#!/usr/bin/env node
/**
 * 从 privacy.html 生成静态英文隐私页 privacy.en.html。
 *
 * privacy.html 已内置中英双语内容与语言切换器，本脚本仅做以下调整：
 * - 默认显示英文（switchLang('en')）
 * - head 元信息替换为英文
 * - canonical 指向 privacy.en.html
 * - 添加 hreflang 三向链接
 *
 * @file scripts/build-privacy-en-page.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'privacy.html');
const outPath = path.join(root, 'privacy.en.html');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

const EN_TITLE = 'Privacy Policy - Account Password Helper';
const EN_DESCRIPTION =
  'Account Password Helper Privacy Policy — 100% local, zero data collection, AES-256-GCM encryption, no cloud, no account, no network transfer.';

let html = readFileSync(srcPath, 'utf8');

// ---------- head 元信息 ----------
const replaceOnce = (pattern, replacement) => {
  const next = html.replace(pattern, replacement);
  if (next === html) throw new Error(`未匹配到替换目标: ${pattern}`);
  html = next;
};

replaceOnce(/<title>[\s\S]*?<\/title>/, `<title>${EN_TITLE}</title>`);
replaceOnce(/name="description"\s+content="[^"]*"/, `name="description"\n      content="${EN_DESCRIPTION}"`);
replaceOnce(/property="og:title"\s+content="[^"]*"/, `property="og:title"\n      content="${EN_TITLE}"`);
replaceOnce(
  /property="og:description"\s+content="[^"]*"/,
  `property="og:description"\n      content="${EN_DESCRIPTION}"`,
);
replaceOnce(/rel="canonical"\s+href="[^"]*"/, `rel="canonical"\n      href="${SITE}/privacy.en.html"`);

// 添加 hreflang
const hreflangBlock = `
    <link
      rel="alternate"
      hreflang="zh-CN"
      href="${SITE}/privacy.html"
    />
    <link
      rel="alternate"
      hreflang="en"
      href="${SITE}/privacy.en.html"
    />
    <link
      rel="alternate"
      hreflang="x-default"
      href="${SITE}/privacy.html"
    />`;
html = html.replace(/(<link\s+rel="canonical"[\s\S]*?\/>)/, `$1${hreflangBlock}`);

// 默认显示英文
replaceOnce("switchLang('zh');", "switchLang('en');");

html = html.replace(
  '<!doctype html>\n',
  '<!doctype html>\n<!-- privacy.en.html is generated from privacy.html by scripts/build-privacy-en-page.mjs — do not edit manually. -->\n',
);

writeFileSync(outPath, html);
console.log('privacy.en.html generated');
