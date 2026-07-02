import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/sidepanel/App.vue';

// 预唤醒 Service Worker：发送消息迫使 Chrome 启动 SW 进程，
// 使其与 Vue 初始化并行执行，避免后续 SidePanel 消息因 SW 冷启动延迟
chrome.runtime.sendMessage({ type: 'SIDEPANEL_PRELOAD' }).catch(() => {
  // SW 冷启动中或上下文不可用，静默忽略（SW 进程已由本调用触发启动）
});

createAndMountApp(App);
