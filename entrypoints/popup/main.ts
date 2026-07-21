import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/popup/App.vue';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { initThemeSync } from '@/utils/theme';
import '@/assets/theme/tokens.css';

// 预唤醒 Service Worker：用户打开 popup 后大概率会点击「快速填充」打开侧边栏，
// 提前发送消息唤醒 SW，消除后续 sidePanel.open() 的冷启动延迟
preWarmServiceWorker();

// 尽早读取并应用主题（fire-and-forget），并监听配置变更实时切换
initThemeSync();

createAndMountApp(App);
