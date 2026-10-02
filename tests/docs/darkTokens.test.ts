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
    // --primary 一旦被抬亮，.btn-primary 的白字对比度会掉（暗档 2.4:1 < 亮档 3.4:1）。
    // 文字侧不在本条约束内：那部分走 --primary-ink / --success-ink，见下一组用例。
    for (const token of ['--primary', '--primary-dark', '--accent']) {
      expect(dark.get(token) ?? light.get(token), `${token} 不应在暗档另起炉灶`).toBe(light.get(token));
    }
  });
});

/**
 * 「主色作文字用」的那一档（批3-5 真机复核补的守卫）
 *
 * 上面那组用例只实算了 `--text` / `--text-muted` 这类成对令牌，而落地页还有第五种文字色
 * 走的是主色族：`color: var(--primary-dark)`。它在亮档是 4.28:1（勉强过线），暗档因为
 * `--primary-dark` 被钉成两档同值（那条断言是对的，它是 `.btn-primary:hover` 的实底色），
 * 落在压深的 `--primary-soft` 上只剩 2.95:1 —— 亮档全绿、暗档肉眼可读，却谁都不会变红。
 *
 * 所以这里钉三件事：
 * 1. 文字令牌必须在暗档**确实翻了值**（没翻 = 停在亮档值上，正是这次的缺陷形态）；
 * 2. 翻出来的值在三种底色（页面底 / 卡片面 / 主色软底）上两档都要 ≥ 4.5:1；
 * 3. 组件规则里不许再出现 `color: var(--primary-dark)`，也不许退回写死的十六进制墨色。
 */
const inkPages = ['index.html', 'en.html', 'compare.html', 'compare.en.html', 'pricing.html', 'pricing.en.html'];

/** 墨色令牌可能被压上去的底色（compare 页没有 --surface，缺席的组合由 contrast() 返回 null 跳过） */
const INK_BACKDROPS = ['--bg', '--surface', '--primary-soft'];

/** 取某条选择器的声明块正文；找不到返回空串。行首锚定，避免 `a` 命中 `.topbar a` */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.#]/g, '\\$&');
  const re = new RegExp(`^\\s*${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm');
  return re.exec(css)?.[1] ?? '';
}

/** 从声明块里取出 `color: #hex`，返回 undefined 表示该规则不写死墨色 */
function literalColor(css: string, selector: string): string | undefined {
  return /\bcolor:\s*(#[0-9a-fA-F]{3,8})\b/.exec(ruleBody(css, selector))?.[1];
}

describe('落地页墨色：主色作文字用的那两枚令牌', () => {
  it.each(inkPages)('%s 的 --primary-ink 在暗档确实翻了值，且两档三种底色都过线', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    expect(light.has('--primary-ink'), `${page} 缺少 :root --primary-ink`).toBe(true);
    expect(dark.has('--primary-ink'), `${page} 暗档没翻 --primary-ink（会停在亮档值上）`).toBe(true);
    expect(dark.get('--primary-ink')).not.toBe(light.get('--primary-ink'));
    const failures: string[] = [];
    let checked = 0;
    for (const bg of INK_BACKDROPS) {
      for (const [scheme, tokens] of [
        ['亮', light],
        ['暗', dark],
      ] as const) {
        const ratio = contrast(tokens.get('--primary-ink'), tokens.get(bg));
        if (ratio === null) continue;
        checked += 1;
        if (ratio < 4.5) failures.push(`--primary-ink on ${bg}（${scheme}档）${ratio.toFixed(2)}:1`);
      }
    }
    // 地板 4：最少的那页（compare 无 --surface）也有 1 底色 × 两档 × …，实算数不足说明
    // 令牌被换成了非十六进制值，整条断言会静默空转。
    expect(checked, `${page} 只实算到 ${checked} 组墨色对比度，断言近乎空转`).toBeGreaterThanOrEqual(4);
    expect(failures, `${page} 墨色对比度不达标：\n${failures.join('\n')}`).toEqual([]);
  });

  it('落地页的 --success-ink 两档都压得住绿底卡，且暗档确实翻了值', () => {
    const css = mainStyle(read('index.html'));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    expect(light.has('--success-ink'), '缺少 :root --success-ink').toBe(true);
    expect(dark.has('--success-ink'), '暗档没翻 --success-ink').toBe(true);
    for (const [scheme, tokens] of [
      ['亮', light],
      ['暗', dark],
    ] as const) {
      for (const bg of ['--bg', '--surface']) {
        const ratio = contrast(tokens.get('--success-ink'), tokens.get(bg));
        expect(ratio, `--success-ink on ${bg}（${scheme}档）`).not.toBeNull();
        // 绿底卡那一层是 rgba(66,184,131,0.07) 压在 --surface 上的合成色（亮 #f2faf6、
        // 暗 #172a39）。实算跌幅两档不一样：亮档 5.61 → 5.29（−0.32），暗档 6.61 → 5.90
        // （−0.71）。及格线抬到 4.8，是按最坏的那一档（−0.71）仍留得住 ≥4.5 定的。
        expect(ratio!, `--success-ink on ${bg}（${scheme}档）`).toBeGreaterThanOrEqual(4.8);
      }
    }
  });

  it('组件规则里不再拿实底色当文字色', () => {
    const offenders: string[] = [];
    for (const page of inkPages) {
      const css = mainStyle(read(page));
      css.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed === 'color: var(--primary-dark);' || /^color:\s*#(27754e|3a6cd9);/.test(trimmed)) {
          offenders.push(`${page} L${i}: ${trimmed}`);
        }
      });
    }
    expect(offenders, `主色实底/写死墨色被当成文字色用了：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('.footer-meta 的写死墨色在页脚底色上两档都过线', () => {
    const css = mainStyle(read('index.html'));
    const ink = literalColor(css, '.footer-meta');
    expect(ink, '.footer-meta 没写出十六进制墨色').toBeDefined();
    for (const [scheme, tokens] of [
      ['亮', rootTokens(css)],
      ['暗', rootTokens(css, true)],
    ] as const) {
      const ratio = contrast(ink, tokens.get('--footer-bg'));
      expect(ratio, `.footer-meta on --footer-bg（${scheme}档）`).not.toBeNull();
      expect(ratio!, `.footer-meta 在${scheme}档页脚上只有 ${ratio!.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // 这六页各存一份字面量（独立页、没有共享样式表），前面几条只保证「每页自己过线」，
  // 单独改某一页照样全绿——而那正是这组令牌最不该有的漂移形状。
  it('六页的墨色令牌逐字等于 index.html（每页注释都写着「与 index.html 同源」）', () => {
    const refLight = rootTokens(mainStyle(read('index.html')));
    const refDark = rootTokens(mainStyle(read('index.html')), true);
    for (const page of inkPages.slice(1)) {
      const css = mainStyle(read(page));
      const light = rootTokens(css);
      const dark = rootTokens(css, true);
      for (const token of ['--primary', '--primary-dark', '--accent', '--primary-ink', '--success-ink', '--warn-ink']) {
        expect(light.get(token), `${page} 的 ${token} 与 index.html 不同值`).toBe(refLight.get(token));
      }
      // 三枚文字令牌都必须真的翻档：只写 :root 而漏暗档，是这套令牌最容易犯的缺陷形状。
      for (const token of ['--primary-ink', '--success-ink', '--warn-ink']) {
        expect(dark.get(token), `${page} 暗档的 ${token} 与 index.html 不同值`).toBe(refDark.get(token));
      }
    }
  });
});

/**
 * compare 两页的判定格与链接（2026-10-02 整页 AA 扫描补的守卫）
 *
 * 上面几组都按「令牌 → 令牌」实算，而这两页的缺陷不在令牌层：`--accent` / `--warn` 是**实底色**
 * （实底按钮、徽标、描边），被 `.yes` / `.partial` 直接拿去当文字；`#cbd5e1` 是页头深色条上的浅字，
 * 被 `.no` 借用。三个值在 `:root` 里各自都成立，落在白底表格里却是 2.50:1、2.04:1、1.48:1——
 * 十六进制没变、令牌名没拼错、暗档也没停更，前面任何一条断言都不会红。
 *
 * 所以这里改钉「哪条规则用了哪个令牌」：选择器的 `color` 必须是指定的文字令牌，且该令牌在它
 * **实际压到的那几块底**上两档都 ≥4.5:1。`td.us` 的半透明蓝底按合成色算（亮档 #f6f9ff、暗档
 * #0e182b），不拿 `--bg` 代替——合成后最坏的一档是 `.partial` 的 4.83:1，按纯白底读会变成 5.09:1。
 */
const comparePages = ['compare.html', 'compare.en.html'] as const;

interface InkRule {
  sel: string;
  token: string;
  on: string[];
}

/** 规则 → 必须使用的文字令牌 → 真实底色（`td.us` 指那条半透明蓝底叠在 `--bg` 上的合成色） */
const COMPARE_INK_RULES: readonly InkRule[] = [
  { sel: '.yes', token: '--success-ink', on: ['--bg', '--bg-soft', 'td.us'] },
  { sel: '.no', token: '--text-muted', on: ['--bg', '--bg-soft', 'td.us'] },
  { sel: '.partial', token: '--warn-ink', on: ['--bg', '--bg-soft', 'td.us'] },
  { sel: 'a', token: '--primary-ink', on: ['--bg', '--bg-soft'] },
  { sel: '.btn.ghost', token: '--primary-ink', on: ['--primary-soft'] },
];

/** 把 `rgba()` 半透明底叠到不透明底色上，得到实际参与对比的十六进制；任一侧不可解析时返回 null */
function blendOnto(tint: string, bg: string | undefined): string | null {
  const m = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/.exec(tint);
  const base = bg === undefined ? undefined : channels(bg);
  if (!m || !base) return null;
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const mix = (c: number, u: number) => Math.round(c * a + u * (1 - a));
  return `#${[mix(r, base[0]), mix(g, base[1]), mix(b, base[2])].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

describe('compare 两页：判定格与链接只用文字令牌', () => {
  it.each(comparePages)('%s 的判定格/链接墨色在其真实底色上两档都过线', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    const tint = /background:\s*(rgba\([^)]*\))/.exec(ruleBody(css, 'td.us'))?.[1];
    expect(tint, `${page} 的 td.us 不再是 rgba() 半透明底，合成色算法要跟着改`).toBeDefined();
    const failures: string[] = [];
    let checked = 0;
    for (const rule of COMPARE_INK_RULES) {
      const body = ruleBody(css, rule.sel);
      expect(body, `${page} 找不到 ${rule.sel} 规则`).not.toBe('');
      const used = /\bcolor:\s*(var\(--[\w-]+\)|[^;]+)/.exec(body)?.[1];
      if (used !== `var(${rule.token})`) {
        failures.push(`${rule.sel} 的 color 应为 var(${rule.token})，实际是 ${used}`);
        continue;
      }
      for (const [scheme, tokens] of [
        ['亮', light],
        ['暗', dark],
      ] as const) {
        for (const surface of rule.on) {
          const bg = surface === 'td.us' ? blendOnto(tint!, tokens.get('--bg')) : tokens.get(surface);
          const ratio = contrast(tokens.get(rule.token), bg ?? undefined);
          if (ratio === null) continue;
          checked += 1;
          if (ratio < 4.5) failures.push(`${rule.sel}（${scheme}档）on ${surface} ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures, `${page} 判定格/链接对比度不达标：\n${failures.join('\n')}`).toEqual([]);
    // 5 条规则共 12 块面 × 两档 = 24 组，当前全实算到。地板 20：只要有一枚底色令牌被换成
    // 渐变或 rgba，contrast() 就返回 null 跳过，整条断言会静默空转——全绿不等于达标。
    expect(checked, `${page} 只实算到 ${checked} 组，断言近乎空转`).toBeGreaterThanOrEqual(20);
  });

  it('两枚判定令牌在暗档确实翻了值，且 --success-ink 与 index.html 逐字同源', () => {
    const refLight = rootTokens(mainStyle(read('index.html')));
    const refDark = rootTokens(mainStyle(read('index.html')), true);
    for (const page of comparePages) {
      const css = mainStyle(read(page));
      const light = rootTokens(css);
      const dark = rootTokens(css, true);
      for (const token of ['--success-ink', '--warn-ink']) {
        expect(light.has(token), `${page} 缺少 :root ${token}`).toBe(true);
        expect(dark.has(token), `${page} 暗档没翻 ${token}（会停在亮档值上）`).toBe(true);
        expect(dark.get(token), `${page} 的 ${token} 两档同值`).not.toBe(light.get(token));
      }
      // compare 页的注释写着「与 index.html 同源」，--success-ink 必须逐字相等。
      // --warn-ink 是这两页自有令牌：落地页的琥珀字面量另成一批，不在同源范围。
      expect(light.get('--success-ink'), `${page} 亮档 --success-ink 与 index.html 不同值`).toBe(
        refLight.get('--success-ink'),
      );
      expect(dark.get('--success-ink'), `${page} 暗档 --success-ink 与 index.html 不同值`).toBe(
        refDark.get('--success-ink'),
      );
    }
  });

  it('两页的 <div class="card"> 都有对应的 .card 规则', () => {
    // 英文版此前只有 HTML 用了这个类、CSS 里根本没写规则：不报错、不塌布局，只是边框 / 内距 /
    // 底色全部消失，读起来和普通段落没区别——没有任何一条既有断言会因此变红。用「用到 ⇒ 必须存在」钉住。
    for (const page of comparePages) {
      expect(read(page), `${page} 的 .card 用例被删了？那这条守卫也该一起删`).toContain('class="card');
      const body = ruleBody(mainStyle(read(page)), '.card');
      expect(body, `${page} 的 CSS 缺少 .card 规则`).not.toBe('');
      expect(body).toMatch(/padding:/);
      expect(body).toMatch(/border:\s*1px solid var\(--border\)/);
      expect(body).toMatch(/background:\s*var\(--bg-soft\)/);
    }
  });

  it('两页的主体样式逐行等价，只允许字体栈那一处不同', () => {
    // 英文版是「手工维护的复制页」：中文页补了 `.card` 而英文页没有时，页面照常渲染、既有断言
    // 一条都不会红（上一条守卫正是为那次缺陷加的）。这里把两页 `<style>` 主体压成行序列逐行比对，
    // 只摘掉本就应当不同的那一处字体栈——此后任何一边单方面漂走都会当场撞上，而不是等用户看出来。
    const rows = (page: string) =>
      mainStyle(read(page))
        .replace(/(?:-\w+-)?font-family:[^;]*;/g, '')
        .split('\n')
        .filter(l => l.trim() !== '');
    const zh = rows('compare.html');
    const en = rows('compare.en.html');
    expect(en.length, `两页主体样式行数不一致（中文 ${zh.length} / 英文 ${en.length}）`).toBe(zh.length);
    const drift = zh
      .map((line, i) => (line === en[i] ? null : `L${i + 1} 中文「${line}」/ 英文「${en[i]}」`))
      .filter((d): d is string => d !== null);
    expect(drift, `compare 两页的主体样式出现了单方面漂移：\n${drift.join('\n')}`).toEqual([]);
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

/**
 * 全站「实底色不得当文字色」总闸（2026-10-02 收口那 87 处之后补的）
 *
 * 前面几组都是「令牌 → 底色」的成对实算，它们能证明某枚令牌压得住某块底，却管不住**新写的规则
 * 拿哪一枚令牌当文字**：`.foo { color: var(--accent) }` 一行新代码，只要没人把它加进 COMPARE_INK_RULES
 * 那种名单，就一条断言都不会红——这一族缺陷（#4e88ff 压白底 3.34:1、#42b883 只有 2.50:1、#ff9f43
 * 只有 2.04:1）正是这样一轮轮攒出来的。所以这里反过来钉：`color:` 的取值**不许**命中任何一枚
 * 实底色令牌，也不许命中它们对应的十六进制字面量（写死值能绕过令牌名单，#ff9f43 那 6 处就是这么漏的）。
 *
 * 扫描面是**整份 HTML**而不是 `<style>` 主体：落地页有 4 处内联 `style=` 和语言包里的 HTML 字符串
 * 同样在决定文字颜色，只读 `<style>` 会连它们的存在都看不见。
 */
const FILL_AS_TEXT_TOKENS = ['--primary', '--primary-dark', '--accent', '--warn'] as const;
/**
 * 上面四枚令牌的取值字面量（privacy 页的 --primary 另有一枚 #4f6ef7，一并列入）。
 * `#42b983` 是 2026-10-03 真机渲染探针补进来的：它是 `--accent` `#42b883` 的**错字近邻**
 * （第 5 位 8→9），按值扫令牌名单永远扫不到，而它正被拿去当文字（`.compare-check` 的 ✓
 * 与 `.compare-price.free` 的「免费」徽标，16px / 13px，实算 2.47:1）。
 */
const FILL_AS_TEXT_HEXES = ['#4e88ff', '#3a6cd9', '#42b883', '#42b983', '#ff9f43', '#4f6ef7'] as const;

describe('官网全站：实底色不得当文字色（令牌名与字面量都算）', () => {
  it.each(publishedPages)('%s 全文的 color: 没有一处落在实底色上', page => {
    const offenders: string[] = [];
    read(page)
      .split('\n')
      .forEach((line, i) => {
        // 前缀 `[^\w-]` 把 border-color / text-decoration-color / -webkit-text-fill-color 挡在门外：
        // 那几处是实底色的正当用法，本守卫只管文字。
        for (const m of line.matchAll(/(^|[^\w-])color:\s*(var\(--[\w-]+\)|#[0-9a-fA-F]{3,8})/g)) {
          const value = m[2];
          const token = /var\((--[\w-]+)\)/.exec(value)?.[1];
          if (token && (FILL_AS_TEXT_TOKENS as readonly string[]).includes(token)) {
            offenders.push(`L${i + 1} color: ${value}`);
          } else if (!token && (FILL_AS_TEXT_HEXES as readonly string[]).includes(value.toLowerCase())) {
            offenders.push(`L${i + 1} color: ${value}（实底色字面量）`);
          }
        }
      });
    expect(offenders, `${page} 拿实底色当文字色用了：\n${offenders.join('\n')}`).toEqual([]);
  });

  // 上一条是「不许有」型断言，删光全部墨色文字也能让它全绿——所以这里补一条「不许没有」：
  // 收口后的形状是文字改走 -ink 令牌，全站 20 页每页都该有墨色文字（现测 170 处，地板 140）。
  it('墨色令牌确实是这批文字的着色方式（全站 20 页、每页 ≥2 处，总量不低于 140）', () => {
    let total = 0;
    const thin: string[] = [];
    for (const page of publishedPages) {
      const n = [...read(page).matchAll(/(^|[^\w-])color:\s*var\(--[\w-]+-ink\)/g)].length;
      total += n;
      if (n < 2) thin.push(`${page} 只有 ${n} 处`);
    }
    expect(thin, `墨色文字薄到近乎没有，上一条扫描可能在空转：\n${thin.join('\n')}`).toEqual([]);
    expect(total, '全站墨色文字总数跌破地板，检查是不是成批改回了实底色').toBeGreaterThanOrEqual(140);
  });

  /**
   * 对比表那三枚判定标记（`✓` / `✗` / 「免费」徽标）按规则点名钉住
   *
   * 它们是**文字**不是图形，走的是 1.4.3 的 4.5:1；而 `#ccc`（实算 1.61:1）这种「浅灰弱化」
   * 写法不在任何实底色名单里，上面那条总闸抓不到它。所以这里按选择器钉取值：标记一旦漂回
   * 写死值就红。墨色令牌压不压得住各自的底，由上面 `--success-ink` / `--warn-ink` 那两组
   * 成对实算负责（`--text-muted` 则在 `--text` / `--text-muted` 成对断言里）。
   */
  const MARK_RULES = [
    { sel: '.compare-check', token: '--success-ink' },
    { sel: '.compare-cross', token: '--text-muted' },
    { sel: '.compare-price.free', token: '--success-ink' },
    { sel: '.compare-price.paid', token: '--warn-ink' },
  ] as const;

  it.each(['index.html', 'en.html'])('%s 的判定标记只用文字令牌', page => {
    const css = mainStyle(read(page));
    for (const { sel, token } of MARK_RULES) {
      const body = ruleBody(css, sel);
      expect(body, `${page} 找不到 ${sel} 规则`).not.toBe('');
      const used = /\bcolor:\s*var\((--[\w-]+)\)/.exec(body)?.[1];
      expect(used, `${page} ${sel} 的 color 不是文字令牌（实底色或写死值会在这里露出来）`).toBe(token);
    }
  });
});

/**
 * privacy 与博客的自有墨色令牌（2026-10-02 同批补）
 *
 * privacy.html 的 `--primary` 是 #4f6ef7（比落地页那套蓝更深一档的靛蓝），墨色只能按**本页**色相压深，
 * 抄 index 的 #3566cb 会把两档配色拆开；博客模板的 `--accent` 又是 #4e88ff（值同落地页主色、名字不同）。
 * 所以这两批页面不进 inkPages 的逐字同源名单，改为各自钉三件事：暗档真的翻了值、压得住**本页真实底色**、
 * 且 privacy 的墨色确实比它自己的实底色更压得住底（把墨色抄成实底色时当场变红）。
 */
describe('privacy 两页与博客 12 页：各自的墨色令牌', () => {
  const privacyPages = ['privacy.html', 'privacy.en.html'] as const;
  const blogPages = publishedPages.filter(p => p.startsWith('blog/'));

  it('名单本身没漂：privacy 两页 + 博客 12 页', () => {
    expect(privacyPages).toEqual(['privacy.html', 'privacy.en.html']);
    expect(blogPages).toHaveLength(12);
  });

  /**
   * 正文链接必须**有自己的**着色规则
   *
   * 这条是渲染层探针抓出来的缺陷钉成的断言：`.policy-section a` 此前整页没有一条规则，链接吃的是
   * UA 默认 `#0000EE`——压白底 9.40（所以亮档从没暴露），压暗档底 `#0b1220` 只有 **1.99**。
   * 本文件的零容忍总闸对这一类是**结构性失明**的：没有声明就没有可扫的东西，令牌名单与底色实算
   * 也证不了「这一族文字真的被着色」。所以只能按选择器把这条规则本身钉住：删掉它或改回写死值即红。
   */
  it.each(privacyPages)('%s 的正文链接不是 UA 默认蓝', page => {
    const body = ruleBody(mainStyle(read(page)), '.policy-section a');
    expect(body, `${page} 缺少 .policy-section a 规则（链接会回落到 UA 默认 #0000EE，暗档 1.99）`).not.toBe('');
    const used = /\bcolor:\s*var\((--[\w-]+)\)/.exec(body)?.[1];
    expect(used, `${page} 的正文链接 color 不是文字令牌`).toBe('--primary-ink');
  });

  it.each(privacyPages)('%s 的 --primary-ink 两档都压得住本页底色，且严格优于 --primary', page => {
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    expect(light.has('--primary-ink'), `${page} 缺少 :root --primary-ink`).toBe(true);
    expect(dark.has('--primary-ink'), `${page} 暗档没翻 --primary-ink`).toBe(true);
    // 暗档「不重写」不等于「没有」：--primary 刻意两档同值，暗档块里查不到就得回落 :root
    // （同 line 212 那条断言的口径）。不回落就会拿到 undefined，暗档三组整批静默跳过。
    const darkEff = new Map([...light, ...dark]);
    const failures: string[] = [];
    let checked = 0;
    for (const [scheme, tokens] of [
      ['亮', light],
      ['暗', darkEff],
    ] as const) {
      for (const bg of ['--bg', '--bg-alt', '--primary-light']) {
        const ink = contrast(tokens.get('--primary-ink'), tokens.get(bg));
        const fill = contrast(tokens.get('--primary'), tokens.get(bg));
        if (ink === null || fill === null) continue;
        checked += 1;
        if (ink < 4.5) failures.push(`--primary-ink on ${bg}（${scheme}档）${ink.toFixed(2)}:1`);
        // 抄成同一个值时两档都会相等：这条比上一条更早红，且说得出为什么。
        if (ink <= fill)
          failures.push(`${scheme}档 --primary-ink（${ink.toFixed(2)}）不优于 --primary（${fill.toFixed(2)}）on ${bg}`);
      }
    }
    expect(checked, `${page} 只实算到 ${checked} 组，断言近乎空转`).toBeGreaterThanOrEqual(6);
    expect(failures, `${page} 墨色对比度不达标：\n${failures.join('\n')}`).toEqual([]);
  });

  it.each(blogPages)('%s 的 --accent-ink 逐字等于落地页的 --primary-ink，且两档压得住底/卡', page => {
    const refLight = rootTokens(mainStyle(read('index.html')));
    const refDark = rootTokens(mainStyle(read('index.html')), true);
    const css = mainStyle(read(page));
    const light = rootTokens(css);
    const dark = rootTokens(css, true);
    expect(light.get('--accent-ink'), `${page} 亮档 --accent-ink 与 index.html 的 --primary-ink 不同值`).toBe(
      refLight.get('--primary-ink'),
    );
    expect(dark.get('--accent-ink'), `${page} 暗档 --accent-ink 与 index.html 的 --primary-ink 不同值`).toBe(
      refDark.get('--primary-ink'),
    );
    const failures: string[] = [];
    let checked = 0;
    for (const [scheme, tokens] of [
      ['亮', light],
      ['暗', dark],
    ] as const) {
      for (const bg of ['--bg', '--card']) {
        const ratio = contrast(tokens.get('--accent-ink'), tokens.get(bg));
        if (ratio === null) continue;
        checked += 1;
        if (ratio < 4.5) failures.push(`--accent-ink on ${bg}（${scheme}档）${ratio.toFixed(2)}:1`);
      }
    }
    expect(checked, `${page} 只实算到 ${checked} 组，断言近乎空转`).toBe(4);
    expect(failures, `${page} 博客链接墨色不达标：\n${failures.join('\n')}`).toEqual([]);
  });
});
