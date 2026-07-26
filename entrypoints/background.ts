import { defineBackground } from '#imports';
import { logger } from '@/utils/logger';
import { initLiteI18n } from '@/utils/i18n-lite';
import { setupSidePanelListeners } from './background/sidePanelManager';
import { setupMessageRouter } from './background/messageRouter';
import {
  setupBackgroundServices,
  initBackgroundConfig,
  handleBrowserStartupRelock,
} from './background/backgroundServices';

export default defineBackground(() => {
  // 初始化轻量 i18n（桌面通知等文案按用户语言渲染，storage 监听实时切换）
  initLiteI18n();

  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    logger.info('账号密码管理助手插件已安装');
    initBackgroundConfig();
  });

  // 浏览器/配置文件启动时，按「浏览器重启后重新锁定」设置执行安全重锁（默认关闭时无副作用）
  chrome.runtime.onStartup.addListener(() => {
    void handleBrowserStartupRelock();
    // 启动预热（Windows）：浏览器刚启动时 OS 磁盘缓存全冷，无论会话是否有效，
    // 首次打开侧边栏都会命中「进程冷 + 资源冷 + SW 冷」三冷叠加白屏。
    // ignoreSessionGate 跳过会话门控强制温热一次渲染资源；
    // 懒 import 不增大 SW 初始包，fire-and-forget 不阻塞启动，函数内自带平台门控与节流
    void import('@/utils/warmSidePanelResources')
      .then(m => m.maybeWarmSidePanelResources({ ignoreSessionGate: true }))
      .catch(() => {});
  });

  // 注册事件监听器（Service Worker 启动时立即执行）
  setupSidePanelListeners();
  setupMessageRouter();
  setupBackgroundServices();
});
