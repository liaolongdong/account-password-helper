#!/usr/bin/env node
/**
 * 把页面内可见 `FAQS` 数组渲染成 FAQ 静态 DOM，注入 `index.html` 的 `#faqList` 生成区。
 *
 * 背景：FAQ 原先完全由页面脚本在运行时 `innerHTML` 注入，脚本一旦解析失败（2026-09-27 就是
 * `FAQS` 里一个未转义的英文撇号整段炸掉），41 条问答在服务器返回的字节里根本不存在——
 * 非 JS 爬虫读不到，`<noscript>` 回退段又是一份手工维护的 9 条节选，与 `FAQS` 长期漂移。
 * 现在可见正文与结构化数据同源同构：`FAQS` 仍是唯一真源，本模块负责在构建期把它落成静态 DOM，
 * 页面脚本只负责给静态节点绑交互（语言与页面自带语种不同时才按该语种重建）。
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
  faqs.forEach((item, i) => {
    if (item.category) {
      if (!item.category.zh || !item.category.en) throw new Error(`FAQS[${i}] 分类文案缺少 zh / en`);
      if (!item.iconSvg || !item.iconClass) throw new Error(`FAQS[${i}] 分类缺少 iconClass / iconSvg`);
      return;
    }
    if (!item.q?.zh || !item.q?.en || !item.a?.zh || !item.a?.en) {
      throw new Error(`FAQS[${i}] 不是完整的问答条目（需要 q.zh / q.en / a.zh / a.en）`);
    }
  });
  return faqs;
}

/**
 * 渲染生成区整块文本（含 BEGIN / prettier-ignore / 容器 / END）。
 *
 * `<!-- prettier-ignore -->` 是必须的：prettier 会在 CJK 之间折行，而折行在 HTML 里塌成一个
 * 空格，会把「本地存储方案」拆成「本地 存储方案」。生成区由本函数独占排版，一次成稿。
 *
 * @param {ReturnType<typeof extractFaqs>} faqs 有序条目
 * @param {'zh' | 'en'} lang 输出语言
 * @param {string} [indent] 生成区缩进（默认与 index.html 的 .container 子级一致）
 * @returns {string} 可直接替换 `FAQ_DOM_BLOCK_RE` 命中原区的文本
 */
export function renderFaqDom(faqs, lang, indent = '        ') {
  const pad = n => indent + '  '.repeat(n);
  const nodes = [];

  faqs.forEach(item => {
    if (item.category) {
      nodes.push(
        [
          `${pad(1)}<div class="faq-category">`,
          `${pad(2)}<span class="faq-category-icon ${item.iconClass}">${item.iconSvg}</span>`,
          `${pad(2)}<span class="faq-category-title">${escapeHtml(item.category[lang])}</span>`,
          `${pad(1)}</div>`,
        ].join('\n'),
      );
      return;
    }
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

  const note =
    lang === 'zh'
      ? '由 scripts/build-faq-dom.mjs（pnpm gen:faq-dom）从页面 FAQS 数组注入，改文案只改 FAQS，勿手改这里'
      : 'generated from the page FAQS array by scripts/build-faq-dom.mjs via pnpm gen:en — edit FAQS, not this block';

  return [
    `${indent}${FAQ_DOM_BEGIN} —— ${note} -->`,
    `${indent}<!-- prettier-ignore -->`,
    `${indent}<div class="faq-list" id="faqList">`,
    ...nodes,
    `${indent}</div>`,
    `${indent}${FAQ_DOM_END}`,
  ].join('\n');
}

/**
 * 用新的生成区替换页面里已有的那一块。
 *
 * @param {string} html   页面源码
 * @param {string} block  renderFaqDom 的产物
 * @returns {{ html: string, changed: boolean, count: number }} 结果文本、是否发生变化、问答条数
 */
export function replaceFaqDom(html, block) {
  if (!FAQ_DOM_BLOCK_RE.test(html)) throw new Error('页面里没有 FAQ 生成区，请先在 #faqList 处放置 BEGIN / END 标记');
  const next = html.replace(FAQ_DOM_BLOCK_RE, () => block);
  const count = (block.match(/class="faq-item"/g) || []).length;
  return { html: next, changed: next !== html, count };
}

/**
 * 按目标语言刷新页面的 FAQ 生成区。
 *
 * @param {string} html 页面源码
 * @param {'zh' | 'en'} lang 目标语言
 * @returns {{ html: string, changed: boolean, count: number }}
 */
export function syncFaqDom(html, lang) {
  return replaceFaqDom(html, renderFaqDom(extractFaqs(html), lang));
}
