/**
 * 主色令牌与主按钮的对比度守卫
 *
 * 两件事分开守：
 * 1. `--aph-primary-strong` 这支「同色相压暗」的强档本身要达 AA（它仍用在正文链接上）。
 * 2. 主按钮（头部「添加密码」与管理页实心按钮）**必须保持品牌浅蓝 `--aph-primary`**——
 *    2026-10-26 用户明确否掉了为对比度把按钮换成深档的做法，代价（白字 2.78:1、
 *    白底蓝字 2.78:1，均不达 AA）作为已知取舍记录在案。这条锁住的是「别再自作主张改主题色」，
 *    数值判据反而次要，所以两条都写成「用了强档就变红」。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

interface ThemeTokens {
  name: string;
  strong: string;
  hoverSurface: string;
  primaryBg: string;
}

const TOKEN_SOURCE = readSource('assets/theme/tokens.css');
const HEADER_SOURCE = readSource('components/options/HeaderBar.vue');

function parseThemes(source: string): ThemeTokens[] {
  const themes: ThemeTokens[] = [];
  for (const match of source.matchAll(/:root(?:\[data-theme='([a-z-]+)'\])?\s*\{([^}]*)\}/g)) {
    const body = match[2];
    const strong = body.match(/--aph-primary-strong:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const hoverSurface = body.match(/--aph-surface-hover:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const primaryBg = body.match(/--aph-primary-bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
    if (!strong || !hoverSurface || !primaryBg) continue;
    themes.push({ name: match[1] ?? 'blue', strong, hoverSurface, primaryBg });
  }
  return themes;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mixWithBlack(hex: string, percentage: number): string {
  return (
    '#' +
    rgb(hex)
      .map(value =>
        Math.round(value * percentage)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const themes = parseThemes(TOKEN_SOURCE);

describe('主色实心按钮的 WCAG AA 对比度', () => {
  it('抽取到六套主题的 strong 与 hover 底色，避免守卫空跑', () => {
    expect(themes.map(theme => theme.name).sort()).toEqual(['blue', 'green', 'mauve', 'orange', 'pink', 'slate']);
  });

  it('六套主题的静息态 strong 压白底均 >= 4.5:1', () => {
    for (const theme of themes) {
      expect(contrast(theme.strong, '#ffffff'), theme.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('浅主色底上的文字用 on-tint 强档，六套主题均 >= 4.5:1', () => {
    const definition = TOKEN_SOURCE.match(
      /--aph-primary-strong-on-tint:\s*color-mix\(in srgb, var\(--aph-primary-strong\) (\d+)%, #000\)/,
    );
    expect(definition, '缺少 --aph-primary-strong-on-tint 令牌').toBeTruthy();
    const percentage = Number(definition![1]);
    expect(percentage).toBeGreaterThan(0);

    for (const theme of themes) {
      const text = mixWithBlack(theme.strong, percentage / 100);
      expect(contrast(text, theme.primaryBg), theme.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('头部主按钮保持品牌浅蓝文字：主题色由用户拍板，强档不得回流到按钮上', () => {
    // 2026-10-26 用户明确要求按钮主题色与品牌图标一致（`--aph-primary` 那支浅蓝）。
    // 白底 + 浅蓝文字实测 2.78:1、hover 的近白底 2.61:1，都不达 WCAG AA —— 这是**已知取舍**，
    // 记在这里，防止下一轮拿「修对比度」的名义把它换成深档；真要换，先改这条并拿到确认。
    const rule = HEADER_SOURCE.match(
      /\.header-actions \.el-button--primary:not\(\.is-link, \.is-text\)\)\s*\{([^}]*)\}/,
    )?.[1];
    expect(rule, 'HeaderBar 实心主按钮规则缺失').toBeTruthy();
    expect(rule, '静息态文字必须是品牌浅蓝').toContain('color: var(--aph-primary)');
    expect(rule, '不许改用强档').not.toContain('--aph-primary-strong');

    const hoverRule = HEADER_SOURCE.match(
      /\.header-actions \.el-button--primary:not\(\.is-link, \.is-text\):hover\)\s*\{([^}]*)\}/,
    )?.[1];
    expect(hoverRule, 'HeaderBar 实心主按钮 hover 规则缺失').toBeTruthy();
    expect(hoverRule, 'hover 文字必须是品牌浅蓝').toContain('color: var(--aph-primary)');
    expect(hoverRule, 'hover 不许改用强档或混黑').not.toMatch(/--aph-primary-strong|color-mix/);
    expect(hoverRule).toContain('background: var(--aph-surface-hover)');
  });
});

/**
 * 浅色告警的文字层级（`assets/theme/tokens.css` 末尾的 EP 覆写）
 *
 * EP 把 `.el-alert--x.is-light` 整块刷成语义色，压在各自的 light-9 底色上只有 2.0~2.6:1，
 * 而告警承载的是必须读懂的说明文字。覆写把标题 / 描述收回 `--el-text-color-primary` /
 * `--el-text-color-regular`，语义色留给图标（图标从根节点继承，不在这两个节点里）。
 * 下面两组十六进制是 Element Plus 的固定值（中性文字色与语义浅底不随主题变），
 * 故按字面量断言；真要改 EP 版本，这几条会红，届时按新版取值复核而不是删断言。
 */
const ALERT_TEXT = {
  title: '#303133', // --el-text-color-primary
  description: '#606266', // --el-text-color-regular
};

const ALERT_LIGHT_BACKGROUNDS: Record<string, string> = {
  'warning-light-9': '#fdf6ec',
  'error-light-9': '#fef0f0',
  'info-light-9': '#f4f4f5',
  'aph-surface（info 在本仓的底色覆写）': '#e8f4fd',
};

/** EP 原本刷在浅色告警上的语义色：逐个证明它们确实不达 AA，否则这组断言是空跑 */
const EP_SEMANTIC_ON_LIGHT: Record<string, string> = {
  '#e6a23c': '#fdf6ec',
  '#f56c6c': '#fef0f0',
  '#909399': '#f4f4f5',
};

describe('浅色告警文字的 WCAG AA 对比度', () => {
  const tokens = readSource('assets/theme/tokens.css');

  it('覆写规则在位，且只锁 .is-light（is-dark 是白字压实底，该跟语义色）', () => {
    expect(tokens).toMatch(
      /\.el-alert\.is-light \.el-alert__content \.el-alert__title\s*\{\s*color: var\(--el-text-color-primary\)/,
    );
    expect(tokens).toMatch(
      /\.el-alert\.is-light \.el-alert__content \.el-alert__description\s*\{\s*color: var\(--el-text-color-regular\)/,
    );
    expect(tokens).not.toMatch(/\.el-alert\.is-dark[^{]*\{\s*color/);
  });

  it('标题与描述在四种浅底上均 >= 4.5:1', () => {
    for (const [label, background] of Object.entries(ALERT_LIGHT_BACKGROUNDS)) {
      expect(contrast(ALERT_TEXT.title, background), `title on ${label}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ALERT_TEXT.description, background), `description on ${label}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('EP 原来的语义色在这些底上确实不达 AA（证明上面那条不是空跑）', () => {
    for (const [foreground, background] of Object.entries(EP_SEMANTIC_ON_LIGHT)) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeLessThan(4.5);
    }
  });
});

/**
 * 语义色只当图形，不当文字
 *
 * 白底上 `--el-color-danger` 2.90:1、`--el-color-warning` 2.19:1，压在任何浅底都不达 AA，
 * 而报错与安全披露恰恰是最需要读清的字。文字一律走 `--aph-danger-strong` /
 * `--aph-warning-strong`（保色相与饱和度、只压暗度，八种浅底最差 4.53 / 4.61:1）。
 * 下面这份清单是**仅剩的图形用法**（图标、星标、图标底框）——新增一处语义色文字就会变红；
 * 清单里的项被删掉同样会红，防守卫自己腐烂成一份过期的白名单。
 */
const GRAPHICAL_SEMANTIC_USES: Record<string, string[]> = {
  'components/options/BackupNudgeBanner.vue': ['.backup-nudge__icon', '.backup-nudge--never .backup-nudge__icon'],
  'components/options/EmptyGuide.vue': ['.empty-guide__card-icon--success', '.empty-guide__card-icon--warning'],
  'components/options/ReviewPrompt.vue': ['.review-prompt__icon'],
};

/** 逐行找 `color: var(--el-color-x);`，回溯最近一个以 `{` 结尾的行当选择器 */
function semanticColorSelectors(relPath: string): string[] {
  const lines = readSource(relPath).split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*color:\s*var\(--el-color-(?:danger|error|warning|success)\);\s*$/.test(line)) return;
    for (let scan = index - 1; scan >= 0; scan -= 1) {
      const trimmed = lines[scan].trimEnd();
      if (trimmed.endsWith('{')) {
        found.push(trimmed.replace(/\{$/, '').trim());
        return;
      }
    }
    found.push('<未找到选择器>');
  });
  return found;
}

/**
 * 浅底清单只有一份：`LIGHT_SURFACES_IN_USE`（本文件末尾）。
 * 这里曾经并存过一张 8 面的旧表，结果 `--aph-danger-strong` 按旧表算「达标」，
 * 换到 12 面就只剩 4.11:1——两张底表就是两个答案，必须只留一张。
 */

describe('语义色不当文字', () => {
  const tokens = readSource('assets/theme/tokens.css');

  it('抽取到三个强档语义文字令牌，避免守卫空跑', () => {
    for (const name of ['danger', 'warning', 'success'] as const) {
      expect(tokens, `缺少 --aph-${name}-strong`).toMatch(new RegExp(`--aph-${name}-strong:\\s*#[0-9a-fA-F]{6}`));
    }
  });

  it('三个令牌在全部浅底的最差一面仍 >= 4.5:1', () => {
    for (const name of ['danger', 'warning', 'success'] as const) {
      const hex = tokens.match(new RegExp(`--aph-${name}-strong:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      expect(hex, `缺少 --aph-${name}-strong`).toBeTruthy();
      const perSurface = LIGHT_SURFACES_IN_USE.map(background => ({ background, ratio: contrast(hex!, background) }));
      const worst = perSurface.reduce((a, b) => (a.ratio < b.ratio ? a : b));
      expect(worst.ratio, `${name} ${hex} 压在 ${worst.background} 上`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('EP 原色在这些底上确实不达 AA（证明上面那条不是空跑）', () => {
    for (const [foreground, background] of Object.entries(EP_SEMANTIC_ON_LIGHT)) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeLessThan(4.5);
    }
  });

  it('EP 自己的报错文字（表单校验与 message-box）也被接管，且各带一层父选择器', () => {
    // 只钉本仓源码里的 `color: var(--el-color-x)` 挡不住这条：它来自 Element Plus 的
    // `.el-form-item__error`。全仓 153 处 el-form-item，校验反馈是最常出现的必读文字。
    expect(tokens).toMatch(/\.el-form-item \.el-form-item__error\s*\{\s*color: var\(--aph-danger-strong\)/);
    expect(tokens).toMatch(/\.el-message-box \.el-message-box__errormsg\s*\{\s*color: var\(--aph-danger-strong\)/);
  });

  it('全仓语义色 color: 只剩图形用法，且白名单一项都没烂掉', () => {
    const sources = [...listSourceFiles('components', ['.vue']), ...listSourceFiles('entrypoints', ['.vue'])];
    const actual = new Map<string, string[]>();
    for (const rel of sources) {
      const selectors = semanticColorSelectors(rel);
      if (selectors.length) actual.set(rel, selectors);
    }
    expect([...actual.keys()].sort(), '出现语义色文字或新增图形用法').toEqual(
      Object.keys(GRAPHICAL_SEMANTIC_USES).sort(),
    );
    for (const [rel, selectors] of actual) {
      expect(selectors.sort(), rel).toEqual([...GRAPHICAL_SEMANTIC_USES[rel]].sort());
    }
  });
});

/**
 * 中性文字阶梯：每一档都要在设计系统出现过的**全部浅底**上达标
 *
 * 这条规则是被一次误判逼出来的：`--aph-text-secondary` 旧值 #6b7280 白底 4.83:1，
 * 按白底看完全合格，压到 `.session-pill:hover` 的 #e2e8f0 上却只剩 3.92:1。
 * 所以判据不是「白底过不过」，而是「最暗的那面浅底过不过」——下面这张表就是扩展页里
 * 真实出现过的浅色底（含 EP 的 fill / 语义 light-9 与 `--aph-surface*`）。
 * 令牌值直接从 tokens.css 解析，改值即改判据结果，不留第二份事实。
 */
const LIGHT_SURFACES_IN_USE = [
  '#ffffff',
  '#f8fbff',
  '#f5f7fa',
  '#f1f5f9',
  '#f4f4f5',
  '#eff6ff',
  '#ecf5ff',
  '#f0f9ff',
  '#e8f4fd',
  '#fdf6ec',
  '#fef0f0',
  '#e2e8f0',
];

describe('中性文字阶梯的 AA 地板', () => {
  const textTokens = [
    ...readSource('assets/theme/tokens.css').matchAll(/^\s*(--aph-text-[a-z-]+):\s*(#[0-9a-fA-F]{6});$/gm),
  ];

  it('解析到全部文字令牌，且它们都是字面十六进制（换成 color-mix 会让这条守卫静默失焦）', () => {
    expect(textTokens.length).toBeGreaterThanOrEqual(4);
    expect(new Set(textTokens.map(match => match[1])).size).toBe(textTokens.length);
  });

  it('每一档在最暗的浅底上仍 >= 4.5:1', () => {
    for (const [, name, hex] of textTokens) {
      const worst = Math.min(...LIGHT_SURFACES_IN_USE.map(surface => contrast(hex, surface)));
      const worstSurface = LIGHT_SURFACES_IN_USE.reduce((a, b) => (contrast(hex, a) < contrast(hex, b) ? a : b));
      expect(worst, `${name} ${hex} 压在 ${worstSurface} 上`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('三档之间仍可分辨（对比度不能塌成同一个数，否则层级白设）', () => {
    const byName = new Map(textTokens.map(([, name, hex]) => [name, contrast(hex, '#ffffff')]));
    expect(byName.get('--aph-text-primary')!, 'primary 应明显重于 secondary').toBeGreaterThan(
      byName.get('--aph-text-secondary')! * 1.5,
    );
    expect(byName.get('--aph-text-secondary')!, 'secondary 应明显重于 muted').toBeGreaterThan(
      byName.get('--aph-text-muted')!,
    );
  });
});

/**
 * 灰阶文字必须走令牌，不许硬编码
 *
 * 上一节那条地板只量得到 `--aph-text-*` 自己；把 #909399 直接写进组件同样能绕过它，
 * 而 #909399（EP 旧 secondary）在最暗浅底上只有 2.50:1——本仓曾有 38 处这么写。
 * 判据取「近灰」（RGB 三通道极差 ≤ 24）：彩色有各自的语义（图标、链接、状态字），
 * 由下面的语义色禁用清单与图标豁免单独管；纯灰一律只有「第几档文字」这一个含义，
 * 所以必须用令牌。阈值定在 24 而不是更紧的 16，是因为 EP 的 #909399 极差 9、
 * Tailwind gray-400 #9ca3af 极差 19、gray-500 #6b7280 极差 21——16 会把后两个放行，
 * 而它们正是溜过去的那两处（TOTP 复制按钮 2.06:1、旧的 secondary 3.92:1）。
 * `#fff` / `#ffffff` 豁免——深色底上的白字是对的，静态模型量不到它的真实底色。
 */
const GRAY_SPREAD = 24;
const WHITE_EXEMPT = new Set(['#ffffff', '#fff']);

function channels(hex: string): number[] {
  const body = hex.replace('#', '');
  const full =
    body.length === 3
      ? body
          .split('')
          .map(char => char + char)
          .join('')
      : body;
  return [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16));
}

describe('灰阶文字不许硬编码', () => {
  const files = [...listSourceFiles('components', ['.vue']), ...listSourceFiles('entrypoints', ['.vue'])];

  it('扫描面足够大，且确实能抓出违规（防空跑）', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(
      [...readSource('components/options/IdleLockSetting.vue').matchAll(/^\s*color:\s*(#[0-9a-fA-F]{3,6});$/gm)].map(
        m => m[1],
      ),
      'IdleLockSetting 应当已经没有硬编码灰阶文字色',
    ).toEqual([]);
  });

  it('全部 .vue 里不存在不达标的硬编码灰阶 color', () => {
    const violations: string[] = [];
    for (const rel of files) {
      const source = readSource(rel);
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        const match = /^\s*color:\s*(#[0-9a-fA-F]{3,6})\s*;$/.exec(line);
        if (!match) return;
        const hex = match[1].toLowerCase();
        if (WHITE_EXEMPT.has(hex)) return;
        const [r, g, b] = channels(hex);
        if (Math.max(r, g, b) - Math.min(r, g, b) > GRAY_SPREAD) return;
        const worst = Math.min(...LIGHT_SURFACES_IN_USE.map(surface => contrast(hex, surface)));
        if (worst < 4.5) violations.push(`${rel}:${index + 1} ${hex} 最差 ${worst.toFixed(2)}:1`);
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  /**
   * Element Plus / Tailwind 的常用灰阶与语义色：写死它们等于绕过上面两条判据。
   * 图标类选择器豁免的理由只是「图形按 1.4.11 是 3:1，不是文字的 4.5:1」——
   * 曾经这里还写着「本仓图标旁都有同义文字」，那句话是错的：侧边栏两颗复制图标
   * 没有任何同义文字（字形就是控件本身），收藏星标也没有。它们由下一节的图标档守卫管。
   */
  const BANNED_HARDCODED_TEXT_COLORS: Record<string, string> = {
    '#909399': 'EP 旧 secondary，最差 2.50:1 → 用 --aph-text-muted',
    '#6b7280': '旧 secondary 值，最差 3.92:1 → 用 --aph-text-secondary',
    '#c0c4cc': 'EP placeholder 灰，最差 1.42:1 → 用 --aph-text-muted',
    '#64748b': '最差 3.86:1 → 用 --aph-text-muted',
    '#6c757d': '最差 3.80:1 → 用 --aph-text-muted',
    '#e6a23c': 'EP warning 原色，最差 1.77:1 → 文字用 --aph-warning-strong',
    '#b88230': 'warning 加深一档仍只有 2.72:1 → 用 --aph-warning-strong',
    '#f56c6c': 'EP danger 原色，最差 2.35:1 → 文字用 --aph-danger-strong',
    '#c45656': 'danger 加深一档仍只有 3.54:1 → 用 --aph-danger-strong',
    '#67c23a': 'EP success 原色，最差 1.82:1 → 文字用 --aph-success-strong',
    '#529b2e': 'success 加深一档仍只有 2.80:1 → 用 --aph-success-strong',
  };

  it('灰阶与语义色都不许写死在文字上（图标选择器除外）', () => {
    const violations: string[] = [];
    for (const rel of files) {
      const lines = readSource(rel).split('\n');
      let selector = '';
      lines.forEach((line, index) => {
        const trimmed = line.trimEnd();
        if (trimmed.endsWith('{')) selector = trimmed.replace(/\{$/, '').trim();
        const match = /^\s*color:\s*(#[0-9a-fA-F]{3,6})\s*;$/.exec(line);
        if (!match) return;
        const reason = BANNED_HARDCODED_TEXT_COLORS[match[1].toLowerCase()];
        if (!reason) return;
        // 只豁免图形：`badge` 不在其列——`.age-badge` 是带 tabular-nums 的文字标签，
        // 这一轮刚被转成强档，把它放进豁免等于给守卫开个正好漏掉刚修完那批的洞。
        if (/icon|__star|__arrow|__dot/i.test(selector)) return;
        violations.push(`${rel}:${index + 1} ${match[1]} — ${reason}（选择器 ${selector}）`);
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

/**
 * 图标档：承载「这是哪个控件 / 它是什么状态」的图形要 >= 3:1（WCAG 1.4.11）
 *
 * 前两节只管文字：图形适用的是 3:1 而非 4.5:1，所以图标一路被放在文字阶梯之外，
 * 结果 `--aph-icon-action` 停在 #b0b7c3（最差浅底 1.64:1）、复制图标借用装饰档 #9ca3af
 * （2.05:1）、收藏星标写死 EP 的 #e6a23c（1.77:1）。侧边栏那排动作图标既无边框也无
 * 同义文字，字形就是用户唯一能看见、能点中的东西——按 1.4.11「识别界面组件及其状态」
 * 正是这条覆盖的对象，而它恰恰被「图标都是装饰」这句想当然豁免掉了。
 *
 * 于是把图标拆成两档并各设判据：
 * - 可操作/状态档（action / warning / success）：全部浅底最差一面 >= 3:1。
 * - 装饰档（muted）：只准出现在下面这份白名单里，且每一处都有同义文字在旁边。
 *   白名单是双向的——新增一处借用即变红，白名单里某项不再借用同样变红，
 *   免得守卫腐烂成一张过期的通行证（与 GRAPHICAL_SEMANTIC_USES 同一套路）。
 */
const ICON_TIER_FLOOR = 3;

/** 三档可操作/状态图标的取值（直接从 tokens.css 解析，不留第二份事实） */
function iconTokenHex(name: string): string {
  const hex = TOKEN_SOURCE.match(new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6});$`, 'm'))?.[1];
  expect(hex, `缺少字面十六进制的 ${name}（换成 color-mix 会让这条判据失焦）`).toBeTruthy();
  return hex!;
}

/** 被本轮替换掉的旧值：逐个证明它们不达 3:1，否则上面的达标断言可能是空跑 */
const RETIRED_ICON_COLORS: Record<string, string> = {
  '--aph-icon-action 旧值': '#b0b7c3',
  '装饰档（曾被复制图标借用）': '#9ca3af',
  'EP warning 原色（收藏星标）': '#e6a23c',
  'EP success 原色（一键登录）': '#67c23a',
};

/** 允许使用装饰档的选择器：每一处旁边都有同义文字，或整块图形与文字同义 */
const DECORATIVE_ICON_USES: Record<string, string[]> = {
  'components/options/CommandPalette.vue': ['.cp-item-icon'],
  'components/options/MasterPasswordSetupView.vue': ['.guide-entry__sep'],
  'components/sidepanel/PasswordListItem.vue': ['.off-site-icon'],
  'components/sidepanel/SidepanelAuthView.vue': ['.sort-dropdown-popper .el-dropdown-menu__item .sort-item-icon'],
};

/** 状态/动作图标必须落在哪一档：写死语义原色或退回装饰档都会让这张表对不上 */
const STATE_ICON_TIERS: Record<string, string> = {
  'components/sidepanel/PasswordListItem.vue .copy-icon-wrapper .copy-icon': '--aph-icon-action',
  'components/sidepanel/PasswordListItem.vue .password-actions': '--aph-icon-action',
  'components/sidepanel/PasswordListItem.vue .favorite-icon': '--aph-icon-action',
  'components/sidepanel/PasswordListItem.vue .favorite-icon:hover': '--aph-icon-warning',
  'components/sidepanel/PasswordListItem.vue .favorite-icon.is-favorite': '--aph-icon-warning',
  'components/sidepanel/PasswordListItem.vue .auto-login-icon': '--aph-icon-action',
  'components/sidepanel/PasswordListItem.vue .auto-login-icon:hover': '--aph-icon-success',
  'components/sidepanel/PasswordListItem.vue .open-site-icon, .share-icon': '--aph-icon-action',
  'components/sidepanel/PasswordListItem.vue .totp-fill-icon, .totp-copy-icon': '--aph-icon-action',
  'components/sidepanel/PasswordListItem.vue .edit-icon': '--aph-icon-action',
  'components/options/PasswordDetailDrawer.vue .detail-header__star': '--aph-icon-warning',
};

/** 装饰档不在其列：它的用法由 DECORATIVE_ICON_USES 那条白名单单独守 */
const OPERATIONAL_ICON_TOKENS = ['--aph-icon-action', '--aph-icon-warning', '--aph-icon-success'];

/** 找出把某令牌写在 `color:` 上的选择器（支持跨行的逗号选择器列表） */
function iconSelectors(relPath: string, token: string): string[] {
  const lines = readSource(relPath).split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    if (!new RegExp(`^\\s*color:\\s*var\\(${token}\\);\\s*$`).test(line)) return;
    let open = index - 1;
    while (open >= 0 && !lines[open].trimEnd().endsWith('{')) open -= 1;
    if (open < 0) {
      found.push('<未找到选择器>');
      return;
    }
    let start = open;
    while (start > 0 && lines[start - 1].trimEnd().endsWith(',')) start -= 1;
    found.push(
      lines
        .slice(start, open + 1)
        .map(row => row.trim())
        .join(' ')
        .replace(/\{$/, '')
        .trim(),
    );
  });
  return found;
}

describe('图标档的 3:1 地板（WCAG 1.4.11）', () => {
  const vueFiles = [...listSourceFiles('components', ['.vue']), ...listSourceFiles('entrypoints', ['.vue'])];

  it('三档可操作/状态图标令牌都是可解析的字面十六进制', () => {
    for (const name of OPERATIONAL_ICON_TOKENS) {
      expect(iconTokenHex(name)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('三档在全部浅底的最差一面仍 >= 3:1', () => {
    for (const name of OPERATIONAL_ICON_TOKENS) {
      const hex = iconTokenHex(name);
      const worst = LIGHT_SURFACES_IN_USE.reduce((a, b) => (contrast(hex, a) < contrast(hex, b) ? a : b));
      expect(contrast(hex, worst), `${name} ${hex} 压在 ${worst} 上`).toBeGreaterThanOrEqual(ICON_TIER_FLOOR);
    }
  });

  it('被替换掉的旧值确实不达 3:1（证明上一条不是空跑）', () => {
    for (const [label, hex] of Object.entries(RETIRED_ICON_COLORS)) {
      const worst = Math.min(...LIGHT_SURFACES_IN_USE.map(surface => contrast(hex, surface)));
      expect(worst, `${label} ${hex}`).toBeLessThan(ICON_TIER_FLOOR);
    }
  });

  it('装饰档只准出现在白名单里的选择器上', () => {
    const actual = new Map<string, string[]>();
    for (const rel of vueFiles) {
      const selectors = iconSelectors(rel, '--aph-icon-muted');
      if (selectors.length) actual.set(rel, selectors);
    }
    expect([...actual.keys()].sort(), '新增/删除了借用装饰档的文件').toEqual(Object.keys(DECORATIVE_ICON_USES).sort());
    for (const [rel, selectors] of actual) {
      expect(selectors.sort(), `${rel} 装饰档的用法发生变化`).toEqual([...DECORATIVE_ICON_USES[rel]].sort());
    }
  });

  it('动作与状态图标各归其档，没有写死语义原色，也没有借用装饰档', () => {
    const actual = new Map<string, string>();
    for (const rel of vueFiles) {
      for (const token of OPERATIONAL_ICON_TOKENS) {
        for (const selector of iconSelectors(rel, token)) actual.set(`${rel} ${selector}`, token);
      }
    }
    expect([...actual.keys()].sort(), '图标着色点增删或换了选择器写法').toEqual(Object.keys(STATE_ICON_TIERS).sort());
    for (const [key, token] of Object.entries(STATE_ICON_TIERS)) {
      expect(actual.get(key), `${key} 应走 ${token}`).toBe(token);
    }
  });

  it('三档仍保持可分辨的层级：装饰档最浅，可操作档仍轻于正文', () => {
    const onWhite = (name: string) => contrast(iconTokenHex(name), '#ffffff');
    expect(onWhite('--aph-icon-muted'), '装饰档必须最浅，否则三档没有区别').toBeLessThan(onWhite('--aph-icon-action'));
    expect(onWhite('--aph-icon-action'), '图标比正文浅是刻意的层级，压到文字之上一律是回归').toBeLessThan(
      onWhite('--aph-text-muted'),
    );
  });
});
