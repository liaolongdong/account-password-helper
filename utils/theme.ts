/**
 * 主题工具模块
 *
 * 提供主题名类型、可选主题元数据、Shadow DOM 令牌映射，以及在扩展页 / 内容脚本
 * Shadow DOM 中应用主题的辅助方法。
 *
 * 设计要点：
 * - 主题名持久化在 `FloatingButtonConfig.theme` 中（复用 floating_button_config 存储键与监听），
 *   避免新增独立存储键与额外监听器。
 * - 本模块直接读取 storage.local，不依赖 configManager，保持轻量，适合首屏「尽早应用」路径。
 * - THEME_SHADOW_TOKENS 的取值需与 assets/theme/tokens.css 保持一致。
 */

import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 主题名（顺序即 UI 展示顺序）
 * - sky：晴空蓝（默认，等同历史配色）
 * - green：青竹绿
 * - pink：桃花粉
 * - mauve：樱粉紫
 * - orange：落霞橙
 * - slate：雾墨灰
 */
export type ThemeName = 'sky' | 'green' | 'pink' | 'mauve' | 'orange' | 'slate';

/** 默认主题 */
export const DEFAULT_THEME: ThemeName = 'sky';

/** 全部主题名（用于校验与遍历） */
export const THEME_NAMES: readonly ThemeName[] = ['sky', 'green', 'pink', 'mauve', 'orange', 'slate'];

/**
 * 主题选项元数据（用于设置面板色块选择器）
 */
export interface ThemeOption {
  /** 主题名 */
  name: ThemeName;
  /** 中文标签 */
  label: string;
  /** 英文标签（偏好设置面板按语言展示） */
  labelEn: string;
  /** 色块主色（primary 十六进制值） */
  swatch: string;
}

/** 可选主题列表（含标签与色块），顺序即 UI 展示顺序 */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { name: 'sky', label: '晴空蓝', labelEn: 'Sky Blue', swatch: '#409eff' },
  { name: 'green', label: '青竹绿', labelEn: 'Bamboo Green', swatch: '#69b599' },
  { name: 'pink', label: '桃花粉', labelEn: 'Peach Pink', swatch: '#d87998' },
  { name: 'mauve', label: '樱粉紫', labelEn: 'Blossom Mauve', swatch: '#ad84cd' },
  { name: 'orange', label: '落霞橙', labelEn: 'Sunset Orange', swatch: '#e28e65' },
  { name: 'slate', label: '雾墨灰', labelEn: 'Misty Slate', swatch: '#7f92b4' },
];

/**
 * Shadow DOM 令牌映射（与 assets/theme/tokens.css 中的 `--aph-*` 取值一致）
 *
 * 内容脚本的 Shadow DOM 无法继承页面 `:root` 上的自定义属性，
 * 因此通过内联方式写入 shadow host，供注入样式中的 `var(--aph-*)` 解析。
 */
export const THEME_SHADOW_TOKENS: Record<ThemeName, Record<string, string>> = {
  sky: {
    '--aph-primary': '#409eff',
    '--aph-primary-hover': '#66b3ff',
    '--aph-primary-rgb': '64 158 255',
    '--aph-primary-bg': '#ecf5ff',
    '--aph-primary-bg-hover': '#f0f7ff',
    '--aph-primary-border': '#d9ecff',
    '--aph-surface': '#e8f4fd',
    '--aph-surface-2': '#f8fbff',
    '--aph-surface-line': '#e3f2fd',
    '--aph-surface-hover': '#f0f9ff',
  },
  green: {
    '--aph-primary': '#69b599',
    '--aph-primary-hover': '#88c5ae',
    '--aph-primary-rgb': '105 181 153',
    '--aph-primary-bg': '#f2f9f6',
    '--aph-primary-bg-hover': '#f5faf8',
    '--aph-primary-border': '#e5f2ee',
    '--aph-surface': '#eef7f4',
    '--aph-surface-2': '#fafdfc',
    '--aph-surface-line': '#ebf5f1',
    '--aph-surface-hover': '#f5faf8',
  },
  pink: {
    '--aph-primary': '#d87998',
    '--aph-primary-hover': '#e199b1',
    '--aph-primary-rgb': '216 121 152',
    '--aph-primary-bg': '#fbf0f4',
    '--aph-primary-bg-hover': '#fcf4f6',
    '--aph-primary-border': '#f6e1e8',
    '--aph-surface': '#f9ecf0',
    '--aph-surface-2': '#fdf9fb',
    '--aph-surface-line': '#f8e8ed',
    '--aph-surface-hover': '#fcf4f6',
  },
  mauve: {
    '--aph-primary': '#ad84cd',
    '--aph-primary-hover': '#c0a0da',
    '--aph-primary-rgb': '173 132 205',
    '--aph-primary-bg': '#f6f2fa',
    '--aph-primary-bg-hover': '#f8f4fb',
    '--aph-primary-border': '#ede4f4',
    '--aph-surface': '#f3edf8',
    '--aph-surface-2': '#fcfafd',
    '--aph-surface-line': '#f1eaf6',
    '--aph-surface-hover': '#f8f4fb',
  },
  orange: {
    '--aph-primary': '#e28e65',
    '--aph-primary-hover': '#eaa886',
    '--aph-primary-rgb': '226 142 101',
    '--aph-primary-bg': '#fcf3ef',
    '--aph-primary-bg-hover': '#fdf6f3',
    '--aph-primary-border': '#f9e7df',
    '--aph-surface': '#fbf0ea',
    '--aph-surface-2': '#fefbf9',
    '--aph-surface-line': '#faece6',
    '--aph-surface-hover': '#fdf6f3',
  },
  slate: {
    '--aph-primary': '#7f92b4',
    '--aph-primary-hover': '#98a7c2',
    '--aph-primary-rgb': '127 146 180',
    '--aph-primary-bg': '#f3f5f8',
    '--aph-primary-bg-hover': '#f6f7fa',
    '--aph-primary-border': '#e7eaf1',
    '--aph-surface': '#eff2f6',
    '--aph-surface-2': '#fafbfc',
    '--aph-surface-line': '#eceff4',
    '--aph-surface-hover': '#f6f7fa',
  },
};

/**
 * 判断任意值是否为合法主题名
 * @param value 待校验值
 * @returns 是否为 ThemeName
 */
export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value);
}

/**
 * 将主题应用到扩展页根元素（设置 `data-theme` 属性，令 tokens.css 生效）
 * @param theme 主题名
 * @param root 目标根元素，默认 document.documentElement
 */
export function applyThemeToRoot(theme: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}

/**
 * 将主题令牌以内联方式写入 Shadow DOM 宿主元素
 * @param host shadow host 元素
 * @param theme 主题名
 */
export function applyThemeTokensToHost(host: HTMLElement, theme: ThemeName): void {
  const tokens = THEME_SHADOW_TOKENS[theme] ?? THEME_SHADOW_TOKENS[DEFAULT_THEME];
  for (const [key, value] of Object.entries(tokens)) {
    host.style.setProperty(key, value);
  }
}

/**
 * 从存储读取当前主题（轻量，直接读 storage.local，避免拉入 configManager 依赖链）
 * @returns 主题名，读取失败或未设置时回退默认主题
 */
export async function getStoredTheme(): Promise<ThemeName> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FLOATING_BUTTON_CONFIG);
    const config = result[STORAGE_KEYS.FLOATING_BUTTON_CONFIG] as { theme?: unknown } | undefined;
    return isThemeName(config?.theme) ? config.theme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * 扩展页主题同步：读取并应用当前主题，并监听配置变更实时切换
 *
 * 在 options/popup/sidepanel 的 main.ts 中调用（fire-and-forget）。
 * 默认主题因 tokens.css 的 `:root` 默认值即为晴空蓝，仅非默认主题首帧有极短闪烁。
 */
export function initThemeSync(): void {
  void getStoredTheme().then(theme => applyThemeToRoot(theme));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEYS.FLOATING_BUTTON_CONFIG];
    if (!change) return;
    const next = (change.newValue as { theme?: unknown } | undefined)?.theme;
    applyThemeToRoot(isThemeName(next) ? next : DEFAULT_THEME);
  });
}
