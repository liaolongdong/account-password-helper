/**
 * 分享图的 `og:image:alt` / `:width` / `:height` 三条附加声明。
 *
 * 起因：全站 32 个页面此前只有 `og:image` 一枚。缺 width/height 时社交平台必须先下载图片
 * 才能确定比例，预览卡因此更容易错位或延迟；缺 alt 时读屏用户与图片加载失败的场景拿不到
 * 任何描述。三条都补上之后，必须钉住「值是真的」——尺寸写死一份会让博客封面（1600×900）
 * 与品牌卡（1200×630）里的一族说假话，所以这里**从 PNG 头独立读一遍**比对。
 *
 * 两条判据：
 * 1. 每页三条各恰好一枚，alt 非空，width/height 是正整数且等于该图 PNG 头声明的真实像素；
 * 2. 品牌卡的 alt 按语言分流（英文页不能挂中文描述），博客文章页的 alt 取自文章标题。
 *
 * 牙齿：把某页的 width 改成另一个数、或删掉一条 alt，都必须判红。
 *
 * PNG 头解析在本文件独立写一份，不 import `scripts/lib/share-image.mjs`——守卫不依赖被守卫
 * 的模块，否则实现与判据会一起错。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SITE = 'https://liaolongdong.github.io/account-password-helper/';

/** 根目录营销页：`.en.html` 结尾的是英文页 */
const ROOT_PAGES = [
  'index.html',
  'en.html',
  'author.html',
  'author.en.html',
  'compare.html',
  'compare.en.html',
  'pricing.html',
  'pricing.en.html',
  'privacy.html',
  'privacy.en.html',
];

const BLOG_PAGES = readdirSync(path.join(ROOT, 'blog'))
  .filter(name => name.endsWith('.html'))
  .map(name => `blog/${name}`)
  .sort();

const ALL_PAGES = [...ROOT_PAGES, ...BLOG_PAGES];

/** 把 head 的空白压平，规避 prettier 的 singleAttributePerLine 折行 */
function headOf(file: string): string {
  const html = readFileSync(path.join(ROOT, file), 'utf8');
  const end = html.indexOf('</head>');
  expect(end, `${file} 找不到 </head>`).toBeGreaterThan(-1);
  return html.slice(0, end).replace(/\s+/g, ' ');
}

function contents(head: string, key: string): string[] {
  return [...head.matchAll(new RegExp(`property="${key}" content="([^"]*)"`, 'g'))].map(match => match[1]);
}

/** 独立实现的 PNG IHDR 宽高读取 */
function realSize(imageUrl: string): { width: number; height: number } {
  expect(imageUrl.startsWith(SITE), `分享图不在本站前缀下：${imageUrl}`).toBe(true);
  const buf = readFileSync(path.join(ROOT, imageUrl.slice(SITE.length)));
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(buf.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 博客文章页的标题取自对应 Markdown 的 frontmatter */
function articleTitle(file: string): string {
  const lang = file.endsWith('.en.html') ? 'en' : 'zh';
  const slug = path.basename(file).replace(/(\.en)?\.html$/, '');
  const md = readFileSync(path.join(ROOT, `docs/blog/${lang}/${slug}.md`), 'utf8');
  const raw = /^title:\s*(.+)$/m.exec(md)?.[1]?.trim() ?? '';
  return raw.replace(/^['"]|['"]$/g, '');
}

describe('分享图附加声明', () => {
  it('量到全部 32 个页面（防空跑）', () => {
    expect(ROOT_PAGES).toHaveLength(10);
    expect(BLOG_PAGES).toHaveLength(22);
    expect(ALL_PAGES).toHaveLength(32);
    // 反向自检：不存在的 key 必须读出空，否则 contents 的过滤是永真
    expect(contents(headOf('index.html'), 'og:image:no-such')).toEqual([]);
  });

  describe.each(ALL_PAGES)('%s', file => {
    it('alt / width / height 各恰好一枚，尺寸等于 PNG 头声明的真实像素', () => {
      const head = headOf(file);
      const image = contents(head, 'og:image');
      expect(image, 'og:image 应当恰好一枚').toHaveLength(1);

      const alt = contents(head, 'og:image:alt');
      expect(alt, 'og:image:alt 应当恰好一枚').toHaveLength(1);
      expect(alt[0].trim().length, `${file} 的 og:image:alt 为空`).toBeGreaterThan(0);

      const { width, height } = realSize(image[0]);
      expect(contents(head, 'og:image:width'), 'og:image:width 应当恰好一枚').toEqual([String(width)]);
      expect(contents(head, 'og:image:height'), 'og:image:height 应当恰好一枚').toEqual([String(height)]);
    });
  });

  it('品牌卡的 alt 跟着页面语言走，博客文章页的 alt 取自文章标题', () => {
    for (const file of ALL_PAGES) {
      const head = headOf(file);
      const [alt] = contents(head, 'og:image:alt');
      const [image] = contents(head, 'og:image');
      const isEnglish = /\.en\.html$|(^|\/)en\.html$/.test(file);
      const hasChinese = /[\u4e00-\u9fff]/.test(alt);

      if (image.includes('/og-1200x630.png') || image.includes('/og-en-1200x630.png')) {
        expect(hasChinese, `${file} 是英文页却挂着中文 alt`).toBe(!isEnglish);
        continue;
      }
      // 剩下的都是博客文章封面：alt 必须与该语言的 md 标题逐字一致
      expect(file.startsWith('blog/'), `${file} 用了未知分享图 ${image}`).toBe(true);
      expect(alt, `${file} 的 alt 与文章标题不一致`).toBe(articleTitle(file));
    }
  });
});
