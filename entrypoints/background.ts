import { defineBackground } from '#imports';
import { logger } from '@/utils/logger';
import { setupSidePanelListeners } from './background/sidePanelManager';
import { setupMessageRouter } from './background/messageRouter';
import {
  setupBackgroundServices,
  initBackgroundConfig,
  handleBrowserStartupRelock,
} from './background/backgroundServices';

export default defineBackground(() => {
  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    logger.info('账号密码管理助手插件已安装');
    initBackgroundConfig();
  });

  // 浏览器/配置文件启动时，按「浏览器重启后重新锁定」设置执行安全重锁（默认关闭时无副作用）
  chrome.runtime.onStartup.addListener(() => {
    void handleBrowserStartupRelock();
  });

  // 注册事件监听器（Service Worker 启动时立即执行）
  setupSidePanelListeners();
  setupMessageRouter();
  setupBackgroundServices();
});
