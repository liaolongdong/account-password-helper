import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/sidepanel/App.vue';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { initThemeSync } from '@/utils/theme';
import { initI18n } from '@/utils/i18n';
// 注册侧边栏所需命名空间语言包（副作用模块，需在 initI18n 前完成）：
// 仅内置 ~100 个 key 替代全量 575 key，首屏关键 JS 减少约 100KB
import '@/utils/i18n/bundles/sidepanel';
import { logger } from '@/utils/logger';
import { markPerf, SP_PERF_MARKS } from '@/utils/perfMetrics';
import '@/assets/theme/tokens.css';

// 性能埋点：入口 JS 开始执行（User Timing API 不受生产构建 drop console 影响，
// 与 timeOrigin 的差值即「渲染进程创建 + 资源加载 + 编译」耗时，量化 Windows 白屏段）
markPerf(SP_PERF_MARKS.MAIN_START);

// 预唤醒 Service Worker：尽早触发 SW 启动，与后续 CSS 切换 + Vue 初始化并行执行，
// 消除后续 initSidepanelData() 中 GET_INITIAL_DATA 的冷启动延迟
preWarmServiceWorker();

// 注：HelpDialog 预取已从模块顶层后移至 App.vue onMounted 的空闲预取（preloadIdleModules），
// 避免在 Windows 冷盘最紧张的首屏窗口与关键 chunk 抢磁盘 IO；
// 锁屏态冷环境下该 chunk 已由 SW 侧 warmSidePanelResources 持续温热，无回退风险。

// ==================== 非阻塞 CSS 加载（CSP 安全方案） ====================
// 构建时将外部 <link rel="stylesheet"> 设为 media="print" 避免阻塞首次绘制。
// 此处立即切换为 media="all" 使样式生效，无需内联 onload（违反 CSP script-src 'self'）。
const t0 = performance.now();
document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][media="print"]').forEach(link => {
  link.media = 'all';
});

// 尽早读取并应用主题（fire-and-forget），并监听配置变更实时切换
initThemeSync();

// 初始化 i18n：等待语言偏好加载完成后再挂载，避免非中文用户首帧闪中文
// （与 options/popup 入口保持一致；语言包已按需静态内置，语言偏好命中
// localStorage 同步镜像时零 IPC 即刻返回，不阻塞首屏）
initI18n().then(() => {
  // 性能埋点：i18n 就绪 + Vue mount 开始（App.vue onMounted 中通过 performance.measure 计算 interval）
  markPerf(SP_PERF_MARKS.I18N_READY);
  markPerf(SP_PERF_MARKS.VUE_MOUNT_START);
  createAndMountApp(App);
  const _perfMountMs = performance.now() - t0;
  logger.debug(`SidePanel: createAndMountApp 耗时 ${_perfMountMs.toFixed(1)}ms（含 Vue 同步挂载）`);
});
