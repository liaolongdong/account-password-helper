import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/sidepanel/App.vue';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { initThemeSync } from '@/utils/theme';
import { logger } from '@/utils/logger';
import '@/assets/theme/tokens.css';

// 预唤醒 Service Worker：尽早触发 SW 启动，与后续 CSS 切换 + Vue 初始化并行执行，
// 消除后续 initSidepanelData() 中 GET_INITIAL_DATA 的冷启动延迟
preWarmServiceWorker();

// 尽早预取 HelpDialog chunk（fire-and-forget，不阻塞首屏）：
// Windows 会话失效期冷启动时，用户可能在侧边栏刚可交互时即点击「?」按钮，
// 若等到 initSidepanelData 完成后再 requestIdleCallback 预取，chunk 仍为冷态需数秒加载。
// 提前到模块顶层发起，与 Vue 初始化并行，最大限度缩短首次点击的等待时间。
import('@/components/sidepanel/HelpDialog.vue').catch(() => {});

// ==================== 非阻塞 CSS 加载（CSP 安全方案） ====================
// 构建时将外部 <link rel="stylesheet"> 设为 media="print" 避免阻塞首次绘制。
// 此处立即切换为 media="all" 使样式生效，无需内联 onload（违反 CSP script-src 'self'）。
const t0 = performance.now();
document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][media="print"]').forEach(link => {
  link.media = 'all';
});

// 尽早读取并应用主题（fire-and-forget），并监听配置变更实时切换
initThemeSync();

// 性能埋点：使用 User Timing API 测量 Vue mount 耗时
// App.vue onMounted 中通过 performance.measure 计算 interval
performance.mark('vue-mount-start');
createAndMountApp(App);
const _perfMountMs = performance.now() - t0;
logger.debug(`SidePanel: createAndMountApp 耗时 ${_perfMountMs.toFixed(1)}ms（含 Vue 同步挂载）`);
