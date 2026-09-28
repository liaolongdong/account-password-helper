import type {
  FloatingButtonConfig,
  EmailBackupConfig,
  ClipboardConfig,
  DomainMatchConfig,
  IdleLockConfig,
  PasswordEntry,
  PasswordHistoryConfig,
} from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { DEFAULT_THEME } from '@/utils/theme';
import { sortPasswordEntries, DEFAULT_SORT, type SortCriterion } from '@/utils/passwordSort';
import { isExactHostMatch, isDomainMatchMode, type DomainMatchMode } from '@/utils/domain';
import { DEFAULT_PAGE_SIZE, isVaultPageSize } from '@/utils/vaultPageSize';

/** 默认收藏上限 */
export const DEFAULT_FAVORITE_LIMIT = 10;

// ==================== 泛型配置工厂 ====================

/**
 * 配置存储实例接口
 *
 * 提供类型安全的 get/save 操作，内部处理：
 * - 默认值合并（新增字段自动补齐）
 * - 错误日志与降级（get 失败返回默认值，save 失败抛出）
 * - 增量合并保存（仅覆盖传入字段）
 */
interface ConfigStore<T extends object> {
  /** 获取默认配置 */
  getDefaults: () => T;
  /** 读取配置（失败时降级为默认值） */
  get: () => Promise<T>;
  /** 增量保存配置（合并当前值后写入） */
  save: (patch: Partial<T>) => Promise<void>;
}

/**
 * 创建类型安全的配置存储实例
 *
 * 消除各配置类型重复的 get/save 模板代码，统一错误处理和默认值合并逻辑。
 *
 * @param storageKey - chrome.storage.local 中的键名
 * @param defaults - 默认配置对象或返回默认配置的工厂函数
 * @param label - 配置中文名称（用于错误日志）
 * @returns ConfigStore 实例
 *
 * @example
 * const clipboardStore = createConfigStore<ClipboardConfig>(
 *   STORAGE_KEYS.CLIPBOARD_CONFIG,
 *   { autoClear: true, clearAfterSeconds: 30 },
 *   '剪贴板配置',
 * );
 * const config = await clipboardStore.get();
 * await clipboardStore.save({ clearAfterSeconds: 60 });
 */
function createConfigStore<T extends object>(
  storageKey: string,
  defaults: T | (() => T),
  label: string,
): ConfigStore<T> {
  const getDefaults = (): T => (typeof defaults === 'function' ? (defaults as () => T)() : defaults);

  return {
    getDefaults,

    async get(): Promise<T> {
      const defaultConfig = getDefaults();
      try {
        const result = await chrome.storage.local.get(storageKey);
        const config = result[storageKey] as Partial<T> | undefined;
        if (!config) return defaultConfig;
        return { ...defaultConfig, ...config };
      } catch (error) {
        logger.error(`获取${label}失败:`, error);
        return defaultConfig;
      }
    },

    async save(patch: Partial<T>): Promise<void> {
      try {
        const current = await this.get();
        const updated: T = { ...current, ...patch };
        await chrome.storage.local.set({ [storageKey]: updated });
      } catch (error) {
        logger.error(`保存${label}失败:`, error);
        throw error;
      }
    },
  };
}

// ==================== 排序配置 ====================

/**
 * 应用保存的排序配置
 *
 * 刻意不接入跨子域档位：唯一调用方 getPasswordsByUrl 无生产使用者，
 * 这里保持迁移前的精确 host 二值优先级，避免后来者误以为「存储层排序也会跨子域」。
 * 跨子域优先级在侧边栏与内联下拉的匹配真源（utils/passwordSort.ts）内按 tier 计算。
 */
export async function applySavedSortConfig(passwords: PasswordEntry[], domain?: string): Promise<void> {
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!domain) return 0;
    const hasUrl = entry.url && entry.url.trim() !== '';
    if (hasUrl && isExactHostMatch(domain, entry.url)) return 0;
    return 1;
  };

  try {
    const sortConfig = await getSortConfig();
    const sortState = sortConfig
      ? { prop: sortConfig.prop, order: (sortConfig.order || null) as 'ascending' | 'descending' | null }
      : DEFAULT_SORT;
    sortPasswordEntries(passwords, sortState, getDomainPriority);
  } catch (error) {
    logger.error('应用排序配置失败，使用默认排序:', error);
    sortPasswordEntries(passwords, DEFAULT_SORT, getDomainPriority);
  }
}

/**
 * 保存排序配置
 */
export async function saveSortConfig(sortConfig: { prop: string; order: string }): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SORT_CONFIG]: sortConfig,
    });
  } catch (error) {
    logger.error('保存排序配置失败:', error);
    throw error;
  }
}

/**
 * 获取排序配置
 */
export async function getSortConfig(): Promise<{ prop: string; order: string } | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SORT_CONFIG);
    return (result[STORAGE_KEYS.SORT_CONFIG] as { prop: string; order: string } | undefined) || null;
  } catch (error) {
    logger.error('获取排序配置失败:', error);
    return null;
  }
}

// ==================== Options 多列排序链配置 ====================

/**
 * 校验并归一化排序链（防御不可信存储数据）
 *
 * 逐项要求 prop 为非空字符串、order 为明确方向；丢弃非法项。
 * 全部非法时返回空数组（等价于默认排序）。
 */
function normalizeSortChain(raw: unknown): SortCriterion[] {
  if (!Array.isArray(raw)) return [];
  const result: SortCriterion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { prop, order } = item as { prop?: unknown; order?: unknown };
    if (typeof prop !== 'string' || prop === '') continue;
    if (order !== 'ascending' && order !== 'descending') continue;
    result.push({ prop, order });
  }
  return result;
}

/**
 * 获取 Options 列表多列排序链
 *
 * 优先读取新键 `options_sort_chain`；若不存在则尝试从旧单列键 `password_sort_config`
 * 迁移（长度为 1 的数组，order 为 null 时视为空链）。均无或异常时返回空数组（默认排序）。
 * 排序链属展示偏好，任何异常都不应阻断列表加载。
 */
export async function getOptionsSortChain(): Promise<SortCriterion[]> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.OPTIONS_SORT_CHAIN, STORAGE_KEYS.SORT_CONFIG]);
    const stored = result[STORAGE_KEYS.OPTIONS_SORT_CHAIN];
    if (stored !== undefined) return normalizeSortChain(stored);

    // 旧格式迁移：单列 { prop, order } → 排序链（order 为 null 表示无排序 → 空链）
    const legacy = result[STORAGE_KEYS.SORT_CONFIG] as { prop?: unknown; order?: unknown } | undefined;
    if (legacy && typeof legacy.prop === 'string' && legacy.prop !== '') {
      if (legacy.order === 'ascending' || legacy.order === 'descending') {
        return [{ prop: legacy.prop, order: legacy.order }];
      }
      return [];
    }
    return [];
  } catch (error) {
    logger.error('获取多列排序链失败:', error);
    return [];
  }
}

/**
 * 保存 Options 列表多列排序链（空数组表示清除排序、回退默认）
 */
export async function saveOptionsSortChain(chain: readonly SortCriterion[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS_SORT_CHAIN]: normalizeSortChain(chain) });
  } catch (error) {
    logger.error('保存多列排序链失败:', error);
    throw error;
  }
}

// ==================== 侧边栏专属排序配置 ====================

export async function getSidepanelSortConfig(): Promise<{ prop: string; order: string } | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_SORT_CONFIG);
    return (result[STORAGE_KEYS.SIDEPANEL_SORT_CONFIG] as { prop: string; order: string } | undefined) || null;
  } catch (error) {
    logger.error('获取侧边栏排序配置失败:', error);
    return null;
  }
}

export async function saveSidepanelSortConfig(config: { prop: string; order: string }): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SIDEPANEL_SORT_CONFIG]: config,
    });
  } catch (error) {
    logger.error('保存侧边栏排序配置失败:', error);
    throw error;
  }
}

// ==================== 管理页每页条数 ====================

/**
 * 读取管理页每页条数
 *
 * 走白名单而非范围校验：档位直接决定一次喂给 `el-table` 的行数（整表重排成本随行数近似
 * 平方增长），存储里的非法值必须落回 `DEFAULT_PAGE_SIZE`，不能透传一个 0 让列表空白，
 * 也不能让手改/导入的配置绕过 200 这条成本上限。读取失败同样降级，不向上抛。
 */
export async function getVaultPageSize(): Promise<number> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.VAULT_PAGE_SIZE);
    const size = result[STORAGE_KEYS.VAULT_PAGE_SIZE];
    return isVaultPageSize(size) ? size : DEFAULT_PAGE_SIZE;
  } catch (error) {
    logger.error('获取管理页每页条数失败:', error);
    return DEFAULT_PAGE_SIZE;
  }
}

/**
 * 保存管理页每页条数
 *
 * 非法档位忽略写入并告警（与 `saveDomainMatchConfig` 同一取舍）：视图偏好不值得为一次
 * 坏写入向用户报错，但把异常状态落盘会长期影响渲染成本，因此是「忽略」而不是「照写」。
 * 写入本身失败会抛出，由调用方按非致命处理。
 */
export async function saveVaultPageSize(size: number): Promise<void> {
  if (!isVaultPageSize(size)) {
    logger.warn('忽略非法的管理页每页条数写入');
    return;
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.VAULT_PAGE_SIZE]: size });
  } catch (error) {
    logger.error('保存管理页每页条数失败:', error);
    throw error;
  }
}

// ==================== 悬浮按钮配置 ====================

const floatingButtonStore = createConfigStore<FloatingButtonConfig>(
  STORAGE_KEYS.FLOATING_BUTTON_CONFIG,
  () => ({
    visible: true,
    position: 'right',
    offsetY: 0,
    opacity: 0.9,
    autoShowSidepanel: false,
    autoTriggerLogin: false,
    passwordVisibilityToggle: false,
    autoFillTotp: false,
    crossSubdomainMatch: true,
    fillMode: 'inline',
    theme: DEFAULT_THEME,
    penetrateShadow: true,
  }),
  '悬浮按钮配置',
);

export function getDefaultFloatingButtonConfig(): FloatingButtonConfig {
  return floatingButtonStore.getDefaults();
}

/**
 * 冻结存量用户的历史填充默认值（扩展升级钩子专用）
 *
 * 背景：默认填充方式由「侧边栏自动弹出」切换为「页面内联」后，仅应对新安装用户生效。
 * 由于 get() 采用 { ...默认值, ...存储值 } 合并，从未保存过偏好设置（storage 无键）或
 * 旧版本存储缺少 fillMode/autoShowSidepanel 字段的存量用户会被新默认值静默改变行为，
 * 因此在 onInstalled(reason === 'update') 时把历史默认值补写进原始存储对象。
 *
 * 注意：直接增量写回原始存储值而非经 floatingButtonStore.save()（后者会将全量新默认值
 * 固化进存储，导致存量用户无法接收未来其他字段的默认值演进）。
 */
export async function freezeLegacyFillDefaults(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FLOATING_BUTTON_CONFIG);
    const stored = (result[STORAGE_KEYS.FLOATING_BUTTON_CONFIG] as Partial<FloatingButtonConfig> | undefined) ?? {};
    const patch: Partial<FloatingButtonConfig> = {};
    if (stored.fillMode === undefined) patch.fillMode = 'sidepanel';
    if (stored.autoShowSidepanel === undefined) patch.autoShowSidepanel = true;
    if (Object.keys(patch).length === 0) return;
    await chrome.storage.local.set({
      [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: { ...stored, ...patch },
    });
  } catch (error) {
    logger.error('冻结存量填充默认值失败:', error);
  }
}

export async function getFloatingButtonConfig(): Promise<FloatingButtonConfig> {
  return floatingButtonStore.get();
}

export async function saveFloatingButtonConfig(config: Partial<FloatingButtonConfig>): Promise<void> {
  return floatingButtonStore.save(config);
}

export async function setFloatingButtonVisible(visible: boolean): Promise<void> {
  await saveFloatingButtonConfig({ visible });
}

// ==================== 邮箱备份配置 ====================

const emailBackupStore = createConfigStore<EmailBackupConfig>(
  STORAGE_KEYS.EMAIL_BACKUP_CONFIG,
  { email: '', autoBackup: false, autoBackupIntervalDays: 7 },
  '邮箱备份配置',
);

export async function getEmailBackupConfig(): Promise<EmailBackupConfig> {
  return emailBackupStore.get();
}

export async function saveEmailBackupConfig(config: Partial<EmailBackupConfig>): Promise<void> {
  return emailBackupStore.save(config);
}

export async function getLastAutoBackupTime(): Promise<number | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_AUTO_BACKUP_TIME);
    return (result[STORAGE_KEYS.LAST_AUTO_BACKUP_TIME] as number | undefined) ?? null;
  } catch (error) {
    logger.error('获取最后自动备份时间失败:', error);
    return null;
  }
}

export async function setLastAutoBackupTime(timestamp: number = Date.now()): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_AUTO_BACKUP_TIME]: timestamp,
    });
  } catch (error) {
    logger.error('记录自动备份时间失败:', error);
    throw error;
  }
}

// ==================== 成功备份时间戳 ====================

/**
 * 读取最近一次「通过完整性自检」的加密 .aph 导出时间戳
 *
 * 与 `getLastAutoBackupTime`（邮箱自动备份落点）区分：本键仅在导出后 round-trip
 * 解密校验通过时写入，代表「这份备份确实可被解回」，供 Options「距上次成功备份 N 天」展示。
 * 读取失败或从未成功导出时返回 null（降级，不抛）。
 */
export async function getLastVerifiedBackupAt(): Promise<number | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT);
    const value = result[STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch (error) {
    logger.error('获取最后成功备份时间失败:', error);
    return null;
  }
}

/**
 * 记录一次通过完整性自检的加密备份导出时间
 *
 * 由 `exportEncryptedBackup` 在自检通过、文件已下载后调用。写入失败会抛出，
 * 调用方需自行按「非致命」处理（备份文件本身已产出，仅提醒时间戳缺失）。
 */
export async function markVerifiedBackupAt(timestamp: number = Date.now()): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT]: timestamp,
  });
}

// ==================== 剪贴板配置 ====================

const clipboardStore = createConfigStore<ClipboardConfig>(
  STORAGE_KEYS.CLIPBOARD_CONFIG,
  { autoClear: true, clearAfterSeconds: 30 },
  '剪贴板配置',
);

export function getDefaultClipboardConfig(): ClipboardConfig {
  return clipboardStore.getDefaults();
}

export async function getClipboardConfig(): Promise<ClipboardConfig> {
  return clipboardStore.get();
}

export async function saveClipboardConfig(config: Partial<ClipboardConfig>): Promise<void> {
  return clipboardStore.save(config);
}

// ==================== 自动锁定配置 ====================

const idleLockStore = createConfigStore<IdleLockConfig>(
  STORAGE_KEYS.IDLE_LOCK_CONFIG,
  { idleLockMinutes: 0, relockOnBrowserRestart: false },
  '自动锁定配置',
);

/**
 * 默认自动锁定配置
 */
export function getDefaultIdleLockConfig(): IdleLockConfig {
  return idleLockStore.getDefaults();
}

/**
 * 获取自动锁定配置
 */
export async function getIdleLockConfig(): Promise<IdleLockConfig> {
  return idleLockStore.get();
}

/**
 * 保存自动锁定配置（增量合并，保留未变更字段）
 */
export async function saveIdleLockConfig(config: Partial<IdleLockConfig>): Promise<void> {
  return idleLockStore.save(config);
}

// ==================== 收藏上限配置 ====================

export async function getFavoriteLimit(): Promise<number> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FAVORITE_LIMIT);
    const limit = result[STORAGE_KEYS.FAVORITE_LIMIT] as number | undefined;
    return limit ?? DEFAULT_FAVORITE_LIMIT;
  } catch (error) {
    logger.error('获取收藏上限失败:', error);
    return DEFAULT_FAVORITE_LIMIT;
  }
}

export async function setFavoriteLimit(limit: number): Promise<void> {
  try {
    if (limit < 1 || limit > 50) {
      throw new Error('收藏上限必须在 1 到 50 之间');
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.FAVORITE_LIMIT]: limit,
    });
  } catch (error) {
    logger.error('设置收藏上限失败:', error);
    throw error;
  }
}

// ==================== Options 分组列显隐配置 ====================

/**
 * 获取 Options 表格「分组」列是否可见
 *
 * 默认隐藏：左侧分组树已表达当前归属，聚合视图下才需要路径列区分来源。
 * 属展示偏好，读取异常降级为默认值，不阻断列表加载。
 */
export async function getOptionsGroupColVisible(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE);
    return result[STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE] === true;
  } catch (error) {
    logger.error('获取分组列显隐配置失败:', error);
    return false;
  }
}

/**
 * 保存 Options 表格「分组」列显隐偏好
 */
export async function setOptionsGroupColVisible(visible: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS_GROUP_COL_VISIBLE]: visible });
  } catch (error) {
    logger.error('保存分组列显隐配置失败:', error);
    throw error;
  }
}

// ==================== 密码历史记录配置 ====================

/** 密码历史记录默认配置 */
export const DEFAULT_PASSWORD_HISTORY_CONFIG: PasswordHistoryConfig = {
  enabled: true,
  maxCount: 3,
};

const passwordHistoryStore = createConfigStore<PasswordHistoryConfig>(
  STORAGE_KEYS.PASSWORD_HISTORY_CONFIG,
  DEFAULT_PASSWORD_HISTORY_CONFIG,
  '密码历史记录配置',
);

/**
 * 获取密码历史记录配置
 */
export async function getPasswordHistoryConfig(): Promise<PasswordHistoryConfig> {
  return passwordHistoryStore.get();
}

/**
 * 保存密码历史记录配置
 */
export async function savePasswordHistoryConfig(config: Partial<PasswordHistoryConfig>): Promise<void> {
  // maxCount 范围校验
  if (config.maxCount !== undefined) {
    if (config.maxCount < 1 || config.maxCount > 10) {
      throw new Error('历史记录保留条数必须在 1 到 10 之间');
    }
  }
  return passwordHistoryStore.save(config);
}

// ==================== 跨子域匹配档位 ====================

/** 默认档位：仅精确 host 匹配，与引入跨子域之前的行为逐条一致 */
export const DEFAULT_DOMAIN_MATCH_MODE: DomainMatchMode = 'off';

const domainMatchStore = createConfigStore<DomainMatchConfig>(
  STORAGE_KEYS.DOMAIN_MATCH_CONFIG,
  { mode: DEFAULT_DOMAIN_MATCH_MODE },
  '跨子域匹配档位',
);

/**
 * 获取跨子域匹配档位
 *
 * 存储值非法（未知枚举、被外部改写成非对象）时回落 `off`：宁可少显示条目，也不静默放宽匹配。
 * 返回固定形状，避免存储里的多余键位透出到调用方。
 */
export async function getDomainMatchConfig(): Promise<DomainMatchConfig> {
  const config = await domainMatchStore.get();
  return { mode: isDomainMatchMode(config?.mode) ? config.mode : DEFAULT_DOMAIN_MATCH_MODE };
}

/**
 * 保存跨子域匹配档位（增量合并）
 *
 * 非法档位值直接忽略写入并告警，避免把异常状态落盘后长期影响匹配口径。
 */
export async function saveDomainMatchConfig(config: Partial<DomainMatchConfig>): Promise<void> {
  if (config.mode !== undefined && !isDomainMatchMode(config.mode)) {
    logger.warn('忽略非法的跨子域匹配档位写入');
    return;
  }
  await domainMatchStore.save(config);
}
