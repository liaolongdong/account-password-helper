import type {
  FloatingButtonConfig,
  EmailBackupConfig,
  ClipboardConfig,
  IdleLockConfig,
  PasswordEntry,
} from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { sortPasswordEntries, DEFAULT_SORT } from '@/utils/passwordSort';

/** 默认收藏上限 */
export const DEFAULT_FAVORITE_LIMIT = 10;

// ==================== 排序配置 ====================

/**
 * 应用保存的排序配置
 */
export async function applySavedSortConfig(passwords: PasswordEntry[], domain?: string): Promise<void> {
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!domain) return 0;
    const hasUrl = entry.url && entry.url.trim() !== '';
    if (hasUrl && (domain.includes(entry.url) || entry.url.includes(domain))) return 0;
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

export function getDefaultFloatingButtonConfig(): FloatingButtonConfig {
  return {
    visible: true,
    position: 'right',
    offsetY: 0,
    opacity: 0.9,
    autoShowSidepanel: true,
    autoTriggerLogin: false,
    passwordVisibilityToggle: false,
  };
}

export async function getFloatingButtonConfig(): Promise<FloatingButtonConfig> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FLOATING_BUTTON_CONFIG);
    const config = result[STORAGE_KEYS.FLOATING_BUTTON_CONFIG];

    if (!config) {
      return getDefaultFloatingButtonConfig();
    }

    return {
      ...getDefaultFloatingButtonConfig(),
      ...config,
    };
  } catch (error) {
    logger.error('获取悬浮按钮配置失败:', error);
    return getDefaultFloatingButtonConfig();
  }
}

export async function saveFloatingButtonConfig(config: Partial<FloatingButtonConfig>): Promise<void> {
  try {
    const currentConfig = await getFloatingButtonConfig();
    const newConfig: FloatingButtonConfig = {
      ...currentConfig,
      ...config,
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: newConfig,
    });
  } catch (error) {
    logger.error('保存悬浮按钮配置失败:', error);
    throw error;
  }
}

export async function setFloatingButtonVisible(visible: boolean): Promise<void> {
  await saveFloatingButtonConfig({ visible });
}

// ==================== 邮箱备份配置 ====================

export async function getEmailBackupConfig(): Promise<EmailBackupConfig> {
  const defaultConfig: EmailBackupConfig = {
    email: '',
    autoBackup: false,
    autoBackupIntervalDays: 7,
  };
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_BACKUP_CONFIG);
    const config = result[STORAGE_KEYS.EMAIL_BACKUP_CONFIG] as Partial<EmailBackupConfig> | undefined;
    if (!config) return defaultConfig;
    return { ...defaultConfig, ...config };
  } catch (error) {
    logger.error('获取邮箱备份配置失败:', error);
    return defaultConfig;
  }
}

export async function saveEmailBackupConfig(config: Partial<EmailBackupConfig>): Promise<void> {
  try {
    const current = await getEmailBackupConfig();
    const updated: EmailBackupConfig = { ...current, ...config };
    await chrome.storage.local.set({
      [STORAGE_KEYS.EMAIL_BACKUP_CONFIG]: updated,
    });
  } catch (error) {
    logger.error('保存邮箱备份配置失败:', error);
    throw error;
  }
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

export function getDefaultClipboardConfig(): ClipboardConfig {
  return {
    autoClear: true,
    clearAfterSeconds: 30,
  };
}

export async function getClipboardConfig(): Promise<ClipboardConfig> {
  const defaultConfig = getDefaultClipboardConfig();
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLIPBOARD_CONFIG);
    const config = result[STORAGE_KEYS.CLIPBOARD_CONFIG] as Partial<ClipboardConfig> | undefined;
    if (!config) return defaultConfig;
    return { ...defaultConfig, ...config };
  } catch (error) {
    logger.error('获取剪贴板配置失败:', error);
    return defaultConfig;
  }
}

export async function saveClipboardConfig(config: Partial<ClipboardConfig>): Promise<void> {
  try {
    const current = await getClipboardConfig();
    const updated: ClipboardConfig = { ...current, ...config };
    await chrome.storage.local.set({
      [STORAGE_KEYS.CLIPBOARD_CONFIG]: updated,
    });
  } catch (error) {
    logger.error('保存剪贴板配置失败:', error);
    throw error;
  }
}

// ==================== 自动锁定配置 ====================

/**
 * 默认自动锁定配置
 */
export function getDefaultIdleLockConfig(): IdleLockConfig {
  return {
    idleLockMinutes: 0,
    relockOnBrowserRestart: false,
  };
}

/**
 * 获取自动锁定配置
 */
export async function getIdleLockConfig(): Promise<IdleLockConfig> {
  const defaultConfig = getDefaultIdleLockConfig();
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDLE_LOCK_CONFIG);
    const config = result[STORAGE_KEYS.IDLE_LOCK_CONFIG] as Partial<IdleLockConfig> | undefined;
    if (!config) return defaultConfig;
    return { ...defaultConfig, ...config };
  } catch (error) {
    logger.error('获取自动锁定配置失败:', error);
    return defaultConfig;
  }
}

/**
 * 保存自动锁定配置（增量合并，保留未变更字段）
 */
export async function saveIdleLockConfig(config: Partial<IdleLockConfig>): Promise<void> {
  try {
    const current = await getIdleLockConfig();
    const updated: IdleLockConfig = { ...current, ...config };
    await chrome.storage.local.set({
      [STORAGE_KEYS.IDLE_LOCK_CONFIG]: updated,
    });
  } catch (error) {
    logger.error('保存自动锁定配置失败:', error);
    throw error;
  }
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
