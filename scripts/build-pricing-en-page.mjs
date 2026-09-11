#!/usr/bin/env node
/**
 * 从 pricing.html 生成静态英文定价页 pricing.en.html。
 *
 * @file scripts/build-pricing-en-page.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { applyI18n, assertI18nCoverage } from './lib/apply-i18n.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'pricing.html');
const outPath = path.join(root, 'pricing.en.html');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

let html = readFileSync(srcPath, 'utf8');

// ---------- 1. 提取 i18n 字典 ----------
const dictStart = html.indexOf('const i18n = {');
if (dictStart === -1) throw new Error('未找到 i18n 字典起点');
const bodyStart = html.indexOf('{', dictStart);
const dictEnd = html.indexOf('};', bodyStart);
if (dictEnd === -1) throw new Error('未找到 i18n 字典终点');
const i18n = vm.runInNewContext(`(${html.slice(bodyStart, dictEnd + 1)})`);

const EN_TITLE = i18n['meta.title'].en;
const EN_DESCRIPTION = i18n['meta.description'].en;

// ---------- 2. 替换静态 i18n 节点 ----------
const result = applyI18n(html, i18n);
assertI18nCoverage(result, 'i18n');
const { replacedText, textTotal, replacedHtml, htmlTotal } = result;
html = result.html;

// ---------- 3. head 元信息 ----------
const replaceOnce = (pattern, replacement) => {
  const next = html.replace(pattern, replacement);
  if (next === html) throw new Error(`未匹配到替换目标: ${pattern}`);
  html = next;
};

replaceOnce(/<html[\s\S]*?lang="zh-CN"[\s\S]*?data-lang="zh"[\s\S]*?>/, '<html\n  lang="en"\n  data-lang="en"\n>');
replaceOnce(/<title>[\s\S]*?<\/title>/, `<title>${EN_TITLE}</title>`);
replaceOnce(/name="description"\s+content="[^"]*"/, `name="description"\n      content="${EN_DESCRIPTION}"`);
replaceOnce(/property="og:title"\s+content="[^"]*"/, `property="og:title"\n      content="${EN_TITLE}"`);
replaceOnce(
  /property="og:description"\s+content="[^"]*"/,
  `property="og:description"\n      content="${EN_DESCRIPTION}"`,
);
replaceOnce(/rel="canonical"\s+href="[^"]*"/, `rel="canonical"\n      href="${SITE}/pricing.en.html"`);

// 页内跳转改为英文兄弟页面，避免英文页链向中文页
const replaceEvery = (from, to) => {
  if (!html.includes(from)) throw new Error(`未匹配到替换目标: ${from}`);
  html = html.replaceAll(from, to);
};
replaceEvery('href="./index.html"', 'href="./en.html"');
replaceEvery('href="./privacy.html"', 'href="./privacy.en.html"');

// hreflang 三条交替声明随 pricing.html 一并继承（双语互指内容相同，无需按语言改写）

// 语言默认值固定为 en
replaceOnce("return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';", "return 'en';");

html = html.replace(
  '<!doctype html>\n',
  '<!doctype html>\n<!-- pricing.en.html is generated from pricing.html by scripts/build-pricing-en-page.mjs — do not edit manually. -->\n',
);

writeFileSync(outPath, html);
console.log(
  `pricing.en.html generated: data-i18n ${replacedText}/${textTotal}, data-i18n-html ${replacedHtml}/${htmlTotal}`,
);
