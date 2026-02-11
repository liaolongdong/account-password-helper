import { defineBackground } from 'wxt/sandbox';
import { Message, MessageType } from '../utils/types';

export default defineBackground(() => {
  // 通过 port 连接跟踪 sidepanel 的打开状态
  let sidePanelPort: chrome.runtime.Port | null = null;

  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    console.log('账号密码管理助手插件已安装');
  });

  // 监听 sidepanel 的 port 连接，用于可靠地追踪打开/关闭状态
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'sidepanel') {
      console.log('SidePanel 已连接');
      sidePanelPort = port;

      // 监听 port 断开（sidepanel 关闭时触发）
      port.onDisconnect.addListener(() => {
        console.log('SidePanel 已断开连接');
        sidePanelPort = null;
      });
    }
  });

  // 监听快捷键命令
  chrome.commands.onCommand.addListener(async command => {
    if (command === 'open_options') {
      await openOptionsPage();
    } else if (command === 'toggle_sidepanel') {
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
        return true;

      case MessageType.HIDE_SIDEPANEL:
        handleHideSidePanel(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理HIDE_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case MessageType.URL_CHANGED:
        handleUrlChanged(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理URL_CHANGED失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case MessageType.OPEN_OPTIONS_PAGE:
        openOptionsPage()
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(error => {
            console.error('处理OPEN_OPTIONS_PAGE失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case MessageType.TOGGLE_SIDEPANEL:
        handleToggleSidePanel(sender, message)
          .then(result => {
            sendResponse({ success: true, result });
          })
          .catch(error => {
            console.error('处理TOGGLE_SIDEPANEL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      default:
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
  });

  /**
   * 打开侧边栏
   * 使用官方 chrome.sidePanel.open() API (Chrome 116+)
   */
  async function handleShowSidePanel(sender: chrome.runtime.MessageSender, message: Message) {
    const tabId = await resolveTabId(sender, message);
    ensureSidePanelSupport();

    await chrome.sidePanel.setOptions({ tabId, enabled: true });
    await chrome.sidePanel.open({ tabId });
    return '侧边栏已打开';
  }

  /**
   * 隐藏侧边栏
   * 使用官方 chrome.sidePanel.close() API (Chrome 129+)
   * 如果 close() 不可用，则通过 port 通知 sidepanel 调用 window.close()
   */
  async function handleHideSidePanel(sender: chrome.runtime.MessageSender, message: Message) {
    ensureSidePanelSupport();

    if (typeof chrome.sidePanel.close === 'function') {
      // Chrome 129+: 使用官方 close() API
      const tabId = await resolveTabId(sender, message);
      await chrome.sidePanel.close({ tabId });
      return '侧边栏已关闭';
    } else if (sidePanelPort) {
      // 降级方案: 通过 port 通知 sidepanel 调用 window.close()
      sidePanelPort.postMessage({ type: MessageType.CLOSE_SIDEPANEL });
      return '侧边栏关闭消息已发送';
    }
    return '侧边栏未打开';
  }

  /**
   * 切换侧边栏显示/隐藏（悬浮按钮使用）
   * 通过 port 连接状态判断侧边栏是否已打开
   * 打开: chrome.sidePanel.open() (Chrome 116+)
   * 关闭: chrome.sidePanel.close() (Chrome 129+)，降级使用 port + window.close()
   */
  async function handleToggleSidePanel(sender: chrome.runtime.MessageSender, message: Message) {
    const tabId = await resolveTabId(sender, message);
    ensureSidePanelSupport();

    // 通过 port 连接状态判断 sidepanel 是否已打开
    if (sidePanelPort) {
      // 侧边栏已打开 → 关闭
      if (typeof chrome.sidePanel.close === 'function') {
        await chrome.sidePanel.close({ tabId });
      } else {
        // 降级方案
        try {
          sidePanelPort.postMessage({ type: MessageType.CLOSE_SIDEPANEL });
        } catch (err) {
          console.log('通过 port 发送关闭消息失败:', err);
          sidePanelPort = null;
        }
      }
      return '侧边栏已关闭';
    } else {
      // 侧边栏未打开 → 打开
      await chrome.sidePanel.setOptions({ tabId, enabled: true });
      await chrome.sidePanel.open({ tabId });
      return '侧边栏已打开';
    }
  }

  /**
   * 切换侧边栏显示状态（快捷键触发）
   */
  async function toggleSidePanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      ensureSidePanelSupport();

      if (sidePanelPort) {
        if (typeof chrome.sidePanel.close === 'function') {
          await chrome.sidePanel.close({ tabId: tab.id });
        } else {
          try {
            sidePanelPort.postMessage({ type: MessageType.CLOSE_SIDEPANEL });
          } catch (err) {
            sidePanelPort = null;
          }
        }
      } else {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (error) {
      console.error('切换侧边栏失败:', error);
    }
  }

  // 打开选项页面
  async function openOptionsPage() {
    try {
      const optionsUrl = chrome.runtime.getURL('options.html');
      const tabs = await chrome.tabs.query({ url: optionsUrl + '*' });

      if (tabs.length > 0) {
        const tab = tabs[0];
        if (tab.id) {
          await chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
        }
      } else {
        await chrome.tabs.create({ url: optionsUrl });
      }
    } catch (error) {
      console.error('打开选项页面失败:', error);
    }
  }

  // 处理URL变化
  async function handleUrlChanged(sender: chrome.runtime.MessageSender, message: Message) {
    const tabId = (message.data?.tabId || sender.tab?.id) as number;
    if (tabId) {
      return 'URL变化处理完成';
    }
    throw new Error('无法获取标签ID');
  }

  // 检查 sidePanel API 是否可用
  function ensureSidePanelSupport(): void {
    if (!chrome.sidePanel) {
      throw new Error('当前Chrome版本不支持sidePanel API');
    }
  }

  // 解析 tabId 的辅助函数
  async function resolveTabId(sender: chrome.runtime.MessageSender, message: Message): Promise<number> {
    const tabId = (message.data?.tabId || sender.tab?.id) as number;
    if (tabId) return tabId;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) return tabs[0].id;

    throw new Error('无法获取标签ID');
  }
});
