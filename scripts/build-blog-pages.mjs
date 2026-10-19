#!/usr/bin/env node
/**
 * 从 docs/blog/{zh,en}/*.md 生成静态博客页面，供 GitHub Pages 部署。
 *
 * 背景：博客文章以 Markdown 维护在仓库内（便于 PR 审阅与多平台投稿），
 * 但搜索引擎与 AI 引擎需要可直接爬取的 HTML。本脚本把每篇文章渲染为
 * 独立静态页，并补齐 SEO 元信息：canonical、hreflang 中英互指、OG/Twitter
 * 卡片与 BlogPosting 结构化数据。
 *
 * 约定：
 * - 文件名即 slug：docs/blog/zh/01-foo.md 生成 blog/01-foo.html，
 *   同名英文文件 docs/blog/en/01-foo.md 生成 blog/01-foo.en.html；
 * - 文章内引用站点图片统一写 `imgs/xxx.png`（相对站点根），
 *   渲染时重写为绝对 URL，保证任意页面下路径正确；
 * - frontmatter 支持 title / description / tags / date / modified / author / image；
 *   `modified` 为可选的修订日期，仅当文章在发布后被回改时填写，用于填充
 *   `BlogPosting.dateModified`、`article:modified_time` 与页面上的「更新于」；
 * - 页面唯一的 `<h1>` 取自 frontmatter 的 `title`。正文开头若出现同级 ATX 标题
 *   （`# ...`）会被剥掉，避免一页两个 h1 稀释权重、破损文档大纲；
 *   值允许用 YAML 单/双引号包裹，解析时会被脱引；
 * - 同一批 Markdown 还产出三份分发面：`blog/feed.xml`（中文）、
 *   `blog/feed.en.xml`（英文）与根目录 `llms-full.txt`（`llms.txt` 摘要 + 全部中英正文）。
 *   RSS 按文章 `date` 倒序，`lastBuildDate` 取该语言最新的 `modified`；
 *   llms-full 里的相对图片路径会改写成站点绝对 URL；
 * - `sitemap.xml` 不由本脚本产出，其 `lastmod` 需手工同步到同一日期。
 *
 * 修改文章后运行 `pnpm gen:blog` 重新生成。本仓库没有 Pages 部署 workflow，
 * Pages 直接读 `main` 分支根目录，所以 `blog/*.html`、两份 feed 与 `llms-full.txt`
 * 属**必须提交入库的产物**——只在本地重跑不会让线上变化。
 *
 * @file scripts/build-blog-pages.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { OG_IMAGE_EN, OG_IMAGE_ZH } from './lib/share-image.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = 'https://liaolongdong.github.io/account-password-helper';
const zhDir = path.join(root, 'docs/blog/zh');
const enDir = path.join(root, 'docs/blog/en');
const outDir = path.join(root, 'blog');

marked.setOptions({ gfm: true, breaks: false });

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeAttr = s => escapeHtml(s);

/**
 * 结构化数据块：JSON 之外还要把小于号改写成等价的 Unicode 转义形式。
 *
 * 产物整段落在 `<script type="application/ld+json">` 里，HTML 解析器不看 JSON——值内出现
 * `</script` 会就地终止这个块，剩下的半截变成页面上的裸文本。标题与摘要是作者手写的，
 * 这条转义让「写进正文的尖号」不需要作者记得避开。
 */
const jsonLd = value => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

/** 文件名即 slug，同时直接拼进产物文件名与 URL，只允许「两位序号 + 小写连字符词」 */
const SLUG_RE = /^\d{2}-[a-z0-9][a-z0-9-]*$/;
/** `date` / `modified` 原样进 `article:*_time` 与 JSON-LD，按 ISO 日期钉死形状 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 封面只能是仓库内的位图路径：段名只允许 `\w` 与 `-`，`..`、空格、引号一并挡在门外 */
const IMG_PATH_RE = /^imgs(?:\/[\w-]+)+\.png$/;

/** 脱去 YAML 单/双引号包裹；只有整值被同类引号包住时才脱，避免误伤内文引号 */
function unquote(value) {
  const m = value.match(/^(['"])([\s\S]*)\1$/);
  if (!m) return value;
  // 内文里的转义引号（如 \'）随脱引一并还原
  return m[2].replace(/\\(['"])/g, '$1');
}

/** 解析 frontmatter（仅支持 `key: value` 单行格式，值可被 YAML 引号包裹） */
function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('缺少 frontmatter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = unquote(line.slice(idx + 1).trim());
  }
  return { meta, body: md.slice(m[0].length) };
}

/**
 * 剥掉正文开头的同级 ATX 标题。
 *
 * 页面 `<h1>` 由模板按 frontmatter 的 `title` 渲染，正文再带一个 `# ...` 就会出现
 * 一页两个 h1；这里只处理**第一块内容**处的标题，正文里其余的 `#` 不动。
 */
function stripLeadingHeading(body) {
  return body.replace(/^\s*#[^\n]*\n+/, '');
}

function readArticles(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(file => {
      const { meta, body } = parseFrontmatter(readFileSync(path.join(dir, file), 'utf8'));
      for (const key of ['title', 'description', 'date']) {
        if (!meta[key]) throw new Error(`${file} frontmatter 缺少 ${key}`);
      }
      const slug = file.replace(/\.md$/, '');
      // 这三个形状是下游的唯一防线：slug 进产物文件名与 URL，date/modified 进 `article:*_time`
      // 与 JSON-LD，image 进 og/twitter 的 content 和 `<img src>`——四处都不做二次转义，
      // 所以坏值必须在读到这里就让构建失败，而不是安静地长进已发布的字节里。
      if (!SLUG_RE.test(slug)) throw new Error(`${file} 文件名不是合法 slug（需匹配 ${SLUG_RE}）`);
      for (const key of ['date', 'modified']) {
        if (meta[key] && !ISO_DATE_RE.test(meta[key])) {
          throw new Error(`${file} frontmatter 的 ${key} 不是 YYYY-MM-DD：${meta[key]}`);
        }
      }
      if (meta.image && !IMG_PATH_RE.test(meta.image)) {
        throw new Error(`${file} frontmatter 的 image 不是 imgs/ 下的位图路径：${meta.image}`);
      }
      return {
        slug,
        title: meta.title,
        description: meta.description,
        tags: (meta.tags || '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean),
        date: meta.date,
        modified: meta.modified || '',
        author: meta.author || 'liaolongdong',
        image: meta.image || '',
        body: stripLeadingHeading(body),
      };
    });
}

/** Markdown → HTML，并把 `imgs/` 相对引用重写为站点绝对 URL */
function renderMarkdown(body) {
  let html = marked.parse(body);
  html = html.replace(/src="imgs\//g, `src="${SITE}/imgs/`);
  return html;
}

const GH_URL = 'https://github.com/liaolongdong/account-password-helper';
const CWS_URL = 'https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli';

/** 无封面文章与索引页的分享卡兜底图：中英各一张 1200×630，语言与页面一致 */
const OG_IMAGE = { 'zh-CN': OG_IMAGE_ZH, en: OG_IMAGE_EN };

/** 品牌名按语言输出：中文页此前挂着英文品牌，与 pricing/privacy 等页面口径不一致 */
const BRAND = { 'zh-CN': '账号密码管理助手', en: 'Account Password Helper' };

/** 面包屑里博客一级的短名（索引页标题较长，不适合当 crumb 文案） */
const BLOG_CRUMB = { 'zh-CN': '博客', en: 'Blog' };

/** 作者页按语言各一份；文章署名优先指到这里，GitHub 作为 sameAs 保留 */
const AUTHOR_PAGE = {
  'zh-CN': `${SITE}/author.html`,
  en: `${SITE}/author.en.html`,
};
const authorProfileUrl = (author, lang) =>
  author === 'liaolongdong' ? AUTHOR_PAGE[lang] : `https://github.com/${author}`;

/** 每语言一份 RSS：读者只订自己读得懂的那一份，避免中英条目混流 */
const BLOG_FEED = {
  'zh-CN': {
    file: 'feed.xml',
    language: 'zh-cn',
    title: '账号密码管理助手 · 技术博客',
    description: '本地优先密码管理器的产品思考与工程实现：安全设计、MV3 性能、Web Crypto 加密与多环境登录。',
    indexUrl: `${SITE}/blog/`,
  },
  en: {
    file: 'feed.en.xml',
    language: 'en',
    title: 'Account Password Helper · Engineering Blog',
    description:
      'Product thinking and engineering deep-dives: local-first security, MV3 performance, Web Crypto internals and multi-environment login.',
    indexUrl: `${SITE}/blog/index.en.html`,
  },
};

/** 文章在对应语言下的公开地址 */
const articleUrl = (article, lang) => `${SITE}/blog/${article.slug}${lang === 'zh-CN' ? '' : '.en'}.html`;

/** RSS 的日期是 RFC 822；日期本身在读取 frontmatter 时已按 ISO 形状校验 */
const rfc822 = iso => new Date(`${iso}T00:00:00Z`).toUTCString();

/** XML 文本节点转义（`escapeHtml` 已覆盖 & < > "，文本里的单引号无需实体化） */
const escapeXml = s => escapeHtml(s);

/**
 * 页内共享的图标、主题色与爬虫指令。
 *
 * 博客 12 个页面此前既没有 favicon 也没有 `robots` meta，而同站另外 8 个页面都写了
 * `index, follow, max-image-preview:large`——文章封面是 1600×900（16:9），
 * 少了这条声明就拿不到大图富结果。
 *
 * RSS 自动发现链接随页面语言给出，订阅器在任意一篇文章上都能找到对应语言的 feed。
 */
function headKit(lang) {
  const feed = BLOG_FEED[lang];
  return `    <link
      rel="icon"
      type="image/svg+xml"
      href="${SITE}/assets/icons/icon.svg"
    />
    <link
      rel="alternate"
      type="application/rss+xml"
      title="${escapeAttr(`${BRAND[lang]} · ${BLOG_CRUMB[lang]}`)}"
      href="${SITE}/blog/${feed.file}"
    />
    <link
      rel="icon"
      type="image/png"
      sizes="32x32"
      href="${SITE}/public/icon/32.png"
    />
    <link
      rel="apple-touch-icon"
      sizes="128x128"
      href="${SITE}/public/icon/128.png"
    />
    <meta
      name="theme-color"
      content="#4e88ff"
    />
    <meta
      name="robots"
      content="index, follow, max-image-preview:large"
    />`;
}

/** 站内落点链接：锚文本用具体意图词，不用「官网」这类泛词 */
function siteLinks(lang) {
  const zh = lang === 'zh-CN';
  const suffix = zh ? '' : '.en';
  const home = zh ? `${SITE}/` : `${SITE}/en.html`;
  const anchors = zh
    ? [
        '产品官网与功能演示',
        '定价：永久免费',
        '与 Bitwarden、1Password 对比',
        '隐私政策',
        'Chrome 应用商店',
        'GitHub',
        'RSS 订阅',
      ]
    : [
        'Product site &amp; demo',
        'Pricing: free forever',
        'Compared with Bitwarden &amp; 1Password',
        'Privacy policy',
        'Chrome Web Store',
        'GitHub',
        'RSS feed',
      ];
  const hrefs = [
    home,
    `${SITE}/pricing${suffix}.html`,
    `${SITE}/compare${suffix}.html`,
    `${SITE}/privacy${suffix}.html`,
    CWS_URL,
    GH_URL,
    `${SITE}/blog/${BLOG_FEED[lang].file}`,
  ];
  return hrefs.map((href, i) => `<a href="${href}">${anchors[i]}</a>`).join(' · ');
}

/** 同作者兄弟产品互链（中英各一份，英文页指向英文落点） */
function siblingLinks(lang) {
  const zh = lang === 'zh-CN';
  const taf = 'https://liaolongdong.github.io/transfer-any-file/';
  const cop = zh
    ? 'https://liaolongdong.github.io/cross-origin-proxy/'
    : 'https://liaolongdong.github.io/cross-origin-proxy/en.html';
  return zh
    ? `同作者：<a href="${taf}">文件格式任意转换助手</a> / <a href="${cop}">跨域代理助手</a>`
    : `Same author: <a href="${taf}">Transfer Any File</a> / <a href="${cop}">Cross-origin Proxy</a>`;
}

/** BreadcrumbList 结构化数据 */
function breadcrumbJsonLd(items) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

/** ItemList 结构化数据（博客索引页的文章清单，供爬虫与 AI 引擎直接读取目录） */
function itemListJsonLd(articles, lang) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: lang === 'zh-CN' ? '技术博客文章列表' : 'Engineering blog posts',
    itemListElement: articles.map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}/blog/${a.slug}${lang === 'zh-CN' ? '' : '.en'}.html`,
    })),
  });
}

function blogPostingJsonLd(article, url, lang) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.description,
    inLanguage: lang,
    image: article.image ? `${SITE}/${article.image}` : undefined,
    datePublished: article.date,
    dateModified: article.modified || article.date,
    author: {
      '@type': 'Person',
      name: article.author,
      url: authorProfileUrl(article.author, lang),
      sameAs: [`https://github.com/${article.author}`],
    },
    keywords: article.tags.join(','),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  });
}

/**
 * RSS 2.0 feed
 *
 * 只放标题、链接、摘要与标签：正文已经在站内页面和 llms-full 里，
 * feed 再塞全文只会让订阅器重复缓存同一批内容。`lastBuildDate` 取该语言
 * 最新的 `modified`，保证同一批源文件重复生成时字节稳定。
 */
function feedXml(articles, lang) {
  const meta = BLOG_FEED[lang];
  const selfUrl = `${SITE}/blog/${meta.file}`;
  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date));
  const lastBuilt = sorted
    .map(a => a.modified || a.date)
    .sort()
    .at(-1);
  const items = sorted
    .map(article => {
      const url = articleUrl(article, lang);
      const categories = article.tags.map(tag => `      <category>${escapeXml(tag)}</category>`).join('\n');
      return `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(article.date)}</pubDate>
      <description>${escapeXml(article.description)}</description>
${categories}
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss
  version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
>
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${meta.indexUrl}</link>
    <description>${escapeXml(meta.description)}</description>
    <language>${meta.language}</language>
    <lastBuildDate>${rfc822(lastBuilt)}</lastBuildDate>
    <atom:link
      href="${selfUrl}"
      rel="self"
      type="application/rss+xml"
    />
${items}
  </channel>
</rss>
`;
}

/**
 * llms-full.txt：`llms.txt` 摘要 + 全部中英博客正文
 *
 * 面向需要完整上下文的 AI 爬虫。正文标题降一级（文章名占 `##`），
 * 图片相对路径改成站点绝对 URL；frontmatter 已在读取阶段剥离。
 */
function llmsFullText(zhArticles, enArticles) {
  const base = readFileSync(path.join(root, 'llms.txt'), 'utf8').trimEnd();
  const sections = [
    { lang: 'zh-CN', label: '中文原文', articles: zhArticles },
    { lang: 'en', label: 'English originals', articles: enArticles },
  ];
  const content = sections
    .map(section => {
      const articles = [...section.articles]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(article => {
          const body = article.body
            .replace(/^(#{1,5})\s/gm, '#$1 ')
            .replace(/\]\(imgs\//g, `](${SITE}/imgs/`)
            .trim();
          const updated = article.modified ? ` · Updated: ${article.modified}` : '';
          return `### [${article.title}](${articleUrl(article, section.lang)})

> Published: ${article.date}${updated} · Author: [${article.author}](https://github.com/${article.author})

${body}`;
        })
        .join('\n\n---\n\n');
      return `## ${section.label}\n\n${articles}`;
    })
    .join('\n\n');
  return `${base}

---

# Full Content

> Every blog post in full, in both languages. The summary version is [llms.txt](${SITE}/llms.txt).

${content}
`;
}

function articlePage(article, { lang, selfUrl, altUrl, backHref, backLabel, switchLabel }) {
  const cover = article.image ? `${SITE}/${article.image}` : OG_IMAGE[lang];
  const breadcrumb = [
    { name: BRAND[lang], url: lang === 'zh-CN' ? `${SITE}/` : `${SITE}/en.html` },
    { name: BLOG_CRUMB[lang], url: `${SITE}/blog/${lang === 'zh-CN' ? '' : 'index.en.html'}` },
    { name: article.title, url: selfUrl },
  ];
  const authorUrl = escapeAttr(authorProfileUrl(article.author, lang));
  const authorGithubUrl = `https://github.com/${escapeAttr(article.author)}`;
  const authorCard =
    lang === 'zh-CN'
      ? `<aside class="author-card" aria-label="关于作者">
        <p><strong>关于作者</strong>：<a href="${authorUrl}" rel="author">${escapeHtml(article.author)}</a>，独立开发者，维护账号密码管理助手、Transfer Any File、Cross-origin Proxy 等开源浏览器扩展，关注本地优先、离线可用与可审计的工程实现 · <a href="${authorGithubUrl}" target="_blank" rel="noopener noreferrer">GitHub</a></p>
      </aside>`
      : `<aside class="author-card" aria-label="About the author">
        <p><strong>About the author</strong>: <a href="${authorUrl}" rel="author">${escapeHtml(article.author)}</a> is an independent developer maintaining open-source browser extensions including Account Password Helper, Transfer Any File and Cross-origin Proxy, with a focus on local-first, offline-capable and auditable engineering · <a href="${authorGithubUrl}" target="_blank" rel="noopener noreferrer">GitHub</a></p>
      </aside>`;
  return `<!doctype html>
<!-- Generated by scripts/build-blog-pages.mjs from docs/blog/${lang === 'zh-CN' ? 'zh' : 'en'}/${article.slug}.md — do not edit manually. -->
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>${escapeHtml(article.title)} | ${BRAND[lang]}</title>
    <meta
      name="description"
      content="${escapeAttr(article.description)}"
    />
    <meta
      name="author"
      content="${escapeAttr(article.author)}"
    />
${headKit(lang)}
    <link
      rel="author"
      href="https://github.com/${escapeAttr(article.author)}"
    />
    <link
      rel="canonical"
      href="${selfUrl}"
    />
    <link
      rel="alternate"
      hreflang="zh-CN"
      href="${lang === 'zh-CN' ? selfUrl : altUrl}"
    />
    <link
      rel="alternate"
      hreflang="en"
      href="${lang === 'en' ? selfUrl : altUrl}"
    />
    <link
      rel="alternate"
      hreflang="x-default"
      href="${altUrl.replace(/\.en\.html$/, '.html')}"
    />
    <meta
      property="og:type"
      content="article"
    />
    <meta
      property="og:locale"
      content="${lang === 'zh-CN' ? 'zh_CN' : 'en_US'}"
    />
    <meta
      property="og:title"
      content="${escapeAttr(article.title)}"
    />
    <meta
      property="og:description"
      content="${escapeAttr(article.description)}"
    />
    <meta
      property="og:url"
      content="${selfUrl}"
    />
    <meta
      property="og:image"
      content="${cover}"
    />
    <meta
      property="og:site_name"
      content="${BRAND[lang]}"
    />
    <meta
      property="article:published_time"
      content="${article.date}"
    />
    ${
      article.modified
        ? `<meta
      property="article:modified_time"
      content="${article.modified}"
    />`
        : ''
    }
    <meta
      name="twitter:card"
      content="summary_large_image"
    />
    <meta
      name="twitter:title"
      content="${escapeAttr(article.title)}"
    />
    <meta
      name="twitter:description"
      content="${escapeAttr(article.description)}"
    />
    <meta
      name="twitter:image"
      content="${cover}"
    />
    <script type="application/ld+json">
${blogPostingJsonLd(article, selfUrl, lang)}
    </script>
    <script type="application/ld+json">
${breadcrumbJsonLd(breadcrumb)}
    </script>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f7f9fc;
        --card: #ffffff;
        --text: #1f2937;
        --muted: #6b7280;
        --accent: #4e88ff;
        /* 强调色「作文字用」的那一档：--accent 是实底徽标与描边的组合色，暗档不能抬亮它，
           所以下方那三处 color: var(--accent-ink) 的声明走它，取值同落地页的 --primary-ink。 */
        --accent-ink: #3566cb;
        --border: #e5e9f0;
        --code: #eef2f7;
      }
      /* 暗色档与官网落地页同源（批2-A）：只翻令牌，不动组件规则。
         pre 代码块两档都保持深色，所以不在此列。 */
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0b1220;
          --card: #141f33;
          --text: #e6edf7;
          --muted: #9aa8bd;
          --accent-ink: #7ea6ff;
          --border: #263349;
          --code: #1e2a3f;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          sans-serif;
        line-height: 1.75;
        color: var(--text);
        background: var(--bg);
      }
      .topbar {
        position: sticky;
        z-index: 10;
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 12px 24px;
        background: var(--card);
        border-bottom: 1px solid var(--border);
      }
      .topbar a {
        font-size: 14px;
        color: var(--accent-ink);
        text-decoration: none;
      }
      .topbar .spacer {
        flex: 1;
      }
      .skip-link {
        position: fixed;
        top: 8px;
        left: 8px;
        z-index: 100;
        padding: 8px 14px;
        font-size: 14px;
        color: #ffffff;
        text-decoration: none;
        background: var(--accent);
        border-radius: 6px;
        transform: translateY(-200%);
      }
      .skip-link:focus-visible {
        transform: translateY(0);
      }
      article {
        max-width: 760px;
        margin: 0 auto;
        padding: 40px 24px 80px;
      }
      .crumbs {
        display: flex;
        flex-wrap: nowrap;
        gap: 6px;
        align-items: center;
        margin-bottom: 16px;
        font-size: 13px;
        color: var(--muted);
      }
      .crumbs a {
        flex-shrink: 0;
        color: var(--accent-ink);
        text-decoration: none;
      }
      .crumbs [aria-current='page'] {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 30px;
        line-height: 1.35;
      }
      .meta {
        margin-bottom: 28px;
        font-size: 14px;
        color: var(--muted);
      }
      .meta a {
        color: var(--accent-ink);
        text-decoration: none;
      }
      .cover {
        width: 100%;
        margin: 0 0 28px;
        border-radius: 12px;
      }
      h2 {
        margin: 40px 0 12px;
        font-size: 22px;
      }
      h3 {
        margin: 28px 0 10px;
        font-size: 18px;
      }
      p {
        margin: 14px 0;
      }
      a {
        color: var(--accent-ink);
      }
      ul,
      ol {
        padding-left: 24px;
      }
      li {
        margin: 6px 0;
      }
      blockquote {
        margin: 16px 0;
        padding: 8px 16px;
        color: var(--muted);
        background: var(--card);
        border-left: 4px solid var(--accent);
        border-radius: 6px;
      }
      code {
        padding: 2px 6px;
        font-size: 0.9em;
        background: var(--code);
        border-radius: 4px;
      }
      pre {
        padding: 14px 16px;
        overflow-x: auto;
        background: #0f172a;
        border-radius: 8px;
      }
      pre code {
        color: #e2e8f0;
        background: none;
      }
      hr {
        margin: 36px 0;
        border: none;
        border-top: 1px solid var(--border);
      }
      .author-card {
        padding: 16px 18px;
        margin-top: 40px;
        font-size: 14px;
        color: var(--muted);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 10px;
      }
      .author-card p {
        margin: 0;
      }
      .author-card a {
        color: var(--accent-ink);
      }
      img {
        max-width: 100%;
        border-radius: 8px;
      }
      .footer {
        padding: 24px;
        font-size: 13px;
        color: var(--muted);
        text-align: center;
      }
      .footer p {
        margin: 6px 0;
      }
      .footer a {
        color: var(--accent-ink);
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main">${lang === 'zh-CN' ? '跳到正文' : 'Skip to content'}</a>
    <nav class="topbar" aria-label="${lang === 'zh-CN' ? '文章导航' : 'Article navigation'}">
      <a href="${backHref}">${backLabel}</a>
      <span class="spacer"></span>
      <a href="${altUrl}">${switchLabel}</a>
    </nav>
    <main id="main" tabindex="-1">
      <article>
        <nav class="crumbs" aria-label="${lang === 'zh-CN' ? '面包屑' : 'Breadcrumb'}">
          <a href="${breadcrumb[0].url}">${BRAND[lang]}</a>
          <span aria-hidden="true">/</span>
          <a href="${breadcrumb[1].url}">${BLOG_CRUMB[lang]}</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page" title="${escapeAttr(article.title)}">${escapeHtml(article.title)}</span>
        </nav>
        <h1>${escapeHtml(article.title)}</h1>
        <p class="meta">${article.date}${article.modified ? ` · ${lang === 'zh-CN' ? '更新于' : 'Updated'} ${article.modified}` : ''} · <a rel="author" href="${authorUrl}">${escapeHtml(article.author)}</a></p>
        ${article.image ? `<img class="cover" src="${SITE}/${article.image}" alt="${escapeAttr(article.title)}" />` : ''}
        ${renderMarkdown(article.body)}
        ${authorCard}
      </article>
    </main>
    <footer class="footer">
      <p>${BRAND[lang]} · ${lang === 'zh-CN' ? '开源（GPL-3.0）' : 'Open source (GPL-3.0)'}</p>
      <p>${siteLinks(lang)}</p>
      <p>${siblingLinks(lang)}</p>
    </footer>
  </body>
</html>
`;
}

function indexPage({ lang, title, subtitle, selfUrl, altUrl, articles, readLabel, backLabel, switchLabel }) {
  const cards = articles
    .map(a => {
      const href = lang === 'zh-CN' ? `${a.slug}.html` : `${a.slug}.en.html`;
      const cover = a.image ? `${SITE}/${a.image}` : OG_IMAGE[lang];
      return `      <a class="card" href="${href}">
        <img src="${cover}" alt="${escapeAttr(a.title)}" loading="lazy" />
        <div class="card-body">
          <h2>${escapeHtml(a.title)}</h2>
          <p>${escapeHtml(a.description)}</p>
          <span class="card-meta">${a.date} · ${readLabel} →</span>
        </div>
      </a>`;
    })
    .join('\n');
  const breadcrumb = [
    { name: BRAND[lang], url: lang === 'zh-CN' ? `${SITE}/` : `${SITE}/en.html` },
    { name: BLOG_CRUMB[lang], url: selfUrl },
  ];
  return `<!doctype html>
<!-- Generated by scripts/build-blog-pages.mjs — do not edit manually. -->
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>${escapeHtml(title)} | ${BRAND[lang]}</title>
    <meta
      name="description"
      content="${escapeAttr(subtitle)}"
    />
${headKit(lang)}
    <link
      rel="canonical"
      href="${selfUrl}"
    />
    <link
      rel="alternate"
      hreflang="zh-CN"
      href="${lang === 'zh-CN' ? selfUrl : altUrl}"
    />
    <link
      rel="alternate"
      hreflang="en"
      href="${lang === 'en' ? selfUrl : altUrl}"
    />
    <link
      rel="alternate"
      hreflang="x-default"
      href="${lang === 'zh-CN' ? selfUrl : altUrl}"
    />
    <meta
      property="og:type"
      content="website"
    />
    <meta
      property="og:locale"
      content="${lang === 'zh-CN' ? 'zh_CN' : 'en_US'}"
    />
    <meta
      property="og:title"
      content="${escapeAttr(title)}"
    />
    <meta
      property="og:description"
      content="${escapeAttr(subtitle)}"
    />
    <meta
      property="og:url"
      content="${selfUrl}"
    />
    <meta
      property="og:image"
      content="${OG_IMAGE[lang]}"
    />
    <meta
      property="og:site_name"
      content="${BRAND[lang]}"
    />
    <meta
      name="twitter:card"
      content="summary_large_image"
    />
    <meta
      name="twitter:title"
      content="${escapeAttr(title)}"
    />
    <meta
      name="twitter:description"
      content="${escapeAttr(subtitle)}"
    />
    <meta
      name="twitter:image"
      content="${OG_IMAGE[lang]}"
    />
    <script type="application/ld+json">
${itemListJsonLd(articles, lang)}
    </script>
    <script type="application/ld+json">
${breadcrumbJsonLd(breadcrumb)}
    </script>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f7f9fc;
        --card: #ffffff;
        --text: #1f2937;
        --muted: #6b7280;
        --accent: #4e88ff;
        /* 强调色「作文字用」的那一档：--accent 是实底徽标与描边的组合色，暗档不能抬亮它，
           所以下方那三处 color: var(--accent-ink) 的声明走它，取值同落地页的 --primary-ink。 */
        --accent-ink: #3566cb;
        --border: #e5e9f0;
        --code: #eef2f7;
      }
      /* 暗色档与官网落地页同源（批2-A）：只翻令牌，不动组件规则。
         pre 代码块两档都保持深色，所以不在此列。 */
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0b1220;
          --card: #141f33;
          --text: #e6edf7;
          --muted: #9aa8bd;
          --accent-ink: #7ea6ff;
          --border: #263349;
          --code: #1e2a3f;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          sans-serif;
        line-height: 1.7;
        color: var(--text);
        background: var(--bg);
      }
      .topbar {
        position: sticky;
        z-index: 10;
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 12px 24px;
        background: var(--card);
        border-bottom: 1px solid var(--border);
      }
      .topbar a {
        font-size: 14px;
        color: var(--accent-ink);
        text-decoration: none;
      }
      .topbar .spacer {
        flex: 1;
      }
      .skip-link {
        position: fixed;
        top: 8px;
        left: 8px;
        z-index: 100;
        padding: 8px 14px;
        font-size: 14px;
        color: #ffffff;
        text-decoration: none;
        background: var(--accent);
        border-radius: 6px;
        transform: translateY(-200%);
      }
      .skip-link:focus-visible {
        transform: translateY(0);
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 48px 24px 80px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 32px;
      }
      .subtitle {
        margin: 0 0 36px;
        color: var(--muted);
      }
      .grid {
        display: grid;
        gap: 20px;
      }
      .card {
        display: flex;
        gap: 20px;
        padding: 18px;
        text-decoration: none;
        color: inherit;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        transition: box-shadow 0.2s ease;
      }
      .card:hover {
        box-shadow: 0 6px 24px rgba(30, 64, 175, 0.12);
      }
      .card img {
        flex-shrink: 0;
        width: 200px;
        height: 120px;
        object-fit: cover;
        border-radius: 8px;
      }
      .card-body h2 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .card-body p {
        margin: 0 0 10px;
        font-size: 14px;
        color: var(--muted);
      }
      .card-meta {
        font-size: 13px;
        color: var(--accent-ink);
      }
      .footer {
        padding: 24px;
        font-size: 13px;
        color: var(--muted);
        text-align: center;
      }
      .footer p {
        margin: 6px 0;
      }
      .footer a {
        color: var(--accent-ink);
        text-decoration: none;
      }
      @media (max-width: 640px) {
        .card {
          flex-direction: column;
        }
        .card img {
          width: 100%;
          height: 160px;
        }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main">${lang === 'zh-CN' ? '跳到正文' : 'Skip to content'}</a>
    <nav class="topbar" aria-label="${lang === 'zh-CN' ? '博客导航' : 'Blog navigation'}">
      <a href="${backLabel.href}">${backLabel.text}</a>
      <span class="spacer"></span>
      <a href="${altUrl}">${switchLabel}</a>
    </nav>
    <main id="main" tabindex="-1">
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      <div class="grid">
${cards}
      </div>
    </main>
    <footer class="footer">
      <p>${BRAND[lang]} · ${lang === 'zh-CN' ? '开源（GPL-3.0）' : 'Open source (GPL-3.0)'}</p>
      <p>${siteLinks(lang)}</p>
      <p>${siblingLinks(lang)}</p>
    </footer>
  </body>
</html>
`;
}

// ---------- 主流程 ----------
const zhArticles = readArticles(zhDir);
const enArticles = readArticles(enDir);
const enSlugs = new Set(enArticles.map(a => a.slug));
for (const a of zhArticles) {
  if (!enSlugs.has(a.slug)) throw new Error(`缺少英文对应文章: ${a.slug}`);
}
const enBySlug = Object.fromEntries(enArticles.map(a => [a.slug, a]));

mkdirSync(outDir, { recursive: true });
let written = 0;

for (const zh of zhArticles) {
  const en = enBySlug[zh.slug];
  const zhUrl = `${SITE}/blog/${zh.slug}.html`;
  const enUrl = `${SITE}/blog/${en.slug}.en.html`;
  writeFileSync(
    path.join(outDir, `${zh.slug}.html`),
    articlePage(zh, {
      lang: 'zh-CN',
      selfUrl: zhUrl,
      altUrl: enUrl,
      backHref: './index.html',
      backLabel: '← 博客首页',
      switchLabel: 'English',
    }),
  );
  writeFileSync(
    path.join(outDir, `${en.slug}.en.html`),
    articlePage(en, {
      lang: 'en',
      selfUrl: enUrl,
      altUrl: zhUrl,
      backHref: './index.en.html',
      backLabel: '← Blog Home',
      switchLabel: '中文',
    }),
  );
  written += 2;
}

writeFileSync(
  path.join(outDir, 'index.html'),
  indexPage({
    lang: 'zh-CN',
    title: '博客 · 本地优先密码管理器的工程实战',
    subtitle: '账号密码管理助手的产品思考与工程实现：本地优先的安全设计、MV3 秒开实战与 Web Crypto 加密详解。',
    selfUrl: `${SITE}/blog/`,
    altUrl: `${SITE}/blog/index.en.html`,
    articles: zhArticles,
    readLabel: '阅读全文',
    backLabel: { href: `${SITE}/`, text: '← 产品官网与功能演示' },
    switchLabel: 'English',
  }),
);
writeFileSync(
  path.join(outDir, 'index.en.html'),
  indexPage({
    lang: 'en',
    title: 'Engineering Blog',
    subtitle:
      'Product thinking and engineering deep-dives from Account Password Helper: local-first security, MV3 performance in practice, and Web Crypto internals.',
    selfUrl: `${SITE}/blog/index.en.html`,
    altUrl: `${SITE}/blog/`,
    articles: enArticles,
    readLabel: 'Read article',
    backLabel: { href: `${SITE}/en.html`, text: '← Product site & demo' },
    switchLabel: '中文',
  }),
);
written += 2;

for (const [lang, articles] of [
  ['zh-CN', zhArticles],
  ['en', enArticles],
]) {
  writeFileSync(path.join(outDir, BLOG_FEED[lang].file), feedXml(articles, lang));
  written += 1;
}

writeFileSync(path.join(root, 'llms-full.txt'), llmsFullText(zhArticles, enArticles));

console.log(`blog pages generated: ${written} files in blog/, plus llms-full.txt`);
