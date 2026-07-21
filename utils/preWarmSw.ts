/**
 * Service Worker 预唤醒工具
 *
 * 在用户可能即将打开侧边栏时提前发送消息唤醒 SW，
 * 避免 sidePanel.open() 时因 SW 冷启动产生延迟。
 *
 * 多处复用：sidepanel/main.ts、content.ts、FloatingButtonManager
 */
import { MessageType } from '@/utils/types';

/**
 * 预热节流窗口（毫秒）
 *
 * 短于此窗口的重复调用会被去重，避免 focusin 等高频事件造成消息风暴；
 * 超过此窗口则允许再次预热——覆盖「会话过期后 SW 已空闲休眠（Chrome MV3
 * idle timeout = 30s），用户再次临近操作时需重新唤醒」的场景。
 * 取值小于 idle timeout，确保 SW 冷却后的下一次操作总能触发唤醒。
 */
const PREWARM_THROTTLE_MS = 8000;

/** 上次预热的时间戳（毫秒），用于节流去重；每个执行上下文独立维护 */
let _lastPreWarmAt = 0;

/**
 * 预唤醒 Service Worker
 *
 * 发送 SIDEPANEL_PRELOAD 消息迫使 Chrome 启动/保持 SW 进程，
 * 避免 sidePanel.open() 时因 SW 冷启动产生延迟。
 *
 * 采用节流式去重（PREWARM_THROTTLE_MS）而非一次性锁：一次性锁会导致
 * 页面长时间停留、SW 早已休眠后无法再次预热，使会话过期场景下的点击
 * 仍需冷启动。节流窗口既抑制高频调用的消息风暴，又能在 SW 冷却后重新唤醒。
 */
export function preWarmServiceWorker(): void {
  // 扩展上下文失效（扩展重载/更新/禁用）后，残留的 content script 仍可能触发本函数，
  // 此时 chrome.runtime.sendMessage 会「同步」抛出 "Extension context invalidated"，
  // .catch 无法捕获同步异常，故先校验 chrome.runtime.id 再以 try/catch 兜底。
  if (!chrome.runtime?.id) return;

  const now = Date.now();
  if (now - _lastPreWarmAt < PREWARM_THROTTLE_MS) return;
  _lastPreWarmAt = now;
  try {
    chrome.runtime.sendMessage({ type: MessageType.SIDEPANEL_PRELOAD }).catch(() => {
      // SW 冷启动中或上下文不可用，静默忽略（SW 进程已由本调用触发启动）
    });
  } catch {
    // 扩展上下文已失效导致同步抛错，静默忽略
  }
}

/**
 * 发送 fire-and-forget 消息到 background
 *
 * 适用于不需要响应的场景（预唤醒、广播等），失败静默忽略。
 * @param message 要发送的消息对象
 */
export function sendMessageFireAndForget(message: Record<string, unknown>): void {
  // 同 preWarmServiceWorker：上下文失效时 sendMessage 会同步抛错，先校验再兜底
  if (!chrome.runtime?.id) return;
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // Fire-and-forget: 忽略失败
    });
  } catch {
    // 扩展上下文已失效导致同步抛错，静默忽略
  }
}
