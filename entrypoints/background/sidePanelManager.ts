import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { markSidepanelOpenRequested, type SidepanelOpenTrigger } from '@/utils/perfMetrics';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { openOptionsPage } from './optionsPageManager';
import { handleQuickFill } from './quickFillHandler';
import { handleOpenInlineDropdown } from './inlineDropdownHandler';

interface SidePanelContext {
  windowId: number;
  tabId: number;
}

/** 按窗口/实例跟踪 Side Panel；刷新重叠时同一窗口可短暂存在多个 Port。 */
const sidePanelContextByPort = new Map<chrome.runtime.Port, SidePanelContext>();
const sidePanelPortsByWindow = new Map<number, Set<chrome.runtime.Port>>();
const pendingSidePanelPorts = new Set<chrome.runtime.Port>();
const openingTabIds = new Set<number>();
const openingWindowByTabId = new Map<number, number>();
const openingTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * 侧边栏打开完成后的资源预热延时（毫秒）
 *
 * port 连接建立即侧边栏渲染进程已启动，此时首屏关键资源正在加载，
 * 延时至首屏收尾（骨架屏淡出 + 数据竞速）完成后再从 SW 侧预热剩余
 * 按需 chunk，避免与渲染进程争抢磁盘 IO / 杀软扫描带宽。
 */
const WARM_AFTER_OPEN_DELAY_MS = 5000;

/** 获取全部已完成 READY 握手的 Side Panel Port，用于广播。 */
export function getSidePanelPorts(): chrome.runtime.Port[] {
  return [...sidePanelContextByPort.keys()];
}

/** 判断目标窗口/标签页是否已打开或正在打开 Side Panel。 */
export function isSidePanelOpen(windowId?: number, tabId?: number): boolean {
  if (tabId !== undefined && openingTabIds.has(tabId)) return true;
  if (windowId !== undefined) {
    if ((sidePanelPortsByWindow.get(windowId)?.size ?? 0) > 0) return true;
    for (const openingWindowId of openingWindowByTabId.values()) {
      if (openingWindowId === windowId) return true;
    }
    return false;
  }
  if (tabId !== undefined) {
    for (const context of sidePanelContextByPort.values()) {
      if (context.tabId === tabId) return true;
    }
    return false;
  }
  return sidePanelContextByPort.size > 0 || openingTabIds.size > 0;
}

function markSidePanelOpening(tabId: number, windowId?: number): void {
  openingTabIds.add(tabId);
  if (windowId !== undefined) {
    openingWindowByTabId.set(tabId, windowId);
  } else {
    void chrome.tabs
      .get(tabId)
      .then(tab => {
        if (openingTabIds.has(tabId)) openingWindowByTabId.set(tabId, tab.windowId);
      })
      .catch(() => {});
  }
  const existing = openingTimeouts.get(tabId);
  if (existing) clearTimeout(existing);
  openingTimeouts.set(
    tabId,
    setTimeout(() => {
      openingTabIds.delete(tabId);
      openingWindowByTabId.delete(tabId);
      openingTimeouts.delete(tabId);
    }, 5000),
  );
}

function clearSidePanelOpening(tabId: number): void {
  openingTabIds.delete(tabId);
  openingWindowByTabId.delete(tabId);
  const timeout = openingTimeouts.get(tabId);
  if (timeout) clearTimeout(timeout);
  openingTimeouts.delete(tabId);
}

function unregisterSidePanelPort(port: chrome.runtime.Port): void {
  pendingSidePanelPorts.delete(port);
  const context = sidePanelContextByPort.get(port);
  if (!context) return;
  sidePanelContextByPort.delete(port);
  const ports = sidePanelPortsByWindow.get(context.windowId);
  ports?.delete(port);
  if (ports?.size === 0) sidePanelPortsByWindow.delete(context.windowId);
}

async function registerReadySidePanelPort(
  port: chrome.runtime.Port,
  message: { windowId?: unknown; tabId?: unknown },
): Promise<void> {
  if (!pendingSidePanelPorts.has(port)) return;
  if (!Number.isInteger(message.windowId) || !Number.isInteger(message.tabId)) return;
  const windowId = message.windowId as number;
  const tabId = message.tabId as number;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!pendingSidePanelPorts.has(port) || tab.windowId !== windowId) return;
    unregisterSidePanelPort(port);
    sidePanelContextByPort.set(port, { windowId, tabId });
    const ports = sidePanelPortsByWindow.get(windowId) ?? new Set<chrome.runtime.Port>();
    ports.add(port);
    sidePanelPortsByWindow.set(windowId, ports);
    clearSidePanelOpening(tabId);
    logger.debug(`SidePanel READY 握手完成, windowId:${windowId}, tabId:${tabId}`);
  } catch (error) {
    logger.warn('SidePanel READY 握手校验失败:', error);
  }
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
 *
 * @param tabId 目标标签页 ID
 * @param sendResponse 消息响应回调
 * @param openMeta 打开请求埋点元信息（clickTs=内容脚本侧点击时刻，可覆盖 SW 唤醒等待盲区；trigger=触发源）
 */
export function openSidePanelAndRespond(
  tabId: number,
  sendResponse: (response: any) => void,
  openMeta?: { clickTs?: number; trigger?: SidepanelOpenTrigger },
): void {
  // 性能埋点：记录打开请求时间戳与触发源（同步发起不 await，不打断用户手势链）
  markSidepanelOpenRequested(openMeta);
  markSidePanelOpening(tabId);
  chrome.sidePanel
    .open({ tabId })
    .then(() => {
      logger.debug('Background: 侧边栏已打开, tabId:' + tabId);
      sendResponse({ success: true, result: '侧边栏已打开' });
    })
    .catch(error => {
      clearSidePanelOpening(tabId);
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
async function forceCloseSidePanel(tabId: number): Promise<void> {
  clearSidePanelOpening(tabId);
  let windowId: number | undefined;
  try {
    windowId = (await chrome.tabs.get(tabId)).windowId;
  } catch {
    // tab 已关闭时交由 close API 的预期错误分支处理
  }
  trySendCloseViaPort(windowId);

  if (typeof chrome.sidePanel.close === 'function') {
    return chrome.sidePanel
      .close({ tabId })
      .then(() => {
        logger.debug('Background: 侧边栏已关闭 (close API)');
      })
      .catch(error => {
        if (isExpectedCloseError(error)) {
          logger.debug('Background: 侧边栏已不存在，视为关闭成功');
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
        return;
      }
      logger.error('Background: setOptions 兜底失败:', error);
      throw error;
    });
}

/**
 * 通过 port 发送关闭消息（降级方案）
 */
function trySendCloseViaPort(windowId?: number): void {
  const ports = windowId === undefined ? [] : [...(sidePanelPortsByWindow.get(windowId) ?? [])];
  for (const port of ports) {
    try {
      port.postMessage({ type: MessageType.CLOSE_SIDEPANEL });
      logger.debug('Background: 侧边栏关闭消息已发送 (port)');
    } catch (err) {
      logger.error('Background: 通过 port 发送关闭消息失败:', err);
      unregisterSidePanelPort(port);
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
      logger.debug('SidePanel 已连接，等待 READY 握手');
      pendingSidePanelPorts.add(port);

      // 打开完成后延时空闲预热渲染资源（替代原 SIDEPANEL_PRELOAD 时机的预热——
      // 后者在用户点击瞬间触发全量 fetch，与渲染进程首屏加载争抢磁盘 IO）。
      // 侧边栏打开期间 port 心跳保持 SW 活跃，定时器可靠触发；
      // 函数内自带平台门控与持久化节流：Windows 全量预热，非 Windows 经
      // allowNonWindowsLightweight 轻量预热首屏关键资源（为下次打开温热，
      // 缓解 Mac 间隔一段时间后首开冷读白屏），窗口内重复调用直接跳过
      setTimeout(() => {
        void import('@/utils/warmSidePanelResources')
          .then(m => m.maybeWarmSidePanelResources({ allowNonWindowsLightweight: true }))
          .catch(() => {});
      }, WARM_AFTER_OPEN_DELAY_MS);

      port.onMessage.addListener((message: any) => {
        if (message.type === MessageType.SIDEPANEL_READY) {
          void registerReadySidePanelPort(port, message);
          return;
        }
        if (message.type === 'HEARTBEAT') {
          // 心跳消息到达即保持 SW 活跃（重置 30s 空闲计时器），无需额外处理
          return;
        }
      });

      port.onDisconnect.addListener(() => {
        logger.debug('SidePanel 已断开连接');
        unregisterSidePanelPort(port);
      });
    }
  });

  // 监听快捷键命令
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open_options') {
      openOptionsPage();
    } else if (command === 'quick_fill') {
      // 透传 onCommand 回调提供的 tab，避免处理器内冗余查询与窗口焦点竞态
      handleQuickFill(tab).catch(error => logger.error('Background: 一键填充快捷键处理失败:', error));
    } else if (command === 'open_inline_dropdown') {
      // 与点击输入框内钥匙图标一致：在当前页面展开内联填充下拉面板
      handleOpenInlineDropdown(tab).catch(error => logger.error('Background: 内联下拉快捷键处理失败:', error));
    } else if (command === 'toggle_sidepanel') {
      if (!chrome.sidePanel) {
        logger.error('Background: 当前Chrome版本不支持sidePanel API');
        return;
      }
      // 同步预热：覆盖快捷键路径在 SW 被强杀复活窗口内无 hover 触发预热的场景，
      // 尽早唤醒可能已冷却的 SW 内存密码缓存；preWarmServiceWorker 内部有 8s 节流，正常态 no-op
      preWarmServiceWorker();

      if (isSidePanelOpen(tab?.windowId, tab?.id)) {
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
        // 性能埋点：记录打开请求时间戳与触发源（同步发起，不打断用户手势链）
        markSidepanelOpenRequested({ trigger: 'shortcut' });
        markSidePanelOpening(tabId, tab.windowId);
        chrome.sidePanel
          .open({ tabId })
          .then(() => logger.debug('Background: 侧边栏已打开 (快捷键)'))
          .catch(error => {
            clearSidePanelOpening(tabId);
            logger.error('Background: 快捷键打开侧边栏失败:', error);
          });
      }
    }
  });
}
