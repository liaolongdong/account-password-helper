import { type RuntimeMessage, MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import {
  getTabIdSync,
  openSidePanelAndRespond,
  closeSidePanelWithResponse,
  isSidePanelOpen,
  getSidePanelPort,
} from './sidePanelManager';
import { openOptionsPage, openOptionsAndSendMessage } from './optionsPageManager';
import {
  getCachedPasswords,
  updatePasswordCache,
  invalidatePasswordCache,
  getCachedSortConfig,
  warmPasswordCache,
} from './passwordCache';
import { handleAutoSavePassword } from './autoSaveHandler';
import { performUpdateCheck, syncSwKeepaliveAlarm } from './backgroundServices';

/**
 * 延迟加载 sessionManager-storage 模块
 *
 * 仅在 GET_INITIAL_DATA（isSessionValid）和 INVALIDATE_PASSWORD_CACHE
 * （invalidateSessionCache / markSessionInvalid / clearSession）路径中使用，
 * 避免静态导入将 session/encryption 代码打入 SW 初始包。
 */
let _sessionModule: typeof import('@/utils/sessionManager-storage') | null = null;
async function _getSessionModule(): Promise<typeof import('@/utils/sessionManager-storage')> {
  if (!_sessionModule) {
    _sessionModule = await import('@/utils/sessionManager-storage');
  }
  return _sessionModule;
}

/**
 * 延迟加载 passwordCrud 模块
 *
 * 仅在 GET_INITIAL_DATA 冷路径（缓存未命中时从 storage 读取全量密码列表）中使用。
 */
let _crudModule: typeof import('@/utils/storage/passwordCrud') | null = null;
async function _getCrudModule(): Promise<typeof import('@/utils/storage/passwordCrud')> {
  if (!_crudModule) {
    _crudModule = await import('@/utils/storage/passwordCrud');
  }
  return _crudModule;
}

/**
 * 处理 GET_INITIAL_DATA 请求
 *
 * 在 Background SW 中执行会话验证 + 数据加载 + 排序配置读取，
 * 将结果打包返回给 sidepanel。利用 SW 保活机制（Phase 1）使热路径
 * （isSessionActiveSync → true）在 ~1ms 内完成，消除 Windows 上
 * sidepanel 端的 storage IPC 和加密模块开销。
 *
 * 缓存加速路径：
 * - 热缓存（passwordCache + sortConfig 都已预热）：~1ms 返回
 * - 冷缓存（首次打开）：~100-300ms（storage 读取），完成后自动预热
 *
 * @param domain 当前页面域名（当前未使用，保留兼容性）
 * @returns 包含会话状态、密码列表、排序配置的响应数据
 */
async function handleGetInitialData(_domain?: string) {
  const { isSessionValid } = await _getSessionModule();
  const sessionValid = await isSessionValid();

  if (!sessionValid) {
    return { sessionValid: false, passwords: [], sortConfig: null };
  }

  // 快速路径：尝试命中内存缓存（由 warmPasswordCache 或上次 sidepanel 填充）
  const cached = await getCachedPasswords();
  if (cached && cached.isAuthenticated) {
    const sortConfig = await getCachedSortConfig();
    logger.debug('Background: GET_INITIAL_DATA 命中缓存，条目数:' + cached.passwords.length);
    return { sessionValid: true, passwords: cached.passwords, sortConfig };
  }

  // 冷路径：从 storage 读取全量密码列表和排序配置
  // 始终返回全量列表，由 sidepanel 端做域名过滤和排序（filteredPasswords computed）
  const { getAllPasswords } = await _getCrudModule();
  const [sortConfig, passwords] = await Promise.all([getCachedSortConfig(), getAllPasswords()]);

  // 读取完成后自动预热缓存，后续请求直接命中
  updatePasswordCache(passwords, '*', true);

  return { sessionValid: true, passwords, sortConfig };
}

/**
 * 设置消息路由监听器
 * 处理来自 content script 和 popup 的所有 runtime 消息
 *
 * 关键：SHOW_SIDEPANEL 和 TOGGLE_SIDEPANEL 必须在同步执行路径中调用 sidePanel.open()
 * 不能在调用 open() 之前使用 await，否则会打断用户手势链
 */
export function setupMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    // SIDEPANEL_PRELOAD 是预唤醒消息（非 MessageType 枚举），主动预热缓存
    if ((message as { type: string }).type === 'SIDEPANEL_PRELOAD') {
      warmPasswordCache();
      sendResponse({ success: true });
      return;
    }

    switch (message.type) {
      case MessageType.SHOW_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message.data?.tabId);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        openSidePanelAndRespond(tabId, sendResponse);
        return true;
      }

      case MessageType.HIDE_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message.data?.tabId);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        closeSidePanelWithResponse(tabId, sendResponse);
        return true;
      }

      case MessageType.TOGGLE_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message.data?.tabId);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        logger.debug('Background: 切换侧边栏, tabId:' + tabId + ', port状态:' + isSidePanelOpen());

        if (isSidePanelOpen()) {
          closeSidePanelWithResponse(tabId, sendResponse);
        } else {
          openSidePanelAndRespond(tabId, sendResponse);
        }
        return true;
      }

      case MessageType.URL_CHANGED: {
        const tabId = sender.tab?.id;
        if (tabId) {
          sendResponse({ success: true, result: 'URL变化处理完成' });
        } else {
          sendResponse({ success: false, error: '无法获取标签ID' });
        }
        break;
      }

      case MessageType.OPEN_OPTIONS_PAGE:
        openOptionsPage()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.error('处理OPEN_OPTIONS_PAGE失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case MessageType.OPEN_OPTIONS_AND_EDIT:
        openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_EDIT, message.data).then(sendResponse);
        return true;

      case MessageType.OPEN_OPTIONS_AND_ADD:
        openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_ADD).then(sendResponse);
        return true;

      case MessageType.GET_CACHED_PASSWORDS: {
        const requestedDomain = message.data?.domain;
        getCachedPasswords(requestedDomain).then(cachedData => {
          sendResponse({ success: true, data: cachedData });
        });
        return true;
      }

      case MessageType.UPDATE_PASSWORD_CACHE: {
        const { passwords, domain, isAuthenticated } = message.data || {};
        if (passwords && domain !== undefined) {
          updatePasswordCache(passwords, domain, isAuthenticated);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: '缺少缓存数据' });
        }
        break;
      }

      case MessageType.INVALIDATE_PASSWORD_CACHE: {
        // 使用 async IIFE 使动态 import + 异步 clearSession 在 switch-case 内正确执行
        void (async () => {
          const {
            invalidateSessionCache: invalidateSess,
            markSessionInvalid: markSessInvalid,
            clearSession: clearSess,
          } = await _getSessionModule();

          invalidatePasswordCache();
          invalidateSess();
          // 同步标记会话为无效（在 async clearSession 之前执行），
          // 使并发的 isSessionValid() 调用立即从缓存返回 false，
          // 消除 clearSession() 异步执行期间（~100-200ms）的竞态窗口
          markSessInvalid();

          // 在 BG SW 上下文中清除会话（lockSession 已在 popup/options 上下文中调用过 clearSession，
          // 但 BG SW 有独立的模块级状态和 _sessionValidCache，必须同步清除，
          // 否则 isSessionValid() 的 5 秒 TTL 缓存会返回过期的 true，
          // 导致后续 GET_INITIAL_DATA 在用户重新打开侧边栏时返回错误的已认证状态）
          clearSess().catch(e => {
            logger.error('Background: INVALIDATE_PASSWORD_CACHE 清除会话失败:', e);
          });

          // 会话已清除，停止 SW 保活闹钟
          syncSwKeepaliveAlarm();
        })();

        const port = getSidePanelPort();
        if (port) {
          try {
            port.postMessage({ type: MessageType.SESSION_EXPIRED });
          } catch {
            // port 可能已断开
          }
        }

        try {
          chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
        } catch {
          // 无监听者时忽略
        }

        sendResponse({ success: true });
        break;
      }

      case MessageType.AUTO_SAVE_PASSWORD: {
        handleAutoSavePassword(message.data).then(result => {
          sendResponse(result);
        });
        return true;
      }

      case MessageType.CHECK_UPDATE: {
        performUpdateCheck().then(updateInfo => {
          sendResponse({ success: true, data: updateInfo });
        });
        return true;
      }

      case MessageType.GET_INITIAL_DATA: {
        const requestedDomain = message.data?.domain;
        handleGetInitialData(requestedDomain)
          .then(data => {
            sendResponse({ success: true, data });
          })
          .catch(error => {
            logger.error('Background: GET_INITIAL_DATA 处理失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      default:
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
  });
}
