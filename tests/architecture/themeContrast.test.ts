/**
 * 主色文字压白底的对比度守卫
 *
 * 「添加密码」是 14px 实心按钮，静息与 hover 都必须满足 WCAG AA 4.5:1。
 * 令牌本身只能证明静息态：hover 底色是更浅的 `--aph-surface-hover`，如果文字仍停在
 * `--aph-primary-strong`，六套主题都会掉到 4.25–4.36:1。这里同时读取令牌与组件的
 * hover 混色比例，按真实背景重算，避免「令牌达标、hover 不达标」再次静默上线。
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

  it('hover 规则用 strong 继续压暗，且六套主题在 hover 底色上均 >= 4.5:1', () => {
    const hoverRule = HEADER_SOURCE.match(
      /\.header-actions \.el-button--primary:not\(\.is-link, \.is-text\):hover\)\s*\{([^}]*)\}/,
    )?.[1];
    expect(hoverRule, 'HeaderBar 实心主按钮 hover 规则缺失').toBeTruthy();

    const percentage = Number(
      hoverRule!.match(/color:\s*color-mix\(in srgb, var\(--aph-primary-strong\) (\d+)%, #000\)/)?.[1],
    );
    expect(percentage, 'hover 文字必须用 strong 与黑色混色，不能停在 strong 原值').toBeGreaterThan(0);
    expect(hoverRule!).toContain('background: var(--aph-surface-hover)');

    for (const theme of themes) {
      const hoverText = mixWithBlack(theme.strong, percentage / 100);
      expect(contrast(hoverText, theme.hoverSurface), theme.name).toBeGreaterThanOrEqual(4.5);
    }
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
  'components/options/PasswordDetailDrawer.vue': ['.detail-header__star'],
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

/** 设计系统里的全部浅底（含各主题浅色面与语义浅底），文字必须在最差一面也达标 */
const LIGHT_SURFACES: Record<string, string> = {
  white: '#ffffff',
  'surface-2': '#f8fbff',
  'primary-bg': '#ecf5ff',
  'surface-hover': '#f0f9ff',
  surface: '#e8f4fd',
  'warning-light-9': '#fdf6ec',
  'danger-light-9': '#fef0f0',
  'info-light-9': '#f4f4f5',
};

describe('语义色不当文字', () => {
  const tokens = readSource('assets/theme/tokens.css');

  it('抽取到两个强档语义文字令牌，避免守卫空跑', () => {
    expect(tokens).toMatch(/--aph-danger-strong:\s*(#[0-9a-fA-F]{6})/);
    expect(tokens).toMatch(/--aph-warning-strong:\s*(#[0-9a-fA-F]{6})/);
  });

  it('两个令牌在八种浅底的最差一面仍 >= 4.5:1', () => {
    for (const name of ['danger', 'warning'] as const) {
      const hex = tokens.match(new RegExp(`--aph-${name}-strong:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      expect(hex, `缺少 --aph-${name}-strong`).toBeTruthy();
      for (const [surface, background] of Object.entries(LIGHT_SURFACES)) {
        expect(contrast(hex!, background), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
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
