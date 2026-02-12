import { onUnmounted } from 'vue';

type StorageChangeHandler = (changes: { [key: string]: chrome.storage.StorageChange }) => void;
type MessageHandler = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => void | boolean;
type TabUpdateHandler = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
type TabActivatedHandler = (activeInfo: chrome.tabs.TabActiveInfo) => void;

interface ListenerCleanup {
  remove: () => void;
}

/**
 * Chrome API 事件监听管理 Composable
 * 自动在组件卸载时清理所有监听器，防止内存泄漏
 */
export function useChromeListeners() {
  const listeners: ListenerCleanup[] = [];

  /**
   * 监听 Chrome Storage 变化
   */
  const onStorageChange = (handler: StorageChangeHandler) => {
    chrome.storage.onChanged.addListener(handler);
    listeners.push({
      remove: () => chrome.storage.onChanged.removeListener(handler),
    });
  };

  /**
   * 监听 Chrome Runtime 消息
   */
  const onMessage = (handler: MessageHandler) => {
    chrome.runtime.onMessage.addListener(handler);
    listeners.push({
      remove: () => chrome.runtime.onMessage.removeListener(handler),
    });
  };

  /**
   * 监听标签页更新
   */
  const onTabUpdated = (handler: TabUpdateHandler) => {
    chrome.tabs.onUpdated.addListener(handler);
    listeners.push({
      remove: () => chrome.tabs.onUpdated.removeListener(handler),
    });
  };

  /**
   * 监听标签页激活
   */
  const onTabActivated = (handler: TabActivatedHandler) => {
    chrome.tabs.onActivated.addListener(handler);
    listeners.push({
      remove: () => chrome.tabs.onActivated.removeListener(handler),
    });
  };

  /**
   * 监听 DOM 事件（如 visibilitychange）
   */
  const onDocumentEvent = (event: string, handler: EventListener) => {
    document.addEventListener(event, handler);
    listeners.push({
      remove: () => document.removeEventListener(event, handler),
    });
  };

  /**
   * 监听 Window 事件（如自定义事件 sessionExpired）
   */
  const onWindowEvent = (event: string, handler: EventListener) => {
    window.addEventListener(event, handler);
    listeners.push({
      remove: () => window.removeEventListener(event, handler),
    });
  };

  /**
   * 手动清理所有监听器
   */
  const cleanup = () => {
    listeners.forEach(listener => {
      try {
        listener.remove();
      } catch (error) {
        console.warn('清理监听器失败:', error);
      }
    });
    listeners.length = 0;
  };

  // 组件卸载时自动清理
  onUnmounted(() => {
    cleanup();
  });

  return {
    onStorageChange,
    onMessage,
    onTabUpdated,
    onTabActivated,
    onDocumentEvent,
    onWindowEvent,
    cleanup,
  };
}
