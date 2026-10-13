/**
 * 落地页 CSS 结构的只读解析工具（供 tests/docs 下的守卫复用）。
 *
 * 为什么单独成文件：`prefers-reduced-motion` 降级块在本仓库里嵌着
 * `@media (max-width: 520px)`，用正则找配对花括号会在嵌套处断掉；而多个守卫文件
 * 都要读同一个结构（隐形初始态与它的终态、降级块里的选择器），各写一遍迟早会漂。
 * 这里只做解析、不含断言，也不带 `describe`——测试文件之间互相 import 会把对方的
 * 用例在自己身上再注册一遍，所以解析逻辑必须待在被测试采集通配之外的位置。
 *
 * @module tests/helpers/landingCss
 */

/** 一条已解析的 CSS 规则 */
export interface CssRule {
  /** 逗号分隔并去空白后的选择器列表 */
  selectors: string[];
  /** 规则体（不含两侧花括号） */
  body: string;
}

/**
 * 去掉 CSS 注释。
 *
 * 必须先于括号配对：本仓库的注释里会写 `{` / `display:none` 这类片段，
 * 留在文本里会让深度计数错位，把一条规则切成两半。
 *
 * @param css CSS 文本
 * @returns 不含注释的 CSS 文本
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 从 `open` 指向的 `{` 起找到配平的 `}`，返回块体。
 *
 * @param css 待扫描的 CSS 文本（调用方需保证已去掉注释）
 * @param open `{` 的下标
 * @returns 块体文本（不含两侧花括号）；未配平时返回到文本末尾
 */
export function braceBody(css: string, open: number): string {
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(open + 1, i - 1);
}

/**
 * 解析一段 CSS 里的规则，递归进 `@media` / `@supports` 的内层。
 *
 * @param css CSS 文本（通常是一个块体）
 * @returns 该段里所有声明块，嵌套层的规则与外层同等列出
 */
export function collectCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const source = stripCssComments(css);
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open === -1) break;
    const prelude = source.slice(cursor, open).replace(/\s+/g, ' ').trim();
    const body = braceBody(source, open);
    const close = source.indexOf('}', open);
    if (prelude.startsWith('@')) rules.push(...collectCssRules(body));
    else if (prelude) rules.push({ selectors: prelude.split(',').map(s => s.trim()), body });
    cursor = close === -1 ? source.length : close + 1;
  }
  return rules;
}

/**
 * 找出页面里所有 `@media (prefers-reduced-motion: reduce)` 块内的规则。
 *
 * 只接受「reduce 块内部」的规则：先按标记切段，再对每段做括号配平切片，
 * 这样块外的规则不会被算进来（否则守卫会因为扫到全文而同样通过，等于没有牙）。
 *
 * @param html 页面源码
 * @returns 降级块里的规则列表
 */
export function reducedMotionRules(html: string): CssRule[] {
  return html
    .split('@media (prefers-reduced-motion: reduce)')
    .slice(1)
    .flatMap(part => {
      const source = stripCssComments(part);
      const open = source.indexOf('{');
      return open === -1 ? [] : collectCssRules(braceBody(source, open));
    });
}

/**
 * 断言用的小工具：降级块里是否存在「选择器完全等于 state 且规则体含某条声明」。
 *
 * 用全等而不是 includes：`html.js .reveal` 是 `html.js .reveal.visible` 的前缀，
 * 子串匹配会让「只写了基准态那条」的降级块蒙混过关。
 *
 * @param rules reducedMotionRules 的结果
 * @param state 期望出现的选择器（逗号组里的单独一项）
 * @param declaration 期望出现在规则体里的声明正则
 * @returns 命中与否
 */
export function hasReducedMotionRule(rules: CssRule[], state: string, declaration: RegExp): boolean {
  return rules.some(rule => rule.selectors.includes(state) && declaration.test(rule.body));
}
