/**
 * 官网页面内联脚本语法守卫
 *
 * 背景：落地页的动效「隐形初始态」挂在 `html.js` 选择器下，而这个 `js` 类由 `<head>` 里
 * 一段极小的门控脚本添加；真正给 `.reveal` 补 `.visible` 的 IntersectionObserver 以及
 * 「老浏览器没有 IO 时直接落终态」的兜底，都在页面底部那段主脚本里。两段不在同一个
 * `<script>` 块中，于是「后面的块解析失败」是最坏情况：门控照常生效、兜底全部失效。
 *
 * 2026-09-27 就是这么炸的：`FAQS` 里一条英文答案写了未转义的撇号（`this device's disk`），
 * 单引号字符串被提前闭合，整段主脚本 `Uncaught SyntaxError: Unexpected identifier 's'`
 * 直接不执行，39 个 `.reveal` 节点与整棵 FAQ 永久停在 `opacity: 0`，页面看起来「到处空白」。
 * `.html` 既不在 ESLint 覆盖内，Prettier 也不会去解析页内脚本（实测把坏写法塞进 index.html，
 * `pnpm exec prettier --check` 仍退 0），这类错误此前没有任何自动化门禁能拦住。
 *
 * 断言：
 * 1. 每个对外页面的内联脚本必须能被真实 JS 解析器（`node:vm`）解析通过；
 * 2. 用 `html.js .reveal` 压隐形初始态的页面，必须同时装好「本页脚本抛错就摘掉门控」的
 *    一次性保险，并在揭示逻辑就位后按序解除；
 * 3. 守卫自检——把历史故障形状与「抽掉兜底」两种变异喂进同一个检查函数，必须判为失败
 *    （防止守卫失去牙齿）。
 *
 * @file tests/docs/landingScripts.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { hasReducedMotionRule, reducedMotionRules } from '@/tests/helpers/landingCss';

const ROOT = path.resolve(__dirname, '../..');

/** 参与守卫的页面：仓库根目录的 Pages 页面 + 博客 + 独立产品站（构建产物与本地调试页除外） */
const STATIC_PAGES = [
  'index.html',
  'en.html',
  'compare.html',
  'compare.en.html',
  'pricing.html',
  'pricing.en.html',
  'privacy.html',
  'privacy.en.html',
  'product-site/index.html',
];

/** blog/ 下由 `pnpm gen:blog` 生成的中英文页 */
function blogPages(): string[] {
  const dir = path.join(ROOT, 'blog');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(file => file.endsWith('.html'))
    .sort()
    .map(file => `blog/${file}`);
}

/** 一个解析失败项：定位到页面绝对行号，并带上出错源码行，便于直接改 */
interface ScriptSyntaxIssue {
  page: string;
  scriptIndex: number;
  /** `<script>` 标签在页面中的行号（1 起） */
  tagLine: number;
  /** 语法错误在页面中的绝对行号，解析不到行号时为 null */
  errorLine: number | null;
  message: string;
  sourceLine: string;
}

/** 只跳过后无语法可检查的脚本：外链、JSON-LD、模板；ESM 专有语法报错单独放行 */
const NON_JS_OR_EXTERNAL = /\bsrc\s*=|type\s*=\s*["']?(application\/ld\+json|text\/template|text\/markdown)/i;
/** ESM 才允许、但 `vm.Script` 会误报的写法：内联 module 脚本按脚本解析时应当跳过这些错误 */
const ESM_ONLY_ERRORS =
  /Cannot use import statement|Unexpected token 'export'|await is only valid|Cannot use 'import' outside|Unexpected strict mode reserved word/i;

/**
 * 从一段 HTML 源码中提取内联脚本并逐个做语法解析。
 *
 * 与浏览器一致：经典脚本按 `vm.Script` 解析，解析失败即整块不执行。
 *
 * @param page 页面相对路径，仅用于报告
 * @param html 页面源码
 * @returns 解析失败的脚本列表，全部通过时为空数组
 */
function findScriptSyntaxIssues(page: string, html: string): ScriptSyntaxIssue[] {
  const issues: ScriptSyntaxIssue[] = [];
  // CodeQL 误报说明（js/bad-tag-filter，告警 #9 已按「used in tests」dismiss）：该正则从本仓库自产的 HTML
  // 里提取内联脚本，交给 vm.Script 做语法校验，不承担净化/过滤职责——提取结果只用于报告解析失败，无 HTML
  // 输出也无 DOM sink，漏匹配 `</script >` 这类变体的代价仅是测试少检一块脚本，不存在被绕过的安全边界。
  // 这里刻意不用行内抑制注释：CodeQL 的抑制判据只覆盖整行定位的结果，而本查询报的是列级定位，写了不生效
  // （2026-09-29 实测：抑制注释合入 main 并重扫后，告警仍在同一处重新出现）。
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = scriptRe.exec(html)) !== null) {
    index += 1;
    const attrs = match[1] ?? '';
    const code = match[2] ?? '';
    if (NON_JS_OR_EXTERNAL.test(attrs) || code.trim() === '') continue;

    try {
      new vm.Script(code, { filename: page });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ESM_ONLY_ERRORS.test(message)) continue;
      const tagLine = html.slice(0, match.index).split('\n').length;
      // 报错栈里的行号是相对脚本内容的，脚本首行即 `<script>` 标签所在行
      const stackLine = String((error as Error).stack ?? '')
        .split('\n')
        .find(line => line.includes(`${page}:`));
      const relativeLine = stackLine ? /:(\d+)(?::\d+)?\s*$/.exec(stackLine)?.[1] : undefined;
      const errorLine = relativeLine ? tagLine + Number(relativeLine) - 1 : null;
      const codeLine = errorLine ? html.split('\n')[errorLine - 1] : undefined;
      issues.push({
        page,
        scriptIndex: index,
        tagLine,
        errorLine,
        message,
        sourceLine: (codeLine ?? '').trim().slice(0, 160),
      });
    }
  }

  return issues;
}

function describeIssue(issue: ScriptSyntaxIssue): string {
  const where = issue.errorLine
    ? `${issue.page}:${issue.errorLine}`
    : `${issue.page} 第 ${issue.scriptIndex} 个内联脚本`;
  return `${where} -> ${issue.message}${issue.sourceLine ? `\n    ${issue.sourceLine}` : ''}`;
}

describe('官网页面内联脚本可被 JS 解析', () => {
  const pages = [...STATIC_PAGES, ...blogPages()];

  it('页面清单非空且文件都存在', () => {
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      expect(existsSync(path.join(ROOT, page)), `缺失页面 ${page}`).toBe(true);
    }
  });

  it('所有内联脚本没有语法错误（语法错误会让整块脚本静默不执行，页面停在隐形初始态）', () => {
    const issues = pages.flatMap(page => findScriptSyntaxIssues(page, readFileSync(path.join(ROOT, page), 'utf8')));
    expect(issues.map(describeIssue), '存在解析失败的内联脚本').toEqual([]);
  });
});

describe('守卫自检：必须能抓住历史故障形状', () => {
  /** 2026-09-27 的真实形状：单引号串里出现未转义撇号，`'s` 变成裸标识符 */
  const BROKEN_PAGE = [
    '<!doctype html>',
    '<html>',
    '<head><script>document.documentElement.classList.add("js");</script></head>',
    '<body>',
    '<script>',
    'const FAQS = [',
    "  { q: 'x', a: { en: 'the key stays on this device's disk' } },",
    '];',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');

  it('同一段撇号未转义的脚本会被判为解析失败', () => {
    const issues = findScriptSyntaxIssues('broken.html', BROKEN_PAGE);
    expect(issues).toHaveLength(1);
    expect(issues[0].scriptIndex).toBe(2);
    expect(issues[0].message).toContain('Unexpected identifier');
    expect(issues[0].errorLine).toBe(7);
  });

  it('转义后的等价写法不会误报', () => {
    expect(findScriptSyntaxIssues('fixed.html', BROKEN_PAGE.replace("device's", "device\\'s"))).toEqual([]);
  });
});

/**
 * `html.js` 门控与错误兜底必须成套出现，且顺序固定。
 *
 * 顺序含义：加 `js` 类 → 把门控标成 armed 并挂 error 监听 → （页面样式据此压隐形初始态）
 * → 主脚本用 IntersectionObserver 接管 `.reveal` → 同步初始化跑完置 ready（保险自我失效）。
 * 少任何一环、或者解除写早了，都会把「一处脚本炸 → 整页空白」重新变成可能。
 */
const GATE_SEQUENCE = [
  "classList.add('js')",
  "dataset.jsGate = 'armed'",
  // 页内另有 img 的 error 监听，标记必须点到兜底这一个
  "addEventListener('error', function jsGateFallback",
  'revealObserver',
  "dataset.jsGate = 'ready'",
];

/**
 * 检查一个页面的隐形初始态是否有配套兜底。
 *
 * @param page 页面相对路径，仅用于报告
 * @param html 页面源码
 * @returns 违规描述列表，合规时为空数组
 */
function findJsGateViolations(page: string, html: string): string[] {
  // 前提：页面确实把内容压成了隐形初始态；没有这种状态就不需要兜底
  if (!/html\.js\s+\.reveal\s*\{[^}]*opacity:\s*0/.test(html)) return [];

  const problems: string[] = [];
  let previous = -1;
  for (const marker of GATE_SEQUENCE) {
    const at = html.indexOf(marker);
    if (at === -1) {
      problems.push(`缺少环节 ${marker}`);
      continue;
    }
    if (at < previous) problems.push(`顺序错误：${marker} 出现在上一环节之前`);
    previous = at;
  }
  if (!html.includes("classList.remove('js')")) problems.push('兜底没有摘掉 js 类');
  // 保险必须在揭示完成后失效，否则交互期偶发报错会把整页打回无动效态
  if (!/dataset\.jsGate\s*!==\s*'armed'/.test(html)) problems.push('兜底缺少「已就位就不再干预」的判定');
  return problems.map(problem => `${page}: ${problem}`);
}

/** 隐形初始态与它的终态，两条都必须出现在降级侧 */
const REVEAL_STATES = ['html.js .reveal', 'html.js .reveal.visible'];

/**
 * 隐形初始态必须有减弱动效兜底，且选择器与基准侧一一对应。
 *
 * 漏掉终态那条是真实会犯的形状：基准侧 `html.js .reveal` 是 (0,2,1)，终态同样是 (0,2,1)，
 * 降级块只列基准那条时，`.reveal.visible` 的 `transform: translateY(0)` 仍然生效——
 * 「减弱动效」档里 24px 位移照样跑一遍，而这一档要的恰恰是没有位移。
 *
 * 解析部分复用 `tests/helpers/landingCss`：降级块里还套着 `@media (max-width: 520px)`，
 * 按 `}` 切段会把嵌套层的声明拼进外层选择器，只有括号配平 + 递归进 at-rule 才读得对。
 *
 * @param page 页面相对路径，仅用于报告
 * @param html 页面源码
 * @returns 违规描述列表，合规时为空数组
 */
function findReducedMotionViolations(page: string, html: string): string[] {
  if (!/html\.js\s+\.reveal\s*\{[^}]*opacity:\s*0/.test(html)) return [];
  const reduced = reducedMotionRules(html);
  if (reduced.length === 0) return [`${page}: 有 html.js .reveal 隐形初始态，却没有 prefers-reduced-motion 降级块`];

  const problems: string[] = [];
  for (const state of REVEAL_STATES) {
    if (!hasReducedMotionRule(reduced, state, /transform:\s*none/)) {
      problems.push(`${page}: 降级块里没有一条「${state} { transform: none }」`);
    }
  }
  return problems;
}

describe('html.js 隐形初始态必须配错误兜底', () => {
  const gatedPages = ['index.html', 'en.html', 'compare.html', 'compare.en.html'];

  it.each(gatedPages)('%s 的门控 / 保险 / 解除成套且按序', page => {
    expect(findJsGateViolations(page, readFileSync(path.join(ROOT, page), 'utf8'))).toEqual([]);
  });

  it.each(gatedPages)('%s 的入场位移在减弱动效档被撤掉', page => {
    expect(findReducedMotionViolations(page, readFileSync(path.join(ROOT, page), 'utf8'))).toEqual([]);
  });

  it('守卫自检：抽掉解除标记或 error 监听会被判违规', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const withoutDisarm = html.replace("document.documentElement.dataset.jsGate = 'ready';", '');
    expect(findJsGateViolations('index.html', withoutDisarm).join('\n')).toContain("dataset.jsGate = 'ready'");
    const withoutGuard = html.replace(
      /window\.addEventListener\('error', function jsGateFallback[\s\S]*?\n {6}\}\);/,
      '',
    );
    expect(findJsGateViolations('index.html', withoutGuard).join('\n')).toContain("addEventListener('error'");
  });

  it('守卫自检：降级块只列基准态、漏掉终态会被判违规', () => {
    const html = readFileSync(path.join(ROOT, 'compare.html'), 'utf8');
    const missingTerminal = html.replace('html.js .reveal,\n        html.js .reveal.visible {', 'html.js .reveal {');
    expect(missingTerminal).not.toBe(html);
    expect(findReducedMotionViolations('compare.html', missingTerminal).join('\n')).toContain('.reveal.visible');
  });

  it('没有隐形初始态的页面不被误伤', () => {
    expect(findJsGateViolations('plain.html', '<style>.reveal { opacity: 0.5; }</style>')).toEqual([]);
    expect(findReducedMotionViolations('plain.html', '<style>.reveal { opacity: 0.5; }</style>')).toEqual([]);
  });
});
