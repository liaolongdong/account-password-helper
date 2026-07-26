/**
 * i18n 命名空间拆分完整性测试
 *
 * 语言包已按命名空间拆分（utils/i18n/locales/{locale}/{ns}.json），
 * 各入口经 utils/i18n/bundles/ 按需注册。本测试提供三层保障：
 * 1. zh/en 每个命名空间文件 key 集合完全对齐（防单边漏译）；
 * 2. 命名空间文件内 key 前缀正确且跨文件无重复（防拆分错位）；
 * 3. 静态扫描各入口依赖图源码中的 t('...') 调用，校验 key 全部
 *    落在该入口 bundle 注册的命名空间内（防「新增文案未注册命名空间
 *    导致界面渲染原始 key」的回归）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES_DIR = path.join(ROOT, 'utils/i18n/locales');
const LOCALES = ['zh-CN', 'en'] as const;

/** 各入口 bundle 注册的命名空间（必须与 utils/i18n/bundles/*.ts 保持一致） */
const BUNDLE_NAMESPACES = {
  sidepanel: ['common', 'message', 'sidepanel', 'fill', 'totp'],
  help: ['help'],
  popup: ['common', 'message', 'popup', 'auth', 'session', 'verify'],
} as const;

/**
 * 侧边栏首屏依赖图源文件（不含懒加载的 HelpDialog）
 * 新增侧边栏组件/composable 使用 t() 时需同步补充到此列表
 */
const SIDEPANEL_GRAPH_FILES = [
  'entrypoints/sidepanel/App.vue',
  'entrypoints/sidepanel/main.ts',
  'entrypoints/sidepanel/icons.ts',
  'components/sidepanel/PasswordListItem.vue',
  'components/sidepanel/SidepanelHeader.vue',
  'components/TotpCode.vue',
  'components/BrandLogo.vue',
  'composables/useSidepanelData.ts',
  'composables/useSidepanelFill.ts',
  'composables/useSidepanelSettings.ts',
  'composables/useChromeListeners.ts',
  'composables/useTagOverflow.ts',
  'composables/useTotp.ts',
];

/** HelpDialog 懒加载 chunk 源文件（可用命名空间 = sidepanel bundle + help） */
const HELP_DIALOG_FILES = ['components/sidepanel/HelpDialog.vue'];

/** Popup 依赖图源文件 */
const POPUP_GRAPH_FILES = [
  'entrypoints/popup/App.vue',
  'entrypoints/popup/main.ts',
  'composables/usePopupInit.ts',
  'composables/useShortcuts.ts',
  'composables/useVersionUpdate.ts',
  'composables/useSessionLock.ts',
];

/** 读取指定语言的某命名空间语言包 */
function readNamespace(locale: (typeof LOCALES)[number], ns: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, `${ns}.json`), 'utf-8'));
}

/** 列出某语言下全部命名空间名 */
function listNamespaces(locale: (typeof LOCALES)[number]): string[] {
  return readdirSync(path.join(LOCALES_DIR, locale))
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * 从源码中提取静态 t('key') / t("key") 调用的 key
 * 前置断言排除 setAttribute('style' 等误匹配；模板字符串动态 key
 * （如 HelpDialog 的 t(`${prefix}.${i}`)）由「整命名空间注册」策略覆盖，无需提取
 */
function extractI18nKeys(filePath: string): string[] {
  const source = readFileSync(path.join(ROOT, filePath), 'utf-8');
  const keys: string[] = [];
  for (const match of source.matchAll(/(?<![\w$.])t\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) {
    keys.push(match[1]);
  }
  return keys;
}

/** 收集一组命名空间注册后的全部可用 key */
function collectBundleKeys(namespaces: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const ns of namespaces) {
    for (const key of Object.keys(readNamespace('zh-CN', ns))) {
      keys.add(key);
    }
  }
  return keys;
}

describe('i18n 语言包命名空间拆分', () => {
  it('zh-CN 与 en 的命名空间文件列表一致', () => {
    expect(listNamespaces('zh-CN')).toEqual(listNamespaces('en'));
  });

  it('每个命名空间文件 zh/en key 集合完全对齐', () => {
    for (const ns of listNamespaces('zh-CN')) {
      const zhKeys = Object.keys(readNamespace('zh-CN', ns)).sort();
      const enKeys = Object.keys(readNamespace('en', ns)).sort();
      expect(zhKeys, `命名空间 ${ns} 的 zh/en key 不对齐`).toEqual(enKeys);
    }
  });

  it('命名空间文件内 key 前缀正确（common 额外容纳无前缀的 appName）', () => {
    for (const locale of LOCALES) {
      for (const ns of listNamespaces(locale)) {
        for (const key of Object.keys(readNamespace(locale, ns))) {
          const valid = key.startsWith(`${ns}.`) || (ns === 'common' && !key.includes('.'));
          expect(valid, `${locale}/${ns}.json 中的 key「${key}」前缀不匹配`).toBe(true);
        }
      }
    }
  });

  it('跨命名空间文件无重复 key', () => {
    for (const locale of LOCALES) {
      const seen = new Map<string, string>();
      for (const ns of listNamespaces(locale)) {
        for (const key of Object.keys(readNamespace(locale, ns))) {
          expect(seen.has(key), `key「${key}」同时存在于 ${seen.get(key)} 和 ${ns}`).toBe(false);
          seen.set(key, ns);
        }
      }
    }
  });
});

describe('入口 bundle key 覆盖率（静态扫描源码）', () => {
  it('侧边栏首屏依赖图使用的 key 全部在 sidepanel bundle 内', () => {
    const bundleKeys = collectBundleKeys(BUNDLE_NAMESPACES.sidepanel);
    for (const file of SIDEPANEL_GRAPH_FILES) {
      for (const key of extractI18nKeys(file)) {
        expect(bundleKeys.has(key), `${file} 使用的 key「${key}」未被 sidepanel bundle 覆盖`).toBe(true);
      }
    }
  });

  it('HelpDialog 使用的 key 全部在 sidepanel + help bundle 内', () => {
    const bundleKeys = collectBundleKeys([...BUNDLE_NAMESPACES.sidepanel, ...BUNDLE_NAMESPACES.help]);
    for (const file of HELP_DIALOG_FILES) {
      for (const key of extractI18nKeys(file)) {
        expect(bundleKeys.has(key), `${file} 使用的 key「${key}」未被 sidepanel+help bundle 覆盖`).toBe(true);
      }
    }
  });

  it('popup 依赖图使用的 key 全部在 popup bundle 内', () => {
    const bundleKeys = collectBundleKeys(BUNDLE_NAMESPACES.popup);
    for (const file of POPUP_GRAPH_FILES) {
      for (const key of extractI18nKeys(file)) {
        expect(bundleKeys.has(key), `${file} 使用的 key「${key}」未被 popup bundle 覆盖`).toBe(true);
      }
    }
  });
});
