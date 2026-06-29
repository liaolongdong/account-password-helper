import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';

/** 防止重复打开选项页面的标记 */
let isOpeningOptionsPage = false;

/**
 * 打开选项页面
 * - 使用同步标记 isOpeningOptionsPage 做去重，确保异步流程完成后再释放
 * - 若已存在 options 标签页：激活 lastAccessed 最大的一个并聚焦其所在窗口
 * - 若不存在：创建新的 options 标签页
 */
export async function openOptionsPage(): Promise<number | undefined> {
  if (isOpeningOptionsPage) {
    logger.debug('Background: 正在打开选项页面，忽略重复请求');
    return undefined;
  }
  isOpeningOptionsPage = true;

  try {
    const optionsUrl = chrome.runtime.getURL('options.html');
    const tabs = await chrome.tabs.query({});
    const matchingTabs = tabs.filter(tab => tab.url && tab.url.startsWith(optionsUrl));

    if (matchingTabs.length > 0) {
      const targetTab = matchingTabs.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));

      if (targetTab.id !== undefined) {
        await chrome.tabs.update(targetTab.id, { active: true });
        if (targetTab.windowId !== undefined) {
          await chrome.windows.update(targetTab.windowId, { focused: true });
        }
        logger.debug(
          'Background: 已激活最近访问的密码管理标签页 tabId=' + targetTab.id + '，匹配总数=' + matchingTabs.length,
        );
        return targetTab.id;
      }
    } else {
      const newTab = await chrome.tabs.create({ url: optionsUrl });
      logger.debug('Background: 已创建新的密码管理标签页');
      return newTab.id;
    }
  } catch (error) {
    logger.error('打开选项页面失败:', error);
  } finally {
    isOpeningOptionsPage = false;
  }
  return undefined;
}

/**
 * 等待指定 tab 加载完成，超时后放弃等待
 * 替代固定 500ms 延迟，避免页面未加载完就发消息（竞态条件）
 */
export function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.status === 'complete') finish();
      })
      .catch(() => finish());
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * 打开选项页面并向其发送指定消息
 * 用于 OPEN_OPTIONS_AND_EDIT 和 OPEN_OPTIONS_AND_ADD 消息的公共处理逻辑
 */
export function openOptionsAndSendMessage(
  messageType: MessageType,
  data?: unknown,
): Promise<{ success: boolean; error?: string }> {
  return openOptionsPage()
    .then(async tabId => {
      if (tabId !== undefined) {
        await waitForTabComplete(tabId, 5000);
        try {
          await chrome.tabs.sendMessage(tabId, { type: messageType, data });
        } catch (err) {
          logger.error(`Background: 向选项页发送 ${messageType} 指令失败:`, err);
        }
      }
      return { success: true };
    })
    .catch(error => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}
