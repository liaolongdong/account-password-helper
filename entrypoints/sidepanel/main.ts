import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/sidepanel/App.vue';
import { preWarmServiceWorker } from '@/utils/preWarmSw';

// 预唤醒 Service Worker：与 Vue 初始化并行执行，避免后续消息因 SW 冷启动延迟
preWarmServiceWorker();

createAndMountApp(App);
