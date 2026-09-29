/**
 * 落地页「阅读进度条」守卫
 *
 * 背景：进度条有两套实现——引擎支持滚动时间线时由 CSS 自己走完（`animation-timeline: scroll()`），
 * 缺席时（Safari / 旧 Firefox）由主脚本的 `onScroll` 写 `--scroll-p` 兜底。两套规则都挂在同一个
 * `.nav::after` 上、靠 `@supports` 互斥，因此它们的一致性只能靠源码结构约束来保证：
 *
 * 1. 少了 `@supports` 门控 → 两档同时命中，无门控那条会按权重压过带变量的兜底规则；
 * 2. 少了 `@keyframes` → 时间线跑在一个不存在的动画名上，进度条永远停在 `scaleX(0)`（等于没有）；
 * 3. 少了 JS 兜底、或兜底没被 `scrollTimelineSupported` 门住 → 老引擎没有进度，新引擎白写变量；
 * 4. 少了 reduce 档的整条撤除 → `animation-duration` 塌成 0.01ms 也改不了「时钟是滚动偏移」这件事，
 *    降级用户看到的仍是一条随滚动生长的运动条。
 *
 * 这四条都属于「静默失效」：页面照样能用、控制台一行报错都没有，所以判据必须钉在结构上，
 * 并由文末的变异用例自证仍有牙。
 *
 * @file tests/docs/landingProgressRail.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** 带进度条的页面：中文页是事实来源，英文页由 `pnpm gen:en` 产出，两页都必须成套 */
const RAIL_PAGES = ['index.html', 'en.html'];

/**
 * 取出 `<style>` 里每一条规则的「祖先声明序列」。
 *
 * 为什么不用「数前面有几个 `@supports{` 和几个 `}`」：样式表里 `}` 远多于 `@supports{`，
 * 那种粗算会把每一条规则都判成「无门控」。这里按 CSS 真实的嵌套层级走一遍栈：
 * 遇到 `{` 入栈（记录它的花括号前缀，即选择器或 at-rule 预令），遇到 `}` 出栈，
 * 于是每条规则都能拿到自己完整的包含链。注释与字符串里的括号一并跳过。
 *
 * @param css `<style>` 内容
 * @returns 每条规则的 `{ selector, ancestors }`，ancestors 由外到内
 */
function cssRules(css: string): Array<{ selector: string; ancestors: string[] }> {
  const rules: Array<{ selector: string; ancestors: string[] }> = [];
  const stack: string[] = [];
  let prelude = '';
  let i = 0;

  while (i < css.length) {
    const ch = css[i];
    const next = css[i + 1];
    if (ch === '/' && next === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === '{') {
      stack.push(prelude.trim());
      prelude = '';
      i += 1;
      continue;
    }
    if (ch === '}') {
      const selector = stack[stack.length - 1];
      if (selector && !selector.startsWith('@')) {
        rules.push({ selector, ancestors: stack.slice(0, -1) });
      }
      stack.pop();
      prelude = '';
      i += 1;
      continue;
    }
    if (ch === ';') {
      // 声明结束：栈顶是 at-rule 预令（如 @import）时退回空串，避免把它当成选择器前缀带上
      prelude = '';
      i += 1;
      continue;
    }
    prelude += ch;
    i += 1;
  }
  return rules;
}

/**
 * 收集页面所有样式表的规则链。
 *
 * @param html 页面源码
 * @returns 规则列表（跨多个 `<style>` 合并）
 */
function allCssRules(html: string) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].flatMap(m => cssRules(m[1] ?? ''));
}

/**
 * 按大括号配平取出某段文本之后的完整块（含首尾花括号）。
 *
 * @param text 源码
 * @param openIndex 从该偏移往后找第一个 `{`
 * @returns 完整块文本，配平失败返回空串
 */
function sliceBalancedBlock(text: string, openIndex: number): string {
  const start = text.indexOf('{', openIndex);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * 找出一个页面里阅读进度条的实现缺口。
 *
 * @param page 页面相对路径，仅用于报告
 * @param html 页面源码
 * @returns 违规描述列表，合规时为空数组
 */
function findRailViolations(page: string, html: string): string[] {
  const problems: string[] = [];
  const rules = allCssRules(html);

  // 每一条 .nav::after 都要有明确归属：要么被某个 @supports 罩住（两档实现互斥的前提），
  // 要么落在 reduce 档里（整条撤除）。无归属的那条会同时命中两种引擎，按权重压过带变量的兜底规则。
  const afterRules = rules.filter(rule => /\.nav::after/.test(rule.selector));
  if (!afterRules.length) problems.push(`${page}: 样式表里没有 .nav::after 规则`);
  const gated = afterRules.filter(rule => rule.ancestors.some(a => a.startsWith('@supports')));
  const inReduce = afterRules.filter(rule =>
    rule.ancestors.some(a => /^@media[^{]*prefers-reduced-motion:\s*reduce/.test(a)),
  );
  const orphans = afterRules.filter(rule => !gated.includes(rule) && !inReduce.includes(rule));
  if (orphans.length) problems.push(`${page}: ${orphans.length} 处 .nav::after 既无 @supports 门控也不在 reduce 档`);
  if (gated.length !== 2)
    problems.push(`${page}: @supports 门控的 .nav::after 应为 2 条（主路径 + 兜底），实得 ${gated.length}`);

  // 主路径：CSS 滚动时间线
  const scrollSupport = /@supports\s*\(animation-timeline:\s*scroll\(\)\)/.exec(html);
  const scrollBlock = scrollSupport ? sliceBalancedBlock(html, scrollSupport.index + scrollSupport[0].length - 1) : '';
  if (!scrollBlock) {
    problems.push(`${page}: 缺少 @supports (animation-timeline: scroll()) 主路径`);
  } else {
    if (!/\.nav::after\s*\{/.test(scrollBlock)) problems.push(`${page}: 主路径里没有 .nav::after`);
    if (!/animation-timeline:\s*scroll\(root block\)/.test(scrollBlock))
      problems.push(`${page}: 主路径没有绑定 scroll(root block) 时间线`);
    const animName = /animation-name:\s*([a-zA-Z0-9_-]+)/.exec(scrollBlock)?.[1];
    if (!animName) problems.push(`${page}: 主路径缺少 animation-name`);
    else if (!new RegExp(`@keyframes\\s+${animName}\\s*\\{[\\s\\S]*?transform:\\s*scaleX\\(1\\)`).test(html)) {
      problems.push(`${page}: 动画名 ${animName} 没有对应的 @keyframes（会静默停在 scaleX(0)）`);
    }
    if (!/transform:\s*scaleX\(0\)/.test(scrollBlock))
      problems.push(`${page}: 主路径缺少 scaleX(0) 基准态（未滚动时进度条会满格）`);
  }

  // 兜底路径：@supports not 与脚本判据必须成套
  const notSupport = /@supports\s+not\s*\(animation-timeline:\s*scroll\(\)\)/.exec(html);
  const notBlock = notSupport ? sliceBalancedBlock(html, notSupport.index + notSupport[0].length - 1) : '';
  if (!notBlock) {
    problems.push(`${page}: 缺少 @supports not (animation-timeline: scroll()) 兜底路径`);
  } else {
    if (!/transform:\s*scaleX\(var\(--scroll-p/.test(notBlock)) problems.push(`${page}: 兜底路径没有消费 --scroll-p`);
    if (/animation-timeline:/.test(notBlock))
      problems.push(`${page}: 兜底路径里混进了 animation-timeline（不支持的引擎上写了也不生效）`);
    if (!/const\s+scrollTimelineSupported\s*=/.test(html))
      problems.push(`${page}: 脚本缺少 scrollTimelineSupported 判据`);
    if (!/!scrollTimelineSupported/.test(html)) problems.push(`${page}: 脚本没有用判据把兜底门住`);
    if (!/setProperty\(\s*['"]--scroll-p['"]/.test(html)) problems.push(`${page}: 脚本没有写 --scroll-p`);
  }

  // 降级：reduce 档整条撤掉（时钟是滚动偏移，没有时长可塌）
  const reduceBlocks = [...html.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g)].map(
    hit => sliceBalancedBlock(html, hit.index + hit[0].length - 1) || '',
  );
  if (!reduceBlocks.some(block => /\.nav::after\s*\{[^}]*content:\s*none/.test(block)))
    problems.push(`${page}: reduce 档没有撤掉 .nav::after`);

  return problems;
}

describe('落地页阅读进度条成套', () => {
  it.each(RAIL_PAGES)('%s 的主路径 / 兜底 / 降级三件套齐备', page => {
    expect(findRailViolations(page, readFileSync(path.join(ROOT, page), 'utf8'))).toEqual([]);
  });

  it('.nav 保持 sticky，进度条才有可依附的定位祖先', () => {
    // `.nav` 不是定位元素时，绝对定位的 ::after 会落回初始包含块：
    // 线跑到文档顶端，滚两下就没了——这是本条判据唯一的现实失效形状。
    for (const page of RAIL_PAGES) {
      const html = readFileSync(path.join(ROOT, page), 'utf8');
      const navBlock = /(^|\n) {6}\.nav\s*\{[\s\S]*?\n {6}\}/.exec(html)?.[0];
      expect(navBlock, `${page} 找不到 .nav 规则`).toBeTruthy();
      expect(navBlock, `${page} 的 .nav 不是 sticky`).toContain('position: sticky');
    }
  });

  it('英文页与中文页的进度条实现逐字同源（en.html 是生成物，不允许各写一套）', () => {
    // 必须带 g：matchAll 只接受全局正则，非全局直接抛 TypeError。
    const BLOCK_RE = /\/\* =+ 阅读进度条 =+ \*\/[\s\S]*?(?=\/\* =+ |@media \(prefers-reduced-motion)/g;
    const pick = (file: string) => [...readFileSync(path.join(ROOT, file), 'utf8').matchAll(BLOCK_RE)].map(m => m[0]);
    const zh = pick('index.html');
    const en = pick('en.html');
    expect(zh).toHaveLength(1);
    expect(en).toHaveLength(1);
    expect(en[0].replace(/\s+/g, ' ')).toBe(zh[0].replace(/\s+/g, ' '));
  });
});

describe('守卫自检：判据仍有牙', () => {
  const source = () => readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const cases: Array<[string, string, string]> = [
    ['抽掉 @keyframes 的名字', '@keyframes aph-read-progress', ''],
    ['抽掉 reduce 档的撤除规则', '        .nav::after {\n          content: none;\n        }', ''],
    ['把兜底档写成无门控', '@supports not (animation-timeline: scroll()) {\n        .nav::after {', '.nav::after {'],
    ['抽掉脚本侧的判据门', 'if (navEl && !scrollTimelineSupported) {', 'if (navEl) {'],
    ['抽掉主路径的时间线绑定', 'animation-timeline: scroll(root block);', ''],
  ];

  it.each(cases)('%s 会被判为违规', (_label, needle, replacement) => {
    const html = source();
    expect(html.includes(needle), `变异目标串已不存在，判据可能已经失效：${needle}`).toBe(true);
    expect(findRailViolations('index.html', html.replace(needle, replacement)).length).toBeGreaterThan(0);
  });

  it('未变异的原文不误伤', () => {
    expect(findRailViolations('index.html', source())).toEqual([]);
  });
});
