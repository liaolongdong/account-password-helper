import type {
  FloatingButtonConfig,
  EmailBackupConfig,
  ClipboardConfig,
  IdleLockConfig,
  PasswordEntry,
} from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { DEFAULT_THEME } from '@/utils/theme';
import { sortPasswordEntries, DEFAULT_SORT } from '@/utils/passwordSort';
import { isDomainMatch } from '@/utils/domain';

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
 */
export async function applySavedSortConfig(passwords: PasswordEntry[], domain?: string): Promise<void> {
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!domain) return 0;
    const hasUrl = entry.url && entry.url.trim() !== '';
    if (hasUrl && isDomainMatch(domain, entry.url)) return 0;
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

// ==================== 悬浮按钮配置 ====================

const floatingButtonStore = createConfigStore<FloatingButtonConfig>(
  STORAGE_KEYS.FLOATING_BUTTON_CONFIG,
  () => ({
    visible: true,
    position: 'right',
    offsetY: 0,
    opacity: 0.9,
    autoShowSidepanel: true,
    autoTriggerLogin: false,
    passwordVisibilityToggle: false,
    fillMode: 'sidepanel',
    theme: DEFAULT_THEME,
  }),
  '悬浮按钮配置',
);

export function getDefaultFloatingButtonConfig(): FloatingButtonConfig {
  return floatingButtonStore.getDefaults();
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
