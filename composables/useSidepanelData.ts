import { ref, onUnmounted } from 'vue';
import type { PasswordEntry, RuntimeMessage } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';
import { useChromeListeners } from '@/composables/useChromeListeners';
import { logger } from '@/utils/logger';

// ==================== 延迟加载模块（避免初始加载拉入 encryption.ts 加密链） ====================

/**
 * 延迟加载 sessionManager-storage 模块（首次回退/事件触发时加载）
 * isSessionValid 在热路径中由 background SW 执行，本地仅在回退和事件处理中使用
 */
let _sessionModule: typeof import('@/utils/sessionManager-storage') | null = null;
const getIsSessionValid = async () => {
  if (!_sessionModule) {
    _sessionModule = await import('@/utils/sessionManager-storage');
  }
  return _sessionModule.isSessionValid;
};

/**
 * 延迟调用 invalidateSessionCache（fire-and-forget）
 * 在 clearSession 路径中异步失效 session 缓存，防止并发 isSessionValid()
 * 从 5s TTL 缓存中返回过期 true 值。首次调用时触发 dynamic import。
 */
const invalidateSessionCacheAsync = async () => {
  if (!_sessionModule) {
    _sessionModule = await import('@/utils/sessionManager-storage');
  }
  _sessionModule.invalidateSessionCache();
};

/**
 * 延迟加载 passwordCrud 模块（首次回退路径时加载）
 * getAllPasswords/getPasswordsByUrl 在热路径中由 background SW 执行，本地仅在回退时使用
 */
let _crudModule: typeof import('@/utils/storage/passwordCrud') | null = null;
const getPasswordCrudModule = async () => {
  if (!_crudModule) {
    _crudModule = await import('@/utils/storage/passwordCrud');
  }
  return _crudModule;
};

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
  /** 是否正在进行首次初始化（含缓存检测 + 会话验证），用于模板显示 loading 过渡态 */
  const initializing = ref(true);
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

  // ==================== 域名工具 ====================

  /**
   * 域名匹配优先级：0=匹配, 1=不匹配
   */
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!currentDomain.value) return 0;
    const hasUrl = entry.url && entry.url.trim() !== '';
    if (hasUrl && (currentDomain.value.includes(entry.url) || entry.url.includes(currentDomain.value))) return 0;
    return 1;
  };

  // ==================== 缓存操作 ====================

  /**
   * 更新 background 中的密码缓存
   */
  const updatePasswordCacheInBackground = async (
    passwordList: PasswordEntry[],
    domain: string,
    authenticated: boolean,
  ): Promise<void> => {
    try {
      await chrome.runtime.sendMessage({
        type: MessageType.UPDATE_PASSWORD_CACHE,
        data: {
          passwords: passwordList,
          domain,
          isAuthenticated: authenticated,
        },
      });
    } catch (error) {
      logger.error('SidePanel: 更新缓存失败:', error);
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
   */
  const loadPasswords = async (skipSessionCheck = false) => {
    try {
      loading.value = true;

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

      // 后台静默更新缓存（不阻塞 UI 渲染）
      void updatePasswordCacheInBackground(loadedPasswords, currentDomain.value, isAuthenticated.value);
    } catch (error) {
      logger.error('加载密码列表失败:', error);
      ElMessage.error('加载密码列表失败');
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
    const sessionKeys = ['session_master_password', 'session_password_expiry', 'session_validity_hours'];
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
      } else {
        _sessionKnownExpired = false;
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
      logger.debug('SidePanel: 检测到密码数据变动，重新加载');
      if (isAuthenticated.value) {
        void loadPasswords();
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
   * - GET_INITIAL_DATA 超时从 2000ms 降至 1200ms，避免冷 SW 场景无谓等待
   * - loadCurrentTab 与 GET_INITIAL_DATA 并行执行，节约 ~5ms 串行延迟
   */
  const initSidepanelData = async () => {
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
      // 竞速标记：null = 未决出胜负，'bg' = Background 路径胜出，'local' = 本地路径胜出
      let raceWinner: 'bg' | 'local' | null = null;
      /** Background 路径迟到结果（本地路径先胜出时保存，用于静默更新缓存） */
      let bgLateResult: {
        success?: boolean;
        data?: {
          sessionValid: boolean;
          passwords: PasswordEntry[];
          sortConfig: { prop: string; order: string } | null;
        };
      } | null = null;

      // 路径 A: loadCurrentTab（并行，不阻塞 GET_INITIAL_DATA）
      const tabPromise = loadCurrentTab();

      // 路径 B: Background GET_INITIAL_DATA（热 SW 快通道，1200ms 超时）
      const bgPromise = Promise.race([
        chrome.runtime.sendMessage({
          type: MessageType.GET_INITIAL_DATA,
        }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 1200)),
      ]).then(result => {
        if (raceWinner) {
          // 本地路径已胜出，保存 bg 结果用于静默更新缓存
          bgLateResult = result as typeof bgLateResult;
          return null;
        }
        raceWinner = 'bg';
        return { source: 'bg' as const, data: result };
      });

      // 路径 C: 本地 storage 直读（冷 SW 回退通道，动态 import + storage 读取并行启动）
      const localPromise = (async () => {
        const isSessionValidFn = await getIsSessionValid();
        const sessionValid = await isSessionValidFn();
        if (!sessionValid) {
          return { sessionValid: false, passwords: [] as PasswordEntry[], sortConfig: null };
        }
        const crud = await getPasswordCrudModule();
        const [sortConfigResult, loadedPasswords] = await Promise.all([
          getSidepanelSortConfig().catch(() => null),
          crud.getAllPasswords(),
        ]);
        return { sessionValid: true, passwords: loadedPasswords as PasswordEntry[], sortConfig: sortConfigResult };
      })().then(result => {
        if (raceWinner) {
          // Background 路径已胜出，本地结果静默丢弃
          return null;
        }
        raceWinner = 'local';
        return { source: 'local' as const, data: result };
      });

      // 等待两条路径之一完成（取先到者）
      const winner = await Promise.race([bgPromise, localPromise]);

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
            initializing.value = false;

            logger.debug('SidePanel: Background 初始化数据加载完成（竞速胜出），条目数:' + data.passwords.length);

            // 后台静默更新缓存
            void updatePasswordCacheInBackground(data.passwords, currentDomain.value, true);

            // 本地路径可能仍在执行（dynamic import），让其静默完成
            localPromise.catch(() => {});
            return;
          }

          // 会话无效
          logger.debug('SidePanel: 会话无效（Background 验证），显示未验证状态');
          _sessionKnownExpired = true;
          isAuthenticated.value = false;
          loading.value = false;
          initializing.value = false;

          localPromise.catch(() => {});
          return;
        }

        // Background 返回了响应但格式异常，回退到本地路径
        logger.debug('SidePanel: Background 响应异常，等待本地路径');
        raceWinner = null;
        const localWinner = await localPromise;
        if (localWinner && localWinner.data.sessionValid) {
          _sessionKnownExpired = false;
          loading.value = true;
          isAuthenticated.value = true;
          passwords.value = localWinner.data.passwords;
          sortConfig.value = localWinner.data.sortConfig;
          loading.value = false;
          initializing.value = false;

          logger.debug('SidePanel: 本地初始化数据加载完成（bg 异常回退），条目数:' + localWinner.data.passwords.length);
          void updatePasswordCacheInBackground(localWinner.data.passwords, currentDomain.value, true);
          return;
        }

        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        loading.value = false;
        initializing.value = false;
        return;
      }

      // 本地路径竞速胜出
      const localData = winner.data;

      if (!localData.sessionValid) {
        logger.debug('SidePanel: 会话无效（本地验证），显示未验证状态');
        _sessionKnownExpired = true;
        isAuthenticated.value = false;
        loading.value = false;
        initializing.value = false;

        // 等待 bg 路径完成（可能迟到），用于同步状态
        bgPromise.catch(() => {});
        return;
      }

      _sessionKnownExpired = false;
      // 先设置 loading=true 再设置 isAuthenticated=true，
      // 避免中间渲染帧显示「已认证但空列表」的闪烁状态
      loading.value = true;
      isAuthenticated.value = true;
      passwords.value = localData.passwords;
      sortConfig.value = localData.sortConfig;
      loading.value = false;
      initializing.value = false;

      logger.debug('SidePanel: 本地初始化数据加载完成（竞速胜出），条目数:' + localData.passwords.length);

      // Background 路径可能迟到，等待其结果用于静默更新缓存
      bgPromise
        .then(() => {
          if (bgLateResult?.success && bgLateResult.data?.sessionValid) {
            logger.debug('SidePanel: Background 迟到结果到达，静默更新缓存');
            void updatePasswordCacheInBackground(bgLateResult.data.passwords, currentDomain.value, true);
          }
        })
        .catch(() => {});
    } catch (error) {
      logger.error('SidePanel: 初始化失败:', error);
      isAuthenticated.value = false;
      loading.value = false;
      initializing.value = false;
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
    initializing,
    isAuthenticated,
    currentDomain,
    showSidepanel,
    sortConfig,
    // 方法
    loadPasswords,
    loadCurrentTab,
    initSidepanelData,
    getDomainPriority,
  };
}
