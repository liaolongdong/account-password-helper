/**
 * i18n 命名空间拆分完整性测试
 *
 * 语言包已按命名空间拆分（utils/i18n/locales/{locale}/{ns}.json），
 * 各入口经 utils/i18n/bundles/ 按需注册。本测试提供三层保障：
 * 1. zh/en 每个命名空间文件 key 集合完全对齐（防单边漏译）；
 * 2. 命名空间文件内 key 前缀正确且跨文件无重复（防拆分错位）；
 * 3. 静态扫描各入口依赖图源码中的 t('...') 调用，校验 key 全部
 *    落在该入口 bundle 注册的命名空间内（防「新增文案未注册命名空间
 *    导致界面渲染原始 key」的回归）；
 * 4. 校验 HelpDialog 以 helpItems(prefix, N) 序号驱动渲染的分组，其
 *    1..N 条目在中英文语言包中齐全且无多余（防「改了 N 忘了补文案」
 *    或「补了文案忘了抬 N」两类单边漂移）；
 * 5. 校验侧边栏专属目录下的源文件都被扫描清单认领、且清单不指向已不存在的
 *    文件（防「清单漏登记 → 该文件的 key 永不校验」这种静默失效）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES_DIR = path.join(ROOT, 'utils/i18n/locales');
const LOCALES = ['zh-CN', 'en'] as const;

/**
 * 各入口 bundle 注册的命名空间（必须与 utils/i18n/bundles/*.ts 保持一致）
 *
 * `help` 与 `form` 不是入口 bundle：它们由侧边栏的懒加载 chunk 在自身文件内
 * `registerMessages` 补注册，扫描口径按「所属 chunk 的可用命名空间」单独成组。
 */
const BUNDLE_NAMESPACES = {
  sidepanel: ['common', 'message', 'sidepanel', 'fill', 'totp', 'session'],
  help: ['help'],
  form: ['form'],
  popup: ['common', 'message', 'popup', 'auth', 'session', 'verify'],
  // options 页面覆盖全部功能域，bundle 静态内置全部命名空间（含 identity）
  options: [
    'auth',
    'backup',
    'common',
    'excel',
    'fill',
    'form',
    'health',
    'help',
    'identity',
    'message',
    'options',
    'popup',
    'session',
    'sidepanel',
    'strength',
    'totp',
    'validity',
    'verify',
  ],
} as const;

/**
 * 侧边栏首屏依赖图源文件
 *
 * 新增侧边栏组件/composable 使用 t() 时需同步补充到此列表，且这一要求由
 * 「侧边栏清单认领完整性」用例强制：漏补会让新文件里的 key 完全不进扫描，
 * 界面渲染出裸 key 而测试仍全绿——`QuickAddDialog.vue` 就是这样漏掉过的。
 *
 * 懒加载 chunk 不在本列的还有 HelpDialog 与 QuickAddDialog：两者都在自身 chunk 内
 * `registerMessages` 补注册了首屏没有的命名空间（见 `HELP_DIALOG_FILES` /
 * `QUICK_ADD_DIALOG_FILES`），可用命名空间与首屏不同，扫描口径也必须分开。
 */
const SIDEPANEL_GRAPH_FILES = [
  'entrypoints/sidepanel/App.vue',
  'entrypoints/sidepanel/main.ts',
  'entrypoints/sidepanel/icons.ts',
  'components/sidepanel/PasswordListItem.vue',
  'components/sidepanel/SidepanelHeader.vue',
  'components/sidepanel/SidepanelAuthView.vue',
  'components/TotpCode.vue',
  'components/BrandLogo.vue',
  'composables/useSidepanelData.ts',
  'composables/useSidepanelFill.ts',
  'composables/useSidepanelSettings.ts',
  'composables/useChromeListeners.ts',
  'composables/useTagOverflow.ts',
  'composables/useTotp.ts',
  'composables/useSessionCountdown.ts',
];

/**
 * HelpDialog 懒加载 chunk 源文件（可用命名空间 = sidepanel bundle + help）
 *
 * ShortcutKeyCap 是 HelpDialog 的子组件，随同一 chunk 落地。它当前不调用 t()
 * （文案一律由调用方翻译后经 props 传入），纳入扫描是为了防止后续回归。
 */
const HELP_DIALOG_FILES = ['components/sidepanel/HelpDialog.vue', 'components/ShortcutKeyCap.vue'];

/**
 * QuickAdd 懒加载 chunk 源文件（可用命名空间 = sidepanel + form）
 *
 * 表单校验规则复用 Options 页的 `form.*` 文案，故该 chunk 在自身文件内补注册
 * form 命名空间（不占侧边栏首屏体积）；这里的 key 若只有首屏 bundle 覆盖会渲染裸 key。
 */
const QUICK_ADD_DIALOG_FILES = ['components/sidepanel/QuickAddDialog.vue'];

/** Popup 依赖图源文件 */
const POPUP_GRAPH_FILES = [
  'entrypoints/popup/App.vue',
  'entrypoints/popup/main.ts',
  'composables/usePopupInit.ts',
  'composables/useShortcuts.ts',
  'composables/useVersionUpdate.ts',
  'composables/useSessionLock.ts',
];

/**
 * 身份信息库（Identity Vault）依赖图源文件
 *
 * 两弹窗 + composable 使用 t() 的 key 均需落在 options bundle（全命名空间）内；
 * 动态 key（如 `t(\`identity.category.${x}\`)`）由「整命名空间注册」策略覆盖，无需提取。
 */
const IDENTITY_GRAPH_FILES = [
  'components/options/IdentityVaultDialog.vue',
  'components/options/IdentityFormDialog.vue',
  'components/options/HeaderBar.vue',
  'composables/useIdentityVault.ts',
  'entrypoints/options/App.vue',
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

  it('QuickAddDialog 使用的 key 全部在 sidepanel + form bundle 内', () => {
    const bundleKeys = collectBundleKeys([...BUNDLE_NAMESPACES.sidepanel, ...BUNDLE_NAMESPACES.form]);
    for (const file of QUICK_ADD_DIALOG_FILES) {
      for (const key of extractI18nKeys(file)) {
        expect(bundleKeys.has(key), `${file} 使用的 key「${key}」未被 sidepanel+form bundle 覆盖`).toBe(true);
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

  it('身份信息库依赖图使用的 key 全部在 options bundle 内', () => {
    const bundleKeys = collectBundleKeys(BUNDLE_NAMESPACES.options);
    for (const file of IDENTITY_GRAPH_FILES) {
      for (const key of extractI18nKeys(file)) {
        expect(bundleKeys.has(key), `${file} 使用的 key「${key}」未被 options bundle 覆盖`).toBe(true);
      }
    }
  });
});

/**
 * 侧边栏专属目录
 *
 * 这两处下的源文件只可能属于侧边栏首屏或侧边栏懒加载 chunk，因此「是否被清单认领」
 * 可以机械判定；跨入口复用的 composables / components 根目录组件不在此列，
 * 仍需人工登记（清单漂移的残余风险，见 `SIDEPANEL_GRAPH_FILES` 注释）。
 */
const SIDEPANEL_OWNED_DIRS = ['entrypoints/sidepanel', 'components/sidepanel'];

/** 递归列出目录下全部 `.ts` / `.vue` 源文件（相对 ROOT） */
function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listSources(rel));
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe('侧边栏扫描清单认领完整性', () => {
  it('侧边栏目录下每个源文件都被某个扫描清单认领', () => {
    const claimed = new Set([...SIDEPANEL_GRAPH_FILES, ...HELP_DIALOG_FILES, ...QUICK_ADD_DIALOG_FILES]);
    const unclaimed = SIDEPANEL_OWNED_DIRS.flatMap(listSources).filter(file => !claimed.has(file));
    expect(
      unclaimed,
      `以下侧边栏源文件未登记进扫描清单，其 t() key 不会被任何 bundle 覆盖校验: ${unclaimed.join(', ')}`,
    ).toEqual([]);
  });

  it('五份清单里的每个文件都真实存在', () => {
    const listed = [
      ...SIDEPANEL_GRAPH_FILES,
      ...HELP_DIALOG_FILES,
      ...QUICK_ADD_DIALOG_FILES,
      ...POPUP_GRAPH_FILES,
      ...IDENTITY_GRAPH_FILES,
    ];
    const missing = listed.filter(file => !existsSync(path.join(ROOT, file)));
    expect(missing, `扫描清单指向不存在的文件（重命名或删除后未同步）: ${missing.join(', ')}`).toEqual([]);
  });
});

/** HelpDialog 的分组条目由 helpItems(prefix, N) 按 1..N 序号渲染，无空值兼容 */
const HELP_DIALOG_SOURCE = 'components/sidepanel/HelpDialog.vue';

describe('HelpDialog 序号驱动的条目数与语言包对齐', () => {
  it('每个 helpItems 前缀的 1..N 在中英文语言包中齐全且无多余', () => {
    const source = readFileSync(path.join(ROOT, HELP_DIALOG_SOURCE), 'utf-8');
    const calls = [...source.matchAll(/helpItems\(\s*'([a-zA-Z0-9_.]+)'\s*,\s*(\d+)\s*\)/g)].map(m => ({
      prefix: m[1],
      count: Number(m[2]),
    }));
    // 扫不到调用说明模板已重构、本守卫失效，必须显式提醒而非静默通过
    expect(calls.length, '未从 HelpDialog.vue 扫描到 helpItems 调用，请检查正则').toBeGreaterThan(0);

    for (const { prefix, count } of calls) {
      // 前缀含 `.`，拼正则前必须转义，否则 `help.gs` 会当作 `helpXgs` 匹配
      const numberedPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+$`);
      for (const locale of LOCALES) {
        const keys = Object.keys(readNamespace(locale, 'help'));
        for (let i = 1; i <= count; i++) {
          expect(keys.includes(`${prefix}.${i}`), `${locale} 缺少 ${prefix}.${i}，弹窗会渲染出裸 key`).toBe(true);
        }
        const numbered = keys.filter(k => numberedPattern.test(k));
        expect(
          numbered.length,
          `${locale} 的 ${prefix} 实有 ${numbered.length} 条编号文案，但 HelpDialog 只渲染 ${count} 条`,
        ).toBe(count);
      }
    }
  });
});
