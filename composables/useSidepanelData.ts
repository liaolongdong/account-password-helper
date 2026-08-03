import { ref, onUnmounted } from 'vue';
import type { PasswordEntry, RuntimeMessage } from '@/utils/types';
import { MessageType } from '@/utils/types';
import type { SidepanelInitMeta } from '@/utils/perfMetrics';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';
import { useChromeListeners } from '@/composables/useChromeListeners';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { isExactHostMatch } from '@/utils/domain';
import { lazyImport } from '@/utils/lazyImport';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

// ==================== 延迟加载模块（避免初始加载拉入 encryption.ts 加密链） ====================

/**
 * 延迟加载 sessionManager-storage 模块（首次回退/事件触发时加载）
 * isSessionValid 在热路径中由 background SW 执行，本地仅在回退和事件处理中使用
 *
 * SidePanel 上下文统一跳过 at-rest 密文化检查（skipConsistencyCheck）：
 * 后续 getAllPasswords 会用会话数据密钥按需解密，无需在 isSessionValid 中
 * 触发额外的全量读取（Windows Web Crypto 较慢，数百条密码开销明显）
 */
const getSessionModule = lazyImport(() => import('@/utils/sessionManager-storage'));

const getIsSessionValid = async () => {
  const sessionModule = await getSessionModule();
  return () => sessionModule.isSessionValid({ skipConsistencyCheck: true });
};

/**
 * 延迟调用 invalidateSessionCache（fire-and-forget）
 * 在 clearSession 路径中异步失效 session 缓存，防止并发 isSessionValid()
 * 从 5s TTL 缓存中返回过期 true 值。首次调用时触发 dynamic import。
 */
const invalidateSessionCacheAsync = async () => {
  const sessionModule = await getSessionModule();
  sessionModule.invalidateSessionCache();
};

/**
 * 延迟加载加密模块（仅锁定感知点清理句柄缓存使用，不引入首屏加密链）
 */
const getEncryptionModule = lazyImport(() => import('@/utils/encryption'));

/**
 * 延迟清空加密模块的 CryptoKey 句柄缓存（fire-and-forget）
 *
 * 句柄缓存为每 JS 上下文独立，background 发起的锁定（空闲锁/系统锁）无法
 * 清理本页面因本地路径解密而填充的句柄，需在 sidepanel 自身的锁定感知点
 * （SESSION_EXPIRED 广播 / 会话键移除）补充清理；加密模块尚未加载时
 * 缓存必为空，dynamic import 仅命中构建产物缓存，开销可忽略
 */
const clearCryptoKeyCacheAsync = async () => {
  const enc = await getEncryptionModule();
  enc.clearCryptoKeyCache();
};

/**
 * 延迟加载 passwordCrud 模块（首次回退路径时加载）
 * getAllPasswords/getPasswordsByUrl 在热路径中由 background SW 执行，本地仅在回退时使用
 */
const getPasswordCrudModule = lazyImport(() => import('@/utils/storage/passwordCrud'));

/**
 * 本地竞速路径超时（毫秒）
 *
 * bg 路径自带 800ms 超时，但其超时/响应异常后会回退等待本地路径，
 * 而本地路径（chunk 冷读 + storage IO + 全量解密）在冷盘极端场景下可能
 * 长尾阻塞，导致骨架屏无限等待。超时后先渲染锁定态降级 UI（确定性兜底），
 * 本地路径迟到完成后再采纳真实结果。
 */
const LOCAL_PATH_TIMEOUT_MS = 3000;

/**
 * 会话过期时间戳的 storage.local 键名
 *
 * 与 sessionManager-storage 的 SESSION_STORAGE_KEYS.PASSWORD_EXPIRY 保持一致；
 * 使用字面量避免静态引入 sessionManager-storage 模块，破坏其懒加载 chunk 拆分
 * （该模块在本文件中统一经 getSessionModule 动态加载）。
 */
const SESSION_EXPIRY_KEY = 'session_password_expiry';

/**
 * 轻量会话失效快速判定（锁屏快速路径专用）
 *
 * 仅读取会话过期时间戳做时间比较（单次 storage.local IPC，毫秒级），
 * 不加载 sessionManager-storage chunk、不触发密钥派生/解密。
 *
 * 返回 true 表示会话已确定失效（无会话键或已过期），调用方可立即淡出骨架屏
 * 展示锁屏 UI，无需等待完整竞速（Windows 会话失效冷环境下竞速瀑布最坏
 * bg 800ms 超时 + 本地 3000ms 兜底 ≈ 3.8s，是白屏的主要来源）；
 * 返回 false（可能有效 / 读取失败）时不走快速路径，交由 initSidepanelData
 * 完整竞速判定——判定方向仅可能「提前展示锁屏」，不存在误判解锁风险（fail-locked）。
 */
export async function isSessionQuicklyKnownInvalid(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(SESSION_EXPIRY_KEY);
    const expiry = result[SESSION_EXPIRY_KEY] as number | undefined;
    return !expiry || Date.now() >= expiry;
  } catch {
    // 读取失败不走快速路径，交由完整竞速判定
    return false;
  }
}

/**
 * storage.session 加密快照直读结果
 */
interface SnapshotReadResult {
  sessionValid: boolean;
  passwords: PasswordEntry[];
  sortConfig: { prop: string; order: string } | null;
}

/**
 * storage.session 加密快照直读（最快数据路径）
 *
 * SW 侧 warmPasswordCache / getOrWarmCache 成功后将加密快照写入 storage.session（纯内存），
 * 侧边栏冷启动时直接读取并解密，跳过 SW 唤醒 + storage.local 磁盘 IO + 逐条 AES-GCM 解密，
 * 将数据加载从 200-3000ms 压缩至 <50ms。
 *
 * 安全：快照经 AES-GCM 加密（密钥同 storage.session 的 session_data_key），
 * 与 at-rest 加密共用密钥体系；storage.session 仅内存、TRUSTED_CONTEXTS 访问。
 * 读取前并行校验 session_password_expiry（单次 storage.local IPC），
 * 会话已过期时拒绝快照（fail-locked），防止锁定前的陈旧快照反向覆盖锁定态。
 *
 * @returns 解密后的密码数据，快照不存在/过期/解密失败时返回 null（静默降级到 bg/local 竞速）
 */
async function readSessionSnapshot(): Promise<SnapshotReadResult | null> {
  try {
    // 并行读取：storage.session（快照 + 数据密钥）与 storage.local（会话过期时间戳 + 有效期配置），
    // 两次 IPC 重叠执行，总延迟约等于单次 IPC（~2-5ms）；
    // MASTER_PASSWORD_VALIDITY 与 SESSION_EXPIRY_KEY 合并到同一次 get，零额外 IPC
    const [sessionResult, localResult] = await Promise.all([
      chrome.storage.session.get([SESSION_MEMORY_KEYS.PASSWORD_CACHE_SNAPSHOT, SESSION_MEMORY_KEYS.DATA_KEY]),
      chrome.storage.local.get([SESSION_EXPIRY_KEY, STORAGE_KEYS.MASTER_PASSWORD_VALIDITY]),
    ]);

    // 会话过期校验（fail-locked）：过期时间戳缺失或已到则拒绝快照
    const expiry = localResult[SESSION_EXPIRY_KEY] as number | undefined;
    if (!expiry || Date.now() >= expiry) return null;

    const snapshot = sessionResult[SESSION_MEMORY_KEYS.PASSWORD_CACHE_SNAPSHOT] as string | undefined;
    const dataKey = sessionResult[SESSION_MEMORY_KEYS.DATA_KEY] as string | undefined;
    if (!snapshot || !dataKey) return null;

    // 解密快照（复用 encryption 模块的 decryptData，经 lazyImport 单例缓存）
    const { decryptData } = await getEncryptionModule();
    const json = await decryptData(snapshot, dataKey);
    const parsed = JSON.parse(json) as {
      passwords: PasswordEntry[];
      sortConfig: { prop: string; order: string } | null;
      timestamp: number;
    };

    // TTL 校验：快照时间戳超出用户配置的会话有效期则视为过期，
    // 避免读取陈旧快照；精确清除由 SW 侧 invalidatePasswordCache 主动保障，
    // 此处为防御性兜底（如 SW 被杀未来得及清除快照）
    const validityHours = (localResult[STORAGE_KEYS.MASTER_PASSWORD_VALIDITY] as number | undefined) || 24;
    const maxAgeMs = validityHours * 60 * 60 * 1000;
    if (Date.now() - parsed.timestamp > maxAgeMs) return null;

    logger.debug('SidePanel: storage.session 快照直读成功，条目数:' + parsed.passwords.length);
    return { sessionValid: true, passwords: parsed.passwords, sortConfig: parsed.sortConfig };
  } catch {
    // 快照不存在/解密失败/JSON 解析异常均静默降级到 bg/local 竞速
    return null;
  }
}

/**
 * SidePanel 数据加载与会话管理 Composable
 *
 * 职责：
 * - 密码列表加载、缓存同步
 * - 会话状态管理（认证、过期、storage 监听）
 * - Chrome 事件注册（storage/message/tab/visibility）
 * - 与 background 的 port 连接
 *
 * @returns 状态与方法供 App.vue 编排使用
 */
export function useSidepanelData() {
  // ==================== 状态 ====================

  const passwords = ref<PasswordEntry[]>([]);
  const loading = ref(true);
  const isAuthenticated = ref(false);
  const currentDomain = ref('');
  const showSidepanel = ref(true);
  const sortConfig = ref<{ prop: string; order: string } | null>(null);

  // ==================== Chrome 事件监听 ====================

  const { onStorageChange, onMessage, onTabUpdated, onTabActivated, onDocumentEvent, onWindowEvent } =
    useChromeListeners();

  // ==================== port 连接 ====================

  /** 与 background 建立 port 连接，用于可靠的状态追踪和关闭通信 */
  let bgPort: chrome.runtime.Port | null = null;

  /** port 心跳定时器，每 25 秒发送轻量消息保持 SW 活跃（Chrome idle timeout = 30s） */
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 模块级标志：已知会话过期
   *
   * 在 handleSessionChange 检测到会话过期时同步设置，后续调用直接同步清除认证状态，
   * 跳过异步检查，避免异步延迟导致加密数据短暂闪烁。
   * 在 initSidepanelData 和 handleSessionChange 检测到会话有效时重置。
   */
  let _sessionKnownExpired = false;

  /**
   * 本地操作进行中标志
   *
   * 当侧边栏自身发起 storage 写入（收藏/填充更新 lastUsedAt）时设为 true，
   * handleStorageChange 检测到此标志后跳过 loadPasswords，避免全量重载覆盖
   * Vue 层已就地完成的状态更新。与 options 页面 usePasswordManagement 的
   * isLocalOperation + runLocalOperation 机制完全对齐。
   */
  let _isLocalOperation = false;

  // ==================== 域名工具 ====================

  /**
   * 域名匹配优先级：0=匹配, 1=不匹配
   */
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!currentDomain.value) return 0;
    const hasUrl = entry.url && entry.url.trim() !== '';
    if (hasUrl && isExactHostMatch(currentDomain.value, entry.url)) return 0;
    return 1;
  };

  // ==================== 缓存操作 ====================

  /**
   * 触发 background 预热/刷新密码缓存（无载荷轻量消息）
   *
   * 不再回传全量明文列表（数百条目时序列化占用主线程 5-30ms），
   * 由 background 自行经 warmPasswordCache 去重预热：缓存已存在时 no-op，
   * 失效后（storage 变更监听已统一失效）重新解密填充，数据一致性不变。
   */
  const triggerBackgroundCacheRefresh = async (): Promise<void> => {
    try {
      await chrome.runtime.sendMessage({ type: MessageType.UPDATE_PASSWORD_CACHE });
    } catch (error) {
      logger.error('SidePanel: 触发缓存刷新失败:', error);
    }
  };

  // ==================== 本地操作守卫 ====================

  /**
   * 包裹本地 storage 写入操作，设置标志位防止 handleStorageChange 触发全量 loadPasswords
   *
   * 原理：本地操作（收藏/填充更新时间戳）已在 Vue 层就地更新状态，
   * 无需 storage watcher 再触发全量 loadPasswords。设置 _isLocalOperation 标志后，
   * handleStorageChange 会跳过 onPasswordDataChange 回调，避免 loading 闪烁和全量替换数组引用。
   *
   * 延迟清除标志使用 setTimeout(0) 确保覆盖 chrome.storage.onChanged 的异步派发时序。
   *
   * @param fn 包含 storage 写入的异步操作
   */
  const runLocalOperation = async (fn: () => Promise<void>) => {
    _isLocalOperation = true;
    try {
      await fn();
    } finally {
      // 延迟清除标志：chrome.storage.onChanged 在当前微任务之后派发，
      // setTimeout(0) 将清除推迟到下一个宏任务，确保事件处理时标志仍为 true
      setTimeout(() => {
        _isLocalOperation = false;
      }, 0);
    }
  };

  // ==================== 数据加载 ====================

  /**
   * 加载当前标签页信息（获取域名）
   */
  const loadCurrentTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url) {
        const url = new URL(tab.url);
        currentDomain.value = url.hostname;
      }
    } catch (error) {
      logger.error('获取当前标签页失败:', error);
    }
  };

  /**
   * 加载密码列表
   * 根据会话状态和当前域名加载对应的密码数据，并同步更新 background 缓存
   *
   * 性能优化：
   * - skipSessionCheck: 调用方已检查过 session 时跳过重复检查
   * - 并行读取排序配置和密码数据，减少串行 IPC 延迟
   *
   * @param skipSessionCheck 是否跳过会话有效性检查（默认 false）
   * @param silent 静默刷新：不置 loading，避免外部 storage 变更（如 SW 延迟落盘的
   *   lastUsedAt 元数据）触发全量重载时列表被骨架屏/spinner 整体替换造成闪烁
   */
  const loadPasswords = async (skipSessionCheck = false, silent = false) => {
    try {
      if (!silent) loading.value = true;

      if (!skipSessionCheck) {
        // 检查会话是否有效（延迟加载 sessionManager-storage）
        const isSessionValidFn = await getIsSessionValid();
        const sessionValid = await isSessionValidFn();
        if (!sessionValid) {
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          passwords.value = [];
          return;
        }
      }

      // 始终加载全量密码列表，域名过滤统一由 filteredPasswords computed 处理
      // 避免 GET_INITIAL_DATA（全量）与 loadPasswords（过滤子集）两条路径数据不一致
      const fetchPasswords = async (): Promise<PasswordEntry[]> => {
        const crud = await getPasswordCrudModule();
        return crud.getAllPasswords();
      };

      const [sortConfigResult, loadedPasswords] = await Promise.all([
        getSidepanelSortConfig().catch(() => null),
        fetchPasswords(),
      ]);

      // 二次检查：异步操作期间会话可能已过期（storage change 并行触发），
      // 防止将加密数据设置到 UI 上导致闪烁
      if (!isAuthenticated.value) {
        return;
      }

      sortConfig.value = sortConfigResult;
      passwords.value = loadedPasswords;
      loading.value = false;

      // 后台静默触发缓存刷新（不阻塞 UI 渲染）
      void triggerBackgroundCacheRefresh();
    } catch (error) {
      logger.error('加载密码列表失败:', error);
      // 静默刷新本意为「无感」：失败时仅记日志不弹 toast，避免与并发的
      // 非静默加载重叠时误报「加载失败」（列表随后会正常加载出来）
      if (!silent) ElMessage.error(t('message.loadListFailed'));
    } finally {
      // 兜底确保 loading 状态清除（异常路径安全网）
      loading.value = false;
    }
  };

  // ==================== 会话与事件处理 ====================

  /**
   * 监听会话状态变化
   *
   * 包含同步守卫：当 _sessionKnownExpired 为 true 时，直接同步处理状态，
   * 跳过异步 isSessionValid() 检查。防止 isSessionValid() 的 5s TTL 缓存
   * 返回过期 true 值，导致错误地将 isAuthenticated 重新设为 true 并加载加密数据。
   */
  const handleSessionChange = async () => {
    try {
      // 同步守卫：已知会话过期时，避免 isSessionValid() 缓存返回过期 true
      // 导致错误地将 isAuthenticated 重新设为 true 并加载加密数据
      if (_sessionKnownExpired) {
        if (isAuthenticated.value) {
          isAuthenticated.value = false;
          passwords.value = [];
        }
        return;
      }

      const isSessionValidFn = await getIsSessionValid();
      const sessionActive = await isSessionValidFn();
      if (sessionActive && !isAuthenticated.value) {
        _sessionKnownExpired = false;
        isAuthenticated.value = true;
        await loadCurrentTab();
        await loadPasswords();
      } else if (!sessionActive && isAuthenticated.value) {
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        passwords.value = [];
      }
    } catch (error) {
      logger.error('SidePanel: 检查会话状态失败:', error);
    }
  };

  /**
   * 监听存储变化
   *
   * clearSession() 分两步执行存储操作（先 remove session keys，再 set 加密密码），
   * 在 SidePanel 中以两个独立的 storage.onChanged 事件到达。若不在第一个事件中
   * 同步标记 _sessionKnownExpired，第二个事件（account_passwords 变更）会在
   * handleSessionChange 异步完成前触发 loadPasswords，此时 isSessionValid()
   * 的 5s TTL 缓存可能仍返回 true，导致加密数据被加载到 UI 上闪烁。
   */
  const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    const sessionKeys = ['session_wrapped_data_key', 'session_password_expiry', 'session_validity_hours'];
    const hasSessionChange = Object.keys(changes).some(key => sessionKeys.includes(key));

    if (hasSessionChange) {
      // 检测 session key 是被创建还是被移除：
      // - 移除（newValue 为 undefined）：同步标记会话过期，阻止紧随的 account_passwords
      //   变更触发 loadPasswords，消除 clearSession 两步存储操作的竞态窗口
      // - 创建/更新（newValue 存在）：重置过期标记，由异步 handleSessionChange
      //   验证 session 有效性并恢复认证状态
      const isSessionRemoved = Object.entries(changes).some(
        ([key, change]) => sessionKeys.includes(key) && change.newValue === undefined,
      );
      if (isSessionRemoved) {
        _sessionKnownExpired = true;
        // 异步失效 session 缓存（fire-and-forget），确保并发 isSessionValid()
        // 调用不会从 5s TTL 缓存中返回过期 true 值
        void invalidateSessionCacheAsync();
        // 清理本上下文的 CryptoKey 句柄缓存（background 发起的锁定无法跨上下文清理）
        void clearCryptoKeyCacheAsync().catch(() => {});
      } else {
        _sessionKnownExpired = false;

        // rekey 自愈：包裹数据密钥被更新（如修改主密码）时，本上下文内存中的旧数据密钥
        // 已无法解密新密文（AES-GCM 全量认证失败会被空值防护降级为空列表），
        // 需先失效旧密钥热缓存再重载列表；未认证态则交由 handleSessionChange 恢复认证
        const wrappedKeyChange = changes['session_wrapped_data_key'];
        if (wrappedKeyChange?.newValue !== undefined) {
          void (async () => {
            const sessionModule = await getSessionModule();
            sessionModule.adoptRekeyedSession(
              wrappedKeyChange.newValue as string,
              changes['session_password_expiry']?.newValue as number | undefined,
              changes['session_validity_hours']?.newValue as number | undefined,
            );
            if (isAuthenticated.value) {
              logger.debug('SidePanel: 检测到会话密钥更换（rekey），已失效旧密钥并重载列表');
              await loadPasswords();
            } else {
              await handleSessionChange();
            }
          })();
          return;
        }
      }

      // 会话变化时，先处理会话状态，不再继续处理 account_passwords，
      // 避免 handleSessionChange 与 loadPasswords 并行执行导致竞态闪烁
      handleSessionChange();
      return;
    }

    // 密码数据变化时，重新加载密码列表（解决自动保存后快速填充列表不刷新的问题）
    // 增加 _sessionKnownExpired 守卫：clearSession 时 password 加密写入会触发本分支，
    // 此时若 _sessionKnownExpired 已为 true（由前置 session key 移除事件设置），跳过加载
    if (changes['account_passwords']) {
      if (_sessionKnownExpired) {
        logger.debug('SidePanel: 检测到密码数据变动但会话已知过期，跳过重新加载');
        return;
      }
      // 本地操作（收藏/填充）已在 Vue 层就地更新，storage watcher 跳过全量重载
      if (_isLocalOperation) {
        logger.debug('SidePanel: 本地操作触发的 storage 变更，跳过重新加载');
        return;
      }
      logger.debug('SidePanel: 检测到密码数据变动，重新加载');
      if (isAuthenticated.value) {
        // 仅元数据变更（使用痕迹落盘等）：复用 SW 侧同一判定 + 白名单就地修补，
        // 零解密零整表替换（Windows Web Crypto 较慢，数百条全量 AES-GCM 解密
        // 开销明显）；未命中（真实增删改）或修补异常时回退静默全量重载
        const change = changes['account_passwords'];
        void (async () => {
          try {
            const crud = await getPasswordCrudModule();
            if (crud.isMetadataOnlyChange(change.oldValue, change.newValue)) {
              applyMetadataOnlyPatch(crud.METADATA_FIELDS, change.newValue);
              logger.debug('SidePanel: 元数据变更命中，已就地修补列表');
              return;
            }
          } catch (error) {
            logger.error('SidePanel: 元数据就地修补失败，回退静默重载:', error);
          }
          // 静默刷新：外部变更（自动保存等）不置 loading，避免已展示的列表被骨架屏替换造成闪烁
          void loadPasswords(false, true);
        })();
      }
    }
  };

  /**
   * 仅元数据变更的就地修补（与 SW 侧 applyMetadataOnlyUpdate 语义对齐）
   *
   * 按键存在性同步白名单字段：存在的拷入新值，缺失的（如取消收藏后
   * at-rest 删除的 favoriteUsedAt 键）从列表条目中删除，避免 UI 与
   * storage 持续偏离。仅改条目字段不替换数组引用，Vue 层无闪烁。
   *
   * @param metadataFields 元数据白名单（派生自 passwordCrud 单一事实源）
   * @param newEntries 本次写入后的 at-rest 全量条目（非敏感字段明文可读）
   */
  const applyMetadataOnlyPatch = (metadataFields: readonly string[], newEntries: unknown): void => {
    if (!Array.isArray(newEntries)) return;
    const byId = new Map(passwords.value.map(p => [p.id, p]));
    for (const raw of newEntries) {
      const entry = raw as Record<string, unknown> | null;
      if (!entry || typeof entry.id !== 'string') continue;
      const cached = byId.get(entry.id);
      if (!cached) continue;
      const target = cached as unknown as Record<string, unknown>;
      for (const field of metadataFields) {
        if (field in entry) {
          target[field] = entry[field];
        } else {
          delete target[field];
        }
      }
    }
  };

  /**
   * 更新当前域名并加载密码
   */
  const updateCurrentDomainAndLoadPasswords = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        const newDomain = url.hostname;

        if (currentDomain.value !== newDomain) {
          currentDomain.value = newDomain;

          if (isAuthenticated.value) {
            await loadPasswords();
          }
        }
      }
    } catch (error) {
      logger.error('更新当前域名失败:', error);
    }
  };

  /**
   * 监听来自 background 的消息
   */
  const handleMessage = (
    message: RuntimeMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void,
  ) => {
    switch (message.type) {
      case MessageType.URL_CHANGED:
        updateCurrentDomainAndLoadPasswords();
        sendResponse({ success: true, message: 'URL变化处理完成' });
        return true;
      case MessageType.SESSION_EXPIRED:
        logger.debug('SidePanel: 收到锁定广播消息，立即切换到未验证状态');
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        passwords.value = [];
        // 清理本上下文的 CryptoKey 句柄缓存（锁定后不残留可用解密句柄）
        void clearCryptoKeyCacheAsync().catch(() => {});
        sendResponse({ success: true });
        return true;
      default:
        return false;
    }
  };

  /**
   * 监听页面可见性变化
   *
   * 侧边栏重新可见时刷新当前 Tab 域名，确保切换 Tab 后回到侧边栏时
   * 域名过滤及时更新（computed 的 filteredPasswords 会自动重新过滤）。
   *
   * 快速路径：当 _sessionKnownExpired 已为 true 时，同步清除认证状态后
   * 仅刷新域名即返回，跳过不必要的 handleSessionChange 异步调用
   * （含 storage 读取 + HKDF 密钥派生，Windows ~40-80ms）。
   */
  const handleVisibilityChange = async () => {
    if (!document.hidden) {
      // 同步守卫：已知会话过期时立即清除认证状态，防止 loadCurrentTab 异步期间加密数据闪烁
      if (_sessionKnownExpired && isAuthenticated.value) {
        isAuthenticated.value = false;
        passwords.value = [];
      }
      // 刷新当前 Tab 域名（切换 Tab 后回到侧边栏时域名可能已变）
      await loadCurrentTab();
      // 已知会话过期时跳过异步 session 检查
      if (_sessionKnownExpired) return;
      await handleSessionChange();
    }
  };

  /**
   * 监听标签页更新
   */
  const handleTabUpdated = async (_tabId: number, changeInfo: any, tab: any) => {
    if (changeInfo.status === 'complete' && tab.url) {
      await updateCurrentDomainAndLoadPasswords();
    }
  };

  /**
   * 监听标签页激活
   */
  const handleTabActivated = async (_activeInfo: any) => {
    await updateCurrentDomainAndLoadPasswords();
  };

  // ==================== 初始化 ====================

  /**
   * SidePanel 数据层初始化
   * 建立 port 连接、注册 Chrome 事件监听器、加载初始数据
   *
   * 性能优化（Phase 3）：「真并行竞速」模式
   * - Background GET_INITIAL_DATA 与本地 storage 直读路径同时启动，取先到者
   * - 热 SW 场景：Background 路径 ~20ms 胜出，本地路径静默完成
   * - 冷 SW 场景：本地路径 ~200-400ms 先完成，Background 迟到结果用于缓存更新
   * - Background 分支设 800ms 兜底上限（见下方 setTimeout）：超时仅代表「切换等待对象」，
   *   冷 SW 的真实响应（bgRawPromise）在回退阶段继续与本地路径竞速，先到即采纳，
   *   不会因超时门被丢弃（否则 Windows 冷 SW 0.9~3s 完成时 UI 只能空等本地长尾）
   * - loadCurrentTab 与 GET_INITIAL_DATA 并行执行，节约 ~5ms 串行延迟
   *
   * @returns 初始化元信息（竞速胜出路径 + 会话状态），供性能埋点记录维度使用
   */
  const initSidepanelData = async (): Promise<SidepanelInitMeta> => {
    // 建立与 background 的 port 连接，用于状态追踪和接收关闭消息
    try {
      bgPort = chrome.runtime.connect({ name: 'sidepanel' });
      bgPort.onMessage.addListener((message: any) => {
        if (message.type === MessageType.CLOSE_SIDEPANEL) {
          logger.debug('SidePanel: 收到关闭消息，正在关闭侧边栏');
          try {
            window.close();
          } catch (err) {
            logger.error('SidePanel: window.close() 失败:', err);
          }
        } else if (message.type === MessageType.SESSION_EXPIRED) {
          logger.debug('SidePanel: 收到锁定消息（port），立即切换到未验证状态');
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          passwords.value = [];
        }
      });
      bgPort.onDisconnect.addListener(() => {
        bgPort = null;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      });

      // 启动心跳：每 25 秒发送轻量消息，保持 SW 在 sidepanel 打开期间持续活跃
      // Chrome MV3 idle timeout = 30s，alarm 最小间隔 = 60s（不够），port 连接本身可保活但需消息触发
      heartbeatTimer = setInterval(() => {
        if (bgPort) {
          try {
            bgPort.postMessage({ type: 'HEARTBEAT' });
          } catch {
            // port 已断开，停止心跳
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          }
        }
      }, 25000);
    } catch (err) {
      logger.error('SidePanel: 建立 port 连接失败:', err);
    }

    // 使用 composable 注册监听器（自动在组件卸载时清理）
    onStorageChange(handleStorageChange);
    onMessage(handleMessage);
    onDocumentEvent('visibilitychange', handleVisibilityChange);
    onWindowEvent('sessionExpired', handleSessionChange);
    onTabUpdated(handleTabUpdated);
    onTabActivated(handleTabActivated);

    try {
      // ---- 并行竞速模式 ----
      const _perfRaceStart = performance.now();

      // 路径 0: storage.session 加密快照直读（最快路径，纯内存 IPC + 单次 AES-GCM）
      // SW 侧 warmPasswordCache 成功后写入加密快照，侧边栏冷启动时直读解密，
      // 跳过 SW 唤醒 + storage.local 磁盘 IO + 逐条解密（200-3000ms → <50ms）；
      // 快照不存在/过期/解密失败时静默降级到 bg/local 竞速
      const _perfSnapshotStart = performance.now();
      const snapshotResult = await readSessionSnapshot();
      if (snapshotResult) {
        const snapshotMs = performance.now() - _perfSnapshotStart;
        logger.debug(`SidePanel: 快照路径竞速胜出 (${snapshotMs.toFixed(1)}ms)`);
        _sessionKnownExpired = false;
        isAuthenticated.value = true;
        passwords.value = snapshotResult.passwords;
        sortConfig.value = snapshotResult.sortConfig;
        loading.value = false;
        // 与 bg/local 路径一致：并行加载当前标签页域名（域名过滤/优先级排序依赖）
        void loadCurrentTab();
        // 轻量触发 SW 侧去重预热作为兜底（缓存存在时 no-op）
        void triggerBackgroundCacheRefresh();
        return {
          raceWinner: 'snapshot' as const,
          sessionValid: true,
          bgPathMs: null,
          localPathMs: null,
          bgSwProcessMs: null,
          bgCacheHit: null,
          bgSwUptimeMs: null,
        };
      }

      // 快照未命中，进入 bg/local 双路竞速
      // 竞速标记：null = 未决出胜负，'bg' = Background 路径胜出，'local' = 本地路径胜出
      let raceWinner: 'bg' | 'local' | null = null;
      // 性能埋点：两条路径各自耗时（写入环形日志，生产环境可定位 Windows 慢点归属）
      let bgPathMs: number | null = null;
      let localPathMs: number | null = null;
      /** Background GET_INITIAL_DATA 响应结构（bgPromise 竞速与回退阶段迟到采纳共用） */
      type BgInitialDataResponse = {
        success?: boolean;
        data?: {
          sessionValid: boolean;
          passwords: PasswordEntry[];
          sortConfig: { prop: string; order: string } | null;
          perf?: { swProcessMs: number; cacheHit: boolean; swUptimeMs: number };
        };
      };
      /** Background 路径迟到结果（本地路径先胜出时保存，用于静默更新缓存） */
      let bgLateResult: BgInitialDataResponse | null = null;

      // 路径 A: loadCurrentTab（并行，不阻塞 GET_INITIAL_DATA）
      const tabPromise = loadCurrentTab();

      // 路径 B: Background GET_INITIAL_DATA（热 SW 快通道，800ms 超时）
      const _perfBgStart = performance.now();
      /** bg 原始响应 Promise（独立持有，不随 800ms 竞速门丢弃）：
       *  冷 SW 在 800ms 后才完成启动时，其真实响应仍可在回退阶段与本地路径继续竞速被采纳，
       *  消除「迟到数据被丢弃 → 空等本地路径 + 3s 兜底超时」的最坏瀑布（Windows 冷 SW 主卡点） */
      const bgRawPromise = chrome.runtime.sendMessage({
        type: MessageType.GET_INITIAL_DATA,
      });
      const bgPromise = Promise.race([
        bgRawPromise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 800)),
      ]).then(result => {
        bgPathMs = performance.now() - _perfBgStart;
        if (raceWinner) {
          // 本地路径已胜出，保存 bg 结果用于静默更新缓存
          bgLateResult = result as typeof bgLateResult;
          logger.debug(`SidePanel: bg 路径迟到 (${bgPathMs.toFixed(1)}ms)，静默更新缓存`);
          return null;
        }
        raceWinner = 'bg';
        logger.debug(`SidePanel: bg 路径竞速胜出 (${bgPathMs.toFixed(1)}ms)`);
        return { source: 'bg' as const, data: result };
      });

      // 路径 C: 本地 storage 直读（冷 SW 回退通道）
      // 加载时序：轻量过期预判先行 → 条件预拉 crud chunk → 与 session 模块加载/会话判定重叠
      const _perfLocalStart = performance.now();
      /** 本地路径原始结果（无论竞速胜负均保存）：bg 响应格式异常回退时，
       *  若本地路径已在 bg 胜出期间完成（.then 返回了 null），可直接复用此结果，
       *  避免被误判为会话无效（极低概率边缘竞态加固） */
      let localRawResult: {
        sessionValid: boolean;
        passwords: PasswordEntry[];
        sortConfig: { prop: string; order: string } | null;
      } | null = null;
      const localPromise = (async () => {
        // 锁屏态优先 + 有效态并行：session 模块加载先行发起保持在途；
        // 轻量过期预判（单次 storage IPC，毫秒级）返回后，未确认失效即刻预拉
        // passwordCrud chunk——与 session chunk 加载、isSessionValid 判定真正重叠，
        // 消除「session chunk → 会话判定 → crud chunk」三段串行瀑布
        // （Windows 冷盘每段 50~300ms 叠加）；
        // 已确认失效时维持「完全跳过 crud chunk」的锁屏优化（减少一次文件冷读）
        const isSessionValidFnPromise = getIsSessionValid();
        const quickInvalid = await isSessionQuicklyKnownInvalid();
        let crudPromise: ReturnType<typeof getPasswordCrudModule> | null = null;
        if (!quickInvalid) {
          crudPromise = getPasswordCrudModule();
          // 预拉分支未被采用时（边缘：预判有效但完整判定无效）吞掉加载失败，
          // 防 unhandled rejection；采用分支 await 时错误仍正常抛出
          crudPromise.catch(() => {});
        }
        const isSessionValidFn = await isSessionValidFnPromise;
        const sessionValid = await isSessionValidFn();
        if (!sessionValid) {
          return { sessionValid: false, passwords: [] as PasswordEntry[], sortConfig: null };
        }
        const crud = await (crudPromise ?? getPasswordCrudModule());
        const [sortConfigResult, loadedPasswords] = await Promise.all([
          getSidepanelSortConfig().catch(() => null),
          crud.getAllPasswords(),
        ]);
        return { sessionValid: true, passwords: loadedPasswords as PasswordEntry[], sortConfig: sortConfigResult };
      })().then(result => {
        localPathMs = performance.now() - _perfLocalStart;
        localRawResult = result;
        if (raceWinner) {
          // Background 路径已胜出，本地结果静默丢弃
          return null;
        }
        raceWinner = 'local';
        logger.debug(`SidePanel: 本地路径竞速胜出 (${localPathMs.toFixed(1)}ms)`);
        return { source: 'local' as const, data: result };
      });

      // 等待两条路径之一完成（取先到者）
      const winner = await Promise.race([bgPromise, localPromise]);
      logger.debug(
        `SidePanel: 竞速完成，胜出路径=${raceWinner}，总耗时 ${(performance.now() - _perfRaceStart).toFixed(1)}ms`,
      );

      /** 组装初始化元信息（含竞速内部耗时与 SW 侧分解，供性能环形日志归因 Windows 慢点） */
      const buildMeta = (
        winnerPath: 'bg' | 'local' | null,
        sessionValid: boolean,
        bgPerf?: { swProcessMs: number; cacheHit: boolean; swUptimeMs: number },
        bgLateAdopted = false,
      ): SidepanelInitMeta => ({
        raceWinner: winnerPath,
        bgLateAdopted,
        sessionValid,
        bgPathMs,
        localPathMs,
        bgSwProcessMs: bgPerf?.swProcessMs ?? null,
        bgCacheHit: bgPerf?.cacheHit ?? null,
        bgSwUptimeMs: bgPerf?.swUptimeMs ?? null,
      });

      // 确保 currentDomain 已就绪（loadCurrentTab 应在 winner 返回时已完成，此处防御性等待）
      await tabPromise;

      if (!winner) {
        // 两条路径都未返回有效结果（极端异常），降级为错误处理
        throw new Error('SidePanel: 所有初始化路径均失败');
      }

      if (winner.source === 'bg') {
        const response = winner.data;
        if (response?.success && response.data) {
          const data = response.data;

          if (data.sessionValid) {
            // Background 验证通过，直接展示数据
            _sessionKnownExpired = false;
            isAuthenticated.value = true;
            passwords.value = data.passwords;
            sortConfig.value = data.sortConfig;
            loading.value = false;

            logger.debug('SidePanel: Background 初始化数据加载完成（竞速胜出），条目数:' + data.passwords.length);

            // 胜出数据来自 bg 自身（命中缓存或冷路径已经 getOrWarmCache 回填），无需回传；
            // 轻量触发一次去重预热作为防御性兜底（缓存存在时 no-op）
            void triggerBackgroundCacheRefresh();

            // 本地路径可能仍在执行（dynamic import），让其静默完成
            localPromise.catch(() => {});
            return buildMeta('bg', true, data.perf);
          }

          // 会话无效
          logger.debug('SidePanel: 会话无效（Background 验证），显示未验证状态');
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          loading.value = false;

          localPromise.catch(() => {});
          return buildMeta('bg', false, data.perf);
        }

        // Background 返回了响应但格式异常（含 800ms 超时的 null），回退到本地路径
        logger.debug('SidePanel: Background 响应异常，等待本地路径');
        raceWinner = null;
        // 冷 SW 真实响应继续参战：SW 在 800ms 门限后才完成冷启动时（Windows 常见
        // 0.9~3s），其响应依然是最快的可用数据源，不应被超时门丢弃后空等本地长尾。
        // 仅在响应格式可用时 resolve；异常/拒绝保持 pending，由本地路径与兜底超时接管
        const lateBgUsable = new Promise<{ source: 'bg'; data: BgInitialDataResponse }>(resolve => {
          bgRawPromise
            .then(result => {
              const response = result as BgInitialDataResponse | null;
              if (response?.success && response.data) resolve({ source: 'bg', data: response });
            })
            .catch(() => {});
        });
        // 冷盘 IO 长尾兜底：本地路径附加超时，避免极端慢盘场景骨架屏无限等待
        const localWinner = await Promise.race([
          localPromise,
          lateBgUsable,
          new Promise<null>(resolve => setTimeout(() => resolve(null), LOCAL_PATH_TIMEOUT_MS)),
        ]);

        if (localWinner?.source === 'bg') {
          // 迟到的 bg 真实响应先到：守卫通过后采纳（语义与竞速胜出的 bg 分支一致）
          const data = localWinner.data.data!;
          bgPathMs = performance.now() - _perfBgStart;
          raceWinner = 'bg';
          localPromise.catch(() => {});

          if (data.sessionValid) {
            // 外部锁定守卫：采纳窗口（800ms~3s）内可能已收到 SESSION_EXPIRED 广播 /
            // 会话键移除（同步置位 _sessionKnownExpired），bg 响应是锁定前的陈旧快照，
            // 不得反向覆盖锁定态导致解密数据重新展示；锁定路径均已失效 TTL 缓存，
            // 补一次实时会话复核兜底（与本地迟到采纳的守卫逻辑一致）
            const isSessionValidFn = await getIsSessionValid();
            if (_sessionKnownExpired || !(await isSessionValidFn())) {
              logger.debug('SidePanel: 迟到 bg 响应与外部锁定冲突，放弃采纳并维持锁定态');
              _sessionKnownExpired = true;
              isAuthenticated.value = false;
              loading.value = false;
              return buildMeta('bg', false, data.perf, true);
            }
            logger.debug(`SidePanel: Background 冷启动迟到响应采纳（回退阶段，${bgPathMs.toFixed(1)}ms）`);
            _sessionKnownExpired = false;
            isAuthenticated.value = true;
            passwords.value = data.passwords;
            sortConfig.value = data.sortConfig;
            loading.value = false;
            void triggerBackgroundCacheRefresh();
            return buildMeta('bg', true, data.perf, true);
          }

          // 陈旧的锁定快照不得覆盖等待窗口内的手动解锁（isAuthenticated 已为 true 时跳过降级）
          if (isAuthenticated.value) {
            return buildMeta('bg', true, data.perf, true);
          }
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          loading.value = false;
          return buildMeta('bg', false, data.perf, true);
        }

        // 边缘竞态加固：若本地路径已在 bg 胜出期间完成（localWinner 为 null），
        // 复用已保存的原始结果，避免会话有效场景被误置为锁定态
        const localData2 = localWinner?.data ?? localRawResult;

        if (!localData2) {
          // 本地路径超时：先渲染锁定态降级 UI（用户可立即交互/重试解锁），
          // 迟到结果到达后静默采纳：会话有效则切回列表态，无效则维持锁定态不变
          logger.warn(`SidePanel: 本地路径超时（${LOCAL_PATH_TIMEOUT_MS}ms），降级渲染锁定态兜底 UI`);
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          loading.value = false;
          // bg 真实响应迟于兜底超时到达时同样静默采纳（守卫逻辑与本地迟到采纳一致）
          void lateBgUsable.then(async late => {
            const lateData = late.data.data;
            if (!lateData?.sessionValid) return;
            if (isAuthenticated.value) return;
            const isSessionValidFn = await getIsSessionValid();
            if (!(await isSessionValidFn())) return;
            // await 间隙后复检：另一迟到采纳路径 / 用户手动解锁可能已生效，勿用更陈旧快照覆盖
            if (isAuthenticated.value) return;
            logger.debug('SidePanel: Background 迟到结果会话有效（兜底超时后），采纳并切回列表态');
            _sessionKnownExpired = false;
            isAuthenticated.value = true;
            passwords.value = lateData.passwords;
            sortConfig.value = lateData.sortConfig;
            void triggerBackgroundCacheRefresh();
          });
          localPromise
            .then(async () => {
              if (!localRawResult?.sessionValid) return;
              // 竞态防护：用户已在等待窗口内手动解锁时，勿用陈旧快照覆盖更新的状态
              if (isAuthenticated.value) return;
              // 采纳前复核实时会话状态：sessionValid 是本地路径起点快照，
              // 若等待窗口内发生外部锁定（SESSION_EXPIRED 广播/会话键移除，
              // 锁定路径均已失效 TTL 缓存），此处实时检查会返回 false，
              // 放弃采纳，避免反向覆盖锁定状态导致解密数据重新展示
              const isSessionValidFn = await getIsSessionValid();
              if (!(await isSessionValidFn())) return;
              // await 间隙后复检：bg 迟到采纳路径 / 用户手动解锁可能已生效，勿用更陈旧快照覆盖
              if (isAuthenticated.value) return;
              logger.debug('SidePanel: 本地路径迟到结果会话有效，采纳并切回列表态');
              _sessionKnownExpired = false;
              isAuthenticated.value = true;
              passwords.value = localRawResult.passwords;
              sortConfig.value = localRawResult.sortConfig;
              void triggerBackgroundCacheRefresh();
            })
            .catch(() => {});
          return buildMeta(null, false);
        }

        if (localData2.sessionValid) {
          _sessionKnownExpired = false;
          isAuthenticated.value = true;
          passwords.value = localData2.passwords;
          sortConfig.value = localData2.sortConfig;
          loading.value = false;

          logger.debug('SidePanel: 本地初始化数据加载完成（bg 异常回退），条目数:' + localData2.passwords.length);
          void triggerBackgroundCacheRefresh();
          return buildMeta('local', true);
        }

        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        loading.value = false;
        return buildMeta('local', false);
      }

      // 本地路径竞速胜出
      const localData = winner.data;

      if (!localData.sessionValid) {
        logger.debug('SidePanel: 会话无效（本地验证），显示未验证状态');
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        loading.value = false;

        // 等待 bg 路径完成（可能迟到），用于同步状态
        bgPromise.catch(() => {});
        return buildMeta('local', false);
      }

      _sessionKnownExpired = false;
      // 先设置 isAuthenticated 再设置 passwords，
      // Vue 批量更新保证同一 tick 内不会渲染「已认证但空列表」的中间态
      isAuthenticated.value = true;
      passwords.value = localData.passwords;
      sortConfig.value = localData.sortConfig;
      loading.value = false;

      logger.debug('SidePanel: 本地初始化数据加载完成（竞速胜出），条目数:' + localData.passwords.length);

      // Background 路径可能迟到（冷 SW）：其 GET_INITIAL_DATA 冷分支已经 getOrWarmCache
      // 自行回填缓存，无需回传全量明文；迟到后轻量触发一次去重预热作为兜底
      bgPromise
        .then(() => {
          if (bgLateResult?.success && bgLateResult.data?.sessionValid) {
            logger.debug('SidePanel: Background 迟到结果到达，触发缓存预热兜底');
            void triggerBackgroundCacheRefresh();
          }
        })
        .catch(() => {});
      return buildMeta('local', true);
    } catch (error) {
      logger.error('SidePanel: 初始化失败:', error);
      isAuthenticated.value = false;
      loading.value = false;
      return { raceWinner: null, sessionValid: false };
    }
  };

  // ==================== 清理 ====================

  /** 组件卸载时清理 port 连接和心跳定时器 */
  onUnmounted(() => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (bgPort) {
      bgPort.disconnect();
      bgPort = null;
    }
  });

  return {
    // 状态
    passwords,
    loading,
    isAuthenticated,
    currentDomain,
    showSidepanel,
    sortConfig,
    // 方法
    loadPasswords,
    loadCurrentTab,
    initSidepanelData,
    getDomainPriority,
    runLocalOperation,
  };
}
