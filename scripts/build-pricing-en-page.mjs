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
import { OG_IMAGE_EN, OG_IMAGE_ALT } from './lib/share-image.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'pricing.html');
const outPath = path.join(root, 'pricing.en.html');
// CodeQL 误报说明（js/incomplete-hostname-regexp，告警 #7 已按「false positive」dismiss）：SITE 只作为字面量
// 拼接进生成的 canonical 属性值，从不作为正则去匹配主机名，此处无需转义点号或尾部锚定。这里刻意不用行内
// 抑制注释：CodeQL 的抑制判据只覆盖整行定位的结果，本查询报的是列级定位，写了不生效。
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
replaceOnce(/property="og:url"\s+content="[^"]*"/, `property="og:url"\n      content="${SITE}/pricing.en.html"`);
replaceOnce(/property="og:locale"\s+content="zh_CN"/, 'property="og:locale"\n      content="en_US"');
replaceOnce(
  /property="og:locale:alternate"\s+content="en_US"/,
  'property="og:locale:alternate"\n      content="zh_CN"',
);
replaceOnce(/name="twitter:title"\s+content="[^"]*"/, `name="twitter:title"\n      content="${EN_TITLE}"`);
replaceOnce(
  /name="twitter:description"\s+content="[^"]*"/,
  `name="twitter:description"\n      content="${EN_DESCRIPTION}"`,
);
// 分享卡跟着语言走：源页里是中文卡，英文页必须换成英文那张 1200×630
replaceOnce(
  // 连源页那枚中文 alt 一起吃掉再整块重建：只换 og:image 会把中文 alt 留在英文页上；
  // 末尾也要补回被正则吃掉的 `/>`，否则标签不闭合
  /property="og:image"\s+content="[^"]*"\s*\/>\s*<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/>/,
  `property="og:image"\n      content="${OG_IMAGE_EN}"\n    />\n    <meta\n      property="og:image:alt"\n      content="${OG_IMAGE_ALT.en}"\n    />`,
);
replaceOnce(/name="twitter:image"\s+content="[^"]*"/, `name="twitter:image"\n      content="${OG_IMAGE_EN}"`);

// 页内跳转改为英文兄弟页面，避免英文页链向中文页
const replaceEvery = (from, to) => {
  if (!html.includes(from)) throw new Error(`未匹配到替换目标: ${from}`);
  html = html.replaceAll(from, to);
};
replaceEvery('href="./index.html"', 'href="./en.html"');
replaceEvery('href="./privacy.html"', 'href="./privacy.en.html"');

// hreflang 三条交替声明随 pricing.html 一并继承（双语互指内容相同，无需按语言改写）

// JSON-LD 的品牌名按页面语言分流：英文页主名用英文、中文名退到 alternateName。
// 判据在 tests/docs/structuredData.test.ts —— name 必须与本页 <html lang> 匹配。
// 这两行不参与 data-i18n 替换，漏掉会让本脚本产出的英文页带着中文名，生成链因此不可复现。
replaceOnce(
  / {8}"name": "账号密码管理助手",\n {8}"alternateName": "Account Password Helper",/,
  ['        "name": "Account Password Helper",', '        "alternateName": "账号密码管理助手",'].join('\n'),
);

// 语言默认值固定为 en（仍尊重 localStorage 显式选择）
replaceOnce(
  /\/\* localStorage 不可用时保持中文缺省 \*\/\n        \}\n        return 'zh';/,
  "/* localStorage 不可用时保持英文缺省 */\n        }\n        return 'en';",
);

html = html.replace(
  '<!doctype html>\n',
  '<!doctype html>\n<!-- pricing.en.html is generated from pricing.html by scripts/build-pricing-en-page.mjs — do not edit manually. -->\n',
);

writeFileSync(outPath, html);
console.log(
  `pricing.en.html generated: data-i18n ${replacedText}/${textTotal}, data-i18n-html ${replacedHtml}/${htmlTotal}`,
);
