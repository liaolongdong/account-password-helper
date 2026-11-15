/**
 * 标签筛选 chip 的边框基线必须内联，且过渡属性必须枚举
 *
 * 缺陷现场（用户报告：初次打开侧边栏，标签面包屑短暂出现一圈很深的黑边）：
 * `.tag-chip` 是**原生 `<button>`**，而它的 `border` 只声明在本组件的 scoped 样式里。
 * 本组件由 `defineAsyncComponent` 异步加载，样式随 chunk 注入，**不在 sidepanel.html 的
 * 初始 `<link>` 里**（构建产物落在 `assets/SidepanelAuthView-*.css`）。于是存在一个窗口：
 * chip 已进 DOM 并绘制，而那份样式表还没生效——此时它穿的是 UA 默认样式
 * `border: 2px outset`，颜色实测 `rgb(0, 0, 0)`，纯黑。
 *
 * 这个窗口不是理论推演，两条实测证据：
 * 1. 打包产物的 `__vitePreload` 去重分支命中已存在但**仍在加载中**的 `<link>` 时直接
 *    `return`，不等它的 `load`。而 `App.vue` 有三处 `import('…/SidepanelAuthView.vue')`
 *    预热（onMounted 会话可能有效时、preloadIdleModules、以及 defineAsyncComponent 的
 *    loader 本身），谁先发起谁建 link，后来者全部走去重分支。实测把 CSS 响应拖慢 400ms：
 *    预热调用 t=6ms 建 link，loader t=7ms 就 resolve（此刻 chip 计算样式为 `2px outset
 *    rgb(0,0,0)`），而 CSS 的 load 事件到 t=419ms 才触发。
 * 2. 基态那句 `transition: all .2s ease` 把「UA 默认 → 组件样式」这次换装也当成一次
 *    普通过渡：border-color 从黑渐变到 `#e2e8f0`、border-width 2px→1px、
 *    border-style outset→solid，全程 200ms。于是一帧的破绽被拉成肉眼清楚可见的一段黑边。
 *
 * 因此判据是两条，缺一不可：
 * - **基线内联**：中性边框由 `tagChipVars` 写进 `:style`，元素创建即生效，早于任何样式表，
 *   UA 黑边永远没有机会上屏。颜色走 `var(--tag-chip-border, 兜底)` 间接层，
 *   让 hover / 选中态仍能在样式表里改这个自定义属性来换色（内联声明优先级高于任何选择器，
 *   直接写 `border-color` 会被内联压死，那是本守卫第 4 条要拦的退化）。
 * - **过渡枚举**：只过渡 color / background-color / border-color，不用 `all`。
 *
 * 实测三变体对照（同一 harness，CSS 延迟到达后逐帧采样计算样式）：
 * 只收窄 transition 仍有 5 帧深色边（约 61ms）——因为 border-color 本身还在过渡列表里，
 * 黑→浅的渐变照旧；只有把基线内联才降到 0 帧。这也是为什么本守卫不能只守 transition。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

/** 被守护的组件（异步加载，样式不在首屏初始 link 里） */
const COMPONENT = 'components/sidepanel/SidepanelAuthView.vue';

/** 承载边框基线的内联样式工厂 */
const STYLE_FACTORY = 'tagChipVars';

/** 基线边框色走的自定义属性（hover / 选中态改它来换色） */
const BORDER_VAR = '--tag-chip-border';

/** `selector { declarations }` 规则对（注释先抹成空格，否则会被吸进选择器捕获组） */
const RULE_RE = /([^{}]+)\{([^{}]+)\}/g;

/** 把 CSS 注释抹成等长空格，保留偏移 */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
}

/** 取 `.vue` 的 `<style>` 块（脚本里的字符串不参与 CSS 判定） */
function styleSource(source: string): string {
  return (source.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join('\n');
}

/** 取某条**精确**选择器的声明块（`.tag-chip` 不会误取 `.tag-chip:hover` / `.tag-chip__label`） */
function ruleBody(css: string, selector: string): string | null {
  for (const [, rawSelector, body] of blankComments(css).matchAll(RULE_RE)) {
    const parts = rawSelector
      .split(',')
      .map(part => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (parts.includes(selector)) return body;
  }
  return null;
}

/** 取内联样式工厂的函数体（到下一个顶层 `};` 为止） */
function styleFactoryBody(source: string, name: string): string | null {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) return null;
  const end = source.indexOf('\n};', start);
  return end < 0 ? null : source.slice(start, end);
}

/** 工厂返回对象里的 `border` 声明值（键带不带引号都认） */
function inlineBorderValue(factoryBody: string): string | null {
  return /['"]?border['"]?\s*:\s*'([^']*)'/.exec(factoryBody)?.[1] ?? null;
}

/**
 * 内联边框是否是合格基线：宽度 + 线型 + 带兜底的 `var()`
 *
 * 三者都要：少了宽度/线型就压不住 UA 的 `2px outset`；少了兜底值则在样式表到达前
 * `var()` 解析失败，整条 `border` 作废，又退回 UA 黑边——等于没修。
 */
function isBaselineBorder(value: string | null): boolean {
  if (value === null) return false;
  return new RegExp(`^\\S+\\s+\\S+\\s+var\\(\\s*${BORDER_VAR}\\s*,\\s*[^)]+\\)$`).test(value.trim());
}

/** 该声明块是否直接写了 border / border-color（会被内联压死的死声明） */
function declaresBorderColor(body: string): boolean {
  return /(^|;)\s*border(-color)?\s*:/.test(body);
}

/** 该声明块是否把过渡收窄成枚举（`all` 会把 UA 换装也播成动画） */
function transitionIsEnumerated(body: string): boolean {
  const value = /(?:^|;)\s*transition\s*:([^;]+)/.exec(body)?.[1];
  if (value === undefined) return false;
  return !/(^|[\s,])all([\s,]|$)/.test(value.trim());
}

const source = readSource(COMPONENT);
const css = styleSource(source);
const baseRule = ruleBody(css, '.tag-chip');
const factoryBody = styleFactoryBody(source, STYLE_FACTORY);

describe('chip 的 UA 默认边框没有机会上屏', () => {
  it('定位有效：原生 button + scoped 基态规则 + 内联样式工厂三者都在（判据不是空跑）', () => {
    // 原生 button 是本守卫的前提。改成 el-tag / el-check-tag 后 UA 黑边前提消失，
    // 这条会红，提示重新判断判据而不是让它静默放行。
    expect(source, '.tag-chip 已不再是原生 <button>，本守卫的前提变了，请重新判定').toMatch(
      /<button\b[^>]*class="tag-chip"/,
    );
    expect(baseRule, '.tag-chip 基态规则没找到').not.toBeNull();
    expect(factoryBody, `${STYLE_FACTORY} 没找到`).not.toBeNull();
    expect(ruleBody(css, '.tag-chip:hover'), 'hover 态规则没找到').not.toBeNull();
    expect(ruleBody(css, '.tag-chip--active'), '选中态规则没找到').not.toBeNull();
  });

  it('中性边框基线由内联样式提供，且带兜底值', () => {
    const value = inlineBorderValue(factoryBody ?? '');
    expect(
      isBaselineBorder(value),
      [
        `${STYLE_FACTORY} 必须返回形如 border: '1px solid var(${BORDER_VAR}, #e2e8f0)' 的基线。`,
        '边框只写在 scoped 样式里时，异步 chunk 的 CSS 到达前 chip 穿的是 UA 的 2px outset 黑边。',
        `实际取到：${value === null ? '（没有 border 声明）' : value}`,
      ].join('\n'),
    ).toBe(true);
  });

  it('scoped 基态不再声明 border —— 内联已接管，留着只会是一份被压死的假声明', () => {
    expect(
      declaresBorderColor(baseRule ?? ''),
      '.tag-chip 基态又写回了 border/border-color：它被内联声明压过，且把基线搬回了异步样式表',
    ).toBe(false);
  });

  it('hover 与选中态改自定义属性换色，不直接写 border-color', () => {
    for (const selector of ['.tag-chip:hover', '.tag-chip--active']) {
      const body = ruleBody(css, selector) ?? '';
      expect(declaresBorderColor(body), `${selector} 直接写了 border-color，会被内联基线压死（换色静默失效）`).toBe(
        false,
      );
      expect(body, `${selector} 必须通过 ${BORDER_VAR} 换色`).toContain(BORDER_VAR);
    }
  });

  it('基态过渡枚举属性，不用 all', () => {
    expect(
      transitionIsEnumerated(baseRule ?? ''),
      '.tag-chip 的 transition 用了 all（或缺失）：UA→组件样式那次换装会被播成 200ms 黑边渐变',
    ).toBe(true);
  });
});

describe('判据有牙', () => {
  it('基线判据：缺 border / 缺兜底 / 缺宽度线型都被拒，合格写法放行', () => {
    expect(isBaselineBorder(inlineBorderValue("return { '--tag-bg': background };"))).toBe(false);
    // 无兜底：样式表到达前 var() 解析失败，整条 border 作废 → 退回 UA 黑边
    expect(isBaselineBorder(`1px solid var(${BORDER_VAR})`)).toBe(false);
    // 只有颜色：压不住 UA 的 2px outset
    expect(isBaselineBorder(`var(${BORDER_VAR}, #e2e8f0)`)).toBe(false);
    // 写死颜色：基线成立但 hover/选中态再也换不了色
    expect(isBaselineBorder('1px solid #e2e8f0')).toBe(false);
    expect(isBaselineBorder(`1px solid var(${BORDER_VAR}, #e2e8f0)`)).toBe(true);
    // 键带引号的写法同样认
    expect(inlineBorderValue(`return { 'border': '1px solid var(${BORDER_VAR}, #e2e8f0)' };`)).toBe(
      `1px solid var(${BORDER_VAR}, #e2e8f0)`,
    );
  });

  it('死声明判据：border 与 border-color 都抓，改自定义属性不误报', () => {
    expect(declaresBorderColor('color: red; border: 1px solid #e2e8f0;')).toBe(true);
    expect(declaresBorderColor(`color: red; border-color: var(--tag-border);`)).toBe(true);
    expect(declaresBorderColor(`color: red; ${BORDER_VAR}: var(--tag-border);`)).toBe(false);
    // 别的属性里含 border 字样不算声明边框
    expect(declaresBorderColor('border-radius: 999px;')).toBe(false);
  });

  it('过渡判据：all 被拒（含多段写法），枚举放行，缺失也算不合格', () => {
    expect(transitionIsEnumerated('transition: all 0.2s ease;')).toBe(false);
    expect(transitionIsEnumerated('transition: color 0.2s ease, all 0.2s ease;')).toBe(false);
    expect(transitionIsEnumerated('transition: color 0.2s ease, border-color 0.2s ease;')).toBe(true);
    expect(transitionIsEnumerated('transition: color var(--aph-duration-mid) ease;')).toBe(true);
    expect(transitionIsEnumerated('color: red;')).toBe(false);
    // `allow` 之类的词里含 all，不能误判成用了 all
    expect(transitionIsEnumerated('transition: border-color 0.2s ease;')).toBe(true);
  });

  it('选择器取的是精确那一条，不把 hover / 子元素的声明混进基态', () => {
    const sample =
      '.tag-chip { color: red; } .tag-chip:hover { border-color: blue; } .tag-chip__label { overflow: hidden; }';
    expect(ruleBody(sample, '.tag-chip')?.trim()).toBe('color: red;');
    expect(declaresBorderColor(ruleBody(sample, '.tag-chip') ?? '')).toBe(false);
    expect(declaresBorderColor(ruleBody(sample, '.tag-chip:hover') ?? '')).toBe(true);
    expect(ruleBody(sample, '.tag-chip--active')).toBeNull();
  });
});
