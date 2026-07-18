import { type PasswordCache, type PasswordEntry, type MatchingAccountsResponse } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { isSessionValid, isSessionActiveSync } from '@/utils/sessionManager-storage';
import { getAllPasswords } from '@/utils/storage/passwordCrud';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';
import { isLocalDevDomain } from '@/utils/domain';
import { sortPasswordEntries, DEFAULT_SIDEPANEL_SORT, type SortState } from '@/utils/passwordSort';

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
    // 缓存已存在且有效时直接返回
    if (passwordCache) return;

    // 快速路径：同步检查内存会话状态，避免每次冷启动都执行
    // isSessionValid() → storage.get() + HKDF 密钥派生（Windows ~40-80ms）。
    // SW 冷启动后模块变量为 null，isSessionActiveSync() 返回 false，
    // 此时回退到 isSessionValid() 从 storage 恢复会话并派生密钥。
    if (!isSessionActiveSync()) {
      const valid = await isSessionValid();
      if (!valid) return;
    }

    const [passwords, sortConfig] = await Promise.all([getAllPasswords(), getSidepanelSortConfig().catch(() => null)]);

    passwordCache = {
      passwords,
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

// ==================== 内联下拉：域名匹配与条目查询 ====================

/**
 * 确保缓存已就绪（会话有效时）
 *
 * 先取带 TTL 校验的缓存，未命中或未认证时触发一次预热后重取。
 * @returns 有效的密码缓存，会话无效/失败时返回 null
 */
async function ensureAuthenticatedCache(): Promise<PasswordCache | null> {
  let cache = await getCachedPasswords();
  if (!cache || !cache.isAuthenticated) {
    await warmPasswordCache();
    cache = await getCachedPasswords();
  }
  return cache && cache.isAuthenticated ? cache : null;
}

/**
 * 获取匹配当前域名的账号元数据（供内联下拉使用，绝不返回密码）
 *
 * 安全：会话锁定时返回 `{ locked: true, accounts: [] }`，不触碰任何凭证；
 * 匹配规则与侧边栏 filteredPasswords 一致（本地开发域名放行全部，否则纳入「URL 为空」或「域名与 url 双向包含」的条目）。
 * 排序：复用 sortPasswordEntries + 侧边栏排序配置 + 域名优先级 + 收藏置顶。
 *
 * @param domain 当前页面顶层域名（hostname）
 * @returns 锁定标记与匹配账号元数据列表
 */
export async function getMatchingAccounts(domain: string): Promise<MatchingAccountsResponse> {
  // 会话状态门禁：优先同步判断，未命中再异步校验
  if (!isSessionActiveSync()) {
    const valid = await isSessionValid();
    if (!valid) return { locked: true, accounts: [] };
  }

  const cache = await ensureAuthenticatedCache();
  if (!cache) return { locked: true, accounts: [] };

  const list = cache.passwords;
  // 过滤（与侧边栏 filteredPasswords 一致，含无 URL 条目）
  const matched = list.filter(p => {
    if (isLocalDevDomain(domain)) return true;
    if (!p.url || p.url.trim() === '') return true;
    return domain.includes(p.url) || p.url.includes(domain);
  });

  // 域名优先级（与侧边栏 getDomainPriority 一致）：0=匹配，1=不匹配
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!domain) return 0;
    const hasUrl = !!entry.url && entry.url.trim() !== '';
    if (hasUrl && (domain.includes(entry.url) || entry.url.includes(domain))) return 0;
    return 1;
  };

  // 排序：复用侧边栏排序配置 + 域名优先 + 收藏置顶
  const sortConfig = await getCachedSortConfig();
  const sortState: SortState = sortConfig
    ? { prop: sortConfig.prop, order: (sortConfig.order || null) as SortState['order'] }
    : DEFAULT_SIDEPANEL_SORT;
  sortPasswordEntries(matched, sortState, getDomainPriority);

  const accounts = matched.map(p => ({
    id: p.id,
    title: (p.tag && p.tag.trim()) || (p.url && p.url.trim()) || p.username || '未命名',
    username: p.username,
    tag: p.tag || '',
    remark: p.remark || '',
    url: p.url || '',
    favorite: !!p.favorite,
    hasTotp: !!(p.totp && p.totp.trim()),
  }));

  return { locked: false, accounts };
}

/**
 * 按条目 ID 获取解密后的完整条目（供 FILL_BY_ID 使用）
 *
 * 会话无效或条目不存在时返回 null，由调用方区分处理。
 * @param id 目标条目 ID
 * @returns 解密后的密码条目，或 null
 */
export async function getDecryptedEntryById(id: string): Promise<PasswordEntry | null> {
  if (!isSessionActiveSync()) {
    const valid = await isSessionValid();
    if (!valid) return null;
  }
  const cache = await ensureAuthenticatedCache();
  return cache?.passwords.find(p => p.id === id) ?? null;
}
