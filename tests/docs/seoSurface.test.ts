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
 *    2026-10-02 的评审把另外三处补进来——`utils/i18n/locales/**`（装进扩展、用户在侧边栏
 *    与管理页读到的就是它）、`public/_locales/**`（商店 listing 的元数据）与
 *    `imgs/store-creatives/*.svg`（`store-creatives:render` 栅格进商店宣传图 PNG 的文字层）。
 *    这三处当初都在口径之外，`docs/store/CWS_PUBLISHING_GUIDE.md:193` 那句「全部表面」才落到实处。
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
 * `utils/i18n/locales/{zh-CN,en}/*.json` 与 `public/_locales/*\/messages.json` 装进的是
 * 用户机器上的扩展本体——侧边栏、管理页和商店 listing 里的每一句隐私承诺都由它们写出；
 * `imgs/store-creatives/*.svg` 同理由 `pnpm store-creatives:render` 烧进商店宣传图 PNG。
 * 这三处此前都在扫描面之外，2026-10-02 评审就是从 `health.json` 那句「零联网」发现这个洞的。
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
  ...readdirSync(path.join(ROOT, 'imgs/store-creatives'))
    .filter(f => f.endsWith('.svg'))
    .map(f => `imgs/store-creatives/${f}`),
  ...readdirSync(path.join(ROOT, 'docs/operations/promo'))
    .filter(f => f.endsWith('.md'))
    .map(f => `docs/operations/promo/${f}`),
  ...['zh-CN', 'en'].flatMap(lang =>
    readdirSync(path.join(ROOT, 'utils/i18n/locales', lang))
      .filter(f => f.endsWith('.json'))
      .map(f => `utils/i18n/locales/${lang}/${f}`),
  ),
  ...['zh_CN', 'en'].map(l => `public/_locales/${l}/messages.json`),
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
  // 「零网络传输」与「零联网」是两条不同的旧措辞，商店指南点名禁的是前者（`CWS_PUBLISHING_GUIDE.md:193`）
  '零网络传输',
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

  it('站页正文、README、语言包与两处矢量源都不出现被禁的绝对化隐私口径', () => {
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

/**
 * 结构化数据块：整块必须留在 `<script type="application/ld+json">` 里
 *
 * HTML 解析器不认识 JSON，它只在一个裸的 `</script` 面前收工。值里出现这个形状时块会就地终止，
 * 后半截变成页面上的裸文本——爬虫读到的是断掉的 JSON，而本地 `JSON.parse(块体)` 照样绿，
 * 因为测试拿到的已经是被截短的那半截。所以对整个对外表面立两条：
 *
 * 1. 块体内不许出现裸的 `<`（小于号一律写成等价的 `<`，语义不变）；
 * 2. 块体必须可解析。
 *
 * 生成侧的转义在 `scripts/lib/faq-schema.mjs`（FAQPage）与 `scripts/build-blog-pages.mjs`
 * （BreadcrumbList / ItemList / BlogPosting）。根目录另外几页是手写块，同在此扫描面内。
 */
const BLOG_PAGES = readdirSync(path.join(ROOT, 'blog'))
  .filter(f => f.endsWith('.html'))
  .map(f => `blog/${f}`);

/**
 * 尚无结构化数据的页面。这是**缺口名单**不是豁免理由：补上一块 ld+json 就得把它从这里删掉，
 * 由下面那条自检把关。默默跳过这些页等于让它们永远不在扫描面内。
 */
const NO_LD_JSON_PAGES = ['privacy.en.html', 'privacy.html'];

const LD_JSON_PAGES = [...ROOT_PAGES, ...BLOG_PAGES].sort().filter(p => !NO_LD_JSON_PAGES.includes(p));

/** 按 HTML 解析器的切法切出每个 ld+json 块的正文 */
function ldJsonBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

describe('结构化数据块：不被值内的尖括号截断', () => {
  it.each(LD_JSON_PAGES)('%s 的每个 ld+json 块可解析、块体内没有裸的 <', page => {
    const blocks = ldJsonBlocks(readPage(page));
    expect(blocks.length, `${page} 一个 ld+json 块都没有，这两条判据成了空转`).toBeGreaterThan(0);
    blocks.forEach((body, i) => {
      let parsed: unknown = null;
      expect(
        () => {
          parsed = JSON.parse(body);
        },
        `${page} 块 #${i + 1} 无法解析`,
      ).not.toThrow();
      expect(parsed, `${page} 块 #${i + 1} 解析结果为空`).toBeTruthy();
      // 只查 `<`：`</script` 与 `<!--` 两种起始形状都以它开头，而 JSON 字符串里的合法写法只能是转义形式
      expect(body.indexOf('<'), `${page} 块 #${i + 1} 块体内有裸的 <，script 会被就地截断`).toBe(-1);
    });
  });

  it('缺口名单精确等于「当前没有 ld+json 的页面」', () => {
    // 名单只能与实际空缺对上：多写一项会让某页永久离开扫描面，少写一项则当场变红。
    const empty = [...ROOT_PAGES, ...BLOG_PAGES].filter(p => ldJsonBlocks(readPage(p)).length === 0).sort();
    expect(empty).toEqual(NO_LD_JSON_PAGES);
  });

  it('守卫自检：还原转义就立刻命中，</script 会真的把块切短', () => {
    const faq = ldJsonBlocks(readPage('index.html')).find(b => b.includes('"FAQPage"'));
    expect(faq, 'index.html 里没有 FAQPage 块，这条自检抓不到东西').toBeDefined();
    // 夹具本身必须真含转义，否则「还原后被判据抓到」只是空转
    expect(faq!.includes('\\u003c'), 'FAQPage 块里没有 <，转义层已经不在产物里了').toBe(true);
    const unescaped = faq!.replace(/\\u003c/g, '<');
    expect(unescaped).not.toBe(faq);
    expect(unescaped.indexOf('<'), '把转义还原成裸 < 之后判据应当命中').toBeGreaterThanOrEqual(0);
    // 提取器按 HTML 解析器的切法走：值内的 </script 会让块停在它前面，后半截根本不在块体内
    const broken = ldJsonBlocks('<script type="application/ld+json">{"a":"</script><p>x</p>"} </script>');
    expect(broken).toHaveLength(1);
    expect(broken[0], '块体没被截短，说明这条自检没有复现真实形状').toBe('{"a":"');
  });
});

describe('守卫自检：匹配层与扫描面都得有牙', () => {
  it('往文案里塞一枚禁用词 → 匹配层认得出，合规口径不误伤', () => {
    expect(bannedPhraseHitsIn('密码数据不出浏览器，多环境账号不串号')).toEqual(['数据不出浏览器']);
    expect(bannedPhraseHitsIn('credential data never leaves the browser')).toEqual(['never leaves the browser']);
    expect(bannedPhraseHitsIn('密码数据不出本机，多环境账号不串号')).toEqual([]);
    expect(bannedPhraseHitsIn('credential data never leaves this machine')).toEqual([]);
    expect(bannedPhraseHitsIn('密码数据零网络传输，多环境账号不串号')).toEqual(['零网络传输']);
    // 评审从语言包里翻出来的原句——匹配层必须认得出它，否则「扫到了」只是侥幸
    expect(bannedPhraseHitsIn('命中常见泄露密码字典（离线检测、零联网）')).toEqual(['零联网']);
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

  it('扫描面确实读到了语言包、商店元数据与商店宣传图矢量源', () => {
    const locales = COPY_SURFACES.filter(f => f.startsWith('utils/i18n/locales/'));
    const zhLocales = locales.filter(f => f.includes('/zh-CN/'));
    expect(zhLocales.length, '语言包没进扫描面，装进用户机器的那句口径无人看守').toBeGreaterThan(10);
    expect(
      locales.filter(f => f.includes('/en/')),
      '只扫到中文语言包，英文文案仍在口径之外',
    ).toHaveLength(zhLocales.length);
    expect(COPY_SURFACES).toContain('public/_locales/zh_CN/messages.json');
    expect(COPY_SURFACES).toContain('public/_locales/en/messages.json');
    const storeCreatives = COPY_SURFACES.filter(f => f.startsWith('imgs/store-creatives/'));
    expect(storeCreatives.length, '商店宣传图矢量源没进扫描面，烧进 PNG 的文案无人看守').toBeGreaterThan(0);
  });

  it('泄露密码提示那条已改成限定口径，语言包扫得到它', () => {
    for (const file of ['utils/i18n/locales/zh-CN/health.json', 'utils/i18n/locales/en/health.json']) {
      const hint = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))['health.breachedHint'] as string;
      expect(hint, `${file} 缺 health.breachedHint`).toBeTruthy();
      expect(bannedPhraseHitsIn(hint), `${file} 仍写着被禁的绝对化说法`).toEqual([]);
    }
  });
});
