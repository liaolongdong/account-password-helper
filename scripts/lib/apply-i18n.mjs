#!/usr/bin/env node
/**
 * 官网静态页 i18n 节点替换逻辑，供 `build-en-page.mjs` 与 `build-pricing-en-page.mjs` 共用。
 *
 * 机制：定位带 `data-i18n` / `data-i18n-html` 的开标签，按标签名做配平扫描找到它自己的
 * 闭合标签，再把整段内部内容替换为字典中的英文条目。
 *
 * 之所以不能以「其后第一个 `</`」作为内容终点：内部含嵌套标签的节点（如
 * `<div data-i18n-html>无 — <span class="highlight">100% 本地</span>，零网络传输</div>`）
 * 会在嵌套闭合处提前收尾，残留半个中文片段，生成中英文混杂的破损 HTML。
 *
 * @file scripts/lib/apply-i18n.mjs
 */

const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 匹配带 i18n 标记的开标签；捕获组 1 为 `-html` 后缀（可选），组 2 为 key */
const OPEN_TAG_RE = /<[a-zA-Z][a-zA-Z0-9-]*\b[^>]*?\bdata-i18n(-html)?="([^"]+)"[^>]*>/g;

/**
 * 从 `from` 起查找 `tagName` 自己的闭合标签位置，同名单开标签会加深一层。
 *
 * @param {string} html    原文
 * @param {string} tagName 待闭合的标签名（小写）
 * @param {number} from    内容起点偏移
 * @returns {number} 闭合标签起始偏移；未找到返回 -1
 */
function findCloseTag(html, tagName, from) {
  const openRe = new RegExp(`<${tagName}(?=[\\s/>])`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  openRe.lastIndex = from;
  closeRe.lastIndex = from;

  let depth = 1;
  let cursor = from;
  while (cursor < html.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return -1;
    if (open && open.index < close.index) {
      depth += 1;
      cursor = open.index + open[0].length;
      continue;
    }
    if (--depth === 0) return close.index;
    cursor = close.index + close[0].length;
  }
  return -1;
}

/**
 * 把所有 i18n 静态节点的内部内容替换为字典中的英文条目。
 *
 * @param {string} html     源页面 HTML（中文为静态字节）
 * @param {Record<string, { zh?: string, en?: string }>} dict  内嵌的中英字典
 * @returns {{ html: string, replacedText: number, textTotal: number, replacedHtml: number, htmlTotal: number, missing: string[] }}
 */
export function applyI18n(html, dict) {
  const textTotal = (html.match(/\bdata-i18n="/g) || []).length;
  const htmlTotal = (html.match(/\bdata-i18n-html="/g) || []).length;
  const missing = [];
  let replacedText = 0;
  let replacedHtml = 0;

  let output = '';
  let cursor = 0;
  OPEN_TAG_RE.lastIndex = 0;

  let match;
  while ((match = OPEN_TAG_RE.exec(html)) !== null) {
    const [openTag, suffix, key] = match;
    const contentStart = match.index + openTag.length;
    const entry = dict[key];

    if (typeof entry?.en !== 'string') {
      missing.push(key);
      output += html.slice(cursor, contentStart);
      cursor = contentStart;
      OPEN_TAG_RE.lastIndex = cursor;
      continue;
    }

    const tagName = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(openTag)[1].toLowerCase();
    const contentEnd = findCloseTag(html, tagName, contentStart);
    if (contentEnd === -1) {
      missing.push(key);
      output += html.slice(cursor, contentStart);
      cursor = contentStart;
      OPEN_TAG_RE.lastIndex = cursor;
      continue;
    }

    output += html.slice(cursor, contentStart) + (suffix ? entry.en : escapeHtml(entry.en));
    cursor = contentEnd;
    OPEN_TAG_RE.lastIndex = contentEnd;
    if (suffix) replacedHtml += 1;
    else replacedText += 1;
  }

  output += html.slice(cursor);
  return { html: output, replacedText, textTotal, replacedHtml, htmlTotal, missing };
}

/**
 * 校验替换结果并抛出与生成脚本一致的覆盖率断言。
 *
 * @param {ReturnType<typeof applyI18n>} result applyI18n 的返回值
 * @param {string} dictLabel 字典名称，用于报错文案
 */
export function assertI18nCoverage(result, dictLabel) {
  if (result.missing.length > 0) {
    throw new Error(`${dictLabel} 字典缺少英文条目: ${[...new Set(result.missing)].join(', ')}`);
  }
  if (result.replacedText !== result.textTotal) {
    throw new Error(`data-i18n 覆盖率不一致: ${result.replacedText}/${result.textTotal}`);
  }
  if (result.replacedHtml !== result.htmlTotal) {
    throw new Error(`data-i18n-html 覆盖率不一致: ${result.replacedHtml}/${result.htmlTotal}`);
  }
}
