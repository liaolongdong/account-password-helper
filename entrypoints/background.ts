import { defineBackground } from 'wxt/sandbox';
import { Message, MessageType } from '../utils/types';

export default defineBackground(() => {
  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    console.log('账号密码管理助手插件已安装');
  });

  // 标签页更新监听
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      closeSidePanel(tabId);
    }
  });

  chrome.tabs.onActivated.addListener(activeInfo => {
    // 可以添加条件判断，比如只对特定网站关闭侧边栏
    closeSidePanel(activeInfo.tabId);
  });

  // 监听快捷键命令
  chrome.commands.onCommand.addListener(async command => {
    if (command === 'open_options') {
      // 打开选项页面
      await openOptionsPage();
    } else if (command === 'toggle_sidepanel') {
      // 切换侧边栏显示状态
      await toggleSidePanel();
    }
  });

  // 监听来自content script和popup的消息
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
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

      case MessageType.URL_CHANGED:
        handleUrlChanged(sender, message.data)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理URL_CHANGED失败:', error);
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
      if (sender.tab?.id) {
        // 检查侧边栏API是否可用
        if (chrome.sidePanel) {
          await chrome.sidePanel.open({ tabId: sender.tab.id });
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
      if (sender.tab?.id) {
        // 检查侧边栏API是否可用
        if (chrome.sidePanel) {
          try {
            // 关闭侧边栏
            closeSidePanel(sender.tab.id);
            return '侧边栏已隐藏';
          } catch (msgError) {
            console.log('无法直接向sidepanel发送消息:', msgError);
          }
        } else {
          const errorMsg = '当前Chrome版本不支持sidePanel API，请升级到Chrome 116 及更高版本';
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

  // 打开选项页面
  async function openOptionsPage() {
    try {
      // 获取选项页面的完整URL
      const optionsUrl = chrome.runtime.getURL('options.html');

      // 首先检查是否已有标签页打开了选项页面
      const tabs = await chrome.tabs.query({ url: optionsUrl });

      if (tabs.length > 0) {
        // 如果已有标签页打开了选项页面，激活该标签页
        const tab = tabs[0];
        await chrome.tabs.update(tab.id!, { active: true });

        // 如果该标签页在其他窗口中，也激活该窗口
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      } else {
        // 如果没有已存在的标签页，创建新标签页
        await chrome.tabs.create({ url: optionsUrl });
      }
    } catch (error) {
      console.error('打开选项页面失败:', error);
    }
  }

  // 切换侧边栏显示状态
  async function toggleSidePanel() {
    try {
      // 获取当前活动标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab.id) {
        // 检查侧边栏是否已经打开
        // 注意：Chrome API 没有直接提供检查侧边栏是否打开的方法
        // 我们采用一种简单的方式：尝试打开侧边栏
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (error) {
      console.error('切换侧边栏失败:', error);
    }
  }

  // 处理URL变化
  async function handleUrlChanged(sender: chrome.runtime.MessageSender, data: any) {
    try {
      // 如果有活动的标签页，通知侧边栏更新数据
      if (sender.tab?.id) {
        // 可以在这里添加更多的逻辑来处理URL变化
        // 例如：检查是否需要显示侧边栏等
        return 'URL变化处理完成';
      } else {
        const errorMsg = '无法获取标签ID';
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('处理URL变化失败:', error);
      throw error;
    }
  }
});

// todo:官方暂时没有提供关闭已打开侧边栏的方法，只能通过其它的方式hack
async function closeSidePanel(tabId: number) {
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
