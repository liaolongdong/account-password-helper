import { type PasswordCache, type PasswordEntry, type MatchingAccountsResponse } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { isSessionValid, isSessionActiveSync } from '@/utils/sessionManager-storage';
import { getAllPasswords } from '@/utils/storage/passwordCrud';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';
import { filterAndSortEntriesForDomain, DEFAULT_SIDEPANEL_SORT, type SortState } from '@/utils/passwordSort';
import { fetchFaviconDataUrl } from '@/utils/favicon';
import { tl } from '@/utils/i18n-lite';

/** 模块级缓存状态（Service Worker 生命周期内有效） */
let passwordCache: PasswordCache | null = null;

/** 缓存有效期（毫秒），模块级缓存避免每次查询都读 storage */
let _cachedValidityMs: number | null = null;

/** 缓存的 sidepanel 排序配置（避免 GET_INITIAL_DATA 每次读取 storage） */
let _cachedSortConfig: { prop: string; order: string } | null | undefined = undefined;

/**
 * 缓存预热的 in-flight Promise（并发去重）
 *
 * 冷 SW 下 SIDEPANEL_PRELOAD(warmPasswordCache) 与 GET_INITIAL_DATA 冷分支可能并发触发，
 * 共享同一预热 Promise 可避免重复的全量 AES-GCM 解密（Windows 上开销明显）。
 */
let _warmInFlight: Promise<PasswordCache | null> | null = null;

/**
 * 缓存代次计数器（epoch）
 *
 * 每次 invalidatePasswordCache 递增。getOrWarmCache 在启动预热时捕获当时的 epoch，
 * 完成时若 epoch 已变（预热期间发生失效/并发写入），则丢弃结果不回填缓存，
 * 避免用过期数据毒化后续调用方。
 */
let _cacheEpoch = 0;

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
 * 缓存存储全量密码列表（域名无关），由 sidepanel 端做域名过滤
 * （filteredPasswords computed），因此无域名参数。
 */
export async function getCachedPasswords(): Promise<PasswordCache | null> {
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
  // 置空进行中的预热并递增 epoch：使已启动但未完成的 getOrWarmCache
  // 不再回填过期数据，新调用方发起 fresh read（消除并发写入期的缓存陈旧窗口）
  _warmInFlight = null;
  _cacheEpoch++;
  _cachedValidityMs = null;
  _cachedSortConfig = undefined;
  logger.debug('Background: 密码缓存已失效');
}

/**
 * 获取或预热密码缓存（并发去重的全量解密）
 *
 * 已有缓存时直接返回（不做 TTL 校验，TTL 语义由 getCachedPasswords 承担）；
 * 缓存缺失时执行「getAllPasswords() 全量解密 + updatePasswordCache」，并将进行中的
 * Promise 暂存于 _warmInFlight，使并发的 warmPasswordCache 与 GET_INITIAL_DATA 冷分支
 * 共享同一次解密，避免冷 SW 下重复的全量 AES-GCM 解密。
 *
 * 前置条件：调用方须已确认会话有效（isSessionValid/isSessionActiveSync）；
 * 会话无效时 getAllPasswords 会因无数据密钥而抛错，由调用方各自处理。
 *
 * @returns 预热后的密码缓存
 */
export async function getOrWarmCache(): Promise<PasswordCache | null> {
  // 已有缓存直接复用，避免无谓解密
  if (passwordCache) return passwordCache;

  // 复用进行中的预热，避免并发重复解密
  if (_warmInFlight) return _warmInFlight;

  // 捕获当前 epoch：若预热期间缓存被失效（并发写入），完成时据此丢弃过期结果
  const epoch = _cacheEpoch;
  _warmInFlight = (async () => {
    const [passwords, sortConfig] = await Promise.all([getAllPasswords(), getSidepanelSortConfig().catch(() => null)]);
    // 预热期间发生失效：不回填模块缓存（避免过期数据毒化后续调用方），
    // 但仍将本次读到的数据返回给当前 awaiter（至多一屏陈旧，随后 storage 变更会刷新）
    if (epoch !== _cacheEpoch) {
      return { passwords, domain: '*', timestamp: Date.now(), isAuthenticated: true } as PasswordCache;
    }
    updatePasswordCache(passwords, '*', true);
    _cachedSortConfig = sortConfig;
    return passwordCache;
  })().finally(() => {
    // 仅当仍属本次 epoch 时才置空，避免覆盖失效后由新调用方发起的预热
    if (epoch === _cacheEpoch) {
      _warmInFlight = null;
    }
  });

  return _warmInFlight;
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
    // 缓存已存在时直接返回
    if (passwordCache) return;

    // 快速路径：同步检查内存会话状态，避免每次冷启动都执行
    // isSessionValid() → storage.get() + HKDF 密钥派生（Windows ~40-80ms）。
    // SW 冷启动后模块变量为 null，isSessionActiveSync() 返回 false，
    // 此时回退到 isSessionValid() 从 storage 恢复会话并派生密钥。
    if (!isSessionActiveSync()) {
      const valid = await isSessionValid();
      if (!valid) return;
    }

    // 委托 getOrWarmCache 执行去重预热，避免与并发的 GET_INITIAL_DATA 冷分支重复解密
    await getOrWarmCache();
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

// ==================== 内联下拉/一键填充：域名匹配与条目查询 ====================

/**
 * 按域名过滤并按侧边栏展示顺序排序（带缓存排序配置读取）
 *
 * 在纯函数 filterAndSortEntriesForDomain 基础上叠加侧边栏排序配置的
 * 缓存读取，供 getMatchingAccounts（内联下拉）与 handleQuickFill（一键填充
 * 取首条）共用，保证两处的列表顺序与侧边栏完全一致。
 *
 * @param passwords 全量密码条目
 * @param domain 当前页面域名（hostname）
 * @returns 过滤并排序后的新数组（首条即侧边栏展示第一条）
 */
export async function sortMatchesForDomain(passwords: PasswordEntry[], domain: string): Promise<PasswordEntry[]> {
  const sortConfig = await getCachedSortConfig();
  const sortState: SortState = sortConfig
    ? { prop: sortConfig.prop, order: (sortConfig.order || null) as SortState['order'] }
    : DEFAULT_SIDEPANEL_SORT;
  return filterAndSortEntriesForDomain(passwords, domain, sortState);
}

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

  // 过滤 + 排序：与侧边栏 filteredPasswords 一致（含无 URL 条目），
  // 仅精确匹配完整 hostname，确保 fat/uat 等多测试环境账号严格隔离；
  // 复用 sortMatchesForDomain（侧边栏排序配置 + 域名优先 + 收藏置顶）
  const matched = await sortMatchesForDomain(cache.passwords, domain);

  // 并行附带网站图标 dataURL（本地 _favicon/ 端点 + 内存缓存，失败降级空串），
  // 避免将 _favicon/* 暴露为 web_accessible_resources 供网页直接加载
  const accounts = await Promise.all(
    matched.map(async p => ({
      id: p.id,
      title: (p.tag && p.tag.trim()) || (p.url && p.url.trim()) || p.username || tl('bg.cache.untitled'),
      username: p.username,
      tag: p.tag || '',
      remark: p.remark || '',
      url: p.url || '',
      favorite: !!p.favorite,
      hasTotp: !!(p.totp && p.totp.trim()),
      favicon: p.url ? await fetchFaviconDataUrl(p.url, 32) : '',
    })),
  );

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
