import type { AutoSaveConfig, AutoSavePasswordData, PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/encryption';
import { isSessionValid } from './facades';
import { getAllPasswordsRaw, updatePassword, savePassword } from './passwordCrud';
import { getFavoriteLimit } from './configManager';

// ==================== 自动保存配置 ====================

/**
 * 获取默认自动保存配置
 */
export function getDefaultAutoSaveConfig(): AutoSaveConfig {
  return {
    enabled: true,
    domainPatterns: [],
    excludedDomains: [],
  };
}

/**
 * 获取自动保存配置（带默认值）
 */
export async function getAutoSaveConfig(): Promise<AutoSaveConfig> {
  const defaultConfig = getDefaultAutoSaveConfig();
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.AUTO_SAVE_CONFIG);
    const config = result[STORAGE_KEYS.AUTO_SAVE_CONFIG] as Partial<AutoSaveConfig> | undefined;
    if (!config) return defaultConfig;
    return {
      ...defaultConfig,
      ...config,
      domainPatterns: Array.isArray(config.domainPatterns) ? config.domainPatterns : defaultConfig.domainPatterns,
      excludedDomains: Array.isArray(config.excludedDomains) ? config.excludedDomains : defaultConfig.excludedDomains,
    };
  } catch (error) {
    logger.error('获取自动保存配置失败:', error);
    return defaultConfig;
  }
}

/**
 * 保存自动保存配置
 */
export async function saveAutoSaveConfig(config: Partial<AutoSaveConfig>): Promise<void> {
  try {
    const current = await getAutoSaveConfig();
    const updated: AutoSaveConfig = { ...current, ...config };
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTO_SAVE_CONFIG]: updated,
    });
  } catch (error) {
    logger.error('保存自动保存配置失败:', error);
    throw error;
  }
}

/**
 * 添加域名到自动保存黑名单（去重）
 */
export async function addExcludedDomain(domain: string): Promise<void> {
  const config = await getAutoSaveConfig();
  const lowerDomain = domain.toLowerCase();
  if (config.excludedDomains.some(d => d.toLowerCase() === lowerDomain)) {
    return;
  }
  config.excludedDomains.push(lowerDomain);
  await saveAutoSaveConfig({ excludedDomains: config.excludedDomains });
  logger.info(`[APH] 已将 ${lowerDomain} 加入自动保存屏蔽列表`);
}

/**
 * 从自动保存黑名单中移除域名
 */
export async function removeExcludedDomain(domain: string): Promise<void> {
  const config = await getAutoSaveConfig();
  const lowerDomain = domain.toLowerCase();
  config.excludedDomains = config.excludedDomains.filter(d => d.toLowerCase() !== lowerDomain);
  await saveAutoSaveConfig({ excludedDomains: config.excludedDomains });
  logger.info(`[APH] 已将 ${lowerDomain} 从自动保存屏蔽列表移除`);
}

/**
 * 检测域名是否匹配自动保存规则
 */
export function isDomainMatchForAutoSave(hostname: string, config: AutoSaveConfig): boolean {
  if (!hostname) return false;

  if (config.excludedDomains && config.excludedDomains.length > 0) {
    const lowerHostname = hostname.toLowerCase();
    const isExcluded = config.excludedDomains.some(excluded => {
      const lowerExcluded = excluded.toLowerCase();
      return lowerHostname === lowerExcluded || lowerHostname.endsWith('.' + lowerExcluded);
    });
    if (isExcluded) return false;
  }

  if (config.domainPatterns.length === 0) return true;

  const lowerHostname = hostname.toLowerCase();
  return config.domainPatterns.some(rule => {
    if (!rule.pattern) return false;
    if (rule.isRegex) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        return regex.test(lowerHostname);
      } catch {
        logger.warn('自动保存域名正则表达式无效:', rule.pattern);
        return false;
      }
    }
    const lowerPattern = rule.pattern.toLowerCase();
    return lowerHostname === lowerPattern || lowerHostname.endsWith('.' + lowerPattern);
  });
}

/**
 * 自动保存密码
 */
export async function autoSavePassword(data: AutoSavePasswordData): Promise<{ success: boolean; message: string }> {
  try {
    const sessionValid = await isSessionValid();
    if (!sessionValid) {
      return { success: false, message: '会话已过期，跳过自动保存' };
    }

    const config = await getAutoSaveConfig();
    if (!config.enabled) {
      return { success: false, message: '自动保存已禁用' };
    }
    if (!isDomainMatchForAutoSave(data.url, config)) {
      return { success: false, message: '域名不匹配，跳过自动保存' };
    }

    if (!data.username || !data.password) {
      return { success: false, message: '账号或密码为空，跳过保存' };
    }

    const passwords = await getAllPasswordsRaw();

    const existingEntry = passwords.find(p => {
      const entry = p as PasswordEntry;
      if (!entry.url || entry.username !== data.username) return false;
      const entryHost = (() => {
        try {
          return new URL(entry.url.startsWith('http') ? entry.url : `https://${entry.url}`).hostname;
        } catch {
          return entry.url;
        }
      })().toLowerCase();
      const dataHost = data.url.toLowerCase();
      return entryHost === dataHost || entryHost.endsWith('.' + dataHost) || dataHost.endsWith('.' + entryHost);
    }) as PasswordEntry | undefined;

    if (existingEntry) {
      const newTag = data.tagEdited ? data.tag : existingEntry.tag || data.tag || '';
      const newRemark = data.remarkEdited
        ? data.remark || '自动保存'
        : existingEntry.remark || data.remark || '自动保存';

      await updatePassword(existingEntry.id, {
        password: data.password,
        tag: newTag,
        remark: newRemark,
        updateTime: Date.now(),
      });
      return { success: true, message: '已更新已有账号密码' };
    } else {
      await savePassword({
        username: data.username,
        password: data.password,
        url: data.url,
        tag: data.tag || '',
        remark: data.remark || '自动保存',
        createTime: Date.now(),
        updateTime: Date.now(),
      });
      return { success: true, message: '已自动保存新账号密码' };
    }
  } catch (error) {
    logger.error('自动保存密码失败:', error);
    return { success: false, message: '自动保存失败: ' + (error instanceof Error ? error.message : '未知错误') };
  }
}

// ==================== LRU 收藏淘汰 ====================

/**
 * LRU 淘汰：当收藏数已达上限时，取消最近最少使用的收藏条目
 */
export async function evictLRUFavoriteIfNeeded(passwords: PasswordEntry[]): Promise<PasswordEntry | null> {
  try {
    const limit = await getFavoriteLimit();
    const favorites = passwords.filter(p => p.favorite);
    if (favorites.length < limit) return null;

    const lruEntry = favorites.reduce((oldest, cur) => {
      const oldestTs = oldest.favoriteUsedAt ?? 0;
      const curTs = cur.favoriteUsedAt ?? 0;
      return curTs < oldestTs ? cur : oldest;
    });

    lruEntry.favorite = false;
    lruEntry.favoriteUsedAt = undefined;
    await updatePassword(lruEntry.id, {
      favorite: false,
      favoriteUsedAt: undefined,
      updateTime: lruEntry.updateTime,
    });
    return lruEntry;
  } catch (error) {
    logger.error('LRU 收藏淘汰失败:', error);
    return null;
  }
}
