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
  // 回执要看，不能只发不管：后台若在清理自己的会话密钥材料时失败，其它上下文会短时仍持有
  // 旧数据密钥——紧随其后的换钥/恢复一提交，它们读到的是一片「解不开」的记录。
  // 未送达重试一次；仍失败只记 warn：本函数的职责是密钥销毁 + 失效通知，
  // 绝不因通知通道的问题把调用方的锁定流程拖停（各上下文仍会经 storage.onChanged 感知）。
  if (await broadcastInvalidate()) return;
  if (await broadcastInvalidate()) return;
  logger.warn('lockSession: 后台失效广播两次未取到成功回执，其它上下文可能短暂持有旧数据密钥');
}

/**
 * 发送一次失效广播
 * @returns 后台明确报告失败或通道不可用时为 false
 */
async function broadcastInvalidate(): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: MessageType.INVALIDATE_PASSWORD_CACHE })) as
      { success?: boolean } | undefined;
    return response?.success !== false;
  } catch {
    logger.debug('lockSession: 后台密码缓存失效广播未送达（后台可能未就绪）');
    return false;
  }
}
