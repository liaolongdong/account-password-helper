/**
 * 博客分发面守卫：RSS、llms-full 与页面可访问性结构
 *
 * `scripts/build-blog-pages.mjs` 现在一次产出四类必须入库的字节：12 个博客 HTML、
 * 两份 RSS、根目录 `llms-full.txt`。这些产物没有 CI 重新生成，改完 Markdown 忘记
 * `pnpm gen:blog` 就会把过期内容留在线上；RSS 的日期、条目顺序和自引用地址写错，
 * 订阅器也不会报错，只会静默不更新。因此这里从**源 Markdown** 反推应得结果：
 *
 * 1. 每条 feed 的标题/摘要/链接/发布日期与该语言的文章一一对应，且按日期倒序；
 *    `lastBuildDate` 取该语言最新的 `modified`；
 * 2. 每篇源文的标题与结尾段落必须出现在 llms-full 中，图片相对路径已改成绝对 URL；
 * 3. 12 个页面都有 skip link、`<main id="main">`、RSS 自动发现；文章页另有可见面包屑、
 *    `rel="author"` 与作者卡片。
 *
 * 判据刻意从源文重算而不是和生成器共享函数：共享实现时，生成器与守卫一起写错也会绿。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

const LANGS = [
  {
    lang: 'zh-CN',
    feed: 'feed.xml',
    index: 'index.html',
    language: 'zh-cn',
    sourceDir: 'docs/blog/zh',
  },
  {
    lang: 'en',
    feed: 'feed.en.xml',
    index: 'index.en.html',
    language: 'en',
    sourceDir: 'docs/blog/en',
  },
] as const;

const ARTICLE_PAGES = [
  '01-local-first-password-manager.html',
  '01-local-first-password-manager.en.html',
  '02-mv3-sidepanel-sub-second-open.html',
  '02-mv3-sidepanel-sub-second-open.en.html',
  '03-webcrypto-encryption-in-practice.html',
  '03-webcrypto-encryption-in-practice.en.html',
  '04-login-flow-details.html',
  '04-login-flow-details.en.html',
  '05-cross-subdomain-matching.html',
  '05-cross-subdomain-matching.en.html',
];
const ALL_PAGES = [...ARTICLE_PAGES, 'index.html', 'index.en.html'];

interface SourceArticle {
  slug: string;
  title: string;
  description: string;
  date: string;
  modified: string;
  bodyTail: string;
}

/** 从 Markdown frontmatter 读出 RSS 与页面都应引用的字段 */
function readSourceArticle(dir: string, file: string): SourceArticle {
  const raw = readFileSync(path.join(ROOT, dir, file), 'utf8');
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n/);
  expect(frontmatter, `${dir}/${file} 缺少 frontmatter`).not.toBeNull();
  const meta = new Map<string, string>();
  for (const line of frontmatter![1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0)
      meta.set(
        line.slice(0, idx).trim(),
        line
          .slice(idx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      );
  }
  const body = raw.slice(frontmatter![0].length);
  const bodyLines = body.trim().split('\n').filter(Boolean);
  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.get('title') ?? '',
    description: meta.get('description') ?? '',
    date: meta.get('date') ?? '',
    modified: meta.get('modified') ?? '',
    bodyTail: bodyLines[bodyLines.length - 1]?.slice(0, 80) ?? '',
  };
}

function sourceArticles(lang: (typeof LANGS)[number]): SourceArticle[] {
  return readdirSync(path.join(ROOT, lang.sourceDir))
    .filter(file => file.endsWith('.md'))
    .sort()
    .map(file => readSourceArticle(lang.sourceDir, file));
}

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** XML 文本转义：源文里出现 & / < / > 时，feed 必须写成实体 */
const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** XML 转义后的日期串与生成器同口径，但由源文的 date 独立计算 */
const rfc822 = (iso: string): string => new Date(`${iso}T00:00:00Z`).toUTCString();

describe('RSS 与源文章一一对应', () => {
  it.each(LANGS)('$feed：语言、自引用、日期与条目顺序', lang => {
    const xml = read(`blog/${lang.feed}`);
    const articles = sourceArticles(lang);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss');
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(xml).toContain(`<language>${lang.language}</language>`);
    expect(xml).toContain(`<link>${SITE}/blog/${lang.lang === 'zh-CN' ? '' : 'index.en.html'}</link>`);
    expect(xml).toContain(`href="${SITE}/blog/${lang.feed}"`);

    const dates = articles.map(a => a.modified || a.date).sort();
    expect(xml).toContain(`<lastBuildDate>${rfc822(dates[dates.length - 1])}</lastBuildDate>`);

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
    expect(items, `${lang.feed} 的条目数与源文不一致`).toHaveLength(articles.length);

    const expectedOrder = [...articles].sort((a, b) => b.date.localeCompare(a.date));
    items.forEach((item, i) => {
      const article = expectedOrder[i];
      const url = `${SITE}/blog/${article.slug}${lang.lang === 'zh-CN' ? '' : '.en'}.html`;
      expect(item, `${lang.feed} 第 ${i + 1} 条标题不是 ${article.slug}`).toContain(
        `<title>${escapeXml(article.title)}</title>`,
      );
      expect(item).toContain(`<link>${url}</link>`);
      expect(item).toContain(`<guid isPermaLink="true">${url}</guid>`);
      expect(item).toContain(`<pubDate>${rfc822(article.date)}</pubDate>`);
      expect(item).toContain(`<description>${escapeXml(article.description)}</description>`);
      expect(existsSync(path.join(ROOT, 'blog', url.split('/blog/')[1]))).toBe(true);
    });
  });

  it('每个页面都声明对应语言的 RSS 自动发现', () => {
    for (const page of ALL_PAGES) {
      const html = read(`blog/${page}`);
      const expected = page.endsWith('.en.html') ? `${SITE}/blog/feed.en.xml` : `${SITE}/blog/feed.xml`;
      expect(html, `${page} 缺少 RSS 自动发现`).toContain('type="application/rss+xml"');
      expect(html, `${page} 的 RSS 地址语言不匹配`).toContain(`href="${expected}"`);
    }
  });
});

describe('llms-full.txt 与 llms.txt 同源且覆盖全部正文', () => {
  const full = read('llms-full.txt');

  it('以 llms.txt 原文开头，并包含中英两个正文分区', () => {
    expect(full.startsWith(read('llms.txt').trimEnd())).toBe(true);
    expect(full).toContain('# Full Content');
    expect(full).toContain('## 中文原文');
    expect(full).toContain('## English originals');
    expect(full).toContain(`[llms.txt](${SITE}/llms.txt)`);
  });

  it.each(LANGS)('$lang：每篇源文的标题、链接与结尾段落都在全文里', lang => {
    for (const article of sourceArticles(lang)) {
      const url = `${SITE}/blog/${article.slug}${lang.lang === 'zh-CN' ? '' : '.en'}.html`;
      expect(full, `llms-full 缺少 ${article.slug}`).toContain(`### [${article.title}](${url})`);
      expect(full, `llms-full 的 ${article.slug} 正文已过期`).toContain(article.bodyTail);
    }
  });

  it('图片相对路径已改为站点绝对 URL，且没有残留 frontmatter', () => {
    expect(full).not.toContain('](imgs/');
    expect(full).not.toMatch(/\n---\ntitle:/);
  });

  it('llms.txt 让 AI 读者能找到全文与两份 RSS', () => {
    const summary = read('llms.txt');
    expect(summary).toContain(`${SITE}/llms-full.txt`);
    expect(summary).toContain(`${SITE}/blog/feed.xml`);
    expect(summary).toContain(`${SITE}/blog/feed.en.xml`);
  });
});

describe('博客页的无障碍与署名结构', () => {
  it.each(ALL_PAGES)('%s 有 skip link、main landmark 与导航标签', page => {
    const html = read(`blog/${page}`);
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('<main id="main" tabindex="-1">');
    expect(html).toContain('<nav');
    expect(html).toMatch(/<nav[^>]+aria-label=/);
  });

  it.each(ARTICLE_PAGES)('%s 有可见面包屑、rel=author 与作者卡片', page => {
    const html = read(`blog/${page}`);
    expect(html).toContain('class="crumbs"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('rel="author"');
    expect(html).toContain('href="https://github.com/liaolongdong"');
    expect(html).toContain('class="author-card"');
  });
});
