import { type PasswordCache, type PasswordEntry } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { isSessionValid } from '@/utils/sessionManager-storage';
import { getAllPasswordsRaw } from '@/utils/storage/passwordCrud';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';

/** 模块级缓存状态（Service Worker 生命周期内有效） */
let passwordCache: PasswordCache | null = null;

/** 缓存有效期（毫秒），模块级缓存避免每次查询都读 storage */
let _cachedValidityMs: number | null = null;

/** 缓存的 sidepanel 排序配置（避免 GET_INITIAL_DATA 每次读取 storage） */
let _cachedSortConfig: { prop: string; order: string } | null | undefined = undefined;

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
 *
 * 域名匹配策略（放宽）：缓存存储全量密码列表（域名无关），
 * 由 sidepanel 端做域名过滤（filteredPasswords computed），
 * 因此不再因域名不匹配而拒绝返回缓存。
 *
 * @param _requestedDomain 请求的域名（已忽略，保留参数兼容性）
 */
export async function getCachedPasswords(_requestedDomain?: string): Promise<PasswordCache | null> {
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
 * 同时重置 _cachedValidityMs 和排序配置缓存，确保配置变更后下次重新读取
 */
export function invalidatePasswordCache(): void {
  passwordCache = null;
  _cachedValidityMs = null;
  _cachedSortConfig = undefined;
  logger.debug('Background: 密码缓存已失效');
}

/**
 * 主动预热密码缓存
 *
 * 在 SIDEPANEL_PRELOAD 消息和 SW 启动时调用。
 * 当会话有效且缓存为空时，从 storage 读取全量密码列表写入缓存，
 * 同时预读取 sidepanel 排序配置。
 *
 * Windows 性能优化关键：确保 sidepanel 首次打开时 GET_INITIAL_DATA
 * 可以直接命中内存缓存（~1ms），而不是走 storage 读取路径（~100-300ms）。
 */
export async function warmPasswordCache(): Promise<void> {
  try {
    // 仅在会话有效且缓存为空时预热
    // 使用 isSessionValid()（异步）而非 isSessionActiveSync()（同步）：
    // SW 冷启动后模块级变量为 null，isSessionActiveSync() 永远返回 false，
    // 导致缓存预热成为空操作，首次 GET_INITIAL_DATA 始终走冷路径
    if (passwordCache) return;
    const valid = await isSessionValid();
    if (!valid) return;

    const [passwords, sortConfig] = await Promise.all([
      getAllPasswordsRaw(),
      getSidepanelSortConfig().catch(() => null),
    ]);

    passwordCache = {
      passwords: passwords as PasswordEntry[],
      domain: '*', // 全域名可用标记
      timestamp: Date.now(),
      isAuthenticated: true,
    };
    _cachedSortConfig = sortConfig;

    logger.debug('Background: 密码缓存已预热，条目数:' + passwords.length);
  } catch (error) {
    logger.error('Background: 预热密码缓存失败:', error);
  }
}

/**
 * 获取缓存的排序配置
 *
 * 优先返回内存缓存，缓存未命中时从 storage 读取并缓存。
 * 供 GET_INITIAL_DATA 使用，避免每次请求都读取 storage。
 *
 * @returns sidepanel 排序配置，获取失败时返回 null
 */
export async function getCachedSortConfig(): Promise<{ prop: string; order: string } | null> {
  if (_cachedSortConfig !== undefined) return _cachedSortConfig;

  const config = await getSidepanelSortConfig().catch(() => null);
  _cachedSortConfig = config;
  return config;
}
