import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/popup/App.vue';
import { preWarmServiceWorker } from '@/utils/preWarmSw';

// 预唤醒 Service Worker：用户打开 popup 后大概率会点击「快速填充」打开侧边栏，
// 提前发送消息唤醒 SW，消除后续 sidePanel.open() 的冷启动延迟
preWarmServiceWorker();

createAndMountApp(App);
