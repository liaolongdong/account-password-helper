import { ref, onUnmounted } from 'vue';
import type { PasswordEntry, PasswordCache } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { useChromeListeners } from '@/composables/useChromeListeners';
import { logger } from '@/utils/logger';

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

  // ==================== 域名工具 ====================

  /**
   * 判断是否为本地开发环境域名
   * 针对 localhost 和 127.0.0.1 域名，默认匹配所有账号密码，方便开发人员快速填充
   * @param domain 当前页面域名
   * @returns 是否为本地开发域名
   */
  const isLocalDevDomain = (domain: string): boolean => {
    return domain === 'localhost' || domain === '127.0.0.1';
  };

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
   * @param domain 域名
   * @returns 缓存的密码数据或 null
   */
  const getCachedPasswordsFromBackground = async (domain?: string): Promise<PasswordCache | null> => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.GET_CACHED_PASSWORDS,
        data: { domain },
      });
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
   */
  const loadPasswords = async () => {
    try {
      loading.value = true;

      // 检查会话是否有效
      const sessionValid = await StorageUtils.isSessionValid();
      if (!sessionValid) {
        isAuthenticated.value = false;
        passwords.value = [];
        return;
      }

      // 加载排序配置
      try {
        sortConfig.value = await StorageUtils.getSortConfig();
      } catch {
        sortConfig.value = null;
      }

      // 会话有效，直接获取数据（StorageUtils 内部会自动判断是否需要解密）
      let loadedPasswords: PasswordEntry[];
      if (currentDomain.value) {
        // 本地开发环境（localhost / 127.0.0.1）默认匹配所有账号密码
        if (isLocalDevDomain(currentDomain.value)) {
          loadedPasswords = await StorageUtils.getAllPasswords();
        } else {
          loadedPasswords = await StorageUtils.getPasswordsByUrl(currentDomain.value);
        }
      } else {
        loadedPasswords = await StorageUtils.getAllPasswords();
      }

      passwords.value = loadedPasswords;

      // 更新缓存
      await updatePasswordCacheInBackground(loadedPasswords, currentDomain.value, isAuthenticated.value);
    } catch (error) {
      logger.error('加载密码列表失败:', error);
      ElMessage.error('加载密码列表失败');
    } finally {
      loading.value = false;
    }
  };

  /**
   * 从存储加载数据（无缓存时的兜底逻辑）
   */
  const loadFromStorage = async () => {
    const isSessionValid = await StorageUtils.isSessionValid();

    if (!isSessionValid) {
      isAuthenticated.value = false;
      loading.value = false;
      return;
    }

    isAuthenticated.value = true;
    await loadPasswords();
  };

  /**
   * 验证会话状态，如果失效则重新加载
   */
  const verifySessionAndRefreshIfNeeded = async () => {
    try {
      const isSessionValid = await StorageUtils.isSessionValid();
      if (!isSessionValid) {
        logger.debug('SidePanel: 会话已失效，显示未验证状态');
        isAuthenticated.value = false;
        passwords.value = [];
      }
    } catch (error) {
      logger.error('SidePanel: 验证会话状态失败:', error);
    }
  };

  // ==================== 会话与事件处理 ====================

  /**
   * 监听会话状态变化
   */
  const handleSessionChange = async () => {
    try {
      const isSessionValid = await StorageUtils.isSessionValid();
      if (isSessionValid && !isAuthenticated.value) {
        isAuthenticated.value = true;
        await loadCurrentTab();
        await loadPasswords();
      } else if (!isSessionValid && isAuthenticated.value) {
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
    message: any,
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

      // 尝试从缓存获取数据
      const cachedData = await getCachedPasswordsFromBackground(currentDomain.value);

      if (cachedData && cachedData.isAuthenticated) {
        logger.debug('SidePanel: 使用缓存数据，条目数:' + cachedData.passwords.length);
        passwords.value = cachedData.passwords;
        isAuthenticated.value = true;
        loading.value = false;

        // 后台验证会话状态，如果失效则重新加载
        verifySessionAndRefreshIfNeeded();
      } else {
        logger.debug('SidePanel: 无缓存，从存储加载数据');
        await loadFromStorage();
      }
    } catch (error) {
      logger.error('SidePanel: 初始化失败:', error);
      isAuthenticated.value = false;
      loading.value = false;
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
