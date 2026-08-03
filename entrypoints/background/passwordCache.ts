import { type PasswordCache, type PasswordEntry, type MatchingAccountsResponse } from '@/utils/types';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { isSessionValid, isSessionActiveSync, getSessionDataKey } from '@/utils/sessionManager-storage';
import { getAllPasswords, METADATA_FLUSH_MARK_TTL_MS } from '@/utils/storage/passwordCrud';
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
 * 将密码缓存加密快照持久化到 storage.session（尽力而为，fire-and-forget）
 *
 * 快照内容：{ passwords, sortConfig, timestamp } JSON 经 AES-GCM 加密（Base64 编码），
 * 加密密钥为 storage.session 中的会话数据密钥（session_data_key）。
 * 侧边栏冷启动时可直读解密（纯内存 IPC + 单次 AES-GCM），跳过 SW 唤醒 +
 * storage.local 磁盘 IO + 逐条解密，将数据加载从 200-3000ms 压缩至 <50ms。
 *
 * 安全：快照与 at-rest 加密共用密钥体系；storage.session 仅内存、TRUSTED_CONTEXTS 访问，
 * 内容脚本不可读；浏览器关闭即清。
 *
 * 并发安全：捕获调用时的 _cacheEpoch，写入前校验 epoch 未变——
 * 若加密期间发生 invalidatePasswordCache（epoch 递增），丢弃本次写入，
 * 防止陈旧快照覆盖 clearCacheSnapshot 的清除操作。
 *
 * @param cache 当前密码缓存
 * @param sortConfig 侧边栏排序配置（可为 null）
 */
async function persistCacheSnapshot(
  cache: PasswordCache,
  sortConfig: { prop: string; order: string } | null,
): Promise<void> {
  const epoch = _cacheEpoch;
  try {
    const dataKey = await getSessionDataKey();
    if (!dataKey) return;
    const { encryptData } = await import('@/utils/encryption');
    const payload = JSON.stringify({
      passwords: cache.passwords,
      sortConfig,
      timestamp: cache.timestamp,
    });
    const encrypted = await encryptData(payload, dataKey);
    // epoch 守卫：加密期间若发生失效（invalidatePasswordCache 递增 epoch），
    // 丢弃本次写入，避免陈旧快照覆盖 clearCacheSnapshot 的清除
    if (epoch !== _cacheEpoch) return;
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.PASSWORD_CACHE_SNAPSHOT]: encrypted,
    });
    logger.debug('Background: 密码缓存快照已持久化到 storage.session，条目数:' + cache.passwords.length);
  } catch (error) {
    // 快照持久化为尽力而为的优化，失败不影响主流程
    logger.debug('Background: 快照持久化跳过（尽力而为）:', error);
  }
}

/**
 * 清除 storage.session 中的密码缓存快照（fire-and-forget）
 *
 * 在缓存失效（invalidatePasswordCache）时调用，确保侧边栏不会读到过期快照。
 */
function clearCacheSnapshot(): void {
  try {
    void chrome.storage.session.remove(SESSION_MEMORY_KEYS.PASSWORD_CACHE_SNAPSHOT).catch(() => {});
  } catch {
    // 静默忽略
  }
}

/**
 * 以失效前捕获的内存明文重建快照并覆盖写入（替代「先删后建」）
 *
 * 直接复用失效前的明文缓存做单次 AES-GCM 加密 + session.set 覆盖，
 * 跳过全量解密且快照无缺失时刻；无可用明文（缓存本就缺失）时降级为删除旧快照。
 * 排序配置始终从 storage 读新值（失效往往正是配置变更触发，旧缓存已陈旧）。
 * epoch 守卫沿用 persistCacheSnapshot 内部机制：重建期间再次失效则丢弃写入。
 *
 * 注意：仅适用于密码数据未变的路径（如排序配置变更）；数据变更场景的
 * 内存缓存已陈旧，必须走删除 + 回温，禁止用本函数覆盖写入旧数据。
 *
 * @param oldCache 失效前捕获的密码缓存（可为 null）
 */
async function rebuildSnapshotFromCaptured(oldCache: PasswordCache | null): Promise<void> {
  if (!oldCache || !oldCache.isAuthenticated) {
    clearCacheSnapshot();
    return;
  }
  const sortConfig = await getSidepanelSortConfig().catch(() => null);
  await persistCacheSnapshot(oldCache, sortConfig);
}

/**
 * 元数据类 PASSWORDS 变更的原地修补（方案 A）
 *
 * 使用痕迹落盘（lastUsedAt/favoriteUsedAt 等防抖批量写）只改非敏感元数据，
 * 无需走「全量失效→清快照→全量解密回温」重链：SW 内存缓存与快照本就持有明文，
 * 直接 patch 对应条目字段后用内存明文重加密快照覆盖写入，全程无快照缺失时刻、
 * 零全量解密，消除内联/侧边栏填充后重开侧边栏白屏变长问题。
 *
 * @param changedEntries 本次写入后的全量条目（非敏感元数据字段为明文可读）
 * @returns true 表示修补成功（缓存与快照已同步）；false 表示内存缓存缺失，
 *   调用方需回退到常规失效回温路径
 */
export async function applyMetadataOnlyUpdate(changedEntries: unknown): Promise<boolean> {
  if (!passwordCache || !passwordCache.isAuthenticated || !Array.isArray(changedEntries)) {
    return false;
  }

  // 仅同步非敏感元数据字段；敏感字段在 at-rest 条目中为密文，绝不能拷入明文缓存
  const METADATA_FIELDS = ['favorite', 'favoriteUsedAt', 'lastUsedAt', 'updateTime', 'tag', 'order'] as const;
  const changedById = new Map<string, Partial<PasswordEntry>>();
  for (const entry of changedEntries as Array<{ id?: string }>) {
    if (!entry?.id) continue;
    const patch: Partial<PasswordEntry> = {};
    for (const field of METADATA_FIELDS) {
      const value = (entry as Record<string, unknown>)[field];
      if (value !== undefined) {
        (patch as Record<string, unknown>)[field] = value;
      }
    }
    changedById.set(entry.id, patch);
  }
  for (const cached of passwordCache.passwords) {
    const patch = changedById.get(cached.id);
    if (patch) Object.assign(cached, patch);
  }

  // 用修补后的内存明文重加密快照覆盖写入（epoch 守卫由 persistCacheSnapshot 内部保障）；
  // 排序配置缓存缺失时（SW 冷启动边缘）从 storage 读新值，避免快照内嵌陈旧/空配置
  const sortConfig =
    _cachedSortConfig !== undefined ? _cachedSortConfig : await getSidepanelSortConfig().catch(() => null);
  await persistCacheSnapshot(passwordCache, sortConfig);
  return true;
}

/**
 * 消费元数据 flush 打标（storage.session，短 TTL）
 *
 * flushMetadataUpdates 写入 account_passwords 前打标，本函数在 storage.onChanged
 * 中消费：命中（未超期）即移除并返回 true，调用方据此走原地修补路径而非全量失效。
 * 超期未消费的残留标记视为无效（防止误判后续真实数据变更为元数据类）。
 *
 * @returns true 表示本次 PASSWORDS 变更为元数据防抖 flush 所致
 */
export async function consumeMetadataFlushMarker(): Promise<boolean> {
  try {
    const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.METADATA_FLUSH_AT);
    const markedAt = result[SESSION_MEMORY_KEYS.METADATA_FLUSH_AT] as number | undefined;
    if (!markedAt || Date.now() - markedAt > METADATA_FLUSH_MARK_TTL_MS) return false;
    void chrome.storage.session.remove(SESSION_MEMORY_KEYS.METADATA_FLUSH_AT).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** 允许原地修补的非敏感元数据字段（与 flushMetadataUpdates 可写字段集一致） */
const METADATA_ONLY_FIELDS = new Set(['favorite', 'favoriteUsedAt', 'lastUsedAt', 'updateTime', 'tag', 'order']);

/**
 * 基于内容校验本次 PASSWORDS 变更是否「仅元数据」（与打标互为双重保险）
 *
 * 打标只能证明「有过 flush」，无法证明「本次变更仅元数据」（标记残留/
 * 双消费竞态场景）。本函数逐条对比 oldValue/newValue：长度与 id 序列对齐
 * （捕获增删），除白名单字段外无任何差异（捕获敏感字段编辑）才返回 true，
 * 确保误判场景回退全量失效，不会把真实数据变更当作元数据 patch 掉。
 *
 * @param oldValue 变更前全量条目
 * @param newValue 变更后全量条目
 * @returns true 表示确认为仅元数据变更
 */
export function isMetadataOnlyChange(oldValue: unknown, newValue: unknown): boolean {
  if (!Array.isArray(oldValue) || !Array.isArray(newValue) || oldValue.length !== newValue.length) {
    return false;
  }
  for (let i = 0; i < newValue.length; i++) {
    const oldEntry = oldValue[i] as Record<string, unknown> | undefined;
    const newEntry = newValue[i] as Record<string, unknown> | undefined;
    if (!oldEntry || !newEntry || oldEntry.id !== newEntry.id) return false;
    const keys = new Set([...Object.keys(oldEntry), ...Object.keys(newEntry)]);
    for (const key of keys) {
      if (oldEntry[key] !== newEntry[key] && !METADATA_ONLY_FIELDS.has(key)) return false;
    }
  }
  return true;
}

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
 *
 * 同时触发加密快照持久化到 storage.session（fire-and-forget），
 * 使侧边栏冷启动时可直读快照而无需等待 SW 唤醒。
 */
export function updatePasswordCache(passwords: PasswordEntry[], domain: string, isAuthenticated: boolean): void {
  passwordCache = {
    passwords,
    domain,
    timestamp: Date.now(),
    isAuthenticated,
  };
  logger.debug('Background: 密码缓存已更新，条目数:' + passwords.length + ' 域名:' + domain);
  // 尽力而为持久化加密快照（不阻塞主流程）
  if (isAuthenticated) {
    void persistCacheSnapshot(passwordCache, _cachedSortConfig ?? null);
  }
}

/**
 * 使密码缓存失效
 * 同时重置 _cachedValidityMs 和排序配置缓存，确保配置变更后下次重新读取。
 *
 * 快照处理策略（keepSnapshotForRebuild）：
 * - false（默认，锁定/会话清除等安全路径）：立即删除快照，fail-locked；
 * - true（数据/排序配置变更路径）：捕获失效前的内存明文，后台覆盖式重建快照
 *   替代「先删后建」，快照无缺失时刻，避免下一次打开侧边栏击穿直读快路径；
 *   无明文可用时降级为删除（与旧行为一致）。
 */
export function invalidatePasswordCache(keepSnapshotForRebuild = false): void {
  const oldCache = passwordCache;
  passwordCache = null;
  // 置空进行中的预热并递增 epoch：使已启动但未完成的 getOrWarmCache
  // 不再回填过期数据，新调用方发起 fresh read（消除并发写入期的缓存陈旧窗口）
  _warmInFlight = null;
  _cacheEpoch++;
  _cachedValidityMs = null;
  _cachedSortConfig = undefined;
  if (keepSnapshotForRebuild) {
    // 覆盖式重建（尽力而为，仅适用于密码数据未变的路径如排序配置变更）：
    // 新快照就绪前旧快照仍可安全服务；重建失败/无明文时降级为删除，由 TTL 兜底防陈旧
    void rebuildSnapshotFromCaptured(oldCache).catch(() => clearCacheSnapshot());
  } else {
    // 同步清除 storage.session 加密快照（fire-and-forget）
    clearCacheSnapshot();
  }
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
    // 先设置排序配置缓存，再更新密码缓存（updatePasswordCache 内部触发快照持久化，
    // 需要 _cachedSortConfig 已就绪以写入正确的排序配置）
    _cachedSortConfig = sortConfig;
    updatePasswordCache(passwords, '*', true);
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
