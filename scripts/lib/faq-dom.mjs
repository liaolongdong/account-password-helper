#!/usr/bin/env node
/**
 * 把页面内可见 `FAQS` 数组渲染成 FAQ 静态 DOM，注入 `index.html` 的 `#faq` 生成区。
 *
 * 背景：FAQ 原先完全由页面脚本在运行时 `innerHTML` 注入，脚本一旦解析失败（2026-09-27 就是
 * `FAQS` 里一个未转义的英文撇号整段炸掉），41 条问答在服务器返回的字节里根本不存在——
 * 非 JS 爬虫读不到，`<noscript>` 回退段又是一份手工维护的 9 条节选，与 `FAQS` 长期漂移。
 * 现在可见正文与结构化数据同源同构：`FAQS` 仍是唯一真源，本模块负责在构建期把它落成静态 DOM，
 * 页面脚本只负责给静态节点绑交互（语言与页面自带语种不同时才按该语种重建）。
 *
 * 产物是 `.faq-wrap` 网格的两格：`<div class="faq-list" id="faqList">` 问答列表，
 * 与 `<aside class="faq-rail">` 分类直达右栏。右栏同样整段生成——分类标题、每组条数、
 * 锚点 id 三样都只能从 `FAQS` 算出来，手写必然与列表漂移；而它必须和列表同一语言，
 * 所以页内脚本切换语言时与列表一起重建（见 `renderFaqs()`）。
 *
 * 与 `faq-schema.mjs` 的分工：那边产出 JSON-LD（爬虫读到的机器视图），这边产出可见 DOM
 * （人和不执行 JS 的爬虫读到的视图），两者都从同一个 `FAQS` 取文，禁止任何一处另写一套措辞。
 *
 * @file scripts/lib/faq-dom.mjs
 */
import vm from 'node:vm';

/** 生成区起点（后面紧跟说明注释，故只匹配到前缀） */
export const FAQ_DOM_BEGIN = '<!-- BEGIN GENERATED FAQ DOM';
/** 生成区终点 */
export const FAQ_DOM_END = '<!-- END GENERATED FAQ DOM -->';

/** 生成区整体正则：捕获组 1 为缩进，替换时按原缩进回写 */
const FAQ_DOM_BLOCK_RE = /([ \t]*)<!-- BEGIN GENERATED FAQ DOM[\s\S]*?<!-- END GENERATED FAQ DOM -->/;

/** 折叠箭头：与 index.html 内 `renderFaqs()` 模板里的 `<svg>` 逐字一致，由测试钉桩 */
const CHEV_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>';

/**
 * 右栏「分类直达」的栏目标题。
 *
 * 刻意不进页面的 I18N 字典：生成区整体由 `lang` 参数决定语言，挂 `data-i18n` 会让 `gen:en`
 * 的字典替换先改一遍、`syncFaqDom` 再整体覆盖一遍，两道活重叠且第二道才是权威。
 * 页内脚本另存同一份常量（切换语言时重建右栏用），两处字符串由
 * `tests/docs/landingFaqDom.test.ts` 逐字钉住，改动必须一起改。
 */
export const FAQ_RAIL_TITLE = { zh: '分类直达', en: 'Browse by category' };

/** 右栏标题元素的 id（`<nav aria-labelledby>` 指向它），语言无关 */
export const FAQ_RAIL_TITLE_ID = 'faqRailTitle';

/**
 * 分类锚点 id：`#faq-cat-<iconClass>`。
 *
 * 用 `iconClass` 而不是数组下标——下标会在插删分类时整体位移，把已经发出去的
 * 「分类直达」深链指到别的分类上；`iconClass` 本来就是 CSS 用的稳定语义名。
 * 形状与唯一性由 `extractFaqs` 校验。
 *
 * @param {string} iconClass 分类的语义类名（security / basic / data / config）
 * @returns {string} 可直接写进 `id` 与 `href` 的锚点
 */
export function faqCategoryAnchor(iconClass) {
  return `faq-cat-${iconClass}`;
}

/** 转义文本节点里必须转义的字符；FAQ 文案是纯文本，不接受内联 HTML */
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 跳过 `text[start]` 处的一个字符串字面量。
 *
 * @param {string} text  源码
 * @param {number} start 起始引号偏移
 * @returns {number} 结束引号所在偏移
 */
function skipString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  throw new Error(`偏移 ${start} 处的字符串字面量未闭合`);
}

/**
 * 以 `[` 为起点做「字符串 / 注释感知」的括号配平，返回其配对 `]` 的偏移。
 *
 * 不用「其后第一个 `];`」定位数组终点：FAQ 答案里出现 `];` 就会提前截断，
 * 而这条路径同时被生成与测试依赖，必须按 JS 词法走。
 *
 * @param {string} text 源码
 * @param {number} open `[` 所在偏移
 * @returns {number} 配对 `]` 的偏移
 */
function findClosingBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      const lineEnd = text.indexOf('\n', i);
      if (lineEnd === -1) break;
      i = lineEnd;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const blockEnd = text.indexOf('*/', i + 2);
      i = blockEnd === -1 ? text.length : blockEnd + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('未找到 FAQS 数组的配对右方括号');
}

/**
 * 求值页面内的 `FAQS` 数组，得到带分类信息的有序条目。
 *
 * @param {string} html 页面源码（含 `const FAQS = [` 数组）
 * @returns {Array<{category?: {zh: string, en: string}, iconClass?: string, iconSvg?: string, q?: {zh: string, en: string}, a?: {zh: string, en: string}}>}
 */
export function extractFaqs(html) {
  const start = html.indexOf('const FAQS = [');
  if (start === -1) throw new Error('未找到 FAQS 数组起点');
  const open = html.indexOf('[', start);
  const close = findClosingBracket(html, open);
  const faqs = vm.runInNewContext(`(${html.slice(open, close + 1)})`);
  if (!Array.isArray(faqs) || faqs.length === 0) throw new Error('FAQS 数组为空');
  /** iconClass → 首次出现的下标，用于钉住锚点唯一性 */
  const anchors = new Map();
  faqs.forEach((item, i) => {
    if (item.category) {
      if (!item.category.zh || !item.category.en) throw new Error(`FAQS[${i}] 分类文案缺少 zh / en`);
      if (!item.iconSvg || !item.iconClass) throw new Error(`FAQS[${i}] 分类缺少 iconClass / iconSvg`);
      // iconClass 同时是分类锚点的一部分，因此它必须是可直接写进 id 的语义 slug，且全页唯一
      if (!/^[a-z][a-z0-9-]*$/.test(item.iconClass)) {
        throw new Error(
          `FAQS[${i}] 的 iconClass「${item.iconClass}」不是合法锚点 slug（只允许小写字母、数字与连字符）`,
        );
      }
      if (anchors.has(item.iconClass)) {
        throw new Error(
          `FAQS[${i}] 的 iconClass「${item.iconClass}」与 FAQS[${anchors.get(item.iconClass)}] 重复，分类锚点会撞车`,
        );
      }
      anchors.set(item.iconClass, i);
      return;
    }
    if (!item.q?.zh || !item.q?.en || !item.a?.zh || !item.a?.en) {
      throw new Error(`FAQS[${i}] 不是完整的问答条目（需要 q.zh / q.en / a.zh / a.en）`);
    }
    if (anchors.size === 0) throw new Error(`FAQS[${i}] 问答出现在任何分类之前，右栏无法为它归组`);
  });
  return faqs;
}

/**
 * 渲染生成区整块文本（含 BEGIN / prettier-ignore / 容器 / END）。
 *
 * `<!-- prettier-ignore -->` 是必须的：prettier 会在 CJK 之间折行，而折行在 HTML 里塌成一个
 * 空格，会把「本地存储方案」拆成「本地 存储方案」。生成区由本函数独占排版，一次成稿。
 * 它的作用域只有紧随其后的那一个节点，因此生成区里每个顶层节点各挂一份。
 *
 * @param {ReturnType<typeof extractFaqs>} faqs 有序条目
 * @param {'zh' | 'en'} lang 输出语言
 * @param {string} [indent] 生成区缩进（默认与 index.html 的 .container 子级一致）
 * @returns {string} 可直接替换 `FAQ_DOM_BLOCK_RE` 命中原区的文本
 */
export function renderFaqDom(faqs, lang, indent = '        ') {
  const pad = n => indent + '  '.repeat(n);
  const nodes = [];
  /** 右栏条目：与分类同序，count 数到下一个分类为止的问答条数 */
  const rail = [];

  faqs.forEach(item => {
    if (item.category) {
      const anchor = faqCategoryAnchor(item.iconClass);
      rail.push({ anchor, title: item.category[lang], count: 0 });
      nodes.push(
        [
          `${pad(1)}<div class="faq-category" id="${anchor}">`,
          `${pad(2)}<span class="faq-category-icon ${item.iconClass}">${item.iconSvg}</span>`,
          `${pad(2)}<span class="faq-category-title">${escapeHtml(item.category[lang])}</span>`,
          `${pad(1)}</div>`,
        ].join('\n'),
      );
      return;
    }
    rail[rail.length - 1].count += 1;
    nodes.push(
      [
        `${pad(1)}<div class="faq-item">`,
        `${pad(2)}<button class="faq-q" aria-expanded="false"><span>${escapeHtml(item.q[lang])}</span>` +
          `<span class="chev">${CHEV_SVG}</span></button>`,
        `${pad(2)}<div class="faq-a"><div class="faq-a-inner">${escapeHtml(item.a[lang])}</div></div>`,
        `${pad(1)}</div>`,
      ].join('\n'),
    );
  });

  const tocItems = rail.map(section => {
    return (
      `${pad(3)}<li><a href="#${section.anchor}"><span class="faq-toc-name">${escapeHtml(section.title)}</span>` +
      `<span class="faq-toc-n">${section.count}</span></a></li>`
    );
  });

  const note =
    lang === 'zh'
      ? '由 scripts/build-faq-dom.mjs（pnpm gen:faq-dom）从页面 FAQS 数组注入，含问答列表与分类直达右栏，改文案只改 FAQS，勿手改这里'
      : 'generated from the page FAQS array by scripts/build-faq-dom.mjs via pnpm gen:en — holds the Q&A list and the category rail; edit FAQS, not this block';

  return [
    `${indent}${FAQ_DOM_BEGIN} —— ${note} -->`,
    `${indent}<!-- prettier-ignore -->`,
    `${indent}<div class="faq-list" id="faqList">`,
    ...nodes,
    `${indent}</div>`,
    // 右栏与列表是 `.faq-wrap`（即 #faq 的 .container）的两格，同源于 FAQS：
    // 分类标题、条数、锚点三样都必须跟着语言走，因此它和列表一样属于生成区，不手写。
    // prettier-ignore 只管紧随其后的那一个节点，所以两格各挂一份——少了第二份，prettier 会把
    // `<li>` 拆成多行，生成区字节与本页产物不再一致（`pnpm gen:*` 与 `pnpm format` 互相回改）。
    `${indent}<!-- prettier-ignore -->`,
    `${indent}<aside class="faq-rail">`,
    `${indent}  <nav class="faq-rail-card" aria-labelledby="${FAQ_RAIL_TITLE_ID}">`,
    `${indent}    <h3 class="faq-rail-title" id="${FAQ_RAIL_TITLE_ID}">${escapeHtml(FAQ_RAIL_TITLE[lang])}</h3>`,
    `${indent}    <ol class="faq-toc" id="faqToc">`,
    ...tocItems,
    `${indent}    </ol>`,
    `${indent}  </nav>`,
    `${indent}</aside>`,
    `${indent}${FAQ_DOM_END}`,
  ].join('\n');
}

/**
 * 用新的生成区替换页面里已有的那一块。
 *
 * @param {string} html   页面源码
 * @param {string} block  renderFaqDom 的产物
 * @returns {{ html: string, changed: boolean, count: number, sections: number }} 结果文本、是否发生变化、问答条数、分类条数
 */
export function replaceFaqDom(html, block) {
  if (!FAQ_DOM_BLOCK_RE.test(html)) throw new Error('页面里没有 FAQ 生成区，请先在 #faqList 处放置 BEGIN / END 标记');
  const next = html.replace(FAQ_DOM_BLOCK_RE, () => block);
  const count = (block.match(/class="faq-item"/g) || []).length;
  const sections = (block.match(/class="faq-toc-name"/g) || []).length;
  return { html: next, changed: next !== html, count, sections };
}

/**
 * 按目标语言刷新页面的 FAQ 生成区。
 *
 * @param {string} html 页面源码
 * @param {'zh' | 'en'} lang 目标语言
 * @returns {{ html: string, changed: boolean, count: number, sections: number }}
 */
export function syncFaqDom(html, lang) {
  return replaceFaqDom(html, renderFaqDom(extractFaqs(html), lang));
}
