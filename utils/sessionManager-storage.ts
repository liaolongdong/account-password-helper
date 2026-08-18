import type { PasswordEntry, MasterPasswordConfig, EncryptedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { lazyImport } from '@/utils/lazyImport';
import { bytesToHex } from '@/utils/crypto-light';
import {
  recoverBrowserStartupRelockAfterAuthentication,
  waitForBrowserStartupRelockBeforeAuthentication,
} from '@/utils/browserStartupRelock';

/**
 * 延迟加载加密模块
 *
 * 页面上下文（sidepanel/options）中该拆分真实生效：encryption.ts 不进入
 * 首屏 chunk，锁屏路径无需加载加密链。注：SW 产物被 WXT 内联为单文件
 * （MV3 SW 禁止运行期动态加载），懒加载在 SW 中仅延迟模块初始化执行，
 * 不减少冷启动解析/编译量。
 *
 * 所有加密函数调用均在 async 函数内部，使用动态 import 按需加载。
 * 模块系统自动去重：多次 import('@/utils/encryption') 返回同一实例。
 */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/**
 * 会话存储键名
 */
export const SESSION_STORAGE_KEYS = {
  /**
   * 旧版遗留键：曾存放「被 salt 派生密钥包裹的主密码密文」。
   * 现已废弃——主密码不再落盘；仅用于向后兼容迁移与清理。
   */
  MASTER_PASSWORD: 'session_master_password',
  /** 会话期数据密钥的密文（被随机包裹密钥 WRAP_KEY 加密），主密码不再落盘 */
  WRAPPED_DATA_KEY: 'session_wrapped_data_key',
  /** 随机包裹密钥（hex），与 WRAPPED_DATA_KEY 原子性同写，用于加解密数据密钥 */
  WRAP_KEY: 'session_wrap_key',
  PASSWORD_EXPIRY: 'session_password_expiry',
  VALIDITY_HOURS: 'session_validity_hours',
  /** 旧版遗留键（曾用于标记明文解密状态）；现已废弃，仅在 clearSession 时一并清理 */
  PASSWORDS_DECRYPTED: 'session_passwords_decrypted',
};

// 会话状态管理变量
/** 会话期数据密钥的密文镜像（storage.local 中 WRAPPED_DATA_KEY 的内存副本；主密码绝不落盘） */
let sessionWrappedDataKey: string | null = null;
let sessionPasswordExpiry: number | null = null;
let sessionValidityHours: number | null = null;
/** 会话期派生的数据加密密钥（hex）；SW 内存热缓存，与 storage.session 互为镜像 */
let sessionDataKey: string | null = null;

/** 标记 at-rest 密文化（明文→密文迁移）是否已在本 SW 生命周期内完成 */
let _encryptAtRestDone = false;
/** at-rest 密文化正在执行中的去重标志，避免并发重复执行 */
let _encryptAtRestInFlight = false;
/** getSessionDataKey level-3 解包（AES-GCM）的 in-flight 去重锁，避免冷启动并发重复解包 */
let _dataKeyDerivingPromise: Promise<string | null> | null = null;
/** 是否为 Service Worker 后台上下文（用于门控 at-rest 迁移仅在后台触发） */
const _isBackgroundContext = typeof window === 'undefined';

/**
 * clearSession() 进行中的 Promise（同一上下文内去重）
 *
 * 过期检测（isSessionValid）、缓存预热（warmPasswordCache）、
 * INVALIDATE_PASSWORD_CACHE 等多个入口可能在短时间内并发触发 clearSession()，
 * 复用同一次执行可避免并发重复的 storage 读写与状态清理竞争。
 */
let _clearSessionInFlight: Promise<void> | null = null;

/**
 * isSessionValid() 结果缓存
 *
 * 避免同一 sidepanel 生命周期内重复执行 storage 读取（Windows ~40-80ms）。
 * TTL 5 秒：会话状态不会在 5 秒内变化（除非 createSession/clearSession 被调用），
 * 而这两个操作会主动调用 invalidateSessionCache() 清除缓存。
 */
let _sessionValidCache: { valid: boolean; timestamp: number } | null = null;
const SESSION_VALID_CACHE_TTL = 5000;

/**
 * 清除会话验证结果缓存
 *
 * 在 createSession()、clearSession() 以及 storage change 监听中调用，
 * 确保缓存不会返回过期的会话状态。
 */
export function invalidateSessionCache(): void {
  _sessionValidCache = null;
}

/**
 * 立即将会话验证结果标记为无效
 *
 * 与 invalidateSessionCache()（设为 null，下次 isSessionValid 需重新检查 storage）不同，
 * 此函数直接将缓存设为 { valid: false }，使后续的 isSessionValid() 调用在 TTL 窗口内
 * 立即返回 false，无需等待异步的 clearSession() 完成 storage 键删除。
 *
 * 在 INVALIDATE_PASSWORD_CACHE 消息处理器中调用，用于消除 async clearSession() 与
 * 并发 GET_INITIAL_DATA 之间的竞态窗口（~100-200ms）。
 *
 * 同时 fire-and-forget 更新 storage.session 锁定状态镜像，使侧边栏的
 * isSessionQuicklyKnownInvalid() 可通过纯内存 IPC 立即感知锁定，
 * 无需等待慢速 storage.local 磁盘读取（Windows 内网冷盘场景优化）。
 */
export function markSessionInvalid(): void {
  _sessionValidCache = { valid: false, timestamp: Date.now() };
  // 更新 storage.session 锁定镜像（fire-and-forget，不阻塞锁定流程）
  try {
    void chrome.storage.session.set({ [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: true } }).catch(() => {});
  } catch {
    // storage.session 不可用时静默忽略
  }
}

/**
 * 同步检查会话是否有效（仅检查内存状态，不从存储恢复）
 */
export function isSessionActiveSync(): boolean {
  if (!sessionWrappedDataKey || !sessionPasswordExpiry) {
    return false;
  }
  return Date.now() < sessionPasswordExpiry;
}

/**
 * 检查会话是否有效
 * 增强：会话恢复后确保 storage.local 中数据均为密文（at-rest 不变量）
 *
 * 性能优化：内置 5 秒 TTL 结果缓存，避免重复的 storage 读取
 * （Windows ~40-80ms，Mac ~10-20ms）。会话创建/清除时缓存自动失效。
 *
 * @param options.skipConsistencyCheck 跳过 at-rest 密文化检查（sidepanel 热路径使用，
 *   后续 getAllPasswords 会自行按需解密，无需在此阻塞）
 */
export async function isSessionValid(options?: { skipConsistencyCheck?: boolean }): Promise<boolean> {
  // 检查缓存：5 秒内的结果直接返回，避免重复的 storage IPC 开销
  if (_sessionValidCache && Date.now() - _sessionValidCache.timestamp < SESSION_VALID_CACHE_TTL) {
    return _sessionValidCache.valid;
  }

  try {
    if (!sessionWrappedDataKey || !sessionPasswordExpiry) {
      // 批量读取会话键（含 VALIDITY_HOURS，确保迁移/恢复时正确记录有效期）；
      // 附带旧版 MASTER_PASSWORD 以支持升级迁移。单次 get，读取键数量对性能无实质影响。
      const keysToRead = [
        SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
        SESSION_STORAGE_KEYS.VALIDITY_HOURS,
        SESSION_STORAGE_KEYS.MASTER_PASSWORD,
      ];
      const _perfStorageStart = performance.now();
      const result = await chrome.storage.local.get(keysToRead);
      logger.debug(
        `isSessionValid: storage.get(${keysToRead.length} keys) ${(performance.now() - _perfStorageStart).toFixed(1)}ms`,
      );

      if (result[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
        // 新格式会话：仅记录内存镜像，数据密钥在 getSessionDataKey 中按需惰性解包
        sessionWrappedDataKey = result[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY] as string | null;
        sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | null;
        sessionValidityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;

        // at-rest 不变量维护：仅在「非 skip 路径 + 后台上下文」触发，fire-and-forget 不阻塞热路径
        if (!options?.skipConsistencyCheck && _isBackgroundContext) {
          void ensurePasswordsEncryptedAtRest();
        }
      } else if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
        // 旧版会话：透明迁移为新格式（主密码不再落盘），不强制用户重新登录
        const expiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number;
        const validityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
        const migrated = await _migrateLegacySession(expiry, validityHours);
        if (!migrated) {
          _sessionValidCache = { valid: false, timestamp: Date.now() };
          return false;
        }
        if (!options?.skipConsistencyCheck && _isBackgroundContext) {
          void ensurePasswordsEncryptedAtRest();
        }
      } else {
        _sessionValidCache = { valid: false, timestamp: Date.now() };
        return false;
      }
    }

    const now = Date.now();
    if (sessionPasswordExpiry !== null && now >= sessionPasswordExpiry) {
      // 先写缓存并立即返回 false，将 clearSession() 改为 fire-and-forget 后台执行，
      // 避免阻塞侧边栏首屏渲染与 SW 消息处理。
      _sessionValidCache = { valid: false, timestamp: Date.now() };
      void clearSession();
      return false;
    }

    _sessionValidCache = { valid: true, timestamp: Date.now() };
    return true;
  } catch (error) {
    logger.error('会话验证失败:', error);
    // 异常路径同样不阻塞：先写缓存返回 false，清理异步执行
    _sessionValidCache = { valid: false, timestamp: Date.now() };
    void clearSession();
    return false;
  }
}

/**
 * 获取会话期数据加密密钥（hex）
 *
 * 三级回退：SW 内存热缓存 → storage.session（跨上下文、活过 SW 终止）→
 * 由持久化的包裹数据密钥解包（AES-GCM，仅在缓存缺失/浏览器重启后执行一次）并回填两级缓存。
 *
 * 注意：不独立校验会话是否过期，调用方须先经过 isSessionValid 门禁。
 * @returns 数据密钥 hex；无法获取（无有效会话）时返回 null
 */
export async function getSessionDataKey(): Promise<string | null> {
  // 1. SW 内存热缓存
  if (sessionDataKey) return sessionDataKey;

  // 2. storage.session（仅内存，跨上下文共享，活过 SW 终止）
  try {
    const r = await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY);
    const cached = r[SESSION_MEMORY_KEYS.DATA_KEY] as string | undefined;
    if (cached) {
      sessionDataKey = cached;
      return cached;
    }
  } catch {
    // storage.session 不可用时静默回退到解包路径
  }

  // 3. 兜底：从持久化的包裹数据密钥解包（AES-GCM，冷启动/浏览器重启后一次）。
  // 用模块级 in-flight 去重，避免冷启动并发重复解包。
  if (_dataKeyDerivingPromise) return _dataKeyDerivingPromise;
  _dataKeyDerivingPromise = _unwrapDataKeyFromStorage().finally(() => {
    _dataKeyDerivingPromise = null;
  });
  return _dataKeyDerivingPromise;
}

/**
 * 从持久化的包裹数据密钥解包出数据密钥（AES-GCM）并回填两级缓存。
 * 仅由 getSessionDataKey 的三级回退在缓存缺失时调用，外层已用 in-flight 锁去重。
 * @returns 数据密钥 hex；无有效会话（无包裹密钥）时返回 null
 */
async function _unwrapDataKeyFromStorage(): Promise<string | null> {
  // 从存储读取「包裹密钥 + 密文数据密钥」（同一快照，保证配对一致）。
  // 二者由 persistWrappedDataKey 原子性同写，单次 get 取得的必然是匹配的一对，
  // 因此即便升级迁移期多个上下文并发写入不同的随机包裹密钥，也不会解包失败。
  let snap = await chrome.storage.local.get([SESSION_STORAGE_KEYS.WRAP_KEY, SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]);

  // 新格式密文缺失：尝试从存储恢复会话（含旧版透明迁移），迁移路径会直接派生并缓存数据密钥
  if (!snap[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]) {
    await restoreSessionFromStorage();
    if (sessionDataKey) return sessionDataKey;
    snap = await chrome.storage.local.get([SESSION_STORAGE_KEYS.WRAP_KEY, SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]);
  }

  const wrapped = snap[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY] as string | undefined;
  const wrapKey = snap[SESSION_STORAGE_KEYS.WRAP_KEY] as string | undefined;
  if (!wrapped || !wrapKey) return null;

  try {
    const enc = await _getEncryption();
    const key = await enc.decryptData(wrapped, wrapKey);
    sessionWrappedDataKey = wrapped;
    sessionDataKey = key;
    try {
      await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: key });
    } catch {
      // 回填失败不影响本次返回
    }
    return key;
  } catch (error) {
    logger.error('解包会话数据密钥失败:', error);
    return null;
  }
}

/**
 * 生成随机包裹密钥并加密数据密钥，二者原子性同写 storage.local。
 *
 * WRAP_KEY 与 WRAPPED_DATA_KEY 必须在同一次 set 中写入：即使多个上下文
 * （后台/选项页/侧边栏）在升级迁移期并发写入，最终落盘的也始终是一对匹配值，
 * 避免「keyA 的包裹密钥 + keyB 的密文」错配导致无法解包。
 *
 * @param dataKey 会话期数据密钥（hex）
 * @param extra 需与密钥对一并写入的其它会话键值（过期时间/有效期）
 * @returns 包裹后的数据密钥密文
 */
async function persistWrappedDataKey(dataKey: string, extra?: Record<string, unknown>): Promise<string> {
  const enc = await _getEncryption();
  const wrapKey = await generateSessionEncryptionKey();
  const wrapped = await enc.encryptData(dataKey, wrapKey);
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEYS.WRAP_KEY]: wrapKey,
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: wrapped,
    ...(extra ?? {}),
  });
  return wrapped;
}

/**
 * 将旧版会话（session_master_password）透明迁移为包裹数据密钥格式。
 *
 * 旧版把「被 salt 派生密钥包裹的主密码」落盘；升级后首次会话恢复时透明迁移为
 * 「被随机包裹密钥加密的数据密钥」，主密码不再落盘，且不强制用户重新登录。
 * 数据密钥由主密码确定性派生，因此多个上下文并发迁移得到同一数据密钥；
 * 包裹密钥对经 persistWrappedDataKey 原子性同写，最终状态始终一致。
 *
 * @returns 迁移成功返回 true；无法解出旧版主密码时返回 false
 */
async function _migrateLegacySession(expiry: number, validityHours: number): Promise<boolean> {
  const masterPassword = await getSessionMasterPasswordDecrypted();
  if (!masterPassword) return false;

  const enc = await _getEncryption();
  const dataKey = await enc.deriveEncryptionKey(masterPassword);

  sessionDataKey = dataKey;
  sessionPasswordExpiry = expiry;
  sessionValidityHours = validityHours;
  try {
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: dataKey });
  } catch {
    // storage.session 不可用时忽略，下次按需重新解包
  }
  sessionWrappedDataKey = await persistWrappedDataKey(dataKey);
  await chrome.storage.local.remove(SESSION_STORAGE_KEYS.MASTER_PASSWORD);
  // 迁移成功后同步更新锁定状态镜像，与 createSession 路径语义保持一致
  try {
    void chrome.storage.session
      .set({ [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: false, expiresAt: expiry } })
      .catch(() => {});
  } catch {
    // storage.session 不可用时忽略
  }
  logger.debug('已将旧版会话迁移为包裹数据密钥格式（主密码不再落盘）');
  return true;
}

/**
 * 确保 storage.local 中所有密码条目均为密文（at-rest 不变量，严重-1）
 *
 * 覆盖两类场景：
 * - 旧版本升级：升级前会话活跃时磁盘残留明文，需一次性加密。
 * - 新条目落盘前的兜底。
 *
 * 幂等且 SW 生命周期内仅有效执行一次（_encryptAtRestDone）；逐条失败不丢弃，
 * 无法获取密钥时不置完成标志，留待下次重试。
 *
 * @param masterPassword 可选，显式主密码（登录流程传入）；缺省时用会话数据密钥
 */
async function ensurePasswordsEncryptedAtRest(masterPassword?: string): Promise<void> {
  if (_encryptAtRestDone || _encryptAtRestInFlight) return;
  _encryptAtRestInFlight = true;
  try {
    const isEncrypted = (e: PasswordEntry | EncryptedPasswordEntry): boolean =>
      'encrypted' in e && (e as EncryptedPasswordEntry).encrypted === true;

    const snapshot: (PasswordEntry | EncryptedPasswordEntry)[] =
      ((await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS))[STORAGE_KEYS.PASSWORDS] as
        | (PasswordEntry | EncryptedPasswordEntry)[]
        | undefined) || [];
    if (snapshot.length === 0) {
      _encryptAtRestDone = true;
      return;
    }
    if (!snapshot.some(e => !isEncrypted(e))) {
      _encryptAtRestDone = true;
      return;
    }

    const enc = await _getEncryption();
    const key = masterPassword ? await enc.deriveEncryptionKey(masterPassword) : await getSessionDataKey();
    if (!key) {
      // 无法获取密钥（无有效会话），不置完成标志，留待下次触发时重试
      return;
    }

    // 预先加密快照中的明文条目，并记录其 updateTime 以便检测并发修改
    const encById = new Map<string, { enc: EncryptedPasswordEntry; updateTime?: number }>();
    for (const e of snapshot) {
      if (!isEncrypted(e)) {
        const plain = e as PasswordEntry;
        encById.set(plain.id, {
          enc: await enc.encryptPasswordEntry(plain, '', key),
          updateTime: plain.updateTime,
        });
      }
    }

    // 重新读取最新快照，仅替换「仍为明文且自快照以来未被并发修改」的条目，
    // 并发新增/修改/删除的条目原样保留，彻底避免与并发写入互相覆盖导致数据丢失。
    const latest: (PasswordEntry | EncryptedPasswordEntry)[] =
      ((await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS))[STORAGE_KEYS.PASSWORDS] as
        | (PasswordEntry | EncryptedPasswordEntry)[]
        | undefined) || [];
    let changed = false;
    const out = latest.map(e => {
      if (isEncrypted(e)) return e;
      const m = encById.get(e.id);
      if (m && (e as PasswordEntry).updateTime === m.updateTime) {
        changed = true;
        return m.enc;
      }
      return e; // 并发新增/修改的明文条目：保留，交由下一轮迁移处理
    });

    if (changed) {
      await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORDS]: out });
    }
    // 仅当最新快照中已无明文时才标记完成，否则留待下次触发继续迁移
    if (!out.some(e => !isEncrypted(e))) {
      _encryptAtRestDone = true;
      logger.debug('at-rest 不变量已满足：storage.local 中所有密码条目均为密文');
    }
  } catch (error) {
    logger.error('确保密码密文落盘失败:', error);
  } finally {
    _encryptAtRestInFlight = false;
  }
}

/**
 * 后台安全网：请求重新执行一次 at-rest 密文化。
 *
 * 用于旧版升级期：某上下文的并发 CRUD 写入可能把尚未迁移的明文条目重新写回
 * storage.local；后台 storage 监听检测到明文残留时调用本函数，重置完成标志并
 * 重跑一次密文化，使明文再落盘窗口尽快自愈，而不必等待下次 SW 重启。
 *
 * 幂等：稳态全密文时 ensurePasswordsEncryptedAtRest 会快速返回；迁移写回全密文后
 * 不再检测到明文，不会形成循环。
 */
export function requestReEncryptAtRest(): void {
  _encryptAtRestDone = false;
  void ensurePasswordsEncryptedAtRest();
}

/**
 * 获取会话主密码（解密后）
 *
 * 注意：主密码不再随会话持久化。仅当存在旧版遗留 blob（session_master_password）时
 * 尽力解出，用于一次性升级迁移；否则返回 null。
 */
export async function getSessionMasterPasswordDecrypted(): Promise<string | null> {
  try {
    const r = await chrome.storage.local.get([SESSION_STORAGE_KEYS.MASTER_PASSWORD, STORAGE_KEYS.MASTER_PASSWORD]);
    const legacy = r[SESSION_STORAGE_KEYS.MASTER_PASSWORD] as string | undefined;
    const config = r[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;
    if (!legacy || !config?.salt) return null;
    const enc = await _getEncryption();
    const legacyWrapKey = await enc.deriveSessionKey(config.salt);
    return await enc.decryptData(legacy, legacyWrapKey);
  } catch (error) {
    logger.error('解密会话主密码失败:', error);
    return null;
  }
}

/**
 * 创建会话缓存
 *
 * 派生数据密钥后仅将其「随机包裹密文」落盘（主密码绝不落盘）；
 * 数据密钥另存 storage.session（仅内存，活过 SW 终止）。
 */
export async function createSession(masterPassword: string, validityHours: number): Promise<void> {
  try {
    if (!(await waitForBrowserStartupRelockBeforeAuthentication())) {
      throw new Error('浏览器启动安全检查尚未完成，请稍后重试');
    }
    invalidateSessionCache();
    const enc = await _getEncryption();

    // 派生数据加密密钥（仅此处用到主密码明文，随即丢弃，绝不落盘）
    sessionDataKey = await enc.deriveEncryptionKey(masterPassword);

    sessionValidityHours = validityHours;
    sessionPasswordExpiry = Date.now() + validityHours * 60 * 60 * 1000;

    // 数据密钥写入 storage.session（仅内存，活过 SW 终止）
    try {
      await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: sessionDataKey });
    } catch (sessionSetError) {
      logger.warn('写入 storage.session 数据密钥失败（将回退到按需重新解包）:', sessionSetError);
    }

    // 将「被随机包裹密钥加密的数据密钥」与过期/有效期原子性落盘；主密码不再落盘
    sessionWrappedDataKey = await persistWrappedDataKey(sessionDataKey, {
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: sessionPasswordExpiry,
      [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
    });

    // 清理旧版遗留的主密码密文（若存在），确保主密码不再残留于磁盘
    await chrome.storage.local.remove(SESSION_STORAGE_KEYS.MASTER_PASSWORD);

    // 确保 at-rest 全部为密文（加密新条目 / 迁移旧版本残留明文），明文绝不落盘。
    // sessionDataKey 已于上方派生并缓存，ensurePasswordsEncryptedAtRest 经
    // getSessionDataKey() 命中内存缓存复用同一密钥，避免二次 PBKDF2。
    _encryptAtRestDone = false;
    await ensurePasswordsEncryptedAtRest();
    // 写入 storage.session 锁定状态镜像（{ locked: false, expiresAt }），
    // 使侧边栏 isSessionQuicklyKnownInvalid() 可通过纯内存 IPC 快速判定会话有效性，
    // 消除 Windows 慢盘场景下 storage.local 磁盘读取延迟（200-500ms）导致的骨架屏延伸白屏
    try {
      await chrome.storage.session.set({
        [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: false, expiresAt: sessionPasswordExpiry },
      });
    } catch {
      // storage.session 不可用时静默忽略（isSessionQuicklyKnownInvalid 会降级到 storage.local）
    }

    // 仅在新会话完整创建后恢复 failed/缺失的启动重锁屏障；独立 recovery 键不会覆盖 pending。
    if (!(await recoverBrowserStartupRelockAfterAuthentication())) {
      // 不能向调用方报告“登录成功但所有凭据入口仍锁定”。回滚刚写入的会话，
      // 让 UI 维持一致的未认证状态并允许用户重试。
      try {
        await clearSession();
      } catch (rollbackError) {
        logger.error('恢复浏览器启动安全屏障失败，且新会话回滚失败:', rollbackError);
      }
      throw new Error('恢复浏览器启动安全状态失败，请重试');
    }
  } catch (error) {
    logger.error('创建会话缓存失败:', error);
    throw error;
  }
}

/**
 * 为修改主密码（rekey）准备新的会话密钥材料
 *
 * 与 createSession 不同：不直接写 storage.local，而是返回需与重加密数据
 * 一并原子写入的会话键值对，消除「新密文已落盘、会话密钥仍是旧值」的
 * 存储态竞态窗口（该窗口会导致各上下文监听器用旧密钥解密新密文全部失败）。
 *
 * 调用完成后，本上下文内存镜像与 storage.session 均已更新为新数据密钥，
 * 其它上下文在 onChanged 回调中回退读取 storage.session 时即可取到新密钥。
 *
 * @param dataKey 新数据加密密钥（hex，由新主密码派生；salt 不变时与 createSession 派生结果一致）
 * @param validityHours 会话有效期（小时）
 * @returns 需由调用方与数据密文原子写入 storage.local 的会话键值对
 */
export async function prepareSessionRekey(dataKey: string, validityHours: number): Promise<Record<string, unknown>> {
  const enc = await _getEncryption();
  const wrapKey = await generateSessionEncryptionKey();
  const wrapped = await enc.encryptData(dataKey, wrapKey);

  invalidateSessionCache();
  sessionDataKey = dataKey;
  sessionWrappedDataKey = wrapped;
  sessionValidityHours = validityHours;
  sessionPasswordExpiry = Date.now() + validityHours * 60 * 60 * 1000;

  // 先更新 storage.session：保证其它上下文失效旧密钥后回退读取时拿到的已是新密钥
  try {
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.DATA_KEY]: dataKey,
      // rekey 后同步更新锁定状态镜像，sidepanel 下次打开时无需等待 storage.local 读取
      [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: false, expiresAt: sessionPasswordExpiry },
    });
  } catch (sessionSetError) {
    logger.warn('写入 storage.session 数据密钥失败（将回退到按需重新解包）:', sessionSetError);
  }

  return {
    [SESSION_STORAGE_KEYS.WRAP_KEY]: wrapKey,
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: wrapped,
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: sessionPasswordExpiry,
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
  };
}

/**
 * 采纳其它上下文完成的会话密钥更换（rekey 自愈）
 *
 * 修改主密码会用新密钥重加密全部数据并更新包裹数据密钥；本上下文内存中的
 * 旧数据密钥热缓存若不失效，后续解密将全部失败并被空值防护降级为空列表。
 * 各上下文的 storage 监听在检测到 WRAPPED_DATA_KEY 被更新（newValue 存在）时调用：
 * 若与内存镜像不一致，则清除旧数据密钥热缓存，下次 getSessionDataKey 经
 * storage.session / 解包三级回退取得新密钥。
 *
 * 注意：与 clearSession 的删除语义（newValue === undefined）严格区分，
 * 调用方必须仅在 newValue 存在时调用本函数，避免干扰锁定流程的竞态防护。
 *
 * @param wrappedKey storage 变更事件中的新包裹数据密钥密文
 * @param expiry 变更事件中的新会话过期时间戳（rekey 原子写入必然同事件携带）；
 *   不采纳会导致内存镜像停留在旧过期时间，旧时间到点时 isSessionValid 误触发提前锁定
 * @param validityHours 变更事件中的新会话有效期（小时）
 */
export function adoptRekeyedSession(wrappedKey: string, expiry?: number, validityHours?: number): void {
  if (sessionWrappedDataKey === wrappedKey) return;
  sessionWrappedDataKey = wrappedKey;
  sessionDataKey = null;
  if (typeof expiry === 'number') sessionPasswordExpiry = expiry;
  if (typeof validityHours === 'number') sessionValidityHours = validityHours;
  invalidateSessionCache();
}

/**
 * 从 storage 恢复会话状态到内存镜像（不触发过期检查）
 *
 * 优先恢复新格式（WRAPPED_DATA_KEY）；若仅存在旧版 blob 则透明迁移。
 */
async function restoreSessionFromStorage(): Promise<void> {
  const result = await chrome.storage.local.get([
    SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
    SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    SESSION_STORAGE_KEYS.VALIDITY_HOURS,
    SESSION_STORAGE_KEYS.MASTER_PASSWORD,
  ]);

  if (result[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]) {
    sessionWrappedDataKey = result[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY] as string;
    sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number;
    sessionValidityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
  } else if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
    const expiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number;
    const validityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
    await _migrateLegacySession(expiry, validityHours);
  }
}

/**
 * 清除会话缓存
 *
 * 使用模块级 in-flight Promise 去重：短时间内并发调用复用同一次执行，
 * 避免并发重复的会话键清理与 storage 写竞争。
 */
export async function clearSession(): Promise<void> {
  if (_clearSessionInFlight) {
    return _clearSessionInFlight;
  }
  _clearSessionInFlight = _doClearSession().finally(() => {
    _clearSessionInFlight = null;
  });
  return _clearSessionInFlight;
}

/**
 * 清除会话缓存的实际执行体（由 clearSession 去重包装调用）
 */
async function _doClearSession(): Promise<void> {
  try {
    invalidateSessionCache();

    // 清空加密模块内的 CryptoKey 句柄缓存，锁定后不残留可用的加解密句柄。
    // fire-and-forget：不阻塞锁定流程；若加密模块尚未加载（缓存必为空），
    // 此处 dynamic import 仅命中构建产物缓存，开销可忽略
    void _getEncryption()
      .then(m => m.clearCryptoKeyCache())
      .catch(() => {});

    // 清除内存与 storage.session 中的会话密钥材料。
    // storage.local 中的密码数据本就是密文（at-rest 不变量），无需再做全量重加密，
    // 上锁因此更快，也消除了旧实现「明文↔密文」重写引入的竞态窗口。
    sessionWrappedDataKey = null;
    sessionPasswordExpiry = null;
    sessionValidityHours = null;
    sessionDataKey = null;
    _encryptAtRestDone = false;

    try {
      // 同时更新锁定状态镜像：侧边栏 isSessionQuicklyKnownInvalid() 下次打开时
      // 可通过纯内存 IPC 立即感知锁定，无需等待 storage.local 磁盘读取
      await chrome.storage.session.remove(SESSION_MEMORY_KEYS.DATA_KEY);
      void chrome.storage.session.set({ [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: true } }).catch(() => {});
    } catch {
      // storage.session 不可用时忽略
    }

    // 注：不清除 WRAP_KEY——它仅是每次写入会话时随机生成的临时包裹密钥，
    // 缺少 WRAPPED_DATA_KEY 时单独存在无任何意义，保留仅为省去一次删除写操作。
    await chrome.storage.local.remove([
      SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
      SESSION_STORAGE_KEYS.MASTER_PASSWORD,
      SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
      SESSION_STORAGE_KEYS.VALIDITY_HOURS,
      SESSION_STORAGE_KEYS.PASSWORDS_DECRYPTED,
    ]);
  } catch (error) {
    logger.error('清除会话缓存失败:', error);
    throw error;
  }
}

/**
 * 迁移未加密的密码条目
 */
export async function migrateUnencryptedEntries(masterPassword: string): Promise<void> {
  // 统一委托到 ensurePasswordsEncryptedAtRest：确保 storage.local 中所有条目均为密文。
  // 登录流程在 createSession 之后调用本函数，此处为幂等兜底（若已完成则快速返回）。
  await ensurePasswordsEncryptedAtRest(masterPassword);
}

/**
 * 获取会话过期时间
 *
 * 优先返回内存镜像；SW 冷启动后尚未经过 isSessionValid 时内存为 null，
 * 此时从 storage.local 读取持久化的 PASSWORD_EXPIRY 兜底，避免 UI 误显示为「无会话」。
 * 仅做只读兜底：不触发会话恢复/迁移等副作用，也不回写内存镜像。
 */
export async function getSessionExpiryTime(): Promise<number | null> {
  if (sessionPasswordExpiry !== null) {
    return sessionPasswordExpiry;
  }
  try {
    const result = await chrome.storage.local.get(SESSION_STORAGE_KEYS.PASSWORD_EXPIRY);
    return (result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | undefined) ?? null;
  } catch (error) {
    logger.error('读取会话过期时间失败:', error);
    return null;
  }
}

/**
 * 生成会话包裹密钥（32 字节随机数的 hex 表示，256-bit）
 *
 * 复用 crypto-light 的 bytesToHex，避免重复实现字节到 hex 的转换逻辑。
 */
export async function generateSessionEncryptionKey(): Promise<string> {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * 获取主密码有效期设置
 */
export async function getMasterPasswordValidityHours(): Promise<number> {
  try {
    if (sessionValidityHours !== null) {
      return sessionValidityHours;
    }

    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD_VALIDITY);
    const validityHours = (result[STORAGE_KEYS.MASTER_PASSWORD_VALIDITY] as number | undefined) || 24;
    sessionValidityHours = validityHours;
    return validityHours;
  } catch (error) {
    logger.error('获取主密码有效期失败:', error);
    return 24;
  }
}

/**
 * 主密码有效期允许范围（小时）
 *
 * 上限 168h = 7 天，与 ValidityHoursSelect 生产选项一致；
 * 下限 0.1h（6 分钟）兼容 ValidityHoursSelect 中预留的开发调试选项
 * （生产选项最小为 1h，调试选项需短有效期验证会话过期链路）。
 */
const VALIDITY_HOURS_MIN = 0.1;
const VALIDITY_HOURS_MAX = 168;

/**
 * 设置主密码有效期
 */
export async function setMasterPasswordValidityHours(hours: number): Promise<void> {
  try {
    // 防御性范围校验：拒绝写入超出允许范围的有效期，避免会话过期时间异常
    if (hours < VALIDITY_HOURS_MIN || hours > VALIDITY_HOURS_MAX) {
      throw new Error(`有效期必须在${VALIDITY_HOURS_MIN}小时到7天（${VALIDITY_HOURS_MAX}小时）之间`);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD_VALIDITY]: hours,
    });
    sessionValidityHours = hours;
  } catch (error) {
    logger.error('设置主密码有效期失败:', error);
    throw error;
  }
}
