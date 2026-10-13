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
 * 3. 折叠态只挂在 `html.js` 下——JS 缺席或兜底回退时全部答案必须展开可读；
 * 4. 静态 DOM 与页内 `renderFaqs()` 模板结构同构（同样的 `faq-q` / `chev` / `faq-a-inner` 与
 *    `aria-expanded="false"`），切语言重建后视觉与交互不变；
 * 5. 手工维护的 `<noscript>` FAQ 段确实被删掉，页内只剩窄屏页头那一个 `<noscript>`；
 * 6. 右栏「分类直达」同样只从 `FAQS` 推导：标题、条数、锚点三样与左列逐字对齐，且锚点在页面里
 *    真的落得下去（`#faq-cat-*` 与分类节点成对出现、id 全页唯一、网格拆分只在 ≥1080px 生效）；
 * 7. 右栏第二张卡「没找到答案」的真源是页面的 `I18N` 字典，不是 `FAQS`，也不是页内第二份常量：
 *    生成区里恰好且只允许 `data-i18n="faqRail.helpTitle"` 与 `data-i18n-html="faqRail.help"`
 *    两个标记，卡面字节必须逐字等于字典里该语言的值。这条例外之所以安全，是因为三条写入路径
 *    （生成器 / `gen:en` 的 applyI18n / 页内 applyLang）落的是同一个字符串；除此之外生成区里
 *    不得再出现任何 i18n 标记——问答条目由 `FAQS` 提供，挂上字典 key 只会多一个写入方。
 *
 * 生成区刻意带 `<!-- prettier-ignore -->`：prettier 会在 CJK 之间折行，折行在 HTML 里塌成一个
 * 空格，会把「本地存储方案」拆成「本地 存储方案」。它的作用域只有紧随其后的那一个节点，所以生成区
 * 的每个顶层节点各挂一份。这里的断言按「一节点一行的规范排版」逐字比对。
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

/**
 * 右栏标题的两份真源值：生成区里的字节（由 `faq-dom.mjs` 写入）与页面脚本里的 `FAQ_RAIL_TITLE`
 * 常量必须同时等于这里。刻意不 import 被守卫模块——改了模块而忘了改这里，说明这是一次需要
 *  conscious 确认的文案变更。
 */
const RAIL_TITLE = { zh: '分类直达', en: 'Browse by category' };
/**
 * 右栏出口卡的两条文案在 `I18N` 字典里的 key，与 `scripts/lib/faq-dom.mjs` 的
 * `FAQ_RAIL_HELP_KEYS` 同值（这里刻意重抄一份，让守卫不依赖被守卫的模块）。
 * 生成区里允许出现的 i18n 标记就只有这两个，且各一次。
 */
const HELP_KEYS = { title: 'faqRail.helpTitle', body: 'faqRail.help' };
/** 出口卡正文里那条页内链的落点（页脚微信交流群块），必须与字典文案同进同退 */
const HELP_CONTACT_ANCHOR = 'contact';
/**
 * 出口卡外链的落点：本仓库的 issue 列表，与页头 GitHub 图标、页脚仓库链同一个仓库。
 * 写死整条而不是只断言「以 /issues 结尾」——文案里换成别的仓库路径（比如 discussions）
 * 会让「有问题来这里」这句话悄悄落到一个不存在反馈入口的地方。
 */
const ISSUES_URL = 'https://github.com/liaolongdong/account-password-helper/issues';
/** 分类锚点前缀：与 `faq-dom.mjs` 的 `faqCategoryAnchor` 和页内 `faqCatAnchor` 同式 */
const ANCHOR_PREFIX = 'faq-cat-';
/** sticky 的落位高度，与 `html { scroll-padding-top }` 同值——点锚点后分类标题不被页头压住 */
const RAIL_STICKY_TOP = '84px';

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
  /** 分类节点的锚点 id，问答节点为 null */
  anchor: string | null;
}

/** 右栏一条：锚点、显示标题、该分类下的问答条数 */
interface RailEntry {
  anchor: string;
  label: string;
  count: number;
}

/**
 * 右栏出口卡：两条文案各自挂的字典 key、卡面字节、正文里所有 <a> 的 href（按出现顺序）。
 *
 * `title` 走 `escapeHtml`，`body` 是原样落进去的 HTML，因此两者比对方式不同——
 * 这点差异本身就是「标题是文本、正文是标记」的契约，别在断言里把它们混成一个比较。
 */
interface RailHelp {
  titleKey: string;
  title: string;
  bodyKey: string;
  body: string;
  hrefs: string[];
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

/**
 * 求值页面内嵌的 `I18N` 字典，取出一个条目的 `{ zh, en }`。
 *
 * 终点判据与生成脚本（字符串感知的括号配平）刻意不同：这里认「起点之后第一个 `};`」——
 * 字典里每个条目都以 `},` 收尾，成对出现的 `};` 只有字典自身那一个。两条独立路径读出的值
 * 必须相同，否则「出口卡文案归字典管」这条契约已经开始漏。
 */
function i18nEntry(html: string, key: string, file: string): { zh: string; en: string } {
  const bodyStart = html.indexOf('{', html.indexOf('const I18N = {'));
  expect(bodyStart, `${file} 未找到 I18N 字典起点`).toBeGreaterThan(-1);
  const close = html.indexOf('};', bodyStart);
  expect(close, `${file} 未找到 I18N 字典终点`).toBeGreaterThan(bodyStart);
  const dict = vm.runInNewContext(`(${html.slice(bodyStart, close + 1)})`) as Record<
    string,
    { zh: string; en: string }
  >;
  const entry = dict[key];
  expect(entry, `${file} 的 I18N 字典缺少 ${key}`).toBeTruthy();
  expect(Object.keys(entry).sort(), `${file} I18N['${key}'] 必须只有 zh / en 两个字段`).toEqual(['en', 'zh']);
  expect(entry.zh, `${file} I18N['${key}'].zh 不能为空`).toBeTruthy();
  expect(entry.en, `${file} I18N['${key}'].en 不能为空`).toBeTruthy();
  return entry;
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
 * 只认「10 空格缩进的 `<div class="faq-category" id="…">` / `<div class="faq-item">` 整块」这一
 * 形态：形态被改动即解析结果与 `FAQS` 不符，测试变红，正好用来盯住「生成区字节必须是规范排版」
 * 这一不变量。分类节点的 `id` 是右栏的落点，缺了就等于链接指向不存在的位置，因此并入同一条判据。
 */
function parseFaqNodes(block: string): FaqNode[] {
  const nodes: FaqNode[] = [];
  const nodeRe = /^ {10}<div class="(faq-category|faq-item)"( id="([^"]+)")?>\n([\s\S]*?)\n {10}<\/div>$/gm;
  let match: RegExpExecArray | null;
  while ((match = nodeRe.exec(block)) !== null) {
    const [, cls, , anchor, inner] = match;
    if (cls === 'faq-category') {
      expect(anchor, `分类节点缺少锚点 id，右栏「${inner.slice(0, 40)}」无处可落`).toBeTruthy();
      expect(anchor!, `分类锚点必须形如 faq-cat-<iconClass>：${anchor}`).toMatch(/^faq-cat-[a-z][a-z0-9-]*$/);
      const title = /<span class="faq-category-title">([\s\S]*?)<\/span>/.exec(inner);
      expect(title, `分类节点缺少 faq-category-title：${inner.slice(0, 80)}`).not.toBeNull();
      nodes.push({ kind: 'category', heading: decodeHtml(title![1]), answer: null, anchor: anchor! });
      continue;
    }
    // 问答条目刻意不带 id：`section:target` 那套落位反馈靠这一点，给它们加 id 会静默改行为
    expect(anchor, `问答条目不应带 id：${inner.slice(0, 40)}`).toBeUndefined();
    const q = /<button class="faq-q" aria-expanded="false"><span>([\s\S]*?)<\/span>/.exec(inner);
    const a = /<div class="faq-a"><div class="faq-a-inner">([\s\S]*?)<\/div><\/div>/.exec(inner);
    expect(q, `问答节点缺少 aria-expanded="false" 的 faq-q 按钮：${inner.slice(0, 80)}`).not.toBeNull();
    expect(a, `问答节点缺少 faq-a-inner：${q![1]}`).not.toBeNull();
    expect(inner, `问答节点折叠箭头不合规：${q![1]}`).toContain(`<span class="chev">${CHEV_SVG}</span>`);
    nodes.push({ kind: 'qa', heading: decodeHtml(q![1]), answer: decodeHtml(a![1]), anchor: null });
  }
  return nodes;
}

/**
 * 解析生成区里的右栏（两卡：分类直达 + 没找到答案）。
 *
 * 与问答列同样「一节点一行」严格排版：prettier 一旦拿到这一段的排版权（漏了第二道
 * prettier-ignore）就会把它拆成多行，这里立刻解析不到；同理，右栏若被挪进 `#faqList` 内部，
 * `renderFaqs()` 的 `faqBox.innerHTML = ''` 会在切语言时把它清掉，也由这里的相邻性判据抓住。
 * 出口卡走的是同一道判据：它是 `<aside>` 的第二格，落在 `</nav>` 之后、`</aside>` 之前。
 */
function parseFaqRail(block: string, file: string): { title: string; entries: RailEntry[]; help: RailHelp } {
  const aside = /^ {8}<aside class="faq-rail">\n([\s\S]*?)\n {8}<\/aside>$/m.exec(block);
  expect(aside, `${file} 生成区缺少与问答列表同级的 <aside class="faq-rail">`).not.toBeNull();
  const body = aside![1];

  // 列表闭合标签、prettier-ignore、右栏开标签三行必须紧邻：右栏是 .faq-wrap 的第二格，不是列表的子节点
  expect(block, `${file} 右栏必须紧跟在 #faqList 的 </div> 之后，且自带一道 prettier-ignore`).toMatch(
    /\n {8}<\/div>\n {8}<!-- prettier-ignore -->\n {8}<aside class="faq-rail">/,
  );

  const head = /<nav class="faq-rail-card" aria-labelledby="faqRailTitle">/.exec(body);
  expect(head, `${file} 右栏 nav 缺少 aria-labelledby="faqRailTitle"（或开标签排版被改）`).not.toBeNull();
  const title = /^ {12}<h3 class="faq-rail-title" id="faqRailTitle">([^<]*)<\/h3>$/m.exec(body);
  expect(title, `${file} 右栏缺少带 id="faqRailTitle" 的 h3 标题`).not.toBeNull();
  const listHead = /^ {12}<ol class="faq-toc" id="faqToc">$/m.exec(body);
  expect(listHead, `${file} 右栏目录缺少 id="faqToc" 的 ol`).not.toBeNull();
  expect(body, `${file} 右栏目录没有闭合的 </ol>`).toMatch(/^ {12}<\/ol>$/m);

  const tocRegion = body.slice(listHead!.index);
  const entries: RailEntry[] = [];
  const itemRe =
    /^ {14}<li><a href="#(faq-cat-[a-z][a-z0-9-]*)"><span class="faq-toc-name">([^<]*)<\/span><span class="faq-toc-n">(\d+)<\/span><\/a><\/li>$/gm;
  let item: RegExpExecArray | null;
  while ((item = itemRe.exec(tocRegion)) !== null) {
    entries.push({ anchor: item[1], label: decodeHtml(item[2]), count: Number(item[3]) });
  }
  // 目录区除解析出的条目外不得再有 <li>：格式漂移（多一行、少一个 span）会静默漏计
  expect((tocRegion.match(/<li>/g) || []).length, `${file} 右栏存在解析不到的 <li>`).toBe(entries.length);

  // —— 第二格：「没找到答案」出口卡 ——
  const card = /^ {10}<div class="faq-rail-card faq-rail-card--key">\n([\s\S]*?)\n {10}<\/div>$/m.exec(body);
  expect(card, `${file} 右栏缺少与「分类直达」同级的 faq-rail-card--key 出口卡`).not.toBeNull();
  // 顺序即读序：先给导航，导航走完才给出口；反过来会把出口顶在目录上面
  expect(body.indexOf('faq-rail-card--key'), `${file} 出口卡必须排在目录之后`).toBeGreaterThan(body.indexOf('</nav>'));
  const helpTitle = /^ {12}<h3 class="faq-rail-title" data-i18n="([^"]+)">([^<]*)<\/h3>$/m.exec(card![1]);
  expect(helpTitle, `${file} 出口卡缺少带 data-i18n 的 h3 标题`).not.toBeNull();
  expect(helpTitle![1], `${file} 出口卡标题挂错了字典 key`).toBe(HELP_KEYS.title);
  // 不写 `|| undefined`：`expect(undefined).not.toBeNull()` 是成立的（undefined !== null），
  // 那样这道断言在匹配失败时静默放行，后面读 helpBody![1] 才炸出一个看不出根因的 TypeError。
  const helpBody = /^ {12}<div class="faq-rail-help" data-i18n-html="([^"]+)">([\s\S]*?)<\/div>$/m.exec(card![1]);
  expect(helpBody, `${file} 出口卡缺少 faq-rail-help 正文容器（排版漂移即解析不到）`).not.toBeNull();
  expect(helpBody![1], `${file} 出口卡正文挂错了字典 key`).toBe(HELP_KEYS.body);
  // 正文必须是「两个 <p>」这一形态：段数、顺序与卡片样式（.faq-rail-help p + p）都对得上
  expect(helpBody![2], `${file} 出口卡正文不是两段 <p>`).toMatch(/^<p>[\s\S]*?<\/p><p>[\s\S]*?<\/p>$/);

  return {
    title: decodeHtml(title![1]),
    entries,
    help: {
      titleKey: helpTitle![1],
      title: decodeHtml(helpTitle![2]),
      bodyKey: helpBody![1],
      // 正文原样取出，不反转义：生成器与 applyLang 都是把它当 HTML 直接落进 innerHTML
      body: helpBody![2],
      hrefs: [...helpBody![2].matchAll(/<a href="([^"]+)"/g)].map(hit => hit[1]),
    },
  };
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

/**
 * 把 CSS 注释替换成等长空白，保持偏移量不变——注释里出现的 `{` `}` 会让大括号扫描走偏。
 */
function blankOutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
}

/** 主样式表正文（第一个 `<style>` 块）：只在它里面找规则，避免把 JS 里的 `/*` 当注释起点 */
function mainCss(html: string): string {
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  expect(start, '页面缺少主 <style> 块').toBeGreaterThan(-1);
  expect(end, '主 <style> 块未闭合').toBeGreaterThan(start);
  return html.slice(start + '<style>'.length, end);
}

/**
 * 找出 `selector {` 规则体，并报告它被哪个 `@media` 包住（无则 null）。
 *
 * 断言「两栏与 sticky 只在 ≥1080px 那一档生效」必须知道规则的嵌套层级——按缩进猜会被 `@media`
 * 内部的缩进差异骗到，且改动一处缩进就让判据失效，所以老老实实扫大括号。
 */
function cssRules(html: string, selector: string): Array<{ body: string; media: string | null }> {
  const css = blankOutComments(mainCss(html));
  const needle = `${selector} {`;
  const found: Array<{ body: string; media: string | null }> = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    // 只认「这一行除了缩进就是该选择器」：`.faq-list .faq-item {` 不该被当成 `.faq-item {`
    const lineStart = css.lastIndexOf('\n', at) + 1;
    if (css.slice(lineStart, at).trim() !== '') continue;
    let depth = 0;
    let media: string | null = null;
    for (let i = 0; i < at; i += 1) {
      const ch = css[i];
      if (ch === '{') {
        depth += 1;
        const cond = /@media\s+([^{]+)$/.exec(css.slice(Math.max(0, i - 80), i));
        if (cond && media === null) media = cond[1].trim();
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) media = null;
      }
    }
    const end = css.indexOf('}', from);
    found.push({ body: css.slice(from, end), media });
  }
  return found;
}

/** 按 @media 条件取规则：`media: null` 表示顶层规则 */
function ruleFor(html: string, selector: string, media: string | null, file: string) {
  const hits = cssRules(html, selector).filter(rule => rule.media === media);
  expect(hits, `${file} 缺少${media ? ` ${media} 档的` : '顶层'} ${selector} 规则`).toHaveLength(1);
  return hits[0];
}

interface Page {
  file: string;
  label: string;
  lang: 'zh' | 'en';
  html: string;
  block: string;
  nodes: FaqNode[];
  rail: { title: string; entries: RailEntry[]; help: RailHelp };
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
    rail: parseFaqRail(block, file),
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
      ? {
          kind: 'category' as const,
          heading: item.category[page.lang],
          answer: null,
          anchor: `${ANCHOR_PREFIX}${item.iconClass}`,
        }
      : { kind: 'qa' as const, heading: item.q![page.lang], answer: item.a![page.lang], anchor: null },
  );
}

/** 把 FAQS 摊平成与右栏同构的分组：分类开一组，其后的问答计入该组 */
function expectedRail(page: Page): RailEntry[] {
  const groups: RailEntry[] = [];
  page.faqs.forEach(item => {
    if (item.category) {
      groups.push({ anchor: `${ANCHOR_PREFIX}${item.iconClass}`, label: item.category[page.lang], count: 0 });
      return;
    }
    groups[groups.length - 1].count += 1;
  });
  return groups;
}

describe.each([zh, en])('$label — FAQ 生成区与 FAQS 同源', (page: Page) => {
  it('条目非空且问答 / 分类数量与 FAQS 一致', () => {
    expect(page.nodes.length).toBe(page.faqs.length);
    // 42 是写死的量级锚点：上一条断言只保证「生成区 == FAQS」，两处一起被误删时它仍然绿，
    // 这一条负责让「少了一条问答」这件事必须有人在场外看见。增删条目时同步这个数字。
    expect(page.nodes.filter(n => n.kind === 'qa').length).toBe(42);
    expect(page.nodes.filter(n => n.kind === 'category').length).toBe(4);
  });

  it('逐条、同序、逐字一致（改 FAQS 忘了重跑生成会在这里变红）', () => {
    expect(page.nodes, `${page.file} 的 FAQ 生成区滞后于 FAQS`).toEqual(expectedNodes(page));
  });

  it('生成区里的 i18n 标记恰好是出口卡那两条，问答条目一条都不许挂', () => {
    // 出口卡是唯一的例外（文案真源在字典，见文件头第 7 条）；问答条目由 FAQS 提供，
    // 挂上字典 key 就多出第二个写入方，`gen:en` 的字典替换与 syncFaqDom 会互相回改。
    expect([...page.block.matchAll(/\bdata-i18n(?:-html)?="([^"]+)"/g)].map(m => m[0])).toEqual([
      `data-i18n="${HELP_KEYS.title}"`,
      `data-i18n-html="${HELP_KEYS.body}"`,
    ]);
    // 且必须都落在出口卡里：挂在目录或问答节点上，等于把 FAQS 的条目交给字典改写
    const card = /<div class="faq-rail-card faq-rail-card--key">[\s\S]*?<\/aside>/.exec(page.block)![0];
    expect(card).toContain(`data-i18n="${HELP_KEYS.title}"`);
    expect(card).toContain(`data-i18n-html="${HELP_KEYS.body}"`);
    expect(page.block.slice(0, page.block.indexOf('faq-rail-card--key'))).not.toMatch(/\bdata-i18n/);
  });

  it('生成区每个顶层节点各占一道 prettier-ignore，长文案没被折行塞进空格', () => {
    expect(page.block.split('\n')[1].trim(), '起点注释后必须紧跟 prettier-ignore').toBe('<!-- prettier-ignore -->');
    expect(
      (page.block.match(/<!-- prettier-ignore -->/g) || []).length,
      `${page.file} 生成区应有两道 prettier-ignore（问答列表 + 右栏），少一道就会被格式化改写`,
    ).toBe(2);
    const answers = page.nodes.map(n => n.answer).filter((a): a is string => a !== null);
    expect(answers.every(a => !a.includes('\n'))).toBe(true);
    expect(
      answers.some(a => CJK_SPACE_CJK.test(a)),
      '中文答案里出现「汉字 空格 汉字」，疑为格式化折行',
    ).toBe(false);
  });
});

describe.each([zh, en])('$label — 右栏「分类直达」与问答列同源', (page: Page) => {
  it('标题与 FAQ_RAIL_TITLE 的该语言值逐字一致', () => {
    expect(page.rail.title).toBe(RAIL_TITLE[page.lang]);
  });

  it('分组、顺序、标题、条数与 FAQS 推导结果逐字一致', () => {
    expect(page.rail.entries, `${page.file} 右栏滞后于 FAQS`).toEqual(expectedRail(page));
  });

  it('条数总和等于问答总数，且每组的锚点就是同序分类节点的 id', () => {
    expect(page.rail.entries.reduce((sum, e) => sum + e.count, 0)).toBe(page.nodes.filter(n => n.kind === 'qa').length);
    expect(page.rail.entries.map(e => e.anchor)).toEqual(page.nodes.filter(n => n.anchor).map(n => n.anchor));
  });

  it('每条 href 都能在页面里落到真实 id，且 id 全页唯一', () => {
    const ids = [...page.html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size, `${page.file} 页面存在重复 id，锚点会落错位置`).toBe(ids.length);
    page.rail.entries.forEach(entry => {
      expect(entry.anchor, `${page.file} 右栏锚点缺少 id 前缀`).toMatch(new RegExp(`^${ANCHOR_PREFIX}`));
      expect(ids, `${page.file} 右栏 ${entry.anchor} 指向不存在的 id`).toContain(entry.anchor);
    });
  });

  it('锚点用 iconClass 而不是序号（插删分类不会让已发布的深链错位）', () => {
    const iconClasses = page.faqs.filter(item => item.category).map(item => item.iconClass);
    expect(new Set(iconClasses).size, 'iconClass 重复会让分类锚点撞车').toBe(iconClasses.length);
    page.rail.entries.forEach((entry, i) => {
      expect(entry.anchor).toBe(`${ANCHOR_PREFIX}${iconClasses[i]}`);
    });
  });
});

describe.each([zh, en])('$label — 右栏「没找到答案」出口卡与字典同源', (page: Page) => {
  it('标题与正文逐字等于 I18N 字典里该语言的值（改字典忘了重跑生成会在这里变红）', () => {
    expect(page.rail.help.title).toBe(i18nEntry(page.html, HELP_KEYS.title, page.file)[page.lang]);
    expect(page.rail.help.body).toBe(i18nEntry(page.html, HELP_KEYS.body, page.file)[page.lang]);
  });

  it('英文页的卡面不残留整段中文，中文页的卡面是中文', () => {
    if (page.lang === 'zh') {
      expect(page.rail.help.title, `${page.file} 中文页出口卡标题不是中文`).toMatch(CJK);
      expect(page.rail.help.body, `${page.file} 中文页出口卡正文不是中文`).toMatch(CJK_RUN);
      return;
    }
    expect(page.rail.help.title, `${page.file} 英文页出口卡标题残留中文`).not.toMatch(CJK);
    expect(page.rail.help.body, `${page.file} 英文页出口卡正文残留整段中文`).not.toMatch(CJK_RUN);
  });

  it('正文里的页内链落到真实 id，外链指向 issue 而非随便一个仓库路径', () => {
    const ids = [...page.html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    const inPage = page.rail.help.hrefs.filter(href => href.startsWith('#'));
    expect(inPage, `${page.file} 出口卡没有一条页内链`).toHaveLength(1);
    expect(inPage[0]).toBe(`#${HELP_CONTACT_ANCHOR}`);
    expect(ids, `${page.file} 出口卡的 #${HELP_CONTACT_ANCHOR} 指向不存在的 id`).toContain(HELP_CONTACT_ANCHOR);
    const external = page.rail.help.hrefs.filter(href => href.startsWith('http'));
    expect(external, `${page.file} 出口卡的外链应恰好一条`).toHaveLength(1);
    expect(external[0]).toBe(ISSUES_URL);
    // 外链一律带 noopener，否则新标签页能通过 window.opener 反向操纵本页
    expect(page.rail.help.body).toMatch(/target="_blank" rel="noopener noreferrer"/);
  });

  it('两卡的排版都由 CSS 消费，不是只写在 DOM 里的空类名', () => {
    const file = page.file;
    // .faq-rail 从「一张卡」变成「两卡的网格」：没有这条 gap，两卡会直接贴在一起
    const railBase = ruleFor(page.html, '.faq-rail', null, file).body;
    expect(railBase).toMatch(/display:\s*grid/);
    expect(railBase).toMatch(/gap:\s*14px/);
    expect(cssRules(page.html, '.faq-rail-card--key').length, `${file} 出口卡没有自己的皮肤`).toBeGreaterThan(0);
    expect(cssRules(page.html, '.faq-rail-help p').length, `${file} 出口卡正文没有排版规则`).toBeGreaterThan(0);
  });
});

describe('FAQ 分类直达的两栏布局', () => {
  it.each([zh, en])('$label — #faq 的容器就是网格容器，两格由生成区产出', (page: Page) => {
    // 起点标签与容器之间允许那段说明注释，但不允许插入别的元素
    expect(page.html).toMatch(/<section id="faq">\n(?: {6}<!--[\s\S]*?-->\n){1,2} {6}<div class="container faq-wrap">/);
    expect(page.block).toContain('<div class="faq-list" id="faqList">');
    expect(page.block).toContain('<aside class="faq-rail">');
  });

  it.each([zh, en])('$label — 基准单列、≥1080px 才拆两栏，sticky 只写在那一档', (page: Page) => {
    const file = page.file;
    const base = ruleFor(page.html, '.faq-wrap', null, file);
    expect(base.body).toMatch(/display:\s*grid/);
    expect(base.body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    // start 是 sticky 的前提：默认 stretch 会把右栏拉成问答列那么高，它就没有可移动的空间了
    expect(base.body).toMatch(/align-items:\s*start/);

    const wide = ruleFor(page.html, '.faq-wrap', '(min-width: 1080px)', file);
    expect(wide.body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 320px/);
    expect(wide.body).toMatch(/column-gap:\s*40px/);

    const railWide = ruleFor(page.html, '.faq-rail', '(min-width: 1080px)', file);
    expect(railWide.body).toMatch(/position:\s*sticky/);
    expect(railWide.body).toMatch(new RegExp(`top:\\s*${RAIL_STICKY_TOP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    // 单列那一档不得 sticky：通栏卡片吸在视口上会把左列整段盖住
    const railBase = ruleFor(page.html, '.faq-rail', null, file).body;
    expect(railBase).not.toMatch(/position:/);
    // 网格项两边都是 auto 边距时不再 stretch，只按内容收缩——没有这条 width，
    // 单列档的卡片实测会缩成 126px 的窄条（1440 档被 320px 那一格遮住，看不出来）
    expect(railBase).toMatch(/width:\s*100%/);
    expect(railBase).toMatch(/max-width:\s*420px/);
    expect(railWide.body).toMatch(/margin-inline:\s*0/);
  });

  it('sticky 落位与锚点滚距同值，点「分类直达」后标题不被 sticky 页头压住', () => {
    for (const page of [zh, en]) {
      expect(page.html, `${page.file} 的 scroll-padding-top 与右栏 sticky top 必须同为 ${RAIL_STICKY_TOP}`).toMatch(
        new RegExp(`scroll-padding-top:\\s*${RAIL_STICKY_TOP}`),
      );
    }
  });

  it('两页的右栏样式与结构逐字同源（en.html 是生成物，不允许各写一套）', () => {
    const pick = (page: Page) =>
      /\/\* =+ FAQ 分类直达右栏 =+ \*\/[\s\S]*?(?=\/\* =+ |@media \(prefers-reduced-motion)/.exec(page.html)![0];
    expect(pick(en).replace(/\s+/g, ' ')).toBe(pick(zh).replace(/\s+/g, ' '));
    expect(en.rail.entries.map(e => e.anchor)).toEqual(zh.rail.entries.map(e => e.anchor));
    expect(en.rail.entries.map(e => e.count)).toEqual(zh.rail.entries.map(e => e.count));
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

  it('右栏标题语言各归各位：中文页为中文，英文页不残留中文', () => {
    expect(zh.rail.title).toMatch(CJK);
    expect(en.rail.title).not.toMatch(CJK);
    en.rail.entries.forEach(entry => {
      expect(entry.label, `英文页右栏残留中文分类名: ${entry.label}`).not.toMatch(CJK);
    });
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
    // 右栏首屏同样不重建：`renderFaqRail()` 只有一个调用点，且它就在 renderFaqs 的收尾处
    expect(page.html.match(/^\s+renderFaqRail\(\);$/gm) || []).toHaveLength(1);
  });

  it('页内脚本重建列表时带着锚点与右栏，且与生成区同式', () => {
    // 锚点：语言切换会整列重建，分类节点的 id 必须由脚本一并写回，否则右栏链接全部落空
    expect(page.html).toMatch(/catEl\.id = faqCatAnchor\(item\.iconClass\);/);
    expect(page.html).toMatch(/function faqCatAnchor\(iconClass\) \{\n {8}return `faq-cat-\$\{iconClass\}`;/);
    // 右栏：renderFaqs 尾部重建，标题与目录都跟着语言走
    expect(page.html).toMatch(/function renderFaqRail\(\) \{/);
    expect(page.html).toMatch(/renderFaqRail\(\);\n {6}\}/);
    // 页内常量与生成区的字节同源（生成区里那份来自 scripts/lib/faq-dom.mjs）
    expect(page.html).toContain(`zh: '${RAIL_TITLE.zh}'`);
    expect(page.html).toContain(`en: '${RAIL_TITLE.en}'`);
    // 目录用 textContent 写入，不走 innerHTML——分类标题是文案，不该被当标记解析
    expect(page.html).toMatch(/name\.className = 'faq-toc-name';\n {12}name\.textContent = group\.title;/);
  });
});

describe('守卫自检：生成区或右栏滞后会变红', () => {
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

  it('分类节点丢了锚点 id → 解析即报错，节点序列也与 FAQS 不符', () => {
    const idless = zh.block.replace('<div class="faq-category" id="faq-cat-security">', '<div class="faq-category">');
    expect(idless).not.toBe(zh.block);
    expect(() => parseFaqNodes(idless)).toThrowError(/缺少锚点 id/);
    const ids = [...zh.html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    expect(ids).toContain('faq-cat-security');
  });

  it('改 FAQS 加一条问答而没重跑生成 → 右栏条数对不上', () => {
    const stale = zh.block.replace('faq-toc-n">7<', 'faq-toc-n">6<');
    expect(stale).not.toBe(zh.block);
    expect(parseFaqRail(stale, '变异页').entries).not.toEqual(expectedRail(zh));
  });

  it('右栏少一个分类 → 分组序列与 FAQS 不符', () => {
    const shortRail = zh.block.replace(/\n {14}<li><a href="#faq-cat-basic">[\s\S]*?<\/a><\/li>/, '');
    expect(shortRail).not.toBe(zh.block);
    expect(parseFaqRail(shortRail, '变异页').entries).toHaveLength(zh.rail.entries.length - 1);
    expect(parseFaqRail(shortRail, '变异页').entries).not.toEqual(expectedRail(zh));
  });

  it('右栏被挪进 #faqList 内部（切语言时会被 innerHTML 清空）→ 相邻性判据变红', () => {
    const nested = zh.block.replace(/\n {8}<\/div>\n {8}<!-- prettier-ignore -->\n {8}<aside/, '\n {8}<aside');
    expect(nested).not.toBe(zh.block);
    expect(nested).not.toMatch(/\n {8}<\/div>\n {8}<!-- prettier-ignore -->\n {8}<aside class="faq-rail">/);
  });

  it('抽掉右栏那道 prettier-ignore → 每个顶层节点一道 prettier-ignore 的判据变红', () => {
    const single = zh.block.replace(/\n {8}<!-- prettier-ignore -->\n {8}<aside/, '\n {8}<aside');
    expect((single.match(/<!-- prettier-ignore -->/g) || []).length).toBe(1);
  });

  it('两栏布局挪出 ≥1080px 那一档（窄屏 sticky 盖住左列）→ 布局判据变红', () => {
    const moved = zh.html.replace(
      '@media (min-width: 1080px) {\n        .faq-wrap {',
      '@media (min-width: 640px) {\n        .faq-wrap {',
    );
    expect(moved).not.toBe(zh.html);
    expect(() => ruleFor(moved, '.faq-wrap', '(min-width: 1080px)', '变异页')).toThrowError();
  });

  it('单列档撤掉 width:100%（auto 边距让网格项按内容收缩）→ 布局判据变红', () => {
    // 必须带上 margin-inline 一起定位：`width:100% + max-width:420px` 这一对在 .hero-visual 里也有，
    // 只换前两行会命中它，变异打不中右栏却照样「没改变页面」，自检就成了自欺。
    const shrunk = zh.html.replace(
      '        width: 100%;\n        max-width: 420px;\n        margin-inline: auto;',
      '        max-width: 420px;\n        margin-inline: auto;',
    );
    expect(shrunk).not.toBe(zh.html);
    expect(ruleFor(shrunk, '.faq-rail', null, '变异页').body).not.toMatch(/width:\s*100%/);
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

  it('语言切换时不重建右栏 → renderFaqs 尾部调用判据变红', () => {
    const noRail = zh.html.replace(/renderFaqRail\(\);\n {6}\}/, '}');
    expect(noRail).not.toMatch(/renderFaqRail\(\);\n {6}\}/);
  });

  it('页内标题常量与生成区分道 → 同源判据变红', () => {
    const drifted = zh.html.replace("zh: '分类直达',", "zh: '按分类浏览',");
    expect(drifted).not.toContain(`zh: '${RAIL_TITLE.zh}'`);
  });

  it('手改生成区里的出口卡而没改字典（或没重跑生成）→ 与字典逐字比对不通过', () => {
    const dictTitle = i18nEntry(zh.html, HELP_KEYS.title, 'index.html').zh;
    const edited = zh.block.replace(`>${dictTitle}</h3>`, '>没找到答案</h3>');
    expect(edited).not.toBe(zh.block);
    expect(parseFaqRail(edited, '变异页').help.title).not.toBe(dictTitle);
  });

  it('出口卡的正文标记挂错 key（改成 data-i18n 会丢掉内链）→ 解析即报错', () => {
    const demoted = zh.block.replace('class="faq-rail-help" data-i18n-html=', 'class="faq-rail-help" data-i18n=');
    expect(demoted).not.toBe(zh.block);
    expect(() => parseFaqRail(demoted, '变异页')).toThrowError(/缺少 faq-rail-help 正文容器/);
  });

  it('整张出口卡被删掉 → 右栏两格的判据与 i18n 白名单同时变红', () => {
    const dropped = zh.block.replace(/\n {10}<div class="faq-rail-card faq-rail-card--key">[\s\S]*?\n {10}<\/div>/, '');
    expect(dropped).not.toBe(zh.block);
    expect(() => parseFaqRail(dropped, '变异页')).toThrowError(/faq-rail-card--key 出口卡/);
    expect([...dropped.matchAll(/\bdata-i18n(?:-html)?="([^"]+)"/g)]).toHaveLength(0);
  });

  it('页脚那块改了 id（#contact 落空）→ 落点判据抓不到这条链', () => {
    // 只替换 `id="contact"` 这一段属性，不写成整行开标签：prettier 的 singleAttributePerLine
    // 会把多属性标签拆成一属性一行，整行字面量在格式化之后必然找不到（变异静默不生效）。
    const renamed = zh.html.replace('id="contact"', 'id="wechat"');
    expect(renamed).not.toBe(zh.html);
    const ids = [...renamed.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    expect(ids).not.toContain(HELP_CONTACT_ANCHOR);
  });
});
