import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { openOptionsPage } from './optionsPageManager';

/** 模块级 port 状态（Service Worker 生命周期内有效） */
let sidePanelPort: chrome.runtime.Port | null = null;

/** 获取 sidePanelPort（供其他模块读取） */
export function getSidePanelPort(): chrome.runtime.Port | null {
  return sidePanelPort;
}

/** 侧边栏是否已打开 */
export function isSidePanelOpen(): boolean {
  return sidePanelPort !== null;
}

/**
 * 同步获取 tabId（不使用 async/await，避免打断用户手势链）
 */
export function getTabIdSync(sender: chrome.runtime.MessageSender, tabIdFromData?: number): number | undefined {
  return tabIdFromData ?? sender.tab?.id;
}

/**
 * 判断关闭侧边栏时的错误是否为预期错误
 */
function isExpectedCloseError(error: unknown): boolean {
  const msg = (error as { message?: string } | undefined)?.message ?? String(error);
  return (
    msg.includes('No active tab-specific side panel') ||
    msg.includes('Extension context invalidated') ||
    msg.includes('No tab with id')
  );
}

/**
 * 打开侧边栏并发送响应
 */
export function openSidePanelAndRespond(tabId: number, sendResponse: (response: any) => void): void {
  chrome.sidePanel
    .open({ tabId })
    .then(() => {
      logger.debug('Background: 侧边栏已打开, tabId:' + tabId);
      sendResponse({ success: true, result: '侧边栏已打开' });
    })
    .catch(error => {
      logger.error('Background: 打开侧边栏失败:', error);
      sendResponse({ success: false, error: error.message });
    });
}

/**
 * 关闭侧边栏（不需要用户手势）
 */
export function closeSidePanel(tabId: number): void {
  forceCloseSidePanel(tabId).catch(error => {
    logger.error('Background: 关闭侧边栏失败:', error);
  });
}

/**
 * 关闭侧边栏并发送响应
 */
export function closeSidePanelWithResponse(tabId: number, sendResponse: (response: any) => void): void {
  forceCloseSidePanel(tabId)
    .then(() => {
      sendResponse({ success: true, result: '侧边栏已关闭' });
    })
    .catch(error => {
      logger.error('Background: 关闭侧边栏失败:', error);
      sendResponse({ success: true, result: '侧边栏关闭请求已处理 (fallback)' });
    });
}

/**
 * 强制关闭侧边栏（多方案兜底）
 *
 * 关闭策略：
 * 1. 优先使用 chrome.sidePanel.close({ tabId }) API（Chrome 129+）
 * 2. 若 close API 不可用或失败：通过 setOptions({ enabled: false }) 强制禁用，
 *    随后恢复 enabled=true 保证下次能打开
 * 3. 同时通过 port 通知 sidepanel 执行 window.close() 作为 UI 层兜底
 */
function forceCloseSidePanel(tabId: number): Promise<void> {
  trySendCloseViaPort();

  if (typeof chrome.sidePanel.close === 'function') {
    return chrome.sidePanel
      .close({ tabId })
      .then(() => {
        logger.debug('Background: 侧边栏已关闭 (close API)');
      })
      .catch(error => {
        if (isExpectedCloseError(error)) {
          logger.debug('Background: 侧边栏已不存在，视为关闭成功');
          sidePanelPort = null;
          return;
        }
        logger.warn('Background: close API 失败，尝试 setOptions 兜底:', error);
        return disableThenEnableSidePanel(tabId);
      });
  }

  return disableThenEnableSidePanel(tabId);
}

/**
 * 通过 setOptions 强制关闭并恢复侧边栏
 */
function disableThenEnableSidePanel(tabId: number): Promise<void> {
  return chrome.sidePanel
    .setOptions({ tabId, enabled: false })
    .then(() => {
      logger.debug('Background: 侧边栏已强制禁用 (setOptions)');
      return chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true,
      });
    })
    .then(() => {
      logger.debug('Background: 侧边栏已恢复 enabled=true');
    })
    .catch(error => {
      if (isExpectedCloseError(error)) {
        logger.debug('Background: 侧边栏已不存在，视为关闭成功');
        sidePanelPort = null;
        return;
      }
      logger.error('Background: setOptions 兜底失败:', error);
      throw error;
    });
}

/**
 * 通过 port 发送关闭消息（降级方案）
 */
function trySendCloseViaPort(): void {
  if (sidePanelPort) {
    try {
      sidePanelPort.postMessage({ type: MessageType.CLOSE_SIDEPANEL });
      logger.debug('Background: 侧边栏关闭消息已发送 (port)');
    } catch (err) {
      logger.error('Background: 通过 port 发送关闭消息失败:', err);
      sidePanelPort = null;
    }
  }
}

/**
 * 设置 sidePanel 相关的 Chrome 事件监听器
 * - port 连接监听（跟踪 sidepanel 打开/关闭状态）
 * - 快捷键命令监听（open_options / toggle_sidepanel）
 */
export function setupSidePanelListeners(): void {
  // 监听 sidepanel 的 port 连接
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'sidepanel') {
      logger.debug('SidePanel 已连接');
      sidePanelPort = port;

      port.onMessage.addListener((message: any) => {
        if (message.type === 'HEARTBEAT') {
          // 心跳消息到达即保持 SW 活跃（重置 30s 空闲计时器），无需额外处理
          return;
        }
      });

      port.onDisconnect.addListener(() => {
        logger.debug('SidePanel 已断开连接');
        sidePanelPort = null;
      });
    }
  });

  // 监听快捷键命令
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open_options') {
      openOptionsPage();
    } else if (command === 'toggle_sidepanel') {
      if (!chrome.sidePanel) {
        logger.error('Background: 当前Chrome版本不支持sidePanel API');
        return;
      }

      if (sidePanelPort) {
        const tabId = tab?.id;
        if (tabId) {
          closeSidePanel(tabId);
        } else {
          chrome.tabs
            .query({ active: true, lastFocusedWindow: true })
            .then(tabs => {
              const fallbackTabId = tabs[0]?.id;
              if (fallbackTabId) {
                closeSidePanel(fallbackTabId);
              } else {
                logger.warn('Background: 无法获取当前标签页，关闭侧边栏失败');
              }
            })
            .catch(error => logger.error('Background: 查询标签页失败:', error));
        }
      } else {
        const tabId = tab?.id;
        if (!tabId) {
          logger.warn('Background: 无法获取当前标签页，打开侧边栏失败');
          return;
        }
        chrome.sidePanel
          .open({ tabId })
          .then(() => logger.debug('Background: 侧边栏已打开 (快捷键)'))
          .catch(error => logger.error('Background: 快捷键打开侧边栏失败:', error));
      }
    }
  });
}
