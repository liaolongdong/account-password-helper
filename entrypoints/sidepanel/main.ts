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

// 预加载加密模块 chunk（fire-and-forget）：与 CSS 切换 / i18n / Vue 挂载并行，
// 使 onMounted 内快照直读路径（readSessionSnapshot）的 getEncryptionModule()
// 命中已就绪 chunk，消除冷上下文首次 dynamic import + importKey 的 100-300ms
// 阻塞（Windows 会话有效期内偶发白屏的主因之一）。与 useSidepanelData 使用
// 同一 import specifier，Vite 复用同一 chunk，不改变分包结构；该 chunk 在
// onMounted 后数毫秒内必被加载，此处仅提前发起、不产生额外 IO
void import('@/utils/encryption').catch(() => {});

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

/**
 * i18n 初始化封顶等待时长（毫秒）
 *
 * 语言偏好命中 localStorage 同步镜像时 initI18n 同步完成（零等待，行为不变）；
 * 镜像未命中（跟随浏览器语言的用户不写镜像，属常态而非边缘场景）需等一次
 * storage IPC，Windows 冷环境可达 40-80ms+ 且串行阻塞 Vue 挂载。此处以竞速
 * 封顶等待：超时先以当前默认语言挂载，initI18n 完成后 currentLocale 响应式
 * 更新自动纠正文案（t() 依赖 currentLocale，无需重新挂载），非中文用户最坏
 * 仅首帧短暂回退默认文案，换取首屏挂载不被 IPC 阻塞
 */
const I18N_INIT_MAX_WAIT_MS = 50;

// 初始化 i18n：镜像命中时同步就绪、行为与既往完全一致；未命中时最多等待
// I18N_INIT_MAX_WAIT_MS，避免 storage IPC 串行阻塞首屏（语言包已按需静态内置）
Promise.race([initI18n(), new Promise<void>(resolve => setTimeout(resolve, I18N_INIT_MAX_WAIT_MS))]).then(() => {
  // 性能埋点：i18n 就绪 + Vue mount 开始（App.vue onMounted 中通过 performance.measure 计算 interval）
  markPerf(SP_PERF_MARKS.I18N_READY);
  markPerf(SP_PERF_MARKS.VUE_MOUNT_START);
  createAndMountApp(App);
  const _perfMountMs = performance.now() - t0;
  logger.debug(`SidePanel: createAndMountApp 耗时 ${_perfMountMs.toFixed(1)}ms（含 Vue 同步挂载）`);
});
