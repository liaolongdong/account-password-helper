import { ref, onUnmounted } from 'vue';
import type { PasswordEntry, PasswordCache, RuntimeMessage } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { isSessionValid } from '@/utils/sessionManager-storage';
import { getAllPasswords, getPasswordsByUrl } from '@/utils/storage/passwordCrud';
import { getSidepanelSortConfig } from '@/utils/storage/configManager';
import { useChromeListeners } from '@/composables/useChromeListeners';
import { logger } from '@/utils/logger';
import { isLocalDevDomain } from '@/utils/domain';

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

  // ==================== 初始化竞速状态 ====================

  /** 标记初始化时缓存是否已先于 storage 返回并设置了数据，用于避免 loadPasswords 覆盖缓存数据 */
  let _cacheWonInitRace = false;

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
   * 从 background 获取缓存的密码数据
   * 用于后台预热缓存，不阻塞首屏加载。超时缩短为 500ms。
   * @param domain 域名
   * @param timeoutMs 超时毫秒数，默认 500ms
   * @returns 缓存的密码数据或 null
   */
  const getCachedPasswordsFromBackground = async (domain?: string, timeoutMs = 500): Promise<PasswordCache | null> => {
    try {
      const timeoutPromise = new Promise<null>(resolve => {
        setTimeout(() => resolve(null), timeoutMs);
      });
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          type: MessageType.GET_CACHED_PASSWORDS,
          data: { domain },
        }),
        timeoutPromise,
      ]);
      if (response?.success && response.data) {
        return response.data as PasswordCache;
      }
      return null;
    } catch (error) {
      logger.error('SidePanel: 获取缓存数据失败:', error);
      return null;
    }
  };

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
      // 竞速模式下缓存已先返回并设置了数据时，静默更新（不动 loading/passwords 状态）
      if (!_cacheWonInitRace) {
        loading.value = true;
      }

      if (!skipSessionCheck) {
        // 检查会话是否有效
        const sessionValid = await isSessionValid();
        if (!sessionValid) {
          isAuthenticated.value = false;
          passwords.value = [];
          return;
        }
      }

      // 并行读取：排序配置 + 密码数据（两个 IPC 互相独立，并行执行减少等待）
      const fetchPasswords = (): Promise<PasswordEntry[]> => {
        if (currentDomain.value) {
          // 本地开发环境（localhost / 127.0.0.1）默认匹配所有账号密码
          if (isLocalDevDomain(currentDomain.value)) {
            return getAllPasswords();
          }
          return getPasswordsByUrl(currentDomain.value);
        }
        return getAllPasswords();
      };

      const [sortConfigResult, loadedPasswords] = await Promise.all([
        getSidepanelSortConfig().catch(() => null),
        fetchPasswords(),
      ]);

      // 竞速模式下缓存已先返回时，保留缓存数据（两者应一致），仅同步 sortConfig 和 background 缓存
      if (!_cacheWonInitRace) {
        sortConfig.value = sortConfigResult;
        passwords.value = loadedPasswords;
        loading.value = false; // 提前清除 loading 状态，不等待缓存更新
      } else {
        sortConfig.value = sortConfigResult;
      }

      // 后台静默更新缓存（不阻塞 UI 渲染）
      void updatePasswordCacheInBackground(loadedPasswords, currentDomain.value, isAuthenticated.value);
    } catch (error) {
      logger.error('加载密码列表失败:', error);
      ElMessage.error('加载密码列表失败');
    } finally {
      // 兜底确保 loading 状态清除（异常路径安全网）
      if (!_cacheWonInitRace) {
        loading.value = false;
      }
    }
  };

  // ==================== 会话与事件处理 ====================

  /**
   * 监听会话状态变化
   */
  const handleSessionChange = async () => {
    try {
      const sessionActive = await isSessionValid();
      if (sessionActive && !isAuthenticated.value) {
        isAuthenticated.value = true;
        await loadCurrentTab();
        await loadPasswords();
      } else if (!sessionActive && isAuthenticated.value) {
        isAuthenticated.value = false;
        passwords.value = [];
      }
    } catch (error) {
      logger.error('SidePanel: 检查会话状态失败:', error);
    }
  };

  /**
   * 监听存储变化
   */
  const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    const sessionKeys = ['session_master_password', 'session_password_expiry', 'session_validity_hours'];
    const hasSessionChange = Object.keys(changes).some(key => sessionKeys.includes(key));

    if (hasSessionChange) {
      handleSessionChange();
    }

    // 密码数据变化时，重新加载密码列表（解决自动保存后快速填充列表不刷新的问题）
    if (changes['account_passwords']) {
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
   */
  const handleVisibilityChange = () => {
    if (!document.hidden) {
      handleSessionChange();
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
   * 性能优化（Phase 2）：「Background 一站式加载」模式
   * - 将原 sidepanel 端的多步操作（session 验证 + storage 读取 + 排序读取）
   *   合并为 background SW 端的单次 GET_INITIAL_DATA 调用
   * - 配合 SW 保活策略（Phase 1），热 SW 场景数据在 20-50ms 内返回
   * - Background SW 已完成会话验证、密码加载和域名过滤，sidepanel 直接展示
   * - 若 background 调用失败（极端冷启动），回退到本地 session 验证 + storage 直读
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
          isAuthenticated.value = false;
          passwords.value = [];
        }
      });
      bgPort.onDisconnect.addListener(() => {
        bgPort = null;
      });
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
      // 先获取当前标签页域名
      await loadCurrentTab();

      // 从 background SW 获取初始化数据（会话验证 + 密码列表 + 排序配置一站式完成）
      // 配合 SW 保活策略，热 SW 场景 20-50ms 返回；冷 SW 设置 2000ms 超时兜底
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          type: MessageType.GET_INITIAL_DATA,
          data: { domain: currentDomain.value },
        }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
      ]);

      if (response?.success && response.data) {
        const data = response.data;

        if (data.sessionValid) {
          // Background 验证通过，直接展示数据
          isAuthenticated.value = true;
          passwords.value = data.passwords;
          sortConfig.value = data.sortConfig;
          loading.value = false;
          initializing.value = false;

          logger.debug('SidePanel: Background 初始化数据加载完成，条目数:' + data.passwords.length);

          // 后台静默更新缓存，确保后续缓存竞速可用
          void updatePasswordCacheInBackground(data.passwords, currentDomain.value, true);
          return;
        }

        // 会话无效
        logger.debug('SidePanel: 会话无效（Background 验证），显示未验证状态');
        isAuthenticated.value = false;
        loading.value = false;
        initializing.value = false;
        return;
      }

      // Background 调用超时或失败（极端冷启动场景），回退到本地验证
      logger.debug('SidePanel: Background GET_INITIAL_DATA 超时，回退到本地验证');
      const sessionValid = await isSessionValid();

      if (!sessionValid) {
        isAuthenticated.value = false;
        loading.value = false;
        initializing.value = false;
        return;
      }

      isAuthenticated.value = true;

      // 回退路径：使用原有的 storage 直读 + 缓存竞速
      const storagePromise = loadPasswords(true).finally(() => {
        if (!_cacheWonInitRace) {
          initializing.value = false;
        }
      });

      const cachePromise = getCachedPasswordsFromBackground(currentDomain.value, 600);
      cachePromise
        .then(cacheResult => {
          if (cacheResult && cacheResult.isAuthenticated) {
            _cacheWonInitRace = true;
            passwords.value = cacheResult.passwords;
            loading.value = false;
            initializing.value = false;
            logger.debug('SidePanel: 缓存竞速胜出（回退路径），条目数:' + cacheResult.passwords.length);
          }
        })
        .catch(() => {});

      await Promise.allSettled([storagePromise, cachePromise]);
      _cacheWonInitRace = false;
    } catch (error) {
      logger.error('SidePanel: 初始化失败:', error);
      isAuthenticated.value = false;
      loading.value = false;
      initializing.value = false;
    }
  };

  // ==================== 清理 ====================

  /** 组件卸载时清理 port 连接 */
  onUnmounted(() => {
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
