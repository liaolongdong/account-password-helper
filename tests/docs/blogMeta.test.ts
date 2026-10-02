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

describe('博客产物清单', () => {
  it('blog/ 恰好是这 12 个页面，不留已被替代的旧页', () => {
    const onDisk = readdirSync(BLOG_DIR)
      .filter(f => f.endsWith('.html'))
      .sort();
    expect(onDisk).toEqual([...ALL_PAGES].sort());
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
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
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
});
