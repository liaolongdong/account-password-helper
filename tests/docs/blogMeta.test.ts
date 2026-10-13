/**
 * 博客静态页元信息守卫测试
 *
 * 背景：`blog/*.html` 由 `scripts/build-blog-pages.mjs`（`pnpm gen:blog`）从 `docs/blog/{zh,en}/*.md`
 * 生成，并且是**必须提交入库的产物**——本仓库没有 Pages 部署 workflow，Pages 直接读 `main` 分支根目录，
 * 所以「改了 Markdown 忘了重跑」和「生成器本身有缺陷」都会长期留在已发布的字节里没人发现。
 * 2026-10-02 排查时同时命中了五类缺陷，本文件把它们逐条钉住：
 *
 * 1. **双 `<h1>`**：md 正文首行的 `# 标题` 与生成器页头的 `<h1>` 叠成两个一级标题（12 页全中）。
 *    现在正文不再写 h1，也不再用 `![]()` 重复插入封面；这里断言每页恰好一个 `<h1`、一张封面 `<img>`，
 *    且正文首个非空行不是标题。
 * 2. **front matter 引号原样进标签**：`title: 'xxx'` 的撇号被当成值的一部分，`<title>` 里出现字面单引号。
 *    这里不单独查引号，而是把 `<title>`、meta description、`og:image` 直接和 md 里**去引号后**的值逐字
 *    比对——生成器的解引用逻辑再次回退，等式立刻不成立，顺带也成了「改了 md 忘重跑」的新鲜度守卫。
 * 3. **`<title>` 与 description 超长**：英文标题曾达 119～149 字符（含品牌后缀），搜索结果里被截断。
 *    预算按整条 `<title>` 的字符数计（中英同为 72），description 为 170。这是像素宽度的粗略代理，
 *    当前实测最长 68 / 160，尚有 `4` 与 `10` 的余量；要再收紧先重跑 `pnpm gen:blog` 看分布。
 * 4. **缺 `robots` / favicon / theme-color / BreadcrumbList / 站内内链**：博客 12 页此前一项都没有，
 *    而同站另外 8 页全写了。这里逐页断言五件套齐备，内链至少覆盖 pricing / compare / privacy 三个落点。
 * 5. **分享图语言不匹配**：索引页的 `og:image` 按语言各取 1200×630 的
 *    `assets/cws-store/og[-en]-1200x630.png`，文章页取 md 的 `image` 字段（16:9 封面）。
 *    所有分享图都要能在仓库里找到对应文件——URL 写错在本地永远看不出问题。
 *
 * 品牌后缀、站点域名、`robots` 串在这里**刻意重复一份**而不是 import 生成器：只改生成器不改这里，
 * 正说明这是一次需要人看一眼的对外表面改动。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BLOG_DIR = path.join(ROOT, 'blog');

/** 与 scripts/build-blog-pages.mjs 一致的站点绝对前缀（重复一份是故意的，见文件头说明） */
const SITE = 'https://liaolongdong.github.io/account-password-helper';
/** 与生成器一致的页脚品牌名，用于拼 `<title>` 后缀 */
const BRAND: Record<'zh-CN' | 'en', string> = {
  'zh-CN': '账号密码管理助手',
  en: 'Account Password Helper',
};
/** 与生成器 headKit() 一致的爬虫指令 */
const ROBOTS = 'index, follow, max-image-preview:large';
/** 中英索引页文件名不对称：中文索引的 canonical 是目录 `/blog/`，英文是 `index.en.html` */
const INDEX_PAGE: Record<'zh-CN' | 'en', string> = { 'zh-CN': 'index.html', en: 'index.en.html' };

/** `<title>` 整条（含品牌后缀）的字符预算 */
const TITLE_BUDGET = 72;
/** meta description 的字符预算 */
const DESCRIPTION_BUDGET = 170;
/** 与生成器 `ISO_DATE_RE` 同形：`date` / `modified` 唯一合法的写法 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 与生成器 `SLUG_RE` 同形，外加英文产物名的 `.en` 后缀 */
const SLUG_PAGE = /^\d{2}-[a-z0-9][a-z0-9-]*(\.en)?\.html$/;

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
const ALL_PAGES = [...ARTICLE_PAGES, INDEX_PAGE['zh-CN'], INDEX_PAGE['en']];

/** prettier 会把长标签的属性折成多行；按属性名匹配前先压成一行 */
function flat(html: string): string {
  return html.replace(/\s+/g, ' ');
}

/** 取单个 meta/link 捕获组里的值；取不到即断言失败，不做静默兜底 */
function pick(html: string, pattern: string): string {
  const m = flat(html).match(new RegExp(pattern));
  expect(m, `页面里找不到匹配 ${pattern} 的标签`).not.toBeNull();
  return m![1];
}

/** 页面文件名 → 语言 */
function langOf(name: string): 'zh-CN' | 'en' {
  return name.endsWith('.en.html') ? 'en' : 'zh-CN';
}

/** 页面自指 URL（中文索引页按目录算） */
function selfUrl(name: string): string {
  return name === INDEX_PAGE['zh-CN'] ? `${SITE}/blog/` : `${SITE}/blog/${name}`;
}

/** 中英互指的另一份产物文件名 */
function siblingName(name: string): string {
  return name.endsWith('.en.html') ? name.replace(/\.en\.html$/, '.html') : `${name.replace(/\.html$/, '')}.en.html`;
}

/** 源 Markdown 路径（索引页无源文件，返回 null） */
function mdPathOf(name: string): string | null {
  if (name === INDEX_PAGE['zh-CN'] || name === INDEX_PAGE['en']) return null;
  const slug = name.replace(/\.en\.html$/, '').replace(/\.html$/, '');
  return path.join(ROOT, 'docs', 'blog', langOf(name) === 'en' ? 'en' : 'zh', `${slug}.md`);
}

/**
 * 极简 front matter 解析，规则对齐生成器的 `unquote()`：值整体被成对引号包住时去掉引号，
 * 并还原 `\'` `\"` 转义。返回 front matter 之后的正文。
 */
function readSource(mdPath: string): { fm: Record<string, string>; body: string } {
  const raw = readFileSync(mdPath, 'utf8');
  const end = raw.indexOf('\n---', 4);
  expect(end, `${path.basename(mdPath)} 缺少 front matter 结束线`).toBeGreaterThan(-1);
  const fm: Record<string, string> = {};
  for (const line of raw.slice(4, end).split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const value = line.slice(idx + 1).trim();
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    fm[line.slice(0, idx).trim()] = quoted ? quoted[2].replace(/\\(['"])/g, '$1') : value;
  }
  return { fm, body: raw.slice(end + 4) };
}

/** 按 HTML 解析器的切法取出每个 ld+json 块的正文（块体内不能再有 `<`，见 seoSurface 的同名判据） */
function ldJsonBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

describe('博客产物清单', () => {
  it('blog/ 恰好是这 12 个页面，不留已被替代的旧页', () => {
    const onDisk = readdirSync(BLOG_DIR)
      .filter(f => f.endsWith('.html'))
      .sort();
    expect(onDisk).toEqual([...ALL_PAGES].sort());
  });

  // 生成器把文件名当构建期契约（`SLUG_RE`）：它同时是产物名和 URL 的那一段，写坏了不会报错，
  // 只会发布出一个 404、一个带空格的地址，或一个中英互指对不上的名字。
  it('文章产物名都是「两位序号 + 小写连字符词」', () => {
    for (const name of ARTICLE_PAGES) {
      expect(name, `${name} 不是合法产物名`).toMatch(SLUG_PAGE);
    }
  });

  it('两页索引的 ItemList 每条 url 都指向磁盘上真实存在的产物', () => {
    // URL 是拼出来的（`${SITE}/blog/${slug}.html`），拼错在本机永远是 200：Pages 还没上线，
    // 爬虫却会拿到一片 404。这里按产物反查文件是否存在，把「写错」变成构建后立刻变红。
    for (const indexPage of [INDEX_PAGE['zh-CN'], INDEX_PAGE['en']]) {
      const html = readFileSync(path.join(BLOG_DIR, indexPage), 'utf8');
      const list = ldJsonBlocks(html)
        .map(b => JSON.parse(b) as { '@type'?: string; itemListElement?: { url?: string }[] })
        .find(d => d['@type'] === 'ItemList');
      expect(list, `${indexPage} 没有 ItemList 结构化数据`).toBeDefined();
      const urls = (list!.itemListElement ?? []).map(i => i.url ?? '');
      expect(urls.length, `${indexPage} 的 ItemList 是空的`).toBe(5);
      for (const url of urls) {
        expect(url, `${indexPage} 的 url 不在站点前缀下`).toMatch(
          /^https:\/\/liaolongdong\.github\.io\/account-password-helper\/blog\//,
        );
        const file = path.join(BLOG_DIR, url.replace(/^.*\/blog\//, ''));
        expect(existsSync(file), `${indexPage} 指向了不存在的产物：${url}`).toBe(true);
      }
    }
  });
});

describe.each(ALL_PAGES)('博客页面 %s', name => {
  const html = readFileSync(path.join(BLOG_DIR, name), 'utf8');
  const lang = langOf(name);
  const mdPath = mdPathOf(name);
  const isIndex = mdPath === null;
  const src = mdPath ? readSource(mdPath) : null;

  it('只有一个 <h1>', () => {
    expect(flat(html).match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('<title> 在预算内、不带字面引号', () => {
    const title = pick(html, '<title>([^<]*)</title>');
    expect(title.length, `<title> 长度 ${title.length} 超出预算 ${TITLE_BUDGET}`).toBeLessThanOrEqual(TITLE_BUDGET);
    expect(title).not.toMatch(/^['"]|['"]$/);
    if (src) expect(title).toBe(`${src.fm.title} | ${BRAND[lang]}`);
    else expect(title, '索引页标题应带品牌后缀').toMatch(/^.+ \| .+$/);
  });

  it('description 与 md 一致、在预算内、语言各归各位', () => {
    const desc = pick(html, '<meta name="description" content="([^"]*)"');
    if (src) expect(desc).toBe(src.fm.description);
    expect(desc.length, `description 长度 ${desc.length} 超出预算 ${DESCRIPTION_BUDGET}`).toBeLessThanOrEqual(
      DESCRIPTION_BUDGET,
    );
    if (lang === 'zh-CN') expect(desc).toMatch(/[\u4e00-\u9fff]/);
    else expect(desc).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('robots / 三件套图标 / theme-color 齐备', () => {
    expect(pick(html, '<meta name="robots" content="([^"]*)"')).toBe(ROBOTS);
    for (const href of [`${SITE}/assets/icons/icon.svg`, `${SITE}/public/icon/32.png`, `${SITE}/public/icon/128.png`]) {
      expect(flat(html), `缺少图标声明 ${href}`).toContain(`href="${href}"`);
    }
    expect(pick(html, '<meta name="theme-color" content="([^"]*)"')).toBe('#4e88ff');
  });

  it('canonical 自指，hreflang 三条中英互指', () => {
    const zhName = lang === 'en' ? siblingName(name) : name;
    const enName = lang === 'en' ? name : siblingName(name);
    expect(pick(html, '<link rel="canonical" href="([^"]*)"')).toBe(selfUrl(name));
    expect(flat(html)).toContain(`hreflang="zh-CN" href="${selfUrl(zhName)}"`);
    expect(flat(html)).toContain(`hreflang="en" href="${selfUrl(enName)}"`);
    expect(flat(html)).toContain(`hreflang="x-default" href="${selfUrl(zhName)}"`);
  });

  it('分享图按语言就位，且文件真的存在于仓库', () => {
    const og = pick(html, '<meta property="og:image" content="([^"]*)"');
    const expected = isIndex
      ? `${SITE}/assets/cws-store/${lang === 'en' ? 'og-en-1200x630.png' : 'og-1200x630.png'}`
      : `${SITE}/${src!.fm.image}`;
    expect(og).toBe(expected);
    expect(existsSync(path.join(ROOT, og.slice(SITE.length + 1))), `分享图文件不存在：${og}`).toBe(true);
    expect(pick(html, '<meta name="twitter:image" content="([^"]*)"')).toBe(og);
  });

  it('JSON-LD 全部可解析，索引页给 ItemList、文章页给 BlogPosting，两页型都有面包屑', () => {
    const blocks = ldJsonBlocks(html);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const types: string[] = [];
    for (const b of blocks) {
      const parsed = JSON.parse(b) as { '@type'?: string; '@graph'?: { '@type': string }[] };
      if (parsed['@graph']) parsed['@graph'].forEach(g => types.push(g['@type']));
      else types.push(parsed['@type'] ?? '');
    }
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain(isIndex ? 'ItemList' : 'BlogPosting');
  });

  it('日期在 meta、JSON-LD 与 md front matter 三处同源，且形状是 ISO 日期', () => {
    // 生成器用同一个 `article.date` / `article.modified` 填这三处，但填法不同（meta 走属性、
    // JSON-LD 走 `dateModified: modified || date`），且 sitemap 的 lastmod 是人工对齐其中一处。
    // 三处只要有一处写歪，Google 看到的「更新于」就和页面正文、和 sitemap 各说各话。
    if (isIndex) {
      expect(flat(html)).not.toMatch(/property="article:(published|modified)_time"/);
      return;
    }
    const published = pick(html, '<meta property="article:published_time" content="([^"]*)"');
    expect(published, `${name} 的 published_time 不是 ISO 日期`).toMatch(ISO_DATE);
    expect(published, `${name} 的 published_time 与 md 的 date 不同源`).toBe(src!.fm.date);

    const block = ldJsonBlocks(html).find(b => b.includes('"BlogPosting"'));
    expect(block, `${name} 的 JSON-LD 里找不到 BlogPosting 块`).toBeDefined();
    const posting = JSON.parse(block!) as {
      datePublished?: string;
      dateModified?: string;
    };
    expect(posting.datePublished, `${name} 的 JSON-LD datePublished 与 meta 不同源`).toBe(published);

    if (src!.fm.modified) {
      const modified = pick(html, '<meta property="article:modified_time" content="([^"]*)"');
      expect(modified, `${name} 的 modified_time 不是 ISO 日期`).toMatch(ISO_DATE);
      expect(modified, `${name} 的 modified_time 与 md 的 modified 不同源`).toBe(src!.fm.modified);
      expect(posting.dateModified, `${name} 的 JSON-LD dateModified 与 meta 不同源`).toBe(modified);
    } else {
      // 生成器在没有 modified 时会退成 date：这条不写 meta，但 JSON-LD 仍必须有一个可解析的日期。
      expect(flat(html)).not.toMatch(/property="article:modified_time"/);
      expect(posting.dateModified, `${name} 缺 modified 时 JSON-LD 应退成 date`).toBe(src!.fm.date);
    }
  });

  it('页脚有指向 pricing / compare / privacy 的内链', () => {
    for (const href of ['pricing', 'compare', 'privacy']) {
      expect(flat(html), `缺少指向 ${href} 的内链`).toContain(`${SITE}/${href}`);
    }
  });
});

describe('博客文章源文件', () => {
  it('正文首行不写 # 标题，也不重复插入封面图', () => {
    for (const name of ARTICLE_PAGES) {
      const { body } = readSource(mdPathOf(name)!);
      const firstLine = body.split('\n').find(l => l.trim() !== '') ?? '';
      expect(firstLine, `${name} 的正文首行不该是 # 标题`).not.toMatch(/^#\s/);
      expect(body, `${name} 的正文不该重复引用封面`).not.toMatch(/!\[[^\]]*\]\([^)]*blog-cover-/);
    }
  });

  it('每篇文章渲染后恰好一张封面 <img class="cover">', () => {
    for (const name of ARTICLE_PAGES) {
      const html = readFileSync(path.join(BLOG_DIR, name), 'utf8');
      expect(flat(html).match(/<img class="cover"/g), `${name} 封面图数量异常`).toHaveLength(1);
    }
  });

  // 角标是画进 `imgs/blog-covers/*.svg` 的文本节点，不会跟着文章篇数自己变：第 5 篇上线后
  // 前四张的分母仍写 `/ 04`，位图和页面都照常渲染，没有任何一条断言会红。这里把分母钉成
  // 篇数、分子钉成产物名里的序号，两处都对不上才算这个守卫有牙。
  it('五张封面 SVG 的角标计数等于文章篇数，序号各归各位', () => {
    const coverDir = path.join(ROOT, 'imgs', 'blog-covers');
    const covers = readdirSync(coverDir)
      .filter(f => /^blog-cover-\d{2}-.+\.svg$/.test(f))
      .sort();
    const total = new Set(ARTICLE_PAGES.map(n => n.replace(/(\.en)?\.html$/, ''))).size;
    expect(covers.length, `封面 SVG 数量与文章数不一致（SVG ${covers.length} / 文章 ${total}）`).toBe(total);
    for (const file of covers) {
      const seq = /^blog-cover-(\d{2})-/.exec(file)![1];
      const badge = /技术博客\s*(\d{2})\s*\/\s*(\d{2})/.exec(readFileSync(path.join(coverDir, file), 'utf8'));
      expect(badge, `${file} 里找不到「技术博客 0N / 0M」角标`).not.toBeNull();
      expect(badge![1], `${file} 的分子应等于文件名里的序号`).toBe(seq);
      expect(
        badge![2],
        `${file} 的分母没跟着篇数走（现在是 ${badge![2]}，应为 ${String(total).padStart(2, '0')}）`,
      ).toBe(String(total).padStart(2, '0'));
    }
  });
});
