/**
 * 主色文字压白底的对比度守卫
 *
 * 「添加密码」是 14px 实心按钮，静息与 hover 都必须满足 WCAG AA 4.5:1。
 * 令牌本身只能证明静息态：hover 底色是更浅的 `--aph-surface-hover`，如果文字仍停在
 * `--aph-primary-strong`，六套主题都会掉到 4.25–4.36:1。这里同时读取令牌与组件的
 * hover 混色比例，按真实背景重算，避免「令牌达标、hover 不达标」再次静默上线。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

interface ThemeTokens {
  name: string;
  strong: string;
  hoverSurface: string;
}

const TOKEN_SOURCE = readSource('assets/theme/tokens.css');
const HEADER_SOURCE = readSource('components/options/HeaderBar.vue');

function parseThemes(source: string): ThemeTokens[] {
  const themes: ThemeTokens[] = [];
  for (const match of source.matchAll(/:root(?:\[data-theme='([a-z-]+)'\])?\s*\{([^}]*)\}/g)) {
    const body = match[2];
    const strong = body.match(/--aph-primary-strong:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const hoverSurface = body.match(/--aph-surface-hover:\s*(#[0-9a-fA-F]{6})/)?.[1];
    if (!strong || !hoverSurface) continue;
    themes.push({ name: match[1] ?? 'blue', strong, hoverSurface });
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
