/**
 * 原生 button 的 UA 兜底：落到首屏全局样式，且它的「稳态零变化」前提必须一直成立
 *
 * 侧边栏的认证视图是 async chunk，它的样式表可能晚于首帧到达（`__vitePreload` 的去重分支
 * 只为「还没人建过 link」的模块等 load 事件；App.vue 另有三处预热 import 与 loader 抢同一份
 * CSS）。那个窗口里的原生 button 穿的是 UA 默认装——2px outset 黑边配 #efefef 灰底，一帧就
 * 够看见，再被组件里的 `transition: all` 拉成一段可见的深色描边。用户报的「标签面包屑初次
 * 打开时短暂出现深黑色边框」就是这个窗口。
 *
 * 组件级修法（把边框基线内联进元素）已在 `tagChipBorderBaseline.test.ts` 守住。但同一个缺陷
 * 类里还有两个按钮：全站搜索条的「回到本站」与空态的跨子域提示，它们靠各自的类规则兜底，
 * 同样要等异步样式表。逐个内联意味着复制三遍同一个技巧、还要为会换色的属性各加一层自定义
 * 属性间接层，且下一个新增按钮又要重来一次。故这一层收口放在首屏全局样式里的元素级
 * `button` 兜底上：它是唯一能覆盖「组件样式还没到」那个窗口的位置。
 *
 * 那条兜底只在**前提下**才是稳态中性的，本文件守的就是这个前提：
 * 1. 兜底只归零 border 与 background-color，不碰 color / padding / 字体——后几项各按钮可能
 *    有意沿用 UA 值；
 * 2. 侧边栏每个原生 button 的 class 集合里，至少有一个类在基础规则里自带 border 与 background
 *    （专用性 0,1,0 压过 `button` 的 0,0,1），或该元素另有内联基线。任一处缺了，兜底就会替它
 *    画出「透明无底」——比 UA 黑边更不像话，而且不会有任何红。
 * 3. 兜底必须落在**全局** `<style>`：scoped 块到不了异步组件的后代元素。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

const APP = 'entrypoints/sidepanel/App.vue';
const AUTH_VIEW = 'components/sidepanel/SidepanelAuthView.vue';

/** 侧边栏文档可能渲染原生 button 的全部源码落点（options / popup 不在此列，兜底到不了那里） */
const SIDEPANEL_DIRS = ['components/sidepanel', 'entrypoints/sidepanel'];

/** 兜底允许声明的属性（其余一律视为越界，会改变按钮稳态外观） */
const ALLOWED_DECLARATIONS = ['border', 'background', 'background-color'];

/**
 * 边框基线改由内联声明提供的位置：基类规则里刻意没有 border
 *
 * 内联在元素创建时即生效，优先级高于任何选择器，覆盖的是同一个「异步样式表还没到」的窗口。
 * 登记在这里的类，其工厂必须真的返回一条 `border:`；工厂没写或条目被删都会让上面的前提
 * 判据变红（否则这类元素会被当成「缺 border」或「已覆盖」两种口径同时糊过去）。
 */
const INLINE_BORDER_FACTORIES: Record<string, { file: string; factory: string }> = {
  'tag-chip': { file: AUTH_VIEW, factory: 'tagChipVars' },
};

/** 注释抹成等长空格：选择器捕获组会把紧贴规则前的说明文字一起收进来 */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
}

/** `.vue` 文件里的全部 `<style>` 块，附带是否 `scoped` */
function styleBlocks(source: string): { css: string; scoped: boolean }[] {
  return [...source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map(match => ({
    scoped: /\bscoped\b/.test(match[1]),
    css: blankComments(match[2]),
  }));
}

/** `selector { declarations }` 规则对（`@media` 里的内层规则同样会被取到） */
const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;

/** 把一段样式文本拆成规则清单，选择器压平成单空格 */
function rulesOf(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(RULE_RE)].map(rule => ({
    selector: rule[1].trim().replace(/\s+/g, ' '),
    body: rule[2],
  }));
}

/**
 * 拆开选择器组（`.port-pill, .env-pill { … }`），只在圆括号深度 0 处按逗号切
 *
 * `:not(.a, .b)` 里就带逗号，机械 `split(',')` 会把一条选择器切成两截；而分组选择器
 * 不拆开，`.env-pill` 这样与 `.port-pill` 共用一个声明块的类会被整条判成「没有基线」。
 */
function selectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim().replace(/\s+/g, ' '));
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim().replace(/\s+/g, ' '));
  return parts.filter(Boolean);
}

/** 取一个文件全部 `<style>` 块拼起来的规则清单 */
function fileRules(file: string): { selector: string; body: string }[] {
  return styleBlocks(readSource(file)).flatMap(block => rulesOf(block.css));
}

/** 声明块里某条属性的值（未声明返回 null；属性名精确匹配，`border` 不会误取 `border-color`） */
function declaration(body: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(body);
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

/** 声明块里出现的全部属性名 */
function declaredProperties(body: string): string[] {
  return body
    .split(';')
    .map(part => part.split(':')[0].trim().toLowerCase())
    .filter(Boolean);
}

/** 全局 `<style>` 块里元素级 `button` 兜底的声明块（scoped 块不计，它到不了异步组件后代） */
function universalButtonBaseline(source: string): string[] {
  return styleBlocks(source)
    .filter(block => !block.scoped)
    .flatMap(block => rulesOf(block.css))
    .filter(rule => rule.selector === 'button')
    .map(rule => rule.body);
}

/** 兜底是否「宽度归零且任何情况下都画不出边」 */
function isInvisibleBorder(body: string): boolean {
  const value = declaration(body, 'border');
  if (!value) return false;
  const parts = value.split(' ').filter(Boolean);
  const widthIsZero = parts.some(part => /^0(?:px|em|rem|%)?$/.test(part));
  const styleIsSet = parts.some(part => /^(?:solid|none|hidden)$/.test(part));
  const colorIsClear = parts.some(part => part === 'transparent' || /^rgba?\([^)]*\/\s*0\s*\)$/.test(part));
  return widthIsZero && styleIsSet && colorIsClear;
}

/** 兜底是否把背景归零 */
function isTransparentBackground(body: string): boolean {
  return (declaration(body, 'background-color') ?? declaration(body, 'background')) === 'transparent';
}

/** 侧边栏源码里每个原生 `<button>` 的静态 class 集合与出处 */
interface ButtonSite {
  file: string;
  classes: string[];
}

/**
 * 从 `<button` 起找标签真正的结束 `>`：属性值里的 `>` 不算
 *
 * `v-if="crossDomainHintCount > 0"` 就是活例子——按第一个 `>` 截断会把标签切在 class 之前，
 * 于是「有静态 class」被判成「没有」，前提判据要么空跑要么误报。
 */
function openTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i + 1;
  }
  return -1;
}

/** 取出一个文件里的全部原生 button 开标签 */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  let from = 0;
  while ((from = source.indexOf('<button', from)) >= 0) {
    const end = openTagEnd(source, from);
    if (end < 0) break;
    tags.push(source.slice(from, end));
    from = end;
  }
  return tags;
}

function buttonSites(): ButtonSite[] {
  return SIDEPANEL_DIRS.flatMap(dir => listSourceFiles(dir, ['.vue', '.css']))
    .filter(file => file.endsWith('.vue'))
    .flatMap(file =>
      buttonTags(readSource(file)).map(tag => ({
        file,
        classes: /\sclass="([^"]*)"/.exec(tag)?.[1].split(/\s+/).filter(Boolean) ?? [],
      })),
    );
}

/** 该 class 的基础规则里是否声明了某条属性 */
function classDeclares(classes: string[], property: string, rules: { selector: string; body: string }[]): boolean {
  return classes.some(cls =>
    rules.some(rule => selectorList(rule.selector).includes(`.${cls}`) && declaration(rule.body, property) !== null),
  );
}

/** 该 class 的内联边框工厂是否真的返回 `border:`（工厂体是 JS 对象字面量，属性间用逗号分隔） */
function inlineBorderRegistered(cls: string): boolean {
  const entry = INLINE_BORDER_FACTORIES[cls];
  if (!entry) return false;
  const source = readSource(entry.file);
  const start = source.indexOf(`const ${entry.factory}`);
  if (start < 0) return false;
  const end = source.indexOf('\n};', start);
  if (end <= start) return false;
  // 注释先抹掉：紧贴在属性前的那段说明若以中文句号结尾，会把「前一个分隔符」挡在锚点之外
  const body = blankComments(source.slice(start, end)).replace(/\/\/[^\n]*/g, '');
  return /(?:^|[,{])\s*border\s*:\s*['"`]/.test(body);
}

/** 全仓侧边栏样式规则（前提判据要用到所有文件，类规则未必写在按钮自己那一份里） */
const sidepanelRules = SIDEPANEL_DIRS.flatMap(dir =>
  listSourceFiles(dir, ['.vue', '.css']).flatMap(file => fileRules(file)),
);

describe('原生 button 的 UA 兜底', () => {
  const bodies = universalButtonBaseline(readSource(APP));

  it('首屏全局样式里存在元素级 button 兜底（判据不是空跑）', () => {
    expect(bodies.length, `${APP} 的全局 <style> 里没有 button 兜底`).toBeGreaterThan(0);
  });

  it('兜底只归零 border 与 background，不碰颜色、内边距与字体', () => {
    const body = bodies.join(';');
    expect(isInvisibleBorder(body), `border 不是「宽度 0 + 透明」，兜底可能画出边：${body}`).toBe(true);
    expect(isTransparentBackground(body), `背景没有归零，异步样式表未到时仍会看到 UA 灰底：${body}`).toBe(true);
    const trespassing = declaredProperties(body).filter(
      property => !ALLOWED_DECLARATIONS.includes(property) && !property.startsWith('/*'),
    );
    // 其余属性各按钮可能有意沿用 UA 值（字号、内边距、文字色），改了就是稳态变化
    expect(trespassing, `兜底越界声明了 ${trespassing.join(', ')}`).toEqual([]);
  });

  it('判据有牙：border: none 与带宽度/不透明色都不算兜底', () => {
    // `none` 把 border-color 重置成 currentColor（黑），配过渡仍会 animate 出一段深色边
    expect(isInvisibleBorder('border: none')).toBe(false);
    expect(isInvisibleBorder('border: 1px solid transparent')).toBe(false);
    expect(isInvisibleBorder('border: 0')).toBe(false);
    expect(isInvisibleBorder('border: 0 solid currentColor')).toBe(false);
    expect(isInvisibleBorder('border: 0 solid transparent')).toBe(true);
    expect(isTransparentBackground('background-color: transparent')).toBe(true);
    expect(isTransparentBackground('background: transparent')).toBe(true);
    expect(isTransparentBackground('background: #fff')).toBe(false);
    expect(isTransparentBackground('color: transparent')).toBe(false);
  });

  it('兜底必须落在全局 <style>：scoped 块到不了异步组件的后代', () => {
    const scopedOnly = '<style scoped>button { background-color: transparent; border: 0 solid transparent; }</style>';
    expect(universalButtonBaseline(scopedOnly)).toEqual([]);
    const globalOnly = '<style>button { background-color: transparent; border: 0 solid transparent; }</style>';
    expect(universalButtonBaseline(globalOnly)).toHaveLength(1);
  });
});

describe('兜底的前提：侧边栏每个原生按钮都自带边框与背景', () => {
  const sites = buttonSites();

  it('扫描到足够规模的原生按钮（判据不是空跑）', () => {
    expect(sites.length).toBeGreaterThanOrEqual(12);
    const classes = new Set(sites.flatMap(site => site.classes));
    expect(classes.size).toBeGreaterThanOrEqual(10);
  });

  it('每个按钮都带静态 class（没有 class 就无从证明兜底中性）', () => {
    const classless = sites.filter(site => site.classes.length === 0).map(site => site.file);
    expect(
      classless,
      `以下文件里的原生 button 没有静态 class，兜底会把它们改成「透明无底」：\n${classless.join('\n')}`,
    ).toEqual([]);
  });

  it('每个按钮的类集合里都有类声明 border 与 background（或另有内联基线）', () => {
    const violations: string[] = [];
    for (const site of sites) {
      const borderCovered =
        classDeclares(site.classes, 'border', sidepanelRules) || site.classes.some(cls => inlineBorderRegistered(cls));
      const backgroundCovered =
        classDeclares(site.classes, 'background', sidepanelRules) ||
        classDeclares(site.classes, 'background-color', sidepanelRules);
      if (!borderCovered) violations.push(`${site.file} 的 .${site.classes.join('.')} 没有 border 基线`);
      if (!backgroundCovered) violations.push(`${site.file} 的 .${site.classes.join('.')} 没有背景基线`);
    }
    expect(
      violations,
      ['以下原生按钮没有自带的 border / background，全局 button 兜底会把它们改成「透明无底」：', ...violations].join(
        '\n',
      ),
    ).toEqual([]);
  });

  it('判据有牙：缺 border 的类、无 class 的按钮、失联的内联登记都要被认出来', () => {
    // 有背景无边框
    expect(classDeclares(['no-border'], 'border', [{ selector: '.no-border', body: 'background: #fff;' }])).toBe(false);
    expect(classDeclares(['no-border'], 'background', [{ selector: '.no-border', body: 'background: #fff;' }])).toBe(
      true,
    );
    // 修饰类只改颜色时不能顶替基类：`.x--yes` 单独出现在 class 集合里不算有边框
    expect(classDeclares(['btn--yes'], 'border', [{ selector: '.btn--yes', body: 'border-color: #fff;' }])).toBe(false);
    // 精确选择器：`.btn` 不能把 `.btn--yes` 的声明算成自己的
    expect(classDeclares(['btn'], 'border', [{ selector: '.btn--yes', body: 'border: 1px solid;' }])).toBe(false);
    // 分组选择器要拆开：`.port-pill, .env-pill { … }` 里的 `.env-pill` 不能判成缺基线
    expect(selectorList('.port-pill, .env-pill')).toEqual(['.port-pill', '.env-pill']);
    expect(
      classDeclares(['env-pill'], 'border', [{ selector: '.port-pill, .env-pill', body: 'border: 1px solid;' }]),
    ).toBe(true);
    // `:not(.a, .b)` 内部的逗号不是分组边界
    expect(selectorList(':not(.a, .b)')).toEqual([':not(.a, .b)']);
    // 属性值里的 `>` 不是标签结尾（`v-if="count > 0"`），按第一个 `>` 截断会把 class 切掉
    expect(buttonTags('<button v-if="count > 0" class="hint">x</button>')).toEqual([
      '<button v-if="count > 0" class="hint">',
    ]);
    // 内联登记必须真的能在源码里找到工厂并读到 border
    expect(inlineBorderRegistered('tag-chip')).toBe(true);
    expect(inlineBorderRegistered('no-such-class')).toBe(false);
  });
});

describe('全站搜索态两个原生按钮的过渡已枚举', () => {
  const rules = fileRules(AUTH_VIEW);

  /** 取精确类选择器的基础规则声明块（分组选择器里出现过也算） */
  const baseRule = (selector: string): string => {
    const hit = rules.find(rule => selectorList(rule.selector).includes(selector));
    expect(hit, `${AUTH_VIEW} 里找不到 ${selector}`).toBeDefined();
    return hit?.body ?? '';
  };

  it('过渡不用 all：否则 UA→组件样式那次换装也被播成 200ms 动画', () => {
    for (const selector of ['.scope-bar__back', '.cross-domain-hint']) {
      const transition = declaration(baseRule(selector), 'transition') ?? '';
      expect(/\ball\b/.test(transition), `${selector} 的 transition 仍是 all：${transition}`).toBe(false);
      expect(transition, `${selector} 没有声明过渡`).not.toBe('');
    }
    // 判据有牙：`all` 出现在多段过渡里同样要被抓到
    expect(/\ball\b/.test('opacity 0.2s ease, all 0.2s ease')).toBe(true);
    expect(/\ball\b/.test('color 0.2s ease, background-color 0.2s ease')).toBe(false);
  });
});
