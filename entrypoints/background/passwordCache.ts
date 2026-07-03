import { type PasswordCache, type PasswordEntry } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/** 模块级缓存状态（Service Worker 生命周期内有效） */
let passwordCache: PasswordCache | null = null;

/** 缓存有效期（毫秒），模块级缓存避免每次查询都读 storage */
let _cachedValidityMs: number | null = null;

/**
 * 获取缓存有效期（毫秒）
 * 与主密码会话有效期保持一致
 * 结果在 SW 生命周期内缓存，配置变更时随 invalidatePasswordCache 一起重置
 */
async function getCacheValidityMs(): Promise<number> {
  if (_cachedValidityMs !== null) return _cachedValidityMs;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD_VALIDITY);
    const validityHours = (result[STORAGE_KEYS.MASTER_PASSWORD_VALIDITY] as number | undefined) || 24;
    _cachedValidityMs = validityHours * 60 * 60 * 1000;
    return _cachedValidityMs;
  } catch (error) {
    logger.error('Background: 获取缓存有效期失败:', error);
    return 24 * 60 * 60 * 1000;
  }
}

/**
 * 获取缓存的密码数据
 * @param requestedDomain 请求的域名，用于检查缓存是否匹配
 */
export async function getCachedPasswords(requestedDomain?: string): Promise<PasswordCache | null> {
  if (!passwordCache) {
    return null;
  }

  const cacheValidityMs = await getCacheValidityMs();

  const now = Date.now();
  if (now - passwordCache.timestamp > cacheValidityMs) {
    logger.debug('Background: 密码缓存已过期');
    passwordCache = null;
    return null;
  }

  if (requestedDomain && passwordCache.domain !== requestedDomain) {
    logger.debug('Background: 缓存域名不匹配，需要重新加载');
    return null;
  }

  logger.debug('Background: 返回缓存数据，条目数:' + passwordCache.passwords.length);
  return passwordCache;
}

/**
 * 更新密码缓存
 */
export function updatePasswordCache(passwords: PasswordEntry[], domain: string, isAuthenticated: boolean): void {
  passwordCache = {
    passwords,
    domain,
    timestamp: Date.now(),
    isAuthenticated,
  };
  logger.debug('Background: 密码缓存已更新，条目数:' + passwords.length + ' 域名:' + domain);
}

/**
 * 使密码缓存失效
 * 同时重置 _cachedValidityMs，确保配置变更后下次重新读取
 */
export function invalidatePasswordCache(): void {
  passwordCache = null;
  _cachedValidityMs = null;
  logger.debug('Background: 密码缓存已失效');
}
