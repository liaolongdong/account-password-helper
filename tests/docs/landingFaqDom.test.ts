/**
 * 官网 FAQ 静态 DOM 一致性测试
 *
 * 背景：FAQ 原先完全由页面脚本在运行时 `innerHTML` 注入，2026-09-27 那次 `FAQS` 里一个未转义的
 * 英文撇号把整段主脚本炸掉，41 条问答在服务器返回的字节里一条都不存在，页面只剩空白；页底
 * `<noscript>` 回退段是手工维护的 9 条节选，与 `FAQS` 长期漂移。现在 `FAQS` 仍是唯一真源，
 * 但由 `scripts/build-faq-dom.mjs`（`pnpm gen:faq-dom`）在构建期把中文 DOM 写进 `index.html`
 * 的生成区，`en.html` 的英文 DOM 由 `pnpm gen:en` 用同一模块产出。本文件固化的就是：
 *
 * 1. 生成区与 `FAQS` 逐条、同序、逐字一致（防止改了 `FAQS` 忘了重跑生成——这是新鲜度守卫）；
 * 2. 中英两页的语言各归各位，英文块不残留中文；
 * 3. 折叠态只挂在 `html.js` 下——JS 缺席或兜底回退时 41 条答案必须全展开可读；
 * 4. 静态 DOM 与页内 `renderFaqs()` 模板结构同构（同样的 `faq-q` / `chev` / `faq-a-inner` 与
 *    `aria-expanded="false"`），切语言重建后视觉与交互不变；
 * 5. 手工维护的 `<noscript>` FAQ 段确实被删掉，页内只剩窄屏页头那一个 `<noscript>`。
 *
 * 生成区刻意带 `<!-- prettier-ignore -->`：prettier 会在 CJK 之间折行，折行在 HTML 里塌成一个
 * 空格，会把「本地存储方案」拆成「本地 存储方案」。所以这里的断言按「一节点一行的规范排版」逐字比对。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'node:vm';

const ROOT = path.resolve(__dirname, '../..');

/** 生成区起止标记，与 scripts/lib/faq-dom.mjs 一致（刻意重复一份，让守卫不依赖被守卫的模块） */
const FAQ_DOM_BEGIN = '<!-- BEGIN GENERATED FAQ DOM';
const FAQ_DOM_END = '<!-- END GENERATED FAQ DOM -->';

/** 与页内 `renderFaqs()` 模板逐字一致的折叠箭头；两处任一改动都会在这里变红 */
const CHEV_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>';

const CJK = /[\u4e00-\u9fff]/;
/** 连续 4 个及以上汉字——成句中文的指纹，用来区分「漏翻」与英文文案里合法引用的界面词「中文」 */
const CJK_RUN = /[\u4e00-\u9fff]{4}/;
const CJK_SPACE_CJK = /[\u4e00-\u9fff] [\u4e00-\u9fff]/;

/** 页面内 `FAQS` 数组的条目形态（分类项只有 category/icon*，问答项只有 q/a） */
interface FaqEntry {
  category?: { zh: string; en: string };
  iconClass?: string;
  iconSvg?: string;
  q?: { zh: string; en: string };
  a?: { zh: string; en: string };
}

interface FaqNode {
  kind: 'category' | 'qa';
  /** 分类标题或问题文本 */
  heading: string;
  /** 答案文本，分类节点为 null */
  answer: string | null;
}

/** 反转义生成区里必转的三个字符（`escapeHtml` 的逆变换） */
function decodeHtml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * 截取页面里 `FAQS` 数组的源码区域。
 *
 * 定位方式与生成脚本（字符串感知的括号配平）刻意不同：这里按「6 空格缩进的 `];` 行」收尾。
 * 两条独立路径同时出错的概率远低于共用一个扫描器——共用时扫描器少读一条，DOM 与期望会一起少读，
 * 守卫反而长期绿。条数另由 `q: {` / `category: {` 的出现次数独立核对。
 */
function faqsRegion(html: string, file: string): string {
  const start = html.indexOf('const FAQS = [');
  expect(start, `${file} 未找到 FAQS 数组起点`).toBeGreaterThan(-1);
  const endRe = /\n {6}\];/g;
  endRe.lastIndex = start;
  const hit = endRe.exec(html);
  expect(hit, `${file} 未找到 FAQS 数组终点`).not.toBeNull();
  // 还原 JS 字符串转义：源码里的 `don\'t` 落到 DOM 里是 `don't`，不还原就永远「逐字不一致」
  return html.slice(start, hit!.index).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** 求值 `FAQS` 数组，得到有序条目 */
function faqsFrom(html: string): FaqEntry[] {
  const open = html.indexOf('[', html.indexOf('const FAQS = ['));
  const close = html.indexOf('];', open);
  expect(close, '未找到 FAQS 数组终点').toBeGreaterThan(open);
  return vm.runInNewContext(`(${html.slice(open, close + 1)})`) as FaqEntry[];
}

/** 取出一个页面里 FAQ 生成区的整块文本 */
function faqDomBlock(html: string, file: string): string {
  const begin = html.indexOf(FAQ_DOM_BEGIN);
  const end = html.indexOf(FAQ_DOM_END);
  expect(begin, `${file} 缺少 FAQ 生成区起点`).toBeGreaterThan(-1);
  expect(end, `${file} 缺少 FAQ 生成区终点`).toBeGreaterThan(begin);
  expect(html.indexOf(FAQ_DOM_BEGIN, begin + 1), `${file} FAQ 生成区起点重复`).toBe(-1);
  return html.slice(begin, end + FAQ_DOM_END.length);
}

/**
 * 按生成区的规范排版解析出有序节点。
 *
 * 只认「10 空格缩进的 `<div class="faq-category|faq-item">` 整块」这一形态：形态被改动即解析结果
 * 与 `FAQS` 不符，测试变红，正好用来盯住「生成区字节必须是规范排版」这一不变量。
 */
function parseFaqNodes(block: string): FaqNode[] {
  const nodes: FaqNode[] = [];
  const nodeRe = /^ {10}<div class="(faq-category|faq-item)">\n([\s\S]*?)\n {10}<\/div>$/gm;
  let match: RegExpExecArray | null;
  while ((match = nodeRe.exec(block)) !== null) {
    const [, cls, inner] = match;
    if (cls === 'faq-category') {
      const title = /<span class="faq-category-title">([\s\S]*?)<\/span>/.exec(inner);
      expect(title, `分类节点缺少 faq-category-title：${inner.slice(0, 80)}`).not.toBeNull();
      nodes.push({ kind: 'category', heading: decodeHtml(title![1]), answer: null });
      continue;
    }
    const q = /<button class="faq-q" aria-expanded="false"><span>([\s\S]*?)<\/span>/.exec(inner);
    const a = /<div class="faq-a"><div class="faq-a-inner">([\s\S]*?)<\/div><\/div>/.exec(inner);
    expect(q, `问答节点缺少 aria-expanded="false" 的 faq-q 按钮：${inner.slice(0, 80)}`).not.toBeNull();
    expect(a, `问答节点缺少 faq-a-inner：${q![1]}`).not.toBeNull();
    expect(inner, `问答节点折叠箭头不合规：${q![1]}`).toContain(`<span class="chev">${CHEV_SVG}</span>`);
    nodes.push({ kind: 'qa', heading: decodeHtml(q![1]), answer: decodeHtml(a![1]) });
  }
  return nodes;
}

/** 独立计数：区域里 `q:` / `category:` 的字面出现次数必须等于求值出的条数 */
function assertFaqsCountMatched(region: string, faqs: FaqEntry[], file: string): void {
  expect((region.match(/\bq: \{/g) || []).length, `${file} 问答条数与 FAQS 源码不符（求值少读了）`).toBe(
    faqs.filter(item => !item.category).length,
  );
  expect((region.match(/\bcategory: \{/g) || []).length, `${file} 分类数与 FAQS 源码不符（求值少读了）`).toBe(
    faqs.filter(item => item.category).length,
  );
}

interface Page {
  file: string;
  label: string;
  lang: 'zh' | 'en';
  html: string;
  block: string;
  nodes: FaqNode[];
  faqs: FaqEntry[];
  region: string;
}

function loadPage(file: string, label: string, lang: 'zh' | 'en'): Page {
  const html = readFileSync(path.join(ROOT, file), 'utf8');
  const block = faqDomBlock(html, file);
  const region = faqsRegion(html, file);
  const faqs = faqsFrom(html);
  assertFaqsCountMatched(region, faqs, file);
  return {
    file,
    label,
    lang,
    html,
    block,
    nodes: parseFaqNodes(block),
    faqs,
    region,
  };
}

const zh = loadPage('index.html', '中文页', 'zh');
const en = loadPage('en.html', '英文页', 'en');

/** 把 FAQS 摊平成与生成区同构的有序节点 */
function expectedNodes(page: Page): FaqNode[] {
  return page.faqs.map(item =>
    item.category
      ? { kind: 'category' as const, heading: item.category[page.lang], answer: null }
      : { kind: 'qa' as const, heading: item.q![page.lang], answer: item.a![page.lang] },
  );
}

describe.each([zh, en])('$label — FAQ 生成区与 FAQS 同源', (page: Page) => {
  it('条目非空且问答 / 分类数量与 FAQS 一致', () => {
    expect(page.nodes.length).toBe(page.faqs.length);
    expect(page.nodes.filter(n => n.kind === 'qa').length).toBe(41);
    expect(page.nodes.filter(n => n.kind === 'category').length).toBe(4);
  });

  it('逐条、同序、逐字一致（改 FAQS 忘了重跑生成会在这里变红）', () => {
    expect(page.nodes, `${page.file} 的 FAQ 生成区滞后于 FAQS`).toEqual(expectedNodes(page));
  });

  it('生成区里没有 data-i18n（否则 gen:en 的字典替换会二次改写它）', () => {
    expect(page.block).not.toMatch(/\bdata-i18n/);
  });

  it('生成区独占一道 prettier-ignore，长文案没被折行塞进空格', () => {
    expect(page.block.split('\n')[1].trim(), '起点注释后必须紧跟 prettier-ignore').toBe('<!-- prettier-ignore -->');
    const answers = page.nodes.map(n => n.answer).filter((a): a is string => a !== null);
    expect(answers.every(a => !a.includes('\n'))).toBe(true);
    expect(
      answers.some(a => CJK_SPACE_CJK.test(a)),
      '中文答案里出现「汉字 空格 汉字」，疑为格式化折行',
    ).toBe(false);
  });
});

describe('FAQ 生成区中英对齐', () => {
  it('两页节点类型序列一致（防只重生成一侧）', () => {
    expect(en.nodes.map(n => n.kind)).toEqual(zh.nodes.map(n => n.kind));
  });

  it('中文页问题为中文，英文页问题不残留中文', () => {
    zh.nodes.forEach(node => {
      expect(node.heading, `中文页问题应为中文: ${node.heading}`).toMatch(CJK);
    });
    en.nodes.forEach(node => {
      expect(node.heading, `英文页问题不应残留中文: ${node.heading}`).not.toMatch(CJK);
    });
  });

  it('英文页答案没有整段中文残留（界面词「中文」两字是合法引用）', () => {
    // 判据用「连续 4 个及以上汉字」：漏翻或错版会留成句中文，而英文答案里合法出现的
    // 「interface language (中文 / English)」只有两个汉字，不能按「出现中文即违规」一刀切。
    en.nodes.forEach(node => {
      if (node.answer) expect(node.answer, `英文页答案残留整段中文: ${node.heading}`).not.toMatch(CJK_RUN);
    });
    expect(zh.nodes.filter(n => n.answer && CJK_RUN.test(n.answer)).length).toBeGreaterThan(30);
  });

  it('英文块的每条问答都能在页面 FAQS 源码里逐字找到', () => {
    en.nodes
      .filter(n => n.kind === 'qa')
      .forEach(node => {
        expect(en.region, `英文问题未在 FAQS 中逐字出现: ${node.heading}`).toContain(node.heading);
        expect(en.region, `英文答案未在 FAQS 中逐字出现: ${node.heading}`).toContain(node.answer as string);
      });
  });
});

describe.each([zh, en])('$label — FAQ 静态 DOM 的无 JS 可读路径', (page: Page) => {
  it('折叠态挂在 html.js 下，JS 缺席时答案全展开', () => {
    expect(page.html).toMatch(/html\.js \.faq-a \{[^}]*max-height:\s*0/);
    // 不再存在不受门控的折叠规则：否则无 JS 时静态 DOM 仍是收起的
    expect(page.html).not.toMatch(/(?<!html\.js )\.faq-a \{[^}]*max-height:\s*0/);
    expect(page.html).toMatch(/html\.js \.faq-a-inner \{[^}]*opacity:\s*0/);
  });

  it('手工维护的 <noscript> FAQ 段已删除', () => {
    expect(page.html).not.toContain('faq-noscript');
    expect(page.html).not.toContain('常见问题 / FAQ');
    expect(page.html.match(/^ {4}<noscript>$/gm) || []).toHaveLength(1);
  });

  it('首屏不重建静态 DOM，只绑交互', () => {
    expect(page.html).toContain("document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'");
    expect(page.html).toContain("faqBox.querySelectorAll('.faq-item').forEach(bindFaqItem)");
    expect(page.html).toContain('applyFaqs();');
    // applyLang 里挂的是 applyFaqs；renderFaqs 只在切到非自带语种时才被调用
    expect(page.html).not.toMatch(/renderCarousel\(\);\n {8}renderFaqs\(\);/);
    expect(page.html).toMatch(/function renderFaqs\(\) \{/);
  });
});

describe('守卫自检：生成区滞后会变红', () => {
  it('只改 DOM 不改 FAQS（忘跑生成的典型形态）→ 逐字比对不通过', () => {
    // 直接在生成区上做变异：整页首个命中会落在头部的 FAQPage JSON-LD 上，量不到想量的东西
    const mutated = zh.block.replace('我的密码会被上传到云端吗？', '我的密码会被上传吗？');
    expect(mutated).not.toBe(zh.block);
    expect(parseFaqNodes(mutated)).not.toEqual(expectedNodes(zh));
  });

  it('整条问答被删掉 → 节点序列与 FAQS 不符', () => {
    const dropped = zh.block.replace(/\n {10}<div class="faq-item">[\s\S]*?\n {10}<\/div>/, '');
    expect(dropped).not.toBe(zh.block);
    const nodes = parseFaqNodes(dropped);
    expect(nodes).toHaveLength(zh.nodes.length - 1);
    expect(nodes).not.toEqual(expectedNodes(zh));
  });

  it('抽掉 html.js 前缀 → 无 JS 可读路径的判据变红', () => {
    const ungated = zh.html.replace('html.js .faq-a {', '.faq-a {');
    expect(ungated).toMatch(/(?<!html\.js )\.faq-a \{[^}]*max-height:\s*0/);
    expect(ungated).not.toMatch(/html\.js \.faq-a \{[^}]*max-height:\s*0/);
  });

  it('把交互收回运行时注入（回到旧实现）→ 页面侧判据变红', () => {
    const reverted = zh.html.replace("faqBox.querySelectorAll('.faq-item').forEach(bindFaqItem);", '');
    expect(reverted).not.toContain("faqBox.querySelectorAll('.faq-item').forEach(bindFaqItem)");
  });
});
