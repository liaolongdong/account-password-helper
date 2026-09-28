import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/utils/types';

/**
 * lockSession() 统一锁定编排行为测试
 *
 * 锁定 B5/B7 收口的三条不变量：
 * 1. 先 `StorageUtils.clearSession()` 销毁会话密钥材料，再广播 INVALIDATE_PASSWORD_CACHE；
 * 2. 广播使用正确的消息类型，交给后台失效 passwordCache / _sessionValidCache；
 * 3. 广播失败（后台未就绪 / 无接收者）被 catch 吞掉，lockSession 本身不抛错——
 *    clearSession 已完成密钥销毁，UI 锁定不应因广播未送达而中断。
 *
 * StorageUtils 经模块 mock 注入；chrome.runtime.sendMessage 用 spy 断言并可模拟失败。
 */

const { clearSession } = vi.hoisted(() => ({ clearSession: vi.fn<() => Promise<void>>() }));

vi.mock('@/utils/storage', () => ({
  StorageUtils: { clearSession },
}));

let sendSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearSession.mockReset().mockResolvedValue(undefined);
  sendSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({} as never);
});

describe('lockSession', () => {
  it('clearSession 先于 INVALIDATE_PASSWORD_CACHE 广播执行', async () => {
    const order: string[] = [];
    clearSession.mockImplementation(async () => {
      order.push('clearSession');
    });
    sendSpy.mockImplementation((async () => {
      order.push('broadcast');
      return {};
    }) as unknown as typeof chrome.runtime.sendMessage);

    const { lockSession } = await import('@/utils/sessionLock');
    await lockSession();

    expect(order).toEqual(['clearSession', 'broadcast']);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('广播携带 INVALIDATE_PASSWORD_CACHE 消息类型', async () => {
    const { lockSession } = await import('@/utils/sessionLock');
    await lockSession();

    expect(sendSpy).toHaveBeenCalledWith({ type: MessageType.INVALIDATE_PASSWORD_CACHE });
  });

  it('广播失败时不抛错，且会话密钥销毁照常完成', async () => {
    sendSpy.mockRejectedValue(new Error('background not ready'));
    const { lockSession } = await import('@/utils/sessionLock');

    await expect(lockSession()).resolves.toBeUndefined();
    expect(clearSession).toHaveBeenCalledTimes(1);
  });
});
