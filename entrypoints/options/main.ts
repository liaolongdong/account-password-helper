import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/options/App.vue';
import { initThemeSync } from '@/utils/theme';
import { initI18n } from '@/utils/i18n';
// 注册全量命名空间语言包（副作用模块，需在 initI18n 前完成）
import '@/utils/i18n/bundles/options';
// ElMessageBox 样式仅在 options 页面使用（确认删除、重置密码等弹窗）
import 'element-plus/es/components/message-box/style/css';
import '@/assets/theme/tokens.css';
import { OPTIONS_FIRST_VIEW_EVENT, OPTIONS_READY_EVENT, type OptionsFirstView } from './appReady';

// 尽早读取并应用主题（fire-and-forget），并监听配置变更实时切换
initThemeSync();

// 首屏静态骨架：等 App 发出「真实视图已绘制」信号后再淡出；5s 兜底防止异常时永久遮挡
const skeleton = document.getElementById('app-skeleton');

/**
 * 认证分支一落定就切骨架形态
 *
 * 默认是居中认证卡片；只有确认「已有会话」后才切到表格骨架。事件在列表解密前发出，
 * 因此锁定态不会先闪一屏「已解锁 + 有数据」。只发一次，监听器用完即摘。
 */
window.addEventListener(
  OPTIONS_FIRST_VIEW_EVENT,
  event => {
    const view = (event as CustomEvent<OptionsFirstView>).detail;
    if (!skeleton || (view !== 'setup' && view !== 'verify' && view !== 'vault')) return;
    skeleton.dataset.view = view;
  },
  { once: true },
);

let skeletonDismissed = false;
const dismissSkeleton = (): void => {
  if (!skeleton || skeletonDismissed) return;
  skeletonDismissed = true;
  skeleton.classList.add('is-hiding');
  window.setTimeout(() => skeleton.remove(), 240);
};
window.addEventListener(OPTIONS_READY_EVENT, dismissSkeleton, { once: true });
window.setTimeout(dismissSkeleton, 5000);

// 初始化 i18n（等待语言偏好与语言包加载完成后再挂载，避免非中文用户首帧闪中文）
initI18n().then(() => {
  createAndMountApp(App);
});
