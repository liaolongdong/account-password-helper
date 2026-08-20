import { onUnmounted } from 'vue';
import { logger } from '@/utils/logger';
import type { RuntimeMessage } from '@/utils/types';

type StorageChangeHandler = (changes: { [key: string]: chrome.storage.StorageChange }) => void;
type MessageHandler = (
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => void | boolean;
type TabUpdateHandler = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void;
type TabActivatedHandler = (activeInfo: chrome.tabs.OnActivatedInfo) => void;

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
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener(handler);
    listeners.push({
      remove: () => {
        try {
          chrome.storage.onChanged.removeListener(handler);
        } catch {
          // 上下文失效时监听器已被 Chrome 自动清理，忽略
        }
      },
    });
  };

  /**
   * 监听 Chrome Runtime 消息
   */
  const onMessage = (handler: MessageHandler) => {
    if (!chrome?.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener(handler);
    listeners.push({
      remove: () => {
        try {
          chrome.runtime.onMessage.removeListener(handler);
        } catch {
          // 上下文失效时监听器已被 Chrome 自动清理，忽略
        }
      },
    });
  };

  /**
   * 监听标签页更新
   */
  const onTabUpdated = (handler: TabUpdateHandler) => {
    if (!chrome?.tabs?.onUpdated) return;
    chrome.tabs.onUpdated.addListener(handler);
    listeners.push({
      remove: () => {
        try {
          chrome.tabs.onUpdated.removeListener(handler);
        } catch {
          // 上下文失效时监听器已被 Chrome 自动清理，忽略
        }
      },
    });
  };

  /**
   * 监听标签页激活
   */
  const onTabActivated = (handler: TabActivatedHandler) => {
    if (!chrome?.tabs?.onActivated) return;
    chrome.tabs.onActivated.addListener(handler);
    listeners.push({
      remove: () => {
        try {
          chrome.tabs.onActivated.removeListener(handler);
        } catch {
          // 上下文失效时监听器已被 Chrome 自动清理，忽略
        }
      },
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
        logger.warn('清理监听器失败:', error);
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
