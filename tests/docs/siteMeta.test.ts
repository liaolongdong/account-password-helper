/**
 * 官网 8 个页面的分享图与图标基线测试
 *
 * 背景：`og:image` / `twitter:image` 曾长期指向 `marquee-1400x560.png`——那是 Chrome 商店的
 * 2.5:1 跑马灯横幅，被社交平台按 1.91:1 裁切后左右各吃掉约 200px 文字；同时英文页与中文页
 * 共用同一张中文卡，英文受众在链接预览里看到的是中文文案。图标侧则是另一种缺失：
 * `compare*.html` 两个手写页根本没有 favicon 与 `theme-color`，`privacy*.html` 只有 SVG 一枚。
 *
 * 这里固化 2026-10-02 修好的四件事：
 *
 * 1. 每个页面的 `og:image` 与 `twitter:image` 都存在且**各只有一枚**，语言正确——中文页用
 *    `og-1200x630.png`，英文页用 `og-en-1200x630.png`（分享卡跟着语言走）；
 * 2. 那两张卡真实存在，且 PNG 头声明的就是 1200×630（OG 推荐的 1.91:1 尺寸，不是横幅）；
 * 3. 每个页面都有 SVG favicon + 32px PNG + apple-touch-icon + `theme-color`，且引用的本地图标
 *    文件在磁盘上取得到（Pages 从 `main` 根目录发布，`./public/...` 是真实可访问路径）；
 * 4. 商店横幅 `marquee-1400x560.png` 不再出现在 `<head>` 的任何一处图片位——包括
 *    `SoftwareApplication` JSON-LD 的 `image`（Google 对该字段要求 16:9 或 4:3，2.5:1 的横幅不合规格）。
 *
 * 常量与 `scripts/lib/share-image.mjs` 重复一份是刻意的——守卫不能依赖被守卫的模块。
 *
 * 暗色波次（`prefers-color-scheme` 自动跟随）落定时没有给每页补第二枚 `theme-color`：每页那枚
 * 取的是品牌主色 `#4e88ff`，明暗两档都不与页面底色相冲，所以第 3 条的「恰好一枚」仍是契约。
 * 若将来要让浏览器边框随暗色变深，加 `media=` 那一枚的同时要把这里改成「浅色一枚 + 深色一枚」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SITE = 'https://liaolongdong.github.io/account-password-helper';
const OG_IMAGE_ZH = `${SITE}/assets/cws-store/og-1200x630.png`;
const OG_IMAGE_EN = `${SITE}/assets/cws-store/og-en-1200x630.png`;
const STORE_MARQUEE = `${SITE}/assets/cws-store/marquee-1400x560.png`;

/** 官网对外页面：`.en.html` 结尾的是英文页，其余为中文页 */
const PAGES: ReadonlyArray<{ file: string; lang: 'zh' | 'en' }> = [
  { file: 'index.html', lang: 'zh' },
  { file: 'en.html', lang: 'en' },
  { file: 'pricing.html', lang: 'zh' },
  { file: 'pricing.en.html', lang: 'en' },
  { file: 'privacy.html', lang: 'zh' },
  { file: 'privacy.en.html', lang: 'en' },
  { file: 'compare.html', lang: 'zh' },
  { file: 'compare.en.html', lang: 'en' },
];

/**
 * Prettier 的 `singleAttributePerLine` 会把每个属性换行，标签因此跨行。
 * 取 `<head>` 并把空白压平后再匹配，读到的就是浏览器实际解析到的属性值。
 */
function headOf(file: string): string {
  const html = readFileSync(path.join(ROOT, file), 'utf8');
  const end = html.indexOf('</head>');
  expect(end, `${file} 找不到 </head>`).toBeGreaterThan(-1);
  return html.slice(0, end).replace(/\s+/g, ' ');
}

function matches(head: string, attr: RegExp): string[] {
  return [...head.matchAll(attr)].map(m => m[1]);
}

/** 从 PNG 的 IHDR 头读宽高——不引入图片依赖，只验「这张卡确实是我们说的那个尺寸」 */
function pngSize(absPath: string): { width: number; height: number } | null {
  const buf = readFileSync(absPath);
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng || buf.slice(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('官网分享图与图标基线', () => {
  describe.each(PAGES)('$file（$lang 页）', ({ file, lang }) => {
    const expected = lang === 'zh' ? OG_IMAGE_ZH : OG_IMAGE_EN;

    it('og:image 与 twitter:image 各只有一枚，且指向本页语言的分享卡', () => {
      const head = headOf(file);
      const og = matches(head, /property="og:image" content="([^"]*)"/g);
      const twitter = matches(head, /name="twitter:image" content="([^"]*)"/g);
      expect(og, `og:image 应当恰好一枚，实际 ${og.length}`).toEqual([expected]);
      expect(twitter, `twitter:image 应当恰好一枚，实际 ${twitter.length}`).toEqual([expected]);
    });

    it('不会把 Chrome 商店横幅当分享图', () => {
      const hits = headOf(file).split(STORE_MARQUEE).length - 1;
      expect(hits, `<head> 里仍有 ${hits} 处商店横幅（2.5:1，社交平台与富结果都按 16:9 裁）`).toBe(0);
    });

    it('SVG favicon、32px PNG、apple-touch-icon、theme-color 齐备', () => {
      const head = headOf(file);
      const icons = matches(head, /<link rel="icon" type="([^"]*)"/g);
      expect(icons, '缺少 <link rel="icon">').toContain('image/svg+xml');
      expect(icons, '缺少 32px PNG favicon（社交平台的圆形头像位只用这一档）').toContain('image/png');
      expect(matches(head, /<link rel="apple-touch-icon"/g), '缺少 apple-touch-icon').toHaveLength(1);
      expect(matches(head, /name="theme-color" content="([^"]{4,9})"/g), 'theme-color 应当恰好一枚').toHaveLength(1);
    });

    it('页内引用的本地图标都取得到文件', () => {
      for (const href of matches(headOf(file), /<link rel="[^"]*"[^>]*href="([^"]*)"/g)) {
        if (!href.startsWith('./')) continue;
        expect(existsSync(path.join(ROOT, href.slice(2))), `${file} 引用了不存在的图标 ${href}`).toBe(true);
      }
    });
  });

  it('两张分享卡存在且是 1200×630', () => {
    for (const url of [OG_IMAGE_ZH, OG_IMAGE_EN]) {
      const abs = path.join(ROOT, url.replace(SITE, '').slice(1));
      expect(existsSync(abs), `分享卡缺失：${url}`).toBe(true);
      expect(pngSize(abs), `${url} 不是可解析的 PNG`).toEqual({ width: 1200, height: 630 });
    }
  });

  it('英文卡与中文卡是两张不同的图（分享预览跟着语言走）', () => {
    const zh = readFileSync(path.join(ROOT, 'assets/cws-store/og-1200x630.png'));
    const en = readFileSync(path.join(ROOT, 'assets/cws-store/og-en-1200x630.png'));
    expect(zh.equals(en), '两张分享卡内容相同，英文页等于没换图').toBe(false);
  });
});
