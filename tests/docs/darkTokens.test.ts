/**
 * 官网暗色档守卫（prefers-color-scheme 自动跟随）
 *
 * 暗色档只翻令牌、不翻组件规则，所以这套东西的正确性完全押在两件事实上：
 *
 * 1. **底色全部走令牌**。只要还剩一处 `background: white` 这种写死的亮底，暗档就会露出
 *    一块亮斑——而它在亮档里完全正常，任何亮档回归都发现不了。本文件直接扫 `<style>` 主体。
 * 2. **暗档写的令牌名必须真实存在**。`--surfacе` 这类拼错（同形异码字符、少一个字母）不会报错，
 *    只会让那一档在暗色下永远停在亮值上；所以除校验令牌集之外，还断言暗档声明的每个属性名
 *    都能在 `:root` 里找到。
 *
 * 另外钉住三条口径：`color-scheme` 已声明（否则滚动条/表单控件停在亮档）、`theme-color` 仍是
 * 单条品牌色（没被顺手拆成两档）、`en.html` 由 `gen:en` 继承了同一份令牌层。
 *
 * 对比度按 WCAG 2.1 相对亮度实算，两档成对断言：暗档不要求比亮档更高，但不得明显更低
 * （`--text` 一档 4.5:1 为线，琥珀告示条按既有取值放 4.0:1）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** `<style>` 主体 = 第一个 style 块；`<noscript>` 里那段窄屏兜底不含配色，不参与本守卫 */
function mainStyle(html: string): string {
  const block = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!block) throw new Error('页面里找不到 <style> 主体');
  return block[1];
}

/** 取 `:root { … }` 里的自定义属性；`dark=true` 时只认暗色 @media 内的那一份 */
function rootTokens(css: string, dark = false): Map<string, string> {
  const scope = dark
    ? css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    : css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'));
  const open = scope.indexOf(':root {');
  if (open < 0) throw new Error(dark ? '缺少暗色 :root 块' : '缺少 :root 块');
  const body = scope.slice(open, scope.indexOf('}', open));
  const tokens = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/** 暗档块单独切出来，用于「令牌之外不许写死颜色」的扫描 */
function darkBlock(css: string): string {
  const start = css.indexOf('@media (prefers-color-scheme: dark)');
  return css.slice(start, css.indexOf('\n      }', start) + 1);
}

/** `#rgb` / `#rrggbb` → 通道数组；非十六进制（渐变、rgba()、关键字）返回 null */
function channels(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.1 相对亮度 */
function luminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** 前景/背景对比度；任一侧不是纯色十六进制（如渐变）时返回 null，由调用方跳过 */
function contrast(fg: string | undefined, bg: string | undefined): number | null {
  const f = fg && channels(fg);
  const b = bg && channels(bg);
  if (!f || !b) return null;
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 表面层令牌：暗档必须逐条给出，缺一条就是页面上的一块亮斑 */
const SURFACE_TOKENS = [
  '--bg',
  '--bg-soft',
  '--surface',
  '--surface-hero',
  '--surface-tint',
  '--surface-chip',
  '--warn-surface',
  '--warn-border',
  '--warn-text',
  '--footer-bg',
  '--nav-bg',
  '--nav-border',
  '--flow-fill',
  '--text',
  '--text-muted',
  '--text-strong',
  '--border',
  '--primary-soft',
] as const;

/** 两档成对断言的配色组合（名称 → [前景令牌, 背景令牌, 及格线]） */
const CONTRAST_PAIRS: ReadonlyArray<readonly [string, string, string, number]> = [
  ['正文 / 页面底', '--text', '--bg', 4.5],
  ['正文 / 卡片底', '--text', '--surface', 4.5],
  ['次级文字 / 卡片底', '--text-muted', '--surface', 4.5],
  ['次级文字 / 页面底', '--text-muted', '--bg', 4.5],
  ['页头锚点 / 页面底', '--text-strong', '--bg', 4.5],
  ['告示条文字 / 告示条底', '--warn-text', '--warn-surface', 4.0],
];

/**
 * 刻意保留写死亮色的位置：二维码成像底必须恒白，否则暗档扫不出。
 * 半透明白底只有 **alpha ≥ 0.1** 的那档算「一面底」，不许写死——2026-10-02 的无头实测就是这么
 * 抓到页头的：`.nav` 写着 `rgba(255, 255, 255, 0.78)`，令牌全对但页头在暗档仍是整页最亮的一条。
 * alpha < 0.1 的是深色区上的肌理（页脚那种 4% 提亮），两档都成立，不在扫描面内；
 * `.key-card` 的掠光是 `background: linear-gradient(...)`，落在蓝底上，同理不在面内。
 */
const ALLOWED_LIGHT_BG = ['background: white;'];
const BANNED_OPAQUE_LIGHT_BG = /^background(-color)?:\s*(white|#f{3,8}|#e{3,8}|#f8fafc|#f6f9ff|#f4f8ff|#eef3ff)\b/i;
const BANNED_TRANSLUCENT_LIGHT_BG = /^background(-color)?:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\s*\)/i;

/** 一面「底」的门槛：alpha ≥ 0.1 才算，深色区上 4% 那种肌理不在此列 */
function isBannedBackground(decl: string): boolean {
  if (BANNED_OPAQUE_LIGHT_BG.test(decl)) return true;
  const m = BANNED_TRANSLUCENT_LIGHT_BG.exec(decl);
  return !!m && Number(m[2]) >= 0.1;
}

const pages = ['index.html', 'en.html'] as const;

describe('官网暗色档：令牌层完整性', () => {
  it.each(pages)('%s 的 :root 声明了完整的表面层令牌', page => {
    const light = rootTokens(mainStyle(read(page)));
    const missing = SURFACE_TOKENS.filter(t => !light.has(t));
    expect(missing, `${page} 缺少令牌：${missing.join(' ')}`).toEqual([]);
  });

  it.each(pages)('%s 的暗档逐条覆盖表面层令牌，且没有拼错的属性名', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    const missing = SURFACE_TOKENS.filter(t => !dark.has(t));
    expect(missing, `${page} 暗档缺少令牌：${missing.join(' ')}`).toEqual([]);
    // 暗档写了 :root 里没有的属性名 = 静默失效，比缺失更难发现
    const orphans = [...dark.keys()].filter(t => !light.has(t));
    expect(orphans, `${page} 暗档声明了 :root 不存在的令牌：${orphans.join(' ')}`).toEqual([]);
  });

  it.each(pages)('%s 声明 color-scheme，避免控件与滚动条停在亮档', page => {
    expect(mainStyle(read(page))).toMatch(/color-scheme:\s*light dark;/);
  });

  // theme-color 刻意保持单条 #4e88ff：那是品牌色而不是页面底色，亮档今天就是这个值，
  // 拆成两档会把已发布页面的浏览器工具栏颜色一并改掉。
  it('theme-color 仍是单条品牌色，未随暗档拆分', () => {
    const metas = [...read('index.html').matchAll(/name="theme-color"/g)];
    expect(metas).toHaveLength(1);
  });
});

describe('官网暗色档：底色不得残留写死的亮色', () => {
  it.each(pages)('%s 的 <style> 主体里没有游离的亮底', page => {
    const css = mainStyle(read(page));
    const body = css.replace(darkBlock(css), '');
    const offenders: string[] = [];
    body
      .split('\n')
      .filter(line => !line.trim().startsWith('/*') && !line.trim().startsWith('--'))
      .forEach((line, i) => {
        const trimmed = line.trim();
        if (isBannedBackground(trimmed)) {
          if (!ALLOWED_LIGHT_BG.includes(trimmed)) offenders.push(`L${i}: ${trimmed}`);
        }
      });
    expect(offenders, `${page} 存在暗档会露白的底色：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('.footer-wechat img 仍然刻意写死 white（二维码成像底）', () => {
    const css = mainStyle(read('index.html'));
    const rule = /\.footer-wechat img\s*\{[\s\S]*?\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('background: white;');
  });
});

describe('官网暗色档：两档对比度成对达标', () => {
  it.each(pages)('%s 每个文字/底色组合在亮暗两档都不低于及格线', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    const failures: string[] = [];
    for (const [label, fg, bg, floor] of CONTRAST_PAIRS) {
      for (const [scheme, tokens] of [
        ['亮', light],
        ['暗', dark],
      ] as const) {
        const ratio = contrast(tokens.get(fg), tokens.get(bg));
        if (ratio !== null && ratio < floor) {
          failures.push(`${label}（${scheme}档）${ratio.toFixed(2)}:1 < ${floor}:1`);
        }
      }
    }
    expect(failures, `${page} 对比度不达标：\n${failures.join('\n')}`).toEqual([]);
  });

  it('暗档不把主色改掉：主色实底按钮上的白字比例与亮档同源', () => {
    const css = mainStyle(read('index.html'));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    // --primary 一旦被抬亮，.btn-primary 的白字对比度会掉（暗档 2.4:1 < 亮档 3.4:1）
    for (const token of ['--primary', '--primary-dark', '--accent']) {
      expect(dark.get(token) ?? light.get(token), `${token} 不应在暗档另起炉灶`).toBe(light.get(token));
    }
  });
});

/**
 * 全站表面：Pages 根目录的每个页面 + 博客十二页，都必须有暗档令牌层。
 *
 * 这条不是「顺手多覆盖几个文件」——暗色用户是从落地页点进对比页 / 博客的，
 * 一半暗一半亮比全站亮更难看，而且这种割裂不会有任何测试自己变红。
 * `product-site/index.html` 是 qoder.zone 的副本、已 noindex，刻意不在名单里。
 */
const publishedPages = [
  ...readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .map(f => f),
  ...readdirSync(path.join(ROOT, 'blog'))
    .filter(f => f.endsWith('.html'))
    .map(f => `blog/${f}`),
].sort();

const FG_TOKENS = ['--text', '--text-strong', '--text-muted', '--text-secondary', '--muted'];
const BG_TOKENS = ['--bg', '--bg-soft', '--bg-alt', '--card', '--surface'];

describe('官网暗色档：全站每个对外页面都覆盖', () => {
  it('页面清单是根目录 8 页 + 博客 12 页，product-site 副本仍在名单外', () => {
    // 名单本身必须是钉死的断言：publishedPages 由 readdirSync 现取，「长度 > 15」和
    // 「不含 product-site」都由构造方式保证，永远红不了。真正有牙的是这两条等式
    // （新增/删除页面必须来这里点名）加下面那条针对副本文件本身的断言。
    expect(publishedPages.filter(p => !p.includes('/'))).toEqual([
      'compare.en.html',
      'compare.html',
      'en.html',
      'index.html',
      'pricing.en.html',
      'pricing.html',
      'privacy.en.html',
      'privacy.html',
    ]);
    expect(publishedPages.filter(p => p.startsWith('blog/'))).toHaveLength(12);
    // 副本的样式是外链（product-site/assets/css/site.css），页面里没有 `<style>` 主体，
    // 所以「名单外」只能这样验：HTML 与它自己那份 CSS 都不出现 prefers-color-scheme。
    const copy = [read('product-site/index.html'), read('product-site/assets/css/site.css')].join('\n');
    expect(copy, 'product-site 副本不该有暗色档——它是 noindex 的镜像，改它等于改两处').not.toMatch(
      /prefers-color-scheme/,
    );
  });

  it.each(publishedPages)('%s 有暗档 :root 与 color-scheme', page => {
    const css = mainStyle(read(page));
    expect(css).toMatch(/color-scheme:\s*light dark;/);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });

  it.each(publishedPages)('%s 暗档没有拼错的令牌名', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    const orphans = [...dark.keys()].filter(t => !light.has(t));
    expect(orphans, `${page} 暗档声明了 :root 不存在的令牌：${orphans.join(' ')}`).toEqual([]);
  });

  it.each(publishedPages)('%s 的文字/底色组合在两档都过 4.5:1', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    const failures: string[] = [];
    let checked = 0;
    for (const fg of FG_TOKENS) {
      for (const bg of BG_TOKENS) {
        for (const [scheme, tokens] of [
          ['亮', light],
          ['暗', dark],
        ] as const) {
          const ratio = contrast(tokens.get(fg), tokens.get(bg));
          if (ratio === null) continue;
          checked += 1;
          if (ratio < 4.5) {
            failures.push(`${fg} on ${bg}（${scheme}档）${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
    // 实算到的组合数必须有下限：contrast() 对渐变与 rgba 返回 null 并被跳过，
    // 一页把底色换成渐变就能让整条断言静默空转——全绿不等于达标。
    // 地板取 8：最少的那批页面（博客与 privacy / compare）恰好是 2 前景 × 2 背景 × 两档 = 8，
    // 少一档令牌或把它改成非十六进制就会掉到 8 以下；落地页 18、定价页 12 都在其上。
    expect(checked, `${page} 只实算到 ${checked} 组对比度，断言近乎空转`).toBeGreaterThanOrEqual(8);
    expect(failures, `${page} 对比度不达标：\n${failures.join('\n')}`).toEqual([]);
  });

  it.each(publishedPages)('%s 没有写死的亮底', page => {
    const css = mainStyle(read(page));
    const body = css.replace(darkBlock(css), '');
    const offenders = body
      .split('\n')
      .map(l => l.trim())
      .filter(l => isBannedBackground(l) && !ALLOWED_LIGHT_BG.includes(l));
    expect(offenders, `${page} 存在暗档会露白的底色：\n${offenders.join('\n')}`).toEqual([]);
  });
});
