/**
 * 官网 SEO 表面一致性守卫
 *
 * 背景：`sitemap.xml`、`llms.txt`、页面自述日期和正文文案各写各的，漂移不会被任何东西拦住。
 * 2026-10-02 那一轮订正（批1-D）把口径钉成两句话，本文件把它们变成断言：
 *
 * 1. **覆盖面**：Pages 从 `main` 根目录发布，根目录每个 `.html` 都必须进 sitemap，且 sitemap
 *    不指向不存在的文件；`product-site/` 是 qoder.zone 的副本，已 `noindex`，所以刻意不在 sitemap 里。
 * 2. **日期口径**：`lastmod` 表示该页**正文**最近一次实质修改的日期。页面自己声明了修改日期
 *    （落地页 JSON-LD `dateModified`、隐私页「最后更新」、博客 front-matter `modified`）时，
 *    sitemap 必须与自述一致；博客索引取五篇文章的 `max(modified)`。
 *    没有自述日期的页面（pricing / compare 两份）本文件不校验日期，只校验不能是未来日期。
 * 3. **隐私口径**：站页正文不出现被禁的绝对化表达（「绝不出浏览器」/ `Passwords Never Leave the
 *    Browser` / `100% offline` 一类）——这类词在商店审核侧已被判过，网站与 README 保持同一口径。
 *    扫描面除根目录页面外还包括 `blog/*.html`、`README*.md`、封面矢量源与 issue 模板：
 *    烧进封面 PNG 的字同样是对外承诺，而只扫 HTML 的 rg 看不见它。
 *
 * 结构方面顺带守住两条：每个页面只有一个 `<h1>`；`llms.txt` 里指向本站的每个链接都取得到文件。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SITE = 'https://liaolongdong.github.io/account-password-helper';

/** 根目录公开页面 = Pages 直接对外提供的那些 HTML */
const ROOT_PAGES = readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .sort();

/**
 * 隐私口径的补充扫描面：同样对外可见、但不在根目录 HTML 里的那几处。
 *
 * `blog/*.html` 是 `pnpm gen:blog` 的产物；README 两版是仓库门面；
 * `imgs/blog-covers/blog-cover-*.svg` 的文字层由 `pnpm covers:render` 栅格进封面 PNG，
 * 而封面 PNG 就是博客的 `og:image`——烧进图片的字也是承诺，只扫 HTML 看不见。
 * `docs/operations/promo/*.md` 是要贴到站外的成稿（公众号 / 微博），落地页之外的读者
 * 先在那儿读到这句话，口径就得在那儿成立。
 * `outline.md`、`docs/store/*` 与 `PULL_REQUEST_TEMPLATE.md` 刻意不在名单里：
 * 它们出现禁用词是在**转述禁令**，扫它们恒红。
 */
const COPY_SURFACES = [
  'README.md',
  'README.en.md',
  'llms.txt',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  ...readdirSync(path.join(ROOT, 'blog'))
    .filter(f => f.endsWith('.html'))
    .map(f => `blog/${f}`),
  ...readdirSync(path.join(ROOT, 'imgs/blog-covers'))
    .filter(f => /^blog-cover-.+\.svg$/.test(f))
    .map(f => `imgs/blog-covers/${f}`),
  ...readdirSync(path.join(ROOT, 'docs/operations/promo'))
    .filter(f => f.endsWith('.md'))
    .map(f => `docs/operations/promo/${f}`),
];

/** 页面文件名 → sitemap 里的 `<loc>`（index.html 是目录根） */
const locOf = (file: string) => `${SITE}/${file === 'index.html' ? '' : file}`;

/** 把 `2026年10月2日` / `October 2, 2026` 这类自述日期读成 `YYYY-MM-DD` */
const isoOf = (y: string, m: string, d: string) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

interface UrlEntry {
  loc: string;
  lastmod: string;
}

function sitemapEntries(): UrlEntry[] {
  const xml = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map(m => ({
    loc: m[1],
    lastmod: m[2],
  }));
}

function readPage(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

/** 页内 `<head>` 之后的部分——正文与页脚，爬虫和读者真正看到的内容 */
function bodyOf(file: string): string {
  return readPage(file).split('</head>')[1] ?? '';
}

/** 博客 front-matter 的 `modified:`；读不到就返回 null，让调用方的断言直接指向源头 */
function frontMatterModified(mdPath: string): string | null {
  const fm = readFileSync(mdPath, 'utf8').match(/^modified:\s*(\d{4}-\d{2}-\d{2})/m);
  return fm ? fm[1] : null;
}

const MONTH_EN: Record<string, string> = {
  January: '01',
  February: '02',
  March: '03',
  April: '04',
  May: '05',
  June: '06',
  July: '07',
  August: '08',
  September: '09',
  October: '10',
  November: '11',
  December: '12',
};

/** 被禁的绝对化隐私口径：不联网 / 数据永不出浏览器这类说法在商店审核侧被判过，全站统一不再出现 */
const BANNED_PHRASES = [
  '绝不出浏览器',
  '数据不出浏览器',
  'Never Leave the Browser',
  'never leave your browser',
  'never leave the browser',
  // 第三人称单数形态：主语是 credential data 时写的是 leaves，漏掉它等于给扫描面留了个洞
  'never leaves the browser',
  '100% offline',
  '零联网',
];

/**
 * 逐字找一段文本里出现的被禁绝对化隐私口径。
 *
 * 抽成函数是为了让自检能直接往里塞一枚违规词：这条断言一次扫十几个文件，
 * 「全绿」既可能因为文案干净，也可能因为匹配根本没跑，只有注入才能分辨。
 *
 * @param text 待查文本
 * @returns 命中的禁用词，干净时为空数组
 */
function bannedPhraseHitsIn(text: string): string[] {
  return BANNED_PHRASES.filter(phrase => text.includes(phrase));
}

/**
 * 在给定表面里找被禁的绝对化隐私口径。
 *
 * @param files 相对仓库根目录的路径
 * @returns `文件 → 命中词` 的清单，全部干净时为空数组
 */
function findBannedPhraseOffenders(files: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    bannedPhraseHitsIn(readFileSync(path.join(ROOT, file), 'utf8')).forEach(phrase => {
      offenders.push(`${file} → ${phrase}`);
    });
  }
  return offenders;
}

describe('官网 SEO 表面一致性', () => {
  const entries = sitemapEntries();

  it('sitemap 覆盖根目录每个公开页面，且没有多余条目', () => {
    expect(ROOT_PAGES, '根目录公开页名单变了，本守卫与 sitemap 都需要一并确认').toEqual([
      'compare.en.html',
      'compare.html',
      'en.html',
      'index.html',
      'pricing.en.html',
      'pricing.html',
      'privacy.en.html',
      'privacy.html',
    ]);
    const sitePageLocs = entries.filter(e => !e.loc.includes('/blog/'));
    expect(sitePageLocs.map(e => e.loc).sort()).toEqual(ROOT_PAGES.map(locOf).sort());
  });

  it('sitemap 每条 loc 都指向真实存在的文件', () => {
    for (const { loc } of entries) {
      const rel = loc.startsWith(`${SITE}/blog/`)
        ? `blog/${loc.slice(`${SITE}/blog/`.length)}`
        : loc.slice(`${SITE}/`.length);
      const file = rel === '' ? 'index.html' : rel;
      expect(existsSync(path.join(ROOT, file)), `sitemap 指向不存在的文件：${loc}`).toBe(true);
    }
  });

  it('qoder.zone 副本（product-site）不进 sitemap', () => {
    expect(entries.filter(e => e.loc.includes('product-site')).map(e => e.loc)).toEqual([]);
  });

  it('落地页的 lastmod 等于 JSON-LD 的 dateModified', () => {
    for (const file of ['index.html', 'en.html']) {
      const declared = readPage(file).match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})"/);
      expect(declared, `${file} 没有 dateModified 字段`).not.toBeNull();
      const entry = entries.find(e => e.loc === locOf(file));
      expect(entry, `sitemap 缺少 ${file}`).toBeDefined();
      expect(entry!.lastmod, `${file} 的 sitemap lastmod 与页内 dateModified 不一致`).toBe(declared![1]);
    }
  });

  it('隐私页的 lastmod 等于页内「最后更新」', () => {
    for (const file of ['privacy.html', 'privacy.en.html']) {
      const body = bodyOf(file);
      const zh = body.match(/最后更新：(\d{4})年(\d{1,2})月(\d{1,2})日/);
      const en = body.match(/Last updated: ([A-Za-z]+) (\d{1,2}), (\d{4})/);
      expect(zh, `${file} 缺少中文「最后更新」`).not.toBeNull();
      expect(en, `${file} 缺少英文 Last updated`).not.toBeNull();
      const fromZh = isoOf(zh![1], zh![2], zh![3]);
      const fromEn = isoOf(en![3], MONTH_EN[en![1]] ?? '?', en![2]);
      expect(fromEn, `${file} 中英文自述日期不一致`).toBe(fromZh);
      const entry = entries.find(e => e.loc === locOf(file));
      expect(entry, `sitemap 缺少 ${file}`).toBeDefined();
      expect(entry!.lastmod, `${file} 的 sitemap lastmod 与页内「最后更新」不一致`).toBe(fromZh);
    }
  });

  it('博客文章的 lastmod 等于 front-matter 的 modified，索引页取五篇的最大值', () => {
    const articles = entries.filter(e => /\/blog\/\d\d-/.test(e.loc));
    expect(articles, 'sitemap 里没有博客文章条目').toHaveLength(10);

    const modifiedByLang: Record<'zh' | 'en', string[]> = { zh: [], en: [] };
    for (const { loc, lastmod } of articles) {
      const name = loc.split('/').pop()!;
      const slug = name.replace(/\.html$/, '').replace(/\.en$/, '');
      const lang = name.endsWith('.en.html') ? 'en' : 'zh';
      const declared = frontMatterModified(path.join(ROOT, 'docs/blog', lang, `${slug}.md`));
      expect(declared, `${lang}/0x-${slug}.md 缺 modified 字段`).not.toBeNull();
      expect(lastmod, `${loc} 的 lastmod 与其 Markdown 的 modified 不一致`).toBe(declared);
      modifiedByLang[lang].push(declared!);
    }

    const newest = Math.max(...[...modifiedByLang.zh, ...modifiedByLang.en].map(d => Number(d.replace(/-/g, ''))));
    const newestIso = String(newest).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    for (const indexLoc of [`${SITE}/blog/`, `${SITE}/blog/index.en.html`]) {
      const entry = entries.find(e => e.loc === indexLoc);
      expect(entry, `sitemap 缺少博客索引 ${indexLoc}`).toBeDefined();
      expect(entry!.lastmod, `${indexLoc} 应等于五篇文章最新的 modified`).toBe(newestIso);
    }
  });

  it('sitemap 里没有未来日期，且全部是 ISO 形状', () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    for (const { loc, lastmod } of entries) {
      expect(lastmod, `${loc} 的 lastmod 不是 YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(lastmod <= todayIso, `${loc} 的 lastmod ${lastmod} 晚于今天 ${todayIso}`).toBe(true);
    }
  });

  it('每个公开页面只有一个 <h1>', () => {
    for (const file of ROOT_PAGES) {
      expect((bodyOf(file).match(/<h1[\s>]/g) ?? []).length, `${file} 的 <h1> 数量不是 1`).toBe(1);
    }
  });

  it('站页正文、README 与封面矢量源都不出现被禁的绝对化隐私口径', () => {
    const offenders = findBannedPhraseOffenders([...ROOT_PAGES, ...COPY_SURFACES]);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('product-site 副本已 noindex，canonical 仍指向 qoder.zone', () => {
    const html = readPage('product-site/index.html');
    const robots = html.match(/name="robots"\s+content="([^"]*)"/);
    expect(robots, 'product-site/index.html 缺少 robots meta').not.toBeNull();
    expect(robots![1]).toContain('noindex');
    expect(html).toContain('rel="canonical"');
    expect(html, 'canonical 应指向 qoder.zone 正式地址').toMatch(
      /href="https:\/\/account-password-helper-[a-z0-9]+\.qoder\.zone\/"/,
    );
  });

  it('llms.txt 有 Optional 小节，且指向本站的每个链接都取得到文件', () => {
    const text = readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
    expect(text).toContain('## Optional');
    expect(text).toContain('## Quick Facts');
    const missing: string[] = [];
    for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
      const url = m[1];
      if (!url.startsWith(SITE)) continue;
      let rel = url.slice(SITE.length).replace(/^\//, '');
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      if (!existsSync(path.join(ROOT, rel))) missing.push(url);
    }
    expect(missing, `llms.txt 里有 ${missing.length} 条链接指向不存在的本地文件`).toEqual([]);
  });
});

describe('守卫自检：匹配层与扫描面都得有牙', () => {
  it('往文案里塞一枚禁用词 → 匹配层认得出，合规口径不误伤', () => {
    expect(bannedPhraseHitsIn('密码数据不出浏览器，多环境账号不串号')).toEqual(['数据不出浏览器']);
    expect(bannedPhraseHitsIn('credential data never leaves the browser')).toEqual(['never leaves the browser']);
    expect(bannedPhraseHitsIn('密码数据不出本机，多环境账号不串号')).toEqual([]);
    expect(bannedPhraseHitsIn('credential data never leaves this machine')).toEqual([]);
  });

  it('扫描面确实读到了 README、博客页、封面矢量源与 issue 模板', () => {
    expect(COPY_SURFACES).toContain('README.md');
    expect(COPY_SURFACES).toContain('README.en.md');
    expect(COPY_SURFACES).toContain('.github/ISSUE_TEMPLATE/feature_request.yml');
    const blogPages = COPY_SURFACES.filter(f => f.startsWith('blog/'));
    expect(blogPages.length, 'blog/*.html 没进扫描面，那条断言成了空转').toBeGreaterThan(0);
    const coverSources = COPY_SURFACES.filter(f => f.startsWith('imgs/blog-covers/'));
    expect(coverSources.length, '封面矢量源没进扫描面，烧进 PNG 的文案无人看守').toBeGreaterThan(0);
  });
});
