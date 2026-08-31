import { defineBackground } from '#imports';
import { logger } from '@/utils/logger';
import { initLiteI18n } from '@/utils/i18n-lite';
import { freezeLegacyFillDefaults } from '@/utils/storage/configManager';
import { setupSidePanelListeners } from './background/sidePanelManager';
import { setupMessageRouter } from './background/messageRouter';
import { setupContextMenu } from './background/contextMenuManager';
import {
  setupBackgroundServices,
  initBackgroundConfig,
  beginBrowserStartupRelock,
  markInstalledBrowserSessionReady,
} from './background/backgroundServices';
import type { WarmSidePanelOptions } from '@/utils/warmSidePanelResources';

/**
 * 触发侧边栏渲染资源预热（fire-and-forget，静默容错）
 *
 * 懒 import 延迟模块初始化（SW 产物已被 WXT 内联，不影响包体积）。
 * 预热函数内自带平台门控与 5 分钟持久化节流（storage.session），
 * 多次调用不会导致重复全量 fetch。
 *
 * @param options 预热选项（ignorePlatformGate 跨平台全量 /
 *   allowNonWindowsLightweight 非 Windows 轻量预热，详见 WarmSidePanelOptions）
 */
function triggerWarmSidePanelResources(options: WarmSidePanelOptions = {}): void {
  void import('@/utils/warmSidePanelResources').then(m => m.maybeWarmSidePanelResources(options)).catch(() => {});
}

export default defineBackground(() => {
  // 初始化轻量 i18n（桌面通知等文案按用户语言渲染，storage 监听实时切换）
  initLiteI18n();

  // 插件安装/更新时的初始化
  chrome.runtime.onInstalled.addListener(details => {
    logger.info('账号密码管理助手插件已安装');
    // 安装/升级发生在当前浏览器会话内，不属于 onStartup 重锁；仅写独立 recovery 标记，
    // 且 onStartup 屏障已建立时拒绝写入，不能覆盖 pending/failed。
    void markInstalledBrowserSessionReady();
    // 升级场景：冻结存量用户的历史填充默认值（新默认 'inline' 仅对新安装生效）；
    // 内部已捕获异常并记录日志，失败不阻断其余初始化
    if (details.reason === 'update') {
      void freezeLegacyFillDefaults();
    }
    initBackgroundConfig();
    // 扩展安装/更新后预热侧边栏渲染资源（跨平台）：
    // 新版本 chunk hash 全部变化，OS 磁盘缓存中的旧文件不再命中，
    // 首次打开侧边栏等同于全冷启动；ignorePlatformGate 跳过平台门控强制温热一次
    triggerWarmSidePanelResources({ ignorePlatformGate: true });
  });

  // 浏览器/配置文件启动时，按「浏览器重启后重新锁定」设置执行安全重锁（默认关闭时无副作用）
  chrome.runtime.onStartup.addListener(() => {
    beginBrowserStartupRelock();
    // 启动预热（跨平台，立即执行）：浏览器刚启动时 OS 磁盘缓存全冷、V8 无 code cache，
    // 无论会话是否有效，首次打开侧边栏都会命中「进程冷 + 资源冷 + SW 冷」
    // 三冷叠加白屏（Mac 重启后首开同样受影响）。
    // ignorePlatformGate 跳过平台门控强制温热一次渲染资源；
    // 预热函数为全异步（fetch），不阻塞 SW 事件循环与 Chrome 启动同步峰值；
    // 内建 5 分钟节流 + in-flight 互斥，与后续保活 tick 预热不冲突
    triggerWarmSidePanelResources({ ignorePlatformGate: true });
  });

  // 窗口焦点恢复时预热（覆盖「切走再切回」场景）：
  // 用户切换到其他应用再回到 Chrome 时，OS 磁盘缓存中的扩展文件可能已被逐出
  // （Windows 内存压力 / 杀毒扫描；Mac 长时间未操作后同样逐出）。
  // Windows 全量预热；非 Windows 经 allowNonWindowsLightweight 轻量预热首屏
  // 关键资源 + 认证视图关键 chunk（含 Element Plus CSS 运行时，Mac「间隔一段时间
  // 偶现白屏」的直接缓解）；本事件同时会唤醒
  // 休眠的 SW（事件驱动），为接下来可能的侧边栏打开顺带消除 SW 冷启动；
  // 预热函数内建 5 分钟节流，频繁切换不会重复 fetch
  chrome.windows.onFocusChanged.addListener(windowId => {
    // WINDOW_ID_NONE（-1）表示所有窗口失焦，仅在窗口获得焦点时触发
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    triggerWarmSidePanelResources({ allowNonWindowsLightweight: true });
  });

  // 标签页激活时轻量预热（补全 onFocusChanged 的覆盖盲区）：
  // Chrome 已聚焦时切换 Tab → onFocusChanged 不触发，但 onActivated 必触发。
  // 典型场景：用户在 Chrome 内切 Tab 后立即打开侧边栏，若磁盘缓存已逐出会命中冷读白屏。
  // onActivated 触发预热后，文件进入 OS/V8 缓存，侧边栏打开时（通常在 Tab 切换后
  // 数百毫秒内）已可命中缓存。与 onFocusChanged 共用同一 5 分钟节流窗口，
  // 高频切 Tab 只执行一轮预热，无多余 IO；节流窗口内从 _lastWarmAt 内存镜像快路径
  // 返回（几乎零开销），不影响浏览体验。
  chrome.tabs.onActivated.addListener(() => {
    triggerWarmSidePanelResources({ allowNonWindowsLightweight: true });
  });

  // 注册事件监听器（Service Worker 启动时立即执行）
  setupSidePanelListeners();
  setupMessageRouter();
  setupContextMenu();
  setupBackgroundServices();
});
