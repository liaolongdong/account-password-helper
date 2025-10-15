import { defineBackground } from 'wxt/sandbox';
import type { Message } from '../utils/types';

export default defineBackground(() => {
  console.log('Account Password Helper background script started');

  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    console.log('插件已安装');
  });

  // 监听来自content script和popup的消息
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    console.log('收到消息:', message, '来自:', sender.tab?.url);

    switch (message.type) {
      case 'SHOW_SIDEPANEL':
        handleShowSidePanel(sender)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理SHOW_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      default:
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
  });

  // 显示侧边栏
  async function handleShowSidePanel(sender: chrome.runtime.MessageSender) {
    try {
      console.log('尝试打开侧边栏, 标签ID:', sender.tab?.id);

      if (sender.tab?.id) {
        // 检查侧边栏API是否可用
        if (chrome.sidePanel) {
          await chrome.sidePanel.open({ tabId: sender.tab.id });
          console.log('侧边栏已打开');
          return '侧边栏已打开';
        } else {
          const errorMsg = '当前Chrome版本不支持sidePanel API';
          console.warn(errorMsg);
          throw new Error(errorMsg);
        }
      } else {
        const errorMsg = '无法获取标签ID';
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('打开侧边栏失败:', error);
      throw error;
    }
  }

  // 标签页更新监听
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      console.log('页面加载完成:', tab.url);
    }
  });
});
