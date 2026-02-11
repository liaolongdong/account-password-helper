import { defineBackground } from 'wxt/sandbox';
import { Message, MessageType } from '../utils/types';

export default defineBackground(() => {
  // 跟踪每个标签页的侧边栏打开状态
  const sidePanelState = new Map<number, boolean>();

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
        handleShowSidePanel(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理SHOW_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      case MessageType.HIDE_SIDEPANEL:
        handleHideSidePanel(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理HIDE_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      case MessageType.URL_CHANGED:
        handleUrlChanged(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理URL_CHANGED失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      case MessageType.OPEN_OPTIONS_PAGE:
        openOptionsPage()
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(error => {
            console.error('处理OPEN_OPTIONS_PAGE失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      case MessageType.TOGGLE_SIDEPANEL:
        handleToggleSidePanel(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理TOGGLE_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开放用于异步响应

      case MessageType.CLOSE_SIDEPANEL:
        // 侧边栏关闭通知（从sidepanel发来的）
        handleSidePanelClosed(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理CLOSE_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      default:
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
  });

  // 显示侧边栏
  async function handleShowSidePanel(sender: chrome.runtime.MessageSender, message: Message) {
    try {
      // 优先使用消息中传来的tabId，否则使用sender.tab.id
      const tabId = (message.data?.tabId || sender.tab?.id) as number;

      if (!tabId) {
        // 如果都没有tabId，尝试获取当前活动标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          const activeTabId = tabs[0].id;
          // 检查侧边栏API是否可用
          if (chrome.sidePanel) {
            // 先确保侧边栏是启用的
            try {
              await chrome.sidePanel.setOptions({
                tabId: activeTabId,
                enabled: true,
              });
            } catch (setOptionsError) {
              console.warn('设置侧边栏选项失败，继续尝试打开:', setOptionsError);
            }

            // 打开侧边栏
            await chrome.sidePanel.open({ tabId: activeTabId });
            // 更新状态
            sidePanelState.set(activeTabId, true);
            return '侧边栏已打开';
          } else {
            const errorMsg = '当前Chrome版本不支持sidePanel API';
            console.warn(errorMsg);
            alert(errorMsg);
            throw new Error(errorMsg);
          }
        } else {
          const errorMsg = '无法获取标签ID';
          console.error(errorMsg);
          throw new Error(errorMsg);
        }
      }

      // 有tabId的情况
      // 检查侧边栏API是否可用
      if (chrome.sidePanel) {
        // 先确保侧边栏是启用的（用户手动关闭后可能会被禁用）
        try {
          await chrome.sidePanel.setOptions({
            tabId: tabId,
            enabled: true,
          });
        } catch (setOptionsError) {
          // 如果设置选项失败，继续尝试打开（可能已经启用）
          console.warn('设置侧边栏选项失败，继续尝试打开:', setOptionsError);
        }

        // 打开侧边栏
        await chrome.sidePanel.open({ tabId: tabId });
        // 更新状态
        sidePanelState.set(tabId, true);
        return '侧边栏已打开';
      } else {
        const errorMsg = '当前Chrome版本不支持sidePanel API';
        console.warn(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('打开侧边栏失败:', error);
      throw error;
    }
  }

  // 隐藏侧边栏
  async function handleHideSidePanel(sender: chrome.runtime.MessageSender, message: Message) {
    try {
      // 优先使用消息中传来的tabId，否则使用sender.tab.id
      const tabId = (message.data?.tabId || sender.tab?.id) as number;

      if (!tabId) {
        // 如果都没有tabId，尝试获取当前活动标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          const activeTabId = tabs[0].id;
          // 检查侧边栏API是否可用
          if (chrome.sidePanel) {
            try {
              // 关闭侧边栏
              closeSidePanel(activeTabId);
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
      }

      // 有tabId的情况
      // 检查侧边栏API是否可用
      if (chrome.sidePanel) {
        try {
          // 关闭侧边栏
          closeSidePanel(tabId);
          return '侧边栏已隐藏';
        } catch (msgError) {
          console.log('无法直接向sidepanel发送消息:', msgError);
        }
      } else {
        const errorMsg = '当前Chrome版本不支持sidePanel API，请升级到Chrome 116 及更高版本';
        console.warn(errorMsg);
        alert(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('隐藏侧边栏失败:', error);
      throw error;
    }
  }

  // 切换侧边栏（用于悬浮按钮）
  async function handleToggleSidePanel(sender: chrome.runtime.MessageSender, message: Message) {
    try {
      // 优先使用消息中传来的tabId，否则使用sender.tab.id
      let tabId = (message.data?.tabId || sender.tab?.id) as number;

      if (!tabId) {
        // 如果都没有tabId，尝试获取当前活动标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          tabId = tabs[0].id;
        } else {
          throw new Error('无法获取标签ID');
        }
      }

      // 检查侧边栏API是否可用
      if (!chrome.sidePanel) {
        throw new Error('当前Chrome版本不支持sidePanel API');
      }

      // 检查当前侧边栏状态
      const isOpen = sidePanelState.get(tabId) || false;

      if (isOpen) {
        // 侧边栏已打开，发送关闭消息给sidepanel让它自己关闭
        try {
          // 通过向所有扩展页面广播消息来通知sidepanel关闭
          await chrome.runtime.sendMessage({
            type: MessageType.CLOSE_SIDEPANEL,
            data: { tabId },
          });
        } catch (err) {
          // 如果发送失败，可能sidepanel已经关闭了，更新状态
          console.log('发送关闭消息失败，sidepanel可能已经关闭:', err);
        }
        // 更新状态
        sidePanelState.set(tabId, false);
        return '侧边栏已关闭';
      } else {
        // 侧边栏未打开，打开它
        try {
          await chrome.sidePanel.setOptions({
            tabId: tabId,
            enabled: true,
          });
        } catch (setOptionsError) {
          console.warn('设置侧边栏选项失败，继续尝试打开:', setOptionsError);
        }

        await chrome.sidePanel.open({ tabId: tabId });
        // 更新状态
        sidePanelState.set(tabId, true);
        return '侧边栏已打开';
      }
    } catch (error) {
      console.error('切换侧边栏失败:', error);
      throw error;
    }
  }

  // 处理侧边栏关闭通知
  async function handleSidePanelClosed(sender: chrome.runtime.MessageSender, message: Message) {
    try {
      const tabId = message.data?.tabId as number;
      if (tabId) {
        sidePanelState.set(tabId, false);
      }
      return '侧边栏状态已更新';
    } catch (error) {
      console.error('处理侧边栏关闭通知失败:', error);
      throw error;
    }
  }

  // 打开选项页面
  async function openOptionsPage() {
    try {
      // 获取选项页面的完整URL
      const optionsUrl = chrome.runtime.getURL('options.html');

      // 使用通配符查询，避免URL参数影响匹配
      const tabs = await chrome.tabs.query({ url: optionsUrl + '*' });

      if (tabs.length > 0) {
        // 如果已有标签页打开了选项页面，激活该标签页
        const tab = tabs[0];
        if (tab.id) {
          await chrome.tabs.update(tab.id, { active: true });

          // 如果该标签页在其他窗口中，也激活该窗口
          if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
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
  async function handleUrlChanged(sender: chrome.runtime.MessageSender, message: Message) {
    try {
      // 优先使用消息中传来的tabId，否则使用sender.tab.id
      const tabId = (message.data?.tabId || sender.tab?.id) as number;

      // 如果有活动的标签页，通知侧边栏更新数据
      if (tabId) {
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
