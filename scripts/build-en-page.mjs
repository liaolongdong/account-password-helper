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

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'index.html');
const outPath = path.join(root, 'en.html');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

const EN_KEYWORDS =
  'password manager,Chrome extension,local password manager,offline password manager,AES-256-GCM,autofill,auto login,TOTP,2FA,authenticator,password generator,security audit,developer tools,credential manager,local-first,password vault,open source password manager,password manager for developers';
const EN_JSONLD_DESCRIPTION =
  'Free, open-source local password manager: one-keystroke login (fill + tick + click), PBKDF2 600K iterations + AES-256-GCM encryption with zero network transfer, built-in TOTP 2FA, security audit and password generator, instant side panel (20-50ms warm path).';

// 英文版 FAQPage / HowTo 结构化数据（与 index.html 中文块逐条对应）
const EN_FAQPAGE_JSONLD = `<!-- FAQPage structured data: English version, mirrored from the Chinese FAQPage block in index.html -->
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Are my passwords uploaded to the cloud?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. The extension is fully local: all data stays in your browser's local storage, sensitive fields are encrypted with AES-256-GCM, and nothing ever travels over the network."
            }
          },
          {
            "@type": "Question",
            "name": "What if I forget my master password?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "It cannot be recovered; you can only use Reset to wipe the vault and start over. Back up regularly via data export or the encrypted .aph backup to avoid data loss."
            }
          },
          {
            "@type": "Question",
            "name": "What happens when my session expires?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "All sensitive fields are automatically re-encrypted into ciphertext. Verify the master password again to restore access — no data is lost."
            }
          },
          {
            "@type": "Question",
            "name": "What is the security audit and what does it check?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A one-click password health scan showing a 0–100 overall score across five checks: weak passwords, password reuse, commonly leaked passwords (offline dictionary), stale passwords, and missing two-factor authentication. Everything is computed locally — no network, no uploads. Expiry reminders help you catch risks early."
            }
          },
          {
            "@type": "Question",
            "name": "Can I import from other password managers?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Upload a CSV file in the import dialog; the extension auto-detects Chrome, LastPass, Bitwarden and 1Password export formats and maps the fields."
            }
          },
          {
            "@type": "Question",
            "name": "Autofill doesn't work — what should I do?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Wait for the page to fully load and retry; the filler tries three strategies in order (native setter, execCommand, simulated keyboard events). If it still fails, refresh the page."
            }
          },
          {
            "@type": "Question",
            "name": "How do I customize the keyboard shortcuts?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Open chrome://extensions/shortcuts, find Account Password Helper, click the shortcut field next to a command and press a new combination."
            }
          },
          {
            "@type": "Question",
            "name": "What is one-click login and how is it different from other password managers?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "One-click login is the core differentiator: press Ctrl+Shift+F and it not only autofills credentials but also ticks the 'I agree' checkbox and clicks the login button — sign-in completes in about one second. Other managers only fill the form; you still click login yourself. Exact-domain matching also isolates dev/test/staging/prod accounts, which no other manager offers."
            }
          },
          {
            "@type": "Question",
            "name": "How does Account Password Helper compare with Bitwarden and 1Password?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "It is completely free, open source and stores data purely locally — no account, no cloud sync. Key differences: 1) one-click login (fill + tick + click) where others only fill; 2) multi-environment account isolation (dev/test/staging/prod); 3) built-in TOTP 2FA (paid tier in Bitwarden/1Password); 4) offline security audit (0–100 score, five checks). Bitwarden and 1Password are cloud-based, require accounts, and lock advanced features behind subscriptions."
            }
          },
          {
            "@type": "Question",
            "name": "How is side panel performance? Any lag?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The side panel is heavily optimized: it loads in about 20–50ms while the session is valid, thanks to Service Worker keep-alive and a resident password cache. It opens instantly even after the session expires. On Windows, a first cold start can take 1–2 extra seconds due to antivirus scanning; adding the Chrome extensions directory to the exclusion list brings it under one second."
            }
          },
          {
            "@type": "Question",
            "name": "How do I migrate to Account Password Helper from another password manager?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Upload a CSV file in the import dialog; the extension auto-detects Chrome, LastPass, Bitwarden and 1Password export formats with Chinese/English column-name mapping — migration takes about 30 seconds. JSON import and .aph encrypted backup import are also supported."
            }
          }
        ]
      }
    </script>
`;
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
            "text": "Visit a login page and use inline fill, the side panel, or Ctrl+Shift+F for one-click login."
          }
        ]
      }
    </script>
`;

let html = readFileSync(srcPath, 'utf8');

// ---------- 1. 提取 I18N 字典（纯对象字面量区域） ----------
const dictStart = html.indexOf('const I18N = {');
if (dictStart === -1) throw new Error('未找到 I18N 字典起点');
const bodyStart = html.indexOf('{', dictStart);
const dictEnd = html.indexOf('};', bodyStart);
if (dictEnd === -1) throw new Error('未找到 I18N 字典终点');
const I18N = vm.runInNewContext(`(${html.slice(bodyStart, dictEnd + 1)})`);

// ---------- 2. 替换静态 i18n 节点 ----------
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const missing = [];
let replacedText = 0;
let replacedHtml = 0;

const totalText = (html.match(/\bdata-i18n="/g) || []).length;
const totalHtml = (html.match(/\bdata-i18n-html="/g) || []).length;

html = html.replace(/(<[a-zA-Z][^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(?=<\/)/g, (m, open, key) => {
  const entry = I18N[key];
  if (typeof entry?.en !== 'string') {
    missing.push(key);
    return m;
  }
  replacedText += 1;
  return open + escapeHtml(entry.en);
});
html = html.replace(/(<[a-zA-Z][^>]*\bdata-i18n-html="([^"]+)"[^>]*>)([\s\S]*?)(?=<\/)/g, (m, open, key) => {
  const entry = I18N[key];
  if (typeof entry?.en !== 'string') {
    missing.push(key);
    return m;
  }
  replacedHtml += 1;
  return open + entry.en;
});
if (missing.length > 0) throw new Error(`I18N 字典缺少英文条目: ${missing.join(', ')}`);
if (replacedText !== totalText) throw new Error(`data-i18n 覆盖率不一致: ${replacedText}/${totalText}`);
if (replacedHtml !== totalHtml) throw new Error(`data-i18n-html 覆盖率不一致: ${replacedHtml}/${totalHtml}`);

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
replaceOnce(
  /"description": "开源免费的本地密码管理器：一键登录（填充\+勾选\+点击），PBKDF2 600K 迭代 \+ AES-256-GCM 加密零联网，TOTP 两步验证、安全体检与密码生成器，侧边栏秒开（缓存快路径 20-50ms），数据绝不出浏览器。",/,
  `"description": "${EN_JSONLD_DESCRIPTION}",`,
);
// 英文版：中文 FAQPage / HowTo 结构化数据块替换为逐条对应的英文版，避免语言错配
replaceOnce(/[ \t]*<!-- FAQPage 结构化数据[\s\S]*?<\/script>\n/, () => EN_FAQPAGE_JSONLD);
replaceOnce(/[ \t]*<!-- HowTo 结构化数据[\s\S]*?<\/script>\n/, () => EN_HOWTO_JSONLD);
// 静态英文页缺省语言固定为 en（仍尊重 ?lang 参数与 localStorage 显式选择）
replaceOnce("return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';", "return 'en';");

html = html.replace(
  '<!doctype html>\n',
  '<!doctype html>\n<!-- en.html is generated from index.html by scripts/build-en-page.mjs — do not edit manually. -->\n',
);

writeFileSync(outPath, html);
console.log(`en.html generated: data-i18n ${replacedText}/${totalText}, data-i18n-html ${replacedHtml}/${totalHtml}`);
