/**
 * Service Worker 预唤醒工具
 *
 * 在用户可能即将打开侧边栏时提前发送消息唤醒 SW，
 * 避免 sidePanel.open() 时因 SW 冷启动产生延迟。
 *
 * 多处复用：sidepanel/main.ts、content.ts、FloatingButtonManager
 */
let _swPreWarmed = false;

/**
 * 预唤醒 Service Worker
 *
 * 首次调用时发送 SIDEPANEL_PRELOAD 消息迫使 Chrome 启动 SW 进程。
 * 内置去重标记，多次调用安全（仅首次生效）。
 */
export function preWarmServiceWorker(): void {
  if (_swPreWarmed) return;
  _swPreWarmed = true;
  chrome.runtime.sendMessage({ type: 'SIDEPANEL_PRELOAD' }).catch(() => {
    // SW 冷启动中或上下文不可用，静默忽略（SW 进程已由本调用触发启动）
  });
}

/**
 * 发送 fire-and-forget 消息到 background
 *
 * 适用于不需要响应的场景（预唤醒、广播等），失败静默忽略。
 * @param message 要发送的消息对象
 */
export function sendMessageFireAndForget(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Fire-and-forget: 忽略失败
  });
}
