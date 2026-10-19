/**
 * 作者页守卫
 *
 * 作者页是 E-E-A-T 的落点：它把「谁在维护这个项目、做过什么、边界在哪」写成可抓取的
 * 静态字节，并用 `ProfilePage > Person` 结构化数据指向 GitHub。最容易静默失效的是三处：
 *
 * 1. **只有页面、没有入口**：博客署名、落地页与 llms.txt 任一漏链，页面就成孤岛；
 * 2. **结构化数据与可见正文各说各话**：JSON-LD 里的 `url` / `sameAs` 必须与页面一致；
 * 3. **中英页面互链断掉**：语言切换与 hreflang 必须同时成立，且 canonical 不能互抢。
 *
 * 根页面元信息、sitemap 覆盖与单 h1 由 `siteMeta` / `seoSurface` 统一把关，这里只补
 * 作者页独有的契约。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

const PAGES = [
  {
    file: 'author.html',
    lang: 'zh-CN',
    self: `${SITE}/author.html`,
    alt: `${SITE}/author.en.html`,
    heading: '关于作者',
    rss: './blog/feed.xml',
  },
  {
    file: 'author.en.html',
    lang: 'en',
    self: `${SITE}/author.en.html`,
    alt: `${SITE}/author.html`,
    heading: 'About the author',
    rss: './blog/feed.en.xml',
  },
] as const;

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

/** 属性可能被格式化器拆到多行；压平后再比对 */
function flat(html: string): string {
  return html.replace(/\s+/g, ' ');
}

function profileJsonLd(html: string, file: string): Record<string, unknown> {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const block = blocks.find(body => body.includes('"ProfilePage"'));
  expect(block, `${file} 缺少 ProfilePage JSON-LD`).toBeDefined();
  return JSON.parse(block!) as Record<string, unknown>;
}

describe('作者页结构', () => {
  it.each(PAGES)('$file 有 skip link、main、面包屑与单一 h1', ({ file, heading }) => {
    const html = read(file);
    const normalized = flat(html);
    expect((html.match(/<h1[\s>]/g) ?? []).length, `${file} 的 h1 数量不对`).toBe(1);
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(normalized).toContain('class="skip-link" href="#main"');
    expect(normalized).toContain('<main id="main" tabindex="-1"');
    expect(normalized).toContain('class="crumbs"');
    expect(normalized).toContain('aria-current="page"');
  });

  it.each(PAGES)('$file 的 canonical、hreflang 与语言切换互指正确', ({ file, lang, self, alt }) => {
    const html = read(file);
    const head = flat(html);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(head).toContain(`rel="canonical" href="${self}"`);
    expect(head).toContain(`hreflang="zh-CN" href="${lang === 'zh-CN' ? self : alt}"`);
    expect(head).toContain(`hreflang="en" href="${lang === 'en' ? self : alt}"`);
    expect(head).toContain(`hreflang="x-default" href="${lang === 'zh-CN' ? self : alt}"`);
    expect(html).toContain(`href="${alt}"`);
  });

  it.each(PAGES)('$file 的 ProfilePage 与可见正文同源', ({ file, lang, self }) => {
    const html = read(file);
    const data = profileJsonLd(html, file);
    const mainEntity = data.mainEntity as
      { '@type'?: string; name?: string; url?: string; sameAs?: string[] } | undefined;
    expect(data['@type']).toBe('ProfilePage');
    expect(data.inLanguage).toBe(lang);
    expect(data.url).toBe(self);
    expect(mainEntity?.['@type']).toBe('Person');
    expect(mainEntity?.name).toBe('liaolongdong');
    expect(mainEntity?.url).toBe(self);
    expect(mainEntity?.sameAs).toContain('https://github.com/liaolongdong');
    expect(flat(html)).toContain('rel="me" href="https://github.com/liaolongdong"');
  });
});

describe('作者页入口不成为孤岛', () => {
  it('落地页与博客署名都指向对应语言的作者页', () => {
    expect(read('index.html')).toContain('href="./author.html"');
    expect(read('en.html')).toContain('href="./author.en.html"');

    const zhArticle = read('blog/01-local-first-password-manager.html');
    const enArticle = read('blog/01-local-first-password-manager.en.html');
    expect(zhArticle).toContain(`rel="author" href="${SITE}/author.html"`);
    expect(enArticle).toContain(`rel="author" href="${SITE}/author.en.html"`);
    expect(zhArticle).toContain('href="https://github.com/liaolongdong"');
    expect(enArticle).toContain('href="https://github.com/liaolongdong"');
  });

  it('llms.txt 与 sitemap 都收录作者页', () => {
    const llms = read('llms.txt');
    expect(llms).toContain(`${SITE}/author.html`);
    expect(llms).toContain(`${SITE}/author.en.html`);
    const sitemap = read('sitemap.xml');
    expect(sitemap).toContain(`<loc>${SITE}/author.html</loc>`);
    expect(sitemap).toContain(`<loc>${SITE}/author.en.html</loc>`);
  });

  it('作者页列出三个产品、GitHub、CWS 与 RSS 出口', () => {
    for (const { file, rss } of PAGES) {
      const html = read(file);
      for (const href of [
        'https://github.com/liaolongdong/account-password-helper',
        'https://github.com/liaolongdong/transfer-any-file',
        'https://github.com/liaolongdong/cross-origin-proxy',
        'https://chromewebstore.google.com/detail/account-password-helper/',
        rss,
      ]) {
        expect(html, `${file} 缺少出口 ${href}`).toContain(href);
      }
    }
  });
});
