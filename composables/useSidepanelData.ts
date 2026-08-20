import { ref, onUnmounted } from 'vue';
import type { PasswordEntry, RuntimeMessage } from '@/utils/types';
import { MessageType } from '@/utils/types';
import type { SidepanelInitMeta } from '@/utils/perfMetrics';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';
import { useChromeListeners } from '@/composables/useChromeListeners';
import { useLocalOperationGuard } from '@/composables/useLocalOperationGuard';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { isExactHostMatch } from '@/utils/domain';
import { lazyImport } from '@/utils/lazyImport';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';
import {
  waitForBrowserStartupRelockMarker,
  waitForBrowserStartupRelockStatus,
  type BrowserStartupRelockWaitStatus,
} from '@/utils/browserStartupRelock';

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
 * 快照、Background 与本地路径同时启动；本地路径（chunk 冷读 + storage IO +
 * 全量解密）在冷盘极端场景下仍可能长尾阻塞。统一超时后先渲染锁定态降级 UI，
 * 任一路迟到完成后仅在会话代际和权威校验均通过时恢复真实结果。
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
 * 优先读取 storage.session（纯内存 IPC，不受磁盘 IO / 杀毒扫描影响）中的
 * SESSION_LOCK_STATE 镜像：SW 侧 createSession 写入 { locked: false, expiresAt }，
 * clearSession / markSessionInvalid 写入 { locked: true }。命中时立即返回判定结果，
 * 消除 Windows 内网慢磁盘场景下 storage.local IPC 延迟（200-500ms）导致
 * _quickKnownInvalid 迟迟不就绪、骨架屏续期延伸至 2.5-5s 的白屏问题。
 *
 * 浏览器重启后 storage.session 自动清零（无 SESSION_LOCK_STATE）→ 降级读取
 * storage.local 中的会话过期时间戳（兜底路径，与旧版行为完全一致）。
 *
 * 返回 true 表示会话已确定失效，调用方可立即淡出骨架屏展示锁屏 UI；
 * 返回 false 时交由 initSidepanelData 完整竞速判定（fail-locked，无误判解锁风险）。
 */
export async function isSessionQuicklyKnownInvalid(): Promise<boolean> {
  // SESSION_LOCK_STATE 键名字面量：避免静态 import SESSION_MEMORY_KEYS（破坏懒加载分包）
  const SESSION_LOCK_STATE_KEY = 'session_lock_state';
  try {
    // 快速路径：优先从纯内存的 storage.session 读取锁定状态镜像
    const sessionResult = await chrome.storage.session.get(SESSION_LOCK_STATE_KEY);
    const lockState = sessionResult[SESSION_LOCK_STATE_KEY] as { locked: boolean; expiresAt?: number } | undefined;

    if (lockState !== undefined) {
      // locked: true → 已被 clearSession / markSessionInvalid 明确标记为锁定
      if (lockState.locked) return true;
      // locked: false 且 expiresAt 有效 → 会话确定有效（不走锁屏快速路径）
      if (lockState.expiresAt) {
        return Date.now() >= lockState.expiresAt;
      }
      // locked: false 但无 expiresAt（边缘：createSession 写入时 session.set 失败过）
      // → 降级到 storage.local 兜底，不武断返回 false
    }

    // 兜底路径：storage.session 无镜像（浏览器重启后首次打开）→ 读 storage.local
    const result = await chrome.storage.local.get(SESSION_EXPIRY_KEY);
    const expiry = result[SESSION_EXPIRY_KEY] as number | undefined;
    return !expiry || Date.now() >= expiry;
  } catch {
    // 读取失败不走快速路径，交由完整竞速判定
    return false;
  }
}

/**
 * 解析侧边栏启动阶段的轻量会话失效提示。
 *
 * 调用方可传入已经发起的判定 Promise，避免快照未命中后本地回退路径再次读取
 * storage.session/storage.local。该值只决定是否提前预拉 passwordCrud chunk，
 * 最终认证状态仍由完整 isSessionValid 判定，因而不会改变会话安全语义。
 */
export async function resolveQuickSessionInvalidHint(prefetched?: Promise<boolean>): Promise<boolean> {
  try {
    return await (prefetched ?? isSessionQuicklyKnownInvalid());
  } catch {
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

interface InitialDataResult {
  sessionValid: boolean;
  passwords: PasswordEntry[];
  sortConfig: { prop: string; order: string } | null;
  perf?: { swProcessMs: number; cacheHit: boolean; swUptimeMs: number };
}

interface BgInitialDataResponse {
  success?: boolean;
  data?: InitialDataResult;
}

type InitialDataCandidate =
  | { source: 'snapshot'; data: SnapshotReadResult }
  | { source: 'bg'; data: InitialDataResult }
  | { source: 'local'; data: InitialDataResult };

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
async function readSessionSnapshot(
  startupRelockStatus?: Promise<BrowserStartupRelockWaitStatus>,
): Promise<SnapshotReadResult | null> {
  try {
    const status = startupRelockStatus
      ? await startupRelockStatus
      : (await waitForBrowserStartupRelockMarker())
        ? 'ready'
        : 'blocked';
    if (status !== 'ready') return null;
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
  const currentPort = ref('');
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
   * 当前 Side Panel 上下文的会话代际。
   *
   * 初始化期间只要发生锁定、解锁、续期或 rekey，storage/message 监听都会同步递增。
   * 所有异步数据源提交前必须仍处于启动时捕获的同一代际，避免旧快照或旧 SW 响应
   * 在会话状态变化后把明文列表重新写回界面。
   */
  let _sessionGeneration = 0;

  /** 同一会话代际内的密码列表加载序号，保证只允许最后一次请求提交。 */
  let _passwordLoadSequence = 0;

  /** 异步权威会话检查序号；锁定/rekey/并发新检查会使旧结果失效。 */
  let _sessionCheckSequence = 0;

  const advanceSessionGeneration = (): void => {
    _sessionGeneration += 1;
    _sessionCheckSequence += 1;
  };

  /**
   * 本地操作守卫：防止 storage watcher 在本地操作期间触发全量 loadPasswords
   *
   * 当侧边栏自身发起 storage 写入（收藏/填充更新 lastUsedAt）时，
   * handleStorageChange 检测到此标志后跳过 loadPasswords，避免全量重载覆盖
   * Vue 层已就地完成的状态更新。
   */
  const { isLocalOperation: localOperationFlag, runLocalOperation } = useLocalOperationGuard();

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

  // ==================== 数据加载 ====================

  /**
   * 加载当前标签页信息（获取域名和端口）
   */
  const loadCurrentTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url) {
        const url = new URL(tab.url);
        currentDomain.value = url.hostname;
        currentPort.value = url.port;
      }
      return tab;
    } catch (error) {
      logger.error('获取当前标签页失败:', error);
      return undefined;
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
    const loadGeneration = _sessionGeneration;
    const loadSequence = ++_passwordLoadSequence;
    const canCommitLoad = (): boolean =>
      loadGeneration === _sessionGeneration && loadSequence === _passwordLoadSequence;

    try {
      if (!silent) loading.value = true;

      if (!skipSessionCheck) {
        // 检查会话是否有效（延迟加载 sessionManager-storage）
        const isSessionValidFn = await getIsSessionValid();
        const sessionValid = await isSessionValidFn();
        if (!sessionValid) {
          if (!canCommitLoad()) return;
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
      if (!canCommitLoad() || !isAuthenticated.value) {
        return;
      }

      sortConfig.value = sortConfigResult;
      passwords.value = loadedPasswords;
      loading.value = false;

      // 后台静默触发缓存刷新（不阻塞 UI 渲染）
      void triggerBackgroundCacheRefresh();
    } catch (error) {
      if (!canCommitLoad()) return;
      logger.error('加载密码列表失败:', error);
      // 静默刷新本意为「无感」：失败时仅记日志不弹 toast，避免与并发的
      // 非静默加载重叠时误报「加载失败」（列表随后会正常加载出来）
      if (!silent) ElMessage.error(t('message.loadListFailed'));
    } finally {
      // 兜底确保 loading 状态清除（异常路径安全网）
      if (canCommitLoad()) loading.value = false;
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
    const checkGeneration = _sessionGeneration;
    const checkSequence = ++_sessionCheckSequence;
    const canCommitCheck = (): boolean =>
      checkGeneration === _sessionGeneration && checkSequence === _sessionCheckSequence;

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

      // onStartup 重锁 pending/failed 时不能恢复旧持久会话；超时/读取失败同样保持锁定。
      if ((await waitForBrowserStartupRelockStatus()) !== 'ready') {
        if (!canCommitCheck()) return;
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        passwords.value = [];
        return;
      }

      const isSessionValidFn = await getIsSessionValid();
      const sessionActive = await isSessionValidFn();
      if (!canCommitCheck()) return;
      if (sessionActive && !isAuthenticated.value) {
        advanceSessionGeneration();
        _sessionKnownExpired = false;
        const authenticatedGeneration = _sessionGeneration;
        const authenticatedCheckSequence = _sessionCheckSequence;
        await loadCurrentTab();
        if (authenticatedGeneration !== _sessionGeneration || authenticatedCheckSequence !== _sessionCheckSequence) {
          return;
        }
        isAuthenticated.value = true;
        await loadPasswords(true);
      } else if (!sessionActive && isAuthenticated.value) {
        advanceSessionGeneration();
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        passwords.value = [];
      }
    } catch (error) {
      if (canCommitCheck()) logger.error('SidePanel: 检查会话状态失败:', error);
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
    const sessionKeys = [
      'session_wrapped_data_key',
      'session_password_expiry',
      'session_validity_hours',
      SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE,
      SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY,
    ];
    const hasSessionChange = Object.keys(changes).some(key => sessionKeys.includes(key));

    if (hasSessionChange) {
      // 同步失效所有正在等待的快照/BG/local 初始化结果；必须早于任何 await。
      advanceSessionGeneration();
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
      if (localOperationFlag.value) {
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
        const newPort = url.port;

        if (currentDomain.value !== newDomain || currentPort.value !== newPort) {
          currentDomain.value = newDomain;
          currentPort.value = newPort;

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
        advanceSessionGeneration();
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
   * - 加密快照、Background GET_INITIAL_DATA 与本地 storage 直读同时启动，取首个可用结果
   * - 热 SW 场景：Background 路径 ~20ms 胜出，本地路径静默完成
   * - 冷 SW 场景：本地路径 ~200-400ms 先完成，Background 迟到结果用于缓存更新
   * - 任一路拒绝/格式异常只淘汰自身，统一 3s 上限后安全显示锁定态；迟到结果仍可在代际复核后采纳
   * - loadCurrentTab 与 GET_INITIAL_DATA 并行执行，节约 ~5ms 串行延迟
   *
   * @returns 初始化元信息（竞速胜出路径 + 会话状态），供性能埋点记录维度使用
   */
  const initSidepanelData = async (quickInvalidHintPromise?: Promise<boolean>): Promise<SidepanelInitMeta> => {
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
          advanceSessionGeneration();
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
      const initGeneration = _sessionGeneration;
      const startupRelockStatusPromise = waitForBrowserStartupRelockStatus();

      const isCurrentGeneration = (): boolean => initGeneration === _sessionGeneration;

      // 当前标签页、快照、Background 与本地路径必须在同一时刻启动，避免快照未命中/损坏时
      // 才串行唤醒 SW 和冷读本地 chunk。标签页结果同时用于 Side Panel 多窗口 READY 握手。
      const tabPromise = loadCurrentTab();
      void tabPromise.then(tab => {
        if (!bgPort || tab?.id === undefined || tab.windowId === undefined) return;
        try {
          bgPort.postMessage({ type: MessageType.SIDEPANEL_READY, tabId: tab.id, windowId: tab.windowId });
        } catch {
          // port 已断开时由 onDisconnect 统一清理
        }
      });

      // 路径 0: storage.session 加密快照直读（最快路径，纯内存 IPC + 单次 AES-GCM）
      // SW 侧 warmPasswordCache 成功后写入加密快照，侧边栏冷启动时直读解密，
      // 跳过 SW 唤醒 + storage.local 磁盘 IO + 逐条解密（200-3000ms → <50ms）；
      // 快照不存在/过期/解密失败时静默降级到 bg/local 竞速
      const _perfSnapshotStart = performance.now();
      const snapshotPromise = readSessionSnapshot(startupRelockStatusPromise).then(result => {
        if (!result) return null;
        logger.debug(`SidePanel: 快照路径完成 (${(performance.now() - _perfSnapshotStart).toFixed(1)}ms)`);
        return { source: 'snapshot' as const, data: result };
      });

      // 快照与 bg/local 三路竞速
      // 竞速标记：null = 未决出胜负，'bg' = Background 路径胜出，'local' = 本地路径胜出
      let raceWinner: 'bg' | 'local' | null = null;
      // 性能埋点：Background/本地路径各自耗时（写入环形日志，生产环境可定位慢点归属）
      let bgPathMs: number | null = null;
      let localPathMs: number | null = null;
      /** Background 路径迟到结果（本地路径先胜出时保存，用于静默更新缓存） */
      let bgLateResult: BgInitialDataResponse | null = null;

      // 路径 B: Background GET_INITIAL_DATA（热 SW 快通道）
      const _perfBgStart = performance.now();
      /** bg 原始响应 Promise（独立持有，不随 800ms 竞速门丢弃）：
       *  冷 SW 在 800ms 后才完成启动时，其真实响应仍可在回退阶段与本地路径继续竞速被采纳，
       *  消除「迟到数据被丢弃 → 空等本地路径 + 3s 兜底超时」的最坏瀑布（Windows 冷 SW 主卡点） */
      const bgRawPromise = chrome.runtime
        .sendMessage({
          type: MessageType.GET_INITIAL_DATA,
        })
        // 发送失败（扩展上下文失效/SW 不可达）归一化为 null：
        // 与 800ms 竞速门超时同语义，统一进入「bg 响应异常 → 回退本地路径」降级分支，
        // 避免 reject 提前终止竞速导致整体初始化失败
        .catch(() => null);
      const bgPromise = Promise.race([
        bgRawPromise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 800)),
      ]).then(result => {
        bgPathMs = performance.now() - _perfBgStart;
        if (!result?.success || !result.data) return null;
        if (raceWinner) {
          bgLateResult = result;
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
      const localPromise = (async () => {
        const startupRelockStatus = await startupRelockStatusPromise;
        if (startupRelockStatus === 'unavailable') return null;
        if (startupRelockStatus === 'blocked') {
          return { sessionValid: false, passwords: [] as PasswordEntry[], sortConfig: null };
        }
        // 锁屏态优先 + 有效态并行：session 模块加载先行发起保持在途；
        // 轻量过期预判（单次 storage IPC，毫秒级）返回后，未确认失效即刻预拉
        // passwordCrud chunk——与 session chunk 加载、isSessionValid 判定真正重叠，
        // 消除「session chunk → 会话判定 → crud chunk」三段串行瀑布
        // （Windows 冷盘每段 50~300ms 叠加）；
        // 已确认失效时维持「完全跳过 crud chunk」的锁屏优化（减少一次文件冷读）
        const isSessionValidFnPromise = getIsSessionValid();
        const quickInvalid = await resolveQuickSessionInvalidHint(quickInvalidHintPromise);
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
      })()
        .then(result => {
          localPathMs = performance.now() - _perfLocalStart;
          if (!result) return null;
          if (raceWinner) {
            // 其他路径已胜出，本地结果静默丢弃
            return null;
          }
          raceWinner = 'local';
          logger.debug(`SidePanel: 本地路径竞速胜出 (${localPathMs.toFixed(1)}ms)`);
          return { source: 'local' as const, data: result };
        })
        .catch(error => {
          localPathMs = performance.now() - _perfLocalStart;
          logger.warn('SidePanel: 本地初始化路径失败，继续等待其他数据源:', error);
          return null;
        });

      // 只让“可用结果”决出胜负：任一路 null/reject 都不会提前结束其他路径。
      const firstUsableCandidate = new Promise<InitialDataCandidate>(resolve => {
        void snapshotPromise.then(result => {
          if (result) resolve(result);
        });
        void bgPromise.then(result => {
          if (result?.data.data) resolve({ source: 'bg', data: result.data.data });
        });
        void localPromise.then(result => {
          if (result) resolve(result);
        });
      });
      const winner = await Promise.race([
        firstUsableCandidate,
        new Promise<null>(resolve => setTimeout(() => resolve(null), LOCAL_PATH_TIMEOUT_MS)),
      ]);
      logger.debug(
        `SidePanel: 竞速完成，胜出路径=${raceWinner}，总耗时 ${(performance.now() - _perfRaceStart).toFixed(1)}ms`,
      );

      /** 组装初始化元信息（含竞速内部耗时与 SW 侧分解，供性能环形日志归因 Windows 慢点） */
      const buildMeta = (
        winnerPath: 'bg' | 'local' | 'snapshot' | null,
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

      if (!winner) {
        logger.warn(`SidePanel: 所有初始化路径在 ${LOCAL_PATH_TIMEOUT_MS}ms 内均未返回可用结果，安全降级锁定态`);
        if (isCurrentGeneration()) {
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          passwords.value = [];
          loading.value = false;
        }

        // 慢盘/冷 SW 迟到时仍可恢复，但提交前必须复核权威会话且代际未变化。
        void firstUsableCandidate.then(async late => {
          if (!late.data.sessionValid || !isCurrentGeneration() || isAuthenticated.value) return;
          const isSessionValidFn = await getIsSessionValid();
          if (!(await isSessionValidFn()) || !isCurrentGeneration() || isAuthenticated.value) return;
          logger.debug(`SidePanel: ${late.source} 迟到结果通过会话代际复核，恢复认证列表`);
          _sessionKnownExpired = false;
          isAuthenticated.value = true;
          passwords.value = late.data.passwords;
          sortConfig.value = late.data.sortConfig;
          loading.value = false;
          void triggerBackgroundCacheRefresh();
        });
        return buildMeta(null, false);
      }

      if (!isCurrentGeneration()) {
        logger.debug('SidePanel: 初始化期间会话代际已变化，丢弃旧数据源结果');
        return buildMeta(winner.source, isAuthenticated.value, winner.source === 'bg' ? winner.data.perf : undefined);
      }

      if (winner.source === 'snapshot') {
        _sessionKnownExpired = false;
        isAuthenticated.value = true;
        passwords.value = winner.data.passwords;
        sortConfig.value = winner.data.sortConfig;
        loading.value = false;
        void triggerBackgroundCacheRefresh();
        return buildMeta('snapshot', true);
      }

      // Background/本地列表在首次绘制前保持原有域名过滤时序；快照路径无需等待该 IPC。
      await tabPromise;
      if (!isCurrentGeneration()) {
        logger.debug('SidePanel: 等待当前标签页期间会话代际已变化，丢弃旧数据源结果');
        return buildMeta(winner.source, isAuthenticated.value, winner.source === 'bg' ? winner.data.perf : undefined);
      }

      if (winner.source === 'bg') {
        const data = winner.data;
        if (data.sessionValid) {
          _sessionKnownExpired = false;
          isAuthenticated.value = true;
          passwords.value = data.passwords;
          sortConfig.value = data.sortConfig;
          loading.value = false;
          logger.debug('SidePanel: Background 初始化数据加载完成（竞速胜出），条目数:' + data.passwords.length);
          void triggerBackgroundCacheRefresh();
          return buildMeta('bg', true, data.perf);
        }

        logger.debug('SidePanel: 会话无效（Background 验证），显示未验证状态');
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        passwords.value = [];
        loading.value = false;
        return buildMeta('bg', false, data.perf);
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
    currentPort,
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
