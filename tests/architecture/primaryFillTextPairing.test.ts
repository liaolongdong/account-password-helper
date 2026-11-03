/**
 * 「实心主色底 ↔ 主色文字」配对守卫
 *
 * 这个 bug 类在本仓库咬过两次，而且两次都不可能在功能测试里变红：
 * 1. `entrypoints/options/styles.css` 把 `.el-button--primary` 刷成主色实底，同一条 `:deep`
 *    链上的 link/text 变体文字本来就是主色 —— 锁屏的「使用离线恢复密钥」整颗看不见。
 * 2. 管理页头部「添加密码」：全局规则只管 `background`，组件规则只管 `color`，级联按属性
 *    逐条裁决，于是蓝字压蓝底，越 hover 越糊。
 * 两处都靠 `:not(.is-link, .is-text)` 把形状锁死（见 `backupChipWiring.test.ts`），但那只覆盖
 * 「EP 主按钮」这一族。剩下的形状很朴素：**任何一条把底色刷成实心 `--aph-primary` 的规则，
 * 都必须同时把文字翻成白**，否则同一个元素上的主色文字（静止态或另一条状态规则给的）就与底色同色。
 * 这类改动手法上只是「hover 加一行 background」，评审时最容易漏，2026-10-26 我把全仓 64 条
 * 主色文字规则与 36 条主色底色规则逐条核对过：6 处实心填充全部自带 `color: #fff`，同一条规则内
 * 零冲突。这条守卫把那份人工核对的结果固定下来，让下一次加实心底的人必须顺手翻白字。
 *
 * 覆盖边界（如实说明，不假装全）：分组只在**单文件内**按「最末段选择器 + 忽略状态伪类」归并，
 * 因此两类情况不在第三条判据的射程里，各自有别的东西兜着：
 * - 跨文件的祖先底色（上面第 2 类）由 `backupChipWiring.test.ts` 的 `:not()` 形状锁负责；
 * - 同一元素的**不同状态**互撞（`.pagination__page.is-current` 填实底 × `.pagination__page:hover`
 *   设主色文字）也不在射程内——把键放粗到忽略 `--text` / `--info` 这类修饰符，第一条判据就会
 *   在 `styles.css` 的 link/text 变体上假红，而那两处恰恰是靠 `:not()` 排除掉的合法写法。
 *   这一格由第四条断言专门钉住：页码选中态靠 `:disabled` 挡住 hover，不是靠运气。
 * - 渐变、浅底（`--aph-primary-bg`）与半透明 `rgb(... / x%)` 不算实心底——它们是另一类问题
 *   （浅主色底上压主色文字约 2.5:1，属对比度取舍，见 tokens.css 的决策记录与用户待决项）。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

interface Rule {
  /** 仓库相对路径 */
  file: string;
  /** 原始选择器（已压掉换行与多余空格） */
  selector: string;
  /** 规则体文本 */
  body: string;
}

/**
 * 状态伪类：与 `:not(...)` 一起从分组键里剥掉，因为「同一个元素的不同状态」才是本守卫关注的粒度。
 * `focus-visible` / `focus-within` 必须排在 `focus` 前面：`\b` 把 `:focus-visible` 里的连字符
 * 也算成词边界，先短后长会只吃掉 `:focus`、把键切成 `.xxx-visible`（2026-10-26 实测踩到），
 * 于是写在 focus-visible 上的实心底就躲过了配对检查。
 */
const STATE_PSEUDO =
  /:(?:hover|active|focus-visible|focus-within|focus|disabled|enabled)\b(?:\([^)]*\))?|:not\([^)]*\)/g;
/** 实心主色文字：`var(--aph-primary)`（可带兜底值）或 `rgb(var(--aph-primary-rgb))` */
const PRIMARY_TEXT = /(?:^|[;{\s])color\s*:\s*(?:var\(--aph-primary\b[^)]*\)|rgb\(var\(--aph-primary-rgb\)\))/;
/** 实心主色底：只认 `var(--aph-primary)` 整值，`-bg` / `-hover` / 渐变 / 半透明都不算 */
const PRIMARY_FILL = /(?:^|[;{\s])(?:background|background-color)\s*:\s*var\(--aph-primary\)\s*[;!]?/;
/** 够白的文字 */
const WHITE_TEXT = /(?:^|[;{\s])color\s*:\s*(?:#fff\b|#ffffff|white|var\(--el-color-white\))/i;

/** 取样式文本：`.vue` 只取 `<style>` 块，`.css` 取全文 */
function styleText(file: string): string {
  const raw = readSource(file);
  if (!file.endsWith('.css')) {
    return [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(block => block[1]).join('\n');
  }
  return raw;
}

/**
 * 括号配对切出规则块；`@media` / `@supports` 只剥外壳、保留内部规则。
 * 先删块注释：注释里会出现「背景被刷成 --aph-primary」这类散文，不删就会喂出假规则。
 */
function parseRules(file: string, css: string): Rule[] {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('{', cursor);
    if (open === -1) break;
    let depth = 0;
    let close = open;
    for (let index = open; index < text.length; index++) {
      if (text[index] === '{') depth++;
      else if (text[index] === '}' && --depth === 0) {
        close = index;
        break;
      }
    }
    const head = text.slice(cursor, open).trim();
    const body = text.slice(open + 1, close);
    if (head.startsWith('@')) {
      if (!head.startsWith('@keyframes')) {
        text = text.slice(0, cursor) + body + text.slice(close + 1);
        continue;
      }
    } else if (head) {
      rules.push({ file, selector: head.replace(/\s+/g, ' '), body });
    }
    cursor = close + 1;
  }
  return rules;
}

/**  unwrap `:deep()/`:where()`，取最末段选择器并剥掉状态伪类，得到「同一个元素」的分组键 */
function groupKey(selector: string): string {
  const unwrapped = selector.replace(/:(?:deep|where|v-deep)\(([^)]*)\)/g, '$1');
  const last = unwrapped
    .replace(STATE_PSEUDO, '')
    .split(/[\s>+~]+/)
    .filter(Boolean)
    .pop();
  return (last ?? unwrapped).replace(/\s+/g, '').trim();
}

function groupable(rules: Rule[]): Map<string, Rule[]> {
  const groups = new Map<string, Rule[]>();
  for (const rule of rules) {
    const key = `${rule.file}::${groupKey(rule.selector)}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  return groups;
}

const ALL_RULES = ['components', 'entrypoints', 'assets']
  .flatMap(dir => listSourceFiles(dir, ['.vue', '.css']))
  .flatMap(file => parseRules(file, styleText(file)));

const GROUPS = groupable(ALL_RULES);

/** 某条规则是否把底色刷成实心主色 */
function isFill(rule: Rule): boolean {
  return PRIMARY_FILL.test(rule.body);
}

/** 某条规则是否把文字设成主色 */
function isPrimaryText(rule: Rule): boolean {
  return PRIMARY_TEXT.test(rule.body);
}

const FILL_KEYS = [...GROUPS].filter(([, rules]) => rules.some(isFill)).map(([key]) => key);

describe('实心主色底必须自带白字（防「蓝字压蓝底」隐形）', () => {
  it('抽取到全部实心主色填充点，守卫不空跑', () => {
    // 2026-10-26 基线：9 个点。这条清单不是装饰——我先按人工核对写了 8 个，抽取器当场多找出
    // `popup/App.vue` 的操作卡实心图标（那一处 `color: #fff` 与底色同规则，本来就是正确写法），
    // 说明抽取比人眼可靠。新增实心底会在这里变红：不是拦路，而是逼作者同时回答
    // 「这个元素上的主色文字谁来翻白」。
    expect(FILL_KEYS.sort()).toEqual([
      'components/options/VaultPagination.vue::.pagination__page.is-current',
      'components/sidepanel/SidepanelAuthView.vue::.scope-bar__back',
      'components/sidepanel/SidepanelHeader.vue::.add-site-plus',
      'entrypoints/options/styles.css::.el-button--large.el-button--primary',
      'entrypoints/options/styles.css::.el-button--primary',
      'entrypoints/popup/App.vue::.action-card__icon--primary',
      'entrypoints/popup/App.vue::.action-card__shortcut-btn',
      'entrypoints/sidepanel/App.vue::.footer-manage-btn',
      'entrypoints/sidepanel/App.vue::.sp-auth-view-error__retry',
    ]);
  });

  it('同一条规则里不同时出现实心主色底与主色文字', () => {
    const conflicts = ALL_RULES.filter(rule => isFill(rule) && isPrimaryText(rule)).map(
      rule => `${rule.file} ${rule.selector}`,
    );
    expect(conflicts, `这些规则把主色文字直接压在同一颗实心主色底上：${conflicts.join('、')}`).toEqual([]);
  });

  it('被实心主色填充的元素一定拿得到白字：自带，或同组里根本没有主色文字', () => {
    const violations: string[] = [];
    for (const [key, rules] of GROUPS) {
      const filled = rules.filter(isFill);
      if (!filled.length || !rules.some(isPrimaryText)) continue;
      // 主色文字与实心主色底落在同一个元素上：唯一的活路是**每一条**填充规则自己声明白字，
      // 因为级联按属性逐条裁决，静止态的 `color` 会盖过填充态的底色继续生效。
      // 这里用 every 而不是 some：若只要求「组里有一条自带白字」，那么往静止态补一行实心底
      // （hover 那条的白字仍在）就能把蓝字压蓝底藏过去——刀正好砍在这种写法上。
      if (!filled.every(rule => WHITE_TEXT.test(rule.body))) violations.push(key.replace('::', '  '));
    }
    expect(violations, `这些点用实心主色填了底却没翻白字，主色文字会整颗隐形：${violations.join('、')}`).toEqual([]);
  });

  it('页码选中态靠 :disabled 挡住 hover 规则，不靠运气', () => {
    // `.pagination__page:hover:not(:disabled)` 把文字设成主色，而 `.is-current` 把底色填成主色；
    // 两者本可以撞在一起（hover 当前页时蓝字压蓝底），救场的是模板上那句 `:disabled="item === currentPage"`。
    // 这条断言把「靠 disabled」写进守卫：哪天有人把 disabled 摘了，这里必须变红而不是悄悄隐形。
    expect(readSource('components/options/VaultPagination.vue')).toContain(':disabled="item === currentPage"');
  });

  it('分组键把状态伪类归并到同一个元素，`:not()` 与多段选择器只认最末段', () => {
    // 分组键是第三条判据唯一的「同一个元素」判据，它错一次守卫就整体哑火，所以直接单测它本身。
    // `-visible` 那条是 2026-10-26 实测踩过的坑：当时 `focus` 排在 `focus-visible` 前面，
    // `\b` 在连字符处就算词边界，键被切成 `.scope-bar__back-visible`，实心底就此逃逸配对检查。
    expect(groupKey('.scope-bar__back:hover')).toBe('.scope-bar__back');
    expect(groupKey('.scope-bar__back:focus-visible')).toBe('.scope-bar__back');
    expect(groupKey(':deep(.footer-manage-btn):hover')).toBe('.footer-manage-btn');
    expect(groupKey('.el-button--primary:not(.is-link, .is-text)')).toBe('.el-button--primary');
    expect(groupKey('.header-actions .el-button--primary:hover')).toBe('.el-button--primary');
    expect(groupKey('.pagination__page.is-current')).toBe('.pagination__page.is-current');
  });
});
