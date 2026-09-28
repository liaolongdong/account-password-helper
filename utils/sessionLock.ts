import { StorageUtils } from '@/utils/storage';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';

/**
 * 统一会话锁定编排
 *
 * 收敛「销毁会话密钥材料 + 通知后台失效缓存」这一对必须同时发生的动作，
 * 供三条锁定入口共用：
 * - Options 会话轮询的自动过期（`sessionManager.handleSessionExpired`）；
 * - Options 手动「清除会话」（`useSessionTimer.handleClearSession`）；
 * - Options「重置全部数据」（`useAuthFlow.resetMasterPassword`，随后再 `clearAllData`）。
 *
 * 此前只有手动锁定路径会广播 `INVALIDATE_PASSWORD_CACHE`，自动过期路径仅 `clearSession()`，
 * 导致后台 SW 独立的明文 `passwordCache` 与 `_sessionValidCache`（5 秒 TTL）在会话过期后
 * 仍可能短暂返回已认证状态。统一编排消除该不对称窗口。
 *
 * 职责边界：仅做密钥销毁 + 后台失效通知；各上下文 UI 状态切换与 `SESSION_EXPIRED`
 * 运行时广播由调用方按其上下文语义分别处理。
 *
 * 后台未就绪 / 无接收者时广播静默降级——`clearSession()` 已把 storage.session 锁定镜像
 * 置为 `{ locked: true }` 并移除 `DATA_KEY`，各上下文仍会通过 `storage.onChanged` 感知。
 */
export async function lockSession(): Promise<void> {
  await StorageUtils.clearSession();
  try {
    await chrome.runtime.sendMessage({ type: MessageType.INVALIDATE_PASSWORD_CACHE });
  } catch {
    logger.debug('lockSession: 后台密码缓存失效广播未送达（后台可能未就绪）');
  }
}
