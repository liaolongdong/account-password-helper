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

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'pricing.html');
const outPath = path.join(root, 'pricing.en.html');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

const EN_TITLE =
  'Free Forever · Pricing — Account Password Helper | Open Source Local Password Manager, No Subscription';
const EN_DESCRIPTION =
  'Account Password Helper is 100% free and open source (GPL-3.0): no subscription, no premium tier, no account required. All features are free for everyone. AES-256-GCM local encryption, zero network transfer, built-in TOTP 2FA, offline security audit and weak password dictionary.';

let html = readFileSync(srcPath, 'utf8');

// ---------- 1. 提取 i18n 字典 ----------
const dictStart = html.indexOf('const i18n = {');
if (dictStart === -1) throw new Error('未找到 i18n 字典起点');
const bodyStart = html.indexOf('{', dictStart);
const dictEnd = html.indexOf('};', bodyStart);
if (dictEnd === -1) throw new Error('未找到 i18n 字典终点');
const i18n = vm.runInNewContext(`(${html.slice(bodyStart, dictEnd + 1)})`);

// ---------- 2. 替换静态 i18n 节点 ----------
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const missing = [];
let replacedText = 0;
let replacedHtml = 0;

const totalText = (html.match(/\bdata-i18n="/g) || []).length;
const totalHtml = (html.match(/\bdata-i18n-html="/g) || []).length;

html = html.replace(/(<[a-zA-Z][^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(?=<\/)/g, (m, open, key) => {
  const entry = i18n[key];
  if (typeof entry?.en !== 'string') {
    missing.push(key);
    return m;
  }
  replacedText += 1;
  return open + escapeHtml(entry.en);
});
html = html.replace(/(<[a-zA-Z][^>]*\bdata-i18n-html="([^"]+)"[^>]*>)([\s\S]*?)(?=<\/)/g, (m, open, key) => {
  const entry = i18n[key];
  if (typeof entry?.en !== 'string') {
    missing.push(key);
    return m;
  }
  replacedHtml += 1;
  return open + entry.en;
});
if (missing.length > 0) throw new Error(`i18n 字典缺少英文条目: ${missing.join(', ')}`);
if (replacedText !== totalText) throw new Error(`data-i18n 覆盖率不一致: ${replacedText}/${totalText}`);
if (replacedHtml !== totalHtml) throw new Error(`data-i18n-html 覆盖率不一致: ${replacedHtml}/${totalHtml}`);

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

// 添加 hreflang（pricing.html 原本没有）
const hreflangBlock = `
    <link
      rel="alternate"
      hreflang="zh-CN"
      href="${SITE}/pricing.html"
    />
    <link
      rel="alternate"
      hreflang="en"
      href="${SITE}/pricing.en.html"
    />
    <link
      rel="alternate"
      hreflang="x-default"
      href="${SITE}/pricing.html"
    />`;
html = html.replace(/(<link\s+rel="canonical"[\s\S]*?\/>)/, `$1${hreflangBlock}`);

// 语言默认值固定为 en
replaceOnce("return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';", "return 'en';");

html = html.replace(
  '<!doctype html>\n',
  '<!doctype html>\n<!-- pricing.en.html is generated from pricing.html by scripts/build-pricing-en-page.mjs — do not edit manually. -->\n',
);

writeFileSync(outPath, html);
console.log(
  `pricing.en.html generated: data-i18n ${replacedText}/${totalText}, data-i18n-html ${replacedHtml}/${totalHtml}`,
);
