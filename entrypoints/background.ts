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
  /**
   * 浏览器首启资源预热延迟（毫秒）
   *
   * 避开 Chrome 启动风暴期（标签页恢复 / 各扩展初始化）的磁盘 IO 争抢，
   * 延迟后再温热侧边栏渲染资源；3s 远小于 MV3 SW 空闲存活窗口（≈30s），
   * setTimeout 可靠触发，无需 alarm。
   */
  const STARTUP_WARM_DELAY_MS = 3000;

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
    // 启动预热（跨平台）：浏览器刚启动时 OS 磁盘缓存全冷、V8 无 code cache，
    // 无论会话是否有效，首次打开侧边栏都会命中「进程冷 + 资源冷 + SW 冷」
    // 三冷叠加白屏（Mac 重启后首开同样受影响）。
    // ignoreSessionGate 跳过会话/平台门控强制温热一次渲染资源；延迟执行
    // 避开启动风暴期磁盘争抢；懒 import 不增大 SW 初始包，fire-and-forget 不阻塞启动
    setTimeout(() => {
      void import('@/utils/warmSidePanelResources')
        .then(m => m.maybeWarmSidePanelResources({ ignoreSessionGate: true }))
        .catch(() => {});
    }, STARTUP_WARM_DELAY_MS);
  });

  // 注册事件监听器（Service Worker 启动时立即执行）
  setupSidePanelListeners();
  setupMessageRouter();
  setupBackgroundServices();
});
