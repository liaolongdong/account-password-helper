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
import { performUpdateCheck } from './backgroundServices';
import { isSessionValid } from '@/utils/sessionManager-storage';
import { getAllPasswords } from '@/utils/storage/passwordCrud';

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
        invalidatePasswordCache();

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
