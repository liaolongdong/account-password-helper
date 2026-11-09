/**
 * `sitemap.xml` 的 hreflang 声明与 HTML 侧互证。
 *
 * 起因：站点 36 个 URL 的 HTML 里早就有 zh-CN / en / x-default 三件套，但 sitemap 里
 * `xhtml:link` 一条都没有。Google 支持在 sitemap 里声明语言 alternates，且对**同一个 URL
 * 组**要求组内每个成员都列出全组（含自己）——只写在 HTML 里，sitemap 这条抓取入口就看不到
 * 语言关系。补上之后必须两侧一致，否则等于给爬虫两份互相矛盾的信号。
 *
 * 三条判据：
 * 1. 每个 `<url>` 恰好三条 `xhtml:link`，hreflang 集合是 zh-CN / en / x-default；
 * 2. 这三条与**该 URL 对应页面** `<head>` 里的 hreflang 逐条相同（不比顺序，compare.en.html
 *   的 HTML 侧顺序就与其他页不同，那是无害的）；
 * 3. 互指闭包：组内每个 href 自己也是 sitemap 里的 `<url>`，且它声明的三条与组一致。
 *
 * 牙齿：删掉任意一条回指、或把某条 href 改成组外地址，第 2 / 3 条必须判红。
 *
 * 刻意不加的：sitemap 手工维护（`scripts/build-blog-pages.mjs` 明确不产出它），所以这里
 * 只守一致性，不生成内容——生成会让 lastmod 的人工口径失去归属。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SITE = 'https://liaolongdong.github.io/account-password-helper/';
const HREFLANGS = ['en', 'x-default', 'zh-CN'];

interface SitemapUrl {
  loc: string;
  alternates: Map<string, string>;
}

/** 逐 `<url>` 块解析，避免跨块串味 */
function sitemapUrls(): SitemapUrl[] {
  const xml = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => {
    const block = match[1];
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1] ?? '';
    const alternates = new Map<string, string>();
    for (const link of block.matchAll(/<xhtml:link\b([^>]*)\/>/g)) {
      const attrs = link[1];
      const hreflang = /hreflang="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? '';
      alternates.set(hreflang, href);
    }
    return { loc, alternates };
  });
}

/** sitemap 的 loc → 仓库内的页面文件 */
function fileOf(loc: string): string {
  const rel = loc.startsWith(SITE) ? loc.slice(SITE.length) : loc;
  if (rel === '') return 'index.html';
  if (rel.endsWith('/')) return `${rel}index.html`;
  return rel;
}

/** 页面 `<head>` 里的 hreflang 三件套 */
function headAlternates(file: string): Map<string, string> {
  const html = readFileSync(path.join(ROOT, file), 'utf8');
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const alternates = new Map<string, string>();
  for (const link of head.matchAll(/<link\b([^>]*)>/g)) {
    const attrs = link[1];
    if (!/rel\s*=\s*"alternate"/.test(attrs) || !/hreflang\s*=/.test(attrs)) continue;
    alternates.set(/hreflang\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '', /href\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '');
  }
  return alternates;
}

const urls = sitemapUrls();
const byLoc = new Map(urls.map(entry => [entry.loc, entry]));

describe('sitemap 的 hreflang 与 HTML 侧互证', () => {
  it('解析到全部 36 个 URL 且 xmlns:xhtml 已声明（防空跑）', () => {
    expect(urls.length).toBe(36);
    const xml = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    expect(xml, '缺 xmlns:xhtml 声明，xhtml:link 会是未定义前缀').toContain(
      'xmlns:xhtml="http://www.w3.org/1999/xhtml"',
    );
    // 反向自检：一个不存在的 hreflang 不该被解析出来
    expect(urls.every(entry => !entry.alternates.has('no-such-lang'))).toBe(true);
  });

  it('每个 URL 恰好三条 xhtml:link，hreflang 集合正确且 href 非空', () => {
    for (const { loc, alternates } of urls) {
      expect([...alternates.keys()].sort(), `${loc} 的 hreflang 集合不对`).toEqual(HREFLANGS);
      for (const [lang, href] of alternates) {
        expect(href.startsWith(SITE), `${loc} 的 ${lang} href 不是站内绝对地址：${href}`).toBe(true);
      }
    }
  });

  it('每条 xhtml:link 与该页 head 里的 hreflang 逐条相同', () => {
    for (const { loc, alternates } of urls) {
      const file = fileOf(loc);
      expect(existsSync(path.join(ROOT, file)), `${loc} 指向不存在的文件 ${file}`).toBe(true);
      const fromHead = headAlternates(file);
      expect([...fromHead.keys()].sort(), `${file} 的 head hreflang 不是三件套`).toEqual(HREFLANGS);
      for (const lang of HREFLANGS) {
        expect(alternates.get(lang), `${loc} 的 ${lang} 与 ${file} 的 head 不一致`).toBe(fromHead.get(lang));
      }
    }
  });

  it('互指闭包：组内每个 href 自己也在 sitemap 里，且声明同一组', () => {
    for (const { loc, alternates } of urls) {
      for (const [lang, href] of alternates) {
        const sibling = byLoc.get(href);
        expect(sibling, `${loc} 的 ${lang} 指向 ${href}，但它不在 sitemap 里`).toBeDefined();
        for (const inner of HREFLANGS) {
          expect(sibling!.alternates.get(inner), `${href} 回指的 ${inner} 与 ${loc} 声明的不一致`).toBe(
            alternates.get(inner),
          );
        }
      }
    }
  });

  it('x-default 与 zh-CN 同址（本站的默认语言是中文）', () => {
    for (const { loc, alternates } of urls) {
      expect(alternates.get('x-default'), `${loc} 的 x-default 应与 zh-CN 同址`).toBe(alternates.get('zh-CN'));
    }
  });
});
