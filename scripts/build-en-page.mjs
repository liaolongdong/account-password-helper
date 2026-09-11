#!/usr/bin/env node
/**
 * 从 index.html 生成静态英文官网页 en.html。
 *
 * 背景：不执行 JS 的 AI 爬虫（GPTBot / PerplexityBot / ClaudeBot 等）只能读到
 * 服务器返回的原始 HTML 字节，index.html 的静态字节为中文，?lang=en 切换依赖
 * 客户端 JS，对这类爬虫无效。en.html 以英文字节直接服务，使 hreflang 双语与
 * AI 引擎引用真正生效。
 *
 * 机制：提取 index.html 内嵌的 I18N 中英字典，替换所有 data-i18n /
 * data-i18n-html 静态节点与 head 元信息；单一事实来源仍为 index.html，
 * 修改文案后运行 `pnpm gen:en` 重新生成（CI 部署前自动执行）。
 *
 * @file scripts/build-en-page.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { applyI18n, assertI18nCoverage } from './lib/apply-i18n.mjs';
import { buildFaqPageJsonLd, parseFaqEntries, selectFaqEntries } from './lib/faq-schema.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'index.html');
const outPath = path.join(root, 'en.html');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

const EN_KEYWORDS =
  'password manager,Chrome extension,local password manager,offline password manager,AES-256-GCM,autofill,auto login,TOTP,2FA,authenticator,password generator,security audit,developer tools,credential manager,local-first,password vault,open source password manager,password manager for developers';
const EN_JSONLD_DESCRIPTION =
  'Free, open-source local password manager: one-keystroke login (fill + tick + click), PBKDF2 600K iterations + per-field AES-256-GCM encryption, built-in TOTP 2FA, security audit and password generator, instant side panel (~20-50ms from cache). Password data is never uploaded.';

const EN_HOWTO_JSONLD = `<!-- HowTo structured data: English version, mirrored from the Chinese HowTo block in index.html -->
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        "name": "How to install the Account Password Helper Chrome extension",
        "description": "Install Account Password Helper from the Chrome Web Store in one click, or download from GitHub Releases for manual installation.",
        "step": [
          {
            "@type": "HowToStep",
            "name": "Install the extension",
            "text": "Visit the Chrome Web Store page and click 'Add to Chrome'; or download the zip from GitHub Releases and load it via developer mode in chrome://extensions/."
          },
          {
            "@type": "HowToStep",
            "name": "Set your master password",
            "text": "On first launch, click the extension icon to open the management page, set a master password (at least 8 characters with letters, numbers and a special character) and choose the session validity period."
          },
          {
            "@type": "HowToStep",
            "name": "Import or add accounts",
            "text": "Add accounts manually, or import CSV/JSON files from Chrome, LastPass, Bitwarden or 1Password in one click."
          },
          {
            "@type": "HowToStep",
            "name": "Start using it",
            "text": "Visit a login page and fill your credentials via inline fill, the side panel, or the Ctrl+Shift+F shortcut; for auto sign-in, click 'Fill and sign in' or turn on the 'Auto login trigger' preference."
          }
        ]
      }
    </script>
`;

let html = readFileSync(srcPath, 'utf8');
// 结构化数据与可见 FAQ 共用同一份条目，避免两处文案漂移
const faqEntries = selectFaqEntries(parseFaqEntries(html));

// ---------- 1. 提取 I18N 字典（纯对象字面量区域） ----------
const dictStart = html.indexOf('const I18N = {');
if (dictStart === -1) throw new Error('未找到 I18N 字典起点');
const bodyStart = html.indexOf('{', dictStart);
const dictEnd = html.indexOf('};', bodyStart);
if (dictEnd === -1) throw new Error('未找到 I18N 字典终点');
const I18N = vm.runInNewContext(`(${html.slice(bodyStart, dictEnd + 1)})`);

// ---------- 2. 替换静态 i18n 节点 ----------
const result = applyI18n(html, I18N);
assertI18nCoverage(result, 'I18N');
const { replacedText, textTotal, replacedHtml, htmlTotal } = result;
html = result.html;

// ---------- 3. head 元信息与结构化数据 ----------
const replaceOnce = (pattern, replacement) => {
  const next = html.replace(pattern, replacement);
  if (next === html) throw new Error(`未匹配到替换目标: ${pattern}`);
  html = next;
};

replaceOnce('<html lang="zh-CN">', '<html lang="en">');
replaceOnce(/<title>[\s\S]*?<\/title>/, `<title>${I18N['meta.title'].en}</title>`);
replaceOnce(
  /name="description"\s+content="[^"]*"/,
  `name="description"\n      content="${I18N['meta.description'].en}"`,
);
replaceOnce(/name="keywords"\s+content="[^"]*"/, `name="keywords"\n      content="${EN_KEYWORDS}"`);
replaceOnce(
  /name="application-name"\s+content="[^"]*"/,
  'name="application-name"\n      content="Account Password Helper"',
);
replaceOnce(/property="og:title"\s+content="[^"]*"/, `property="og:title"\n      content="${I18N['meta.title'].en}"`);
replaceOnce(
  /property="og:description"\s+content="[^"]*"/,
  `property="og:description"\n      content="${I18N['meta.description'].en}"`,
);
replaceOnce(/property="og:url"\s+content="[^"]*"/, `property="og:url"\n      content="${SITE}/en.html"`);
replaceOnce(/property="og:locale"\s+content="zh_CN"/, 'property="og:locale"\n      content="en_US"');
replaceOnce(
  /property="og:locale:alternate"\s+content="en_US"/,
  'property="og:locale:alternate"\n      content="zh_CN"',
);
replaceOnce(/name="twitter:title"\s+content="[^"]*"/, `name="twitter:title"\n      content="${I18N['meta.title'].en}"`);
replaceOnce(
  /name="twitter:description"\s+content="[^"]*"/,
  `name="twitter:description"\n      content="${I18N['meta.description'].en}"`,
);
replaceOnce(/rel="canonical"\s+href="[^"]*"/, `rel="canonical"\n      href="${SITE}/en.html"`);

// 页内跳转改为英文兄弟页面，避免英文页链向中文页
const replaceEvery = (from, to) => {
  if (!html.includes(from)) throw new Error(`未匹配到替换目标: ${from}`);
  html = html.replaceAll(from, to);
};
replaceEvery('href="./privacy.html"', 'href="./privacy.en.html"');
replaceEvery('href="./pricing.html"', 'href="./pricing.en.html"');
replaceEvery('href="./compare.html"', 'href="./compare.en.html"');
replaceEvery('href="./blog/"', 'href="./blog/index.en.html"');
replaceOnce(/"description": "开源免费的本地密码管理器[^\n]*",/, `"description": "${EN_JSONLD_DESCRIPTION}",`);
// 英文版：中文 FAQPage / HowTo 结构化数据块替换为英文版，避免语言错配
// FAQPage 与可见 FAQ 同源（faqEntries 取自 FAQS 数组），文案不再单独维护
replaceOnce(/[ \t]*<!-- FAQPage 结构化数据[\s\S]*?<\/script>\n/, () => buildFaqPageJsonLd(faqEntries, 'en'));
replaceOnce(/[ \t]*<!-- HowTo 结构化数据[\s\S]*?<\/script>\n/, () => EN_HOWTO_JSONLD);
// 静态英文页缺省语言固定为 en（仍尊重 ?lang 参数与 localStorage 显式选择）
replaceOnce("return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';", "return 'en';");

html = html.replace(
  '<!doctype html>\n',
  '<!doctype html>\n<!-- en.html is generated from index.html by scripts/build-en-page.mjs — do not edit manually. -->\n',
);

writeFileSync(outPath, html);
console.log(`en.html generated: data-i18n ${replacedText}/${textTotal}, data-i18n-html ${replacedHtml}/${htmlTotal}`);
