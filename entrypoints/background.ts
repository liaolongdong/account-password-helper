import { defineBackground } from 'wxt/sandbox';
import { Message, MessageType } from '../utils/types';

export default defineBackground(() => {
  console.log('Account Password Helper background script started');

  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    console.log('插件已安装');
  });

  // 标签页更新监听
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      console.log('页面加载完成:', tab.url);
      closeSidePanel(tabId);
    }
  });

  chrome.tabs.onActivated.addListener(activeInfo => {
    // 可以添加条件判断，比如只对特定网站关闭侧边栏
    closeSidePanel(activeInfo.tabId);
  });

  // 监听来自content script和popup的消息
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    console.log('收到消息:', message, '来自:', sender.tab?.url);

    switch (message.type) {
      case MessageType.SHOW_SIDEPANEL:
        handleShowSidePanel(sender)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理SHOW_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      case MessageType.HIDE_SIDEPANEL:
        handleHideSidePanel(sender)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理HIDE_SIDEPANEL失败:', error);
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

  // 隐藏侧边栏
  async function handleHideSidePanel(sender: chrome.runtime.MessageSender) {
    try {
      console.log('尝试隐藏侧边栏, 标签ID:', sender.tab?.id);

      if (sender.tab?.id) {
        // 检查侧边栏API是否可用
        if (chrome.sidePanel) {
          try {
            // 关闭侧边栏
            closeSidePanel(sender.tab.id);
            console.log('侧边栏已隐藏');
            return '侧边栏已隐藏';
          } catch (msgError) {
            console.log('无法直接向sidepanel发送消息:', msgError);
          }
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
      console.error('隐藏侧边栏失败:', error);
      throw error;
    }
  }
});

// todo:官方暂时没有提供关闭已打开侧边栏的方法，只能通过其它的方式hack
async function closeSidePanel(tabId: number) {
  console.log('🚀 ~ closeSidePanel ~ tabId:', tabId);
  // window.close();
  if (chrome.sidePanel) {
    // 方法1：直接关闭侧边栏(官方API没该方法)
    // chrome.sidePanel.close({ tabId });
    // 方法2：禁用侧边栏（需要时再启用）该方法只能禁用打开侧边栏，不能关闭或者隐藏已打开的侧边栏
    // chrome.sidePanel.setOptions({
    //   tabId,
    //   enabled: false,
    // });
    // 方法3：通过隐藏侧边栏的dom节点
    // 方法4：创建一个新的空白标签页（或使用一个已存在的特定标签页）
    // const newTab = await chrome.tabs.create({ url: 'about:blank', active: false });
    // // 确保新标签页有ID后再尝试打开侧边栏
    // if (newTab.id !== undefined) {
    //   // 将侧边栏指向这个新标签页
    //   await chrome.sidePanel.open({ tabId: newTab.id! });
    //   // 延迟一下确保侧边栏已经切换，然后关闭新标签页
    //   setTimeout(() => {
    //     chrome.tabs.remove(newTab.id!);
    //   }, 100);
    //   // 这样，原标签页 (tabId) 的侧边栏就会关闭
    // } else {
    //   console.error('无法创建新标签页或获取标签页ID');
    // }
  }
}
