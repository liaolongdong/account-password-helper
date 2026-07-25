import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/popup/App.vue';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { initThemeSync } from '@/utils/theme';
import { initI18n } from '@/utils/i18n';
import '@/assets/theme/tokens.css';

// 预唤醒 Service Worker：用户打开 popup 后大概率会点击「快速填充」打开侧边栏，
// 提前发送消息唤醒 SW，消除后续 sidePanel.open() 的冷启动延迟
preWarmServiceWorker();

// 尽早读取并应用主题（fire-and-forget），并监听配置变更实时切换
initThemeSync();

// 初始化 i18n（等待语言偏好与语言包加载完成后再挂载，避免非中文用户首帧闪中文）
initI18n().then(() => {
  createAndMountApp(App);
});
