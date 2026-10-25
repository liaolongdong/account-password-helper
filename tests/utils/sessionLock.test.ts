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
  // spy 会被同一 spy 实例复用：不 mockReset 的话用例里的次数是累加的，重试判据读不出真假
  sendSpy = vi.spyOn(chrome.runtime, 'sendMessage');
  sendSpy.mockReset().mockResolvedValue({} as never);
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

  /**
   * 回执不是可选项（评审报告 P2-5）。
   *
   * 后台若在自己清理会话密钥材料时失败，其它上下文会短时仍持有旧数据密钥；紧随其后的
   * 换钥/恢复一提交，它们读到的就是一整片「解不开」的记录。旧实现把回执丢掉，等于让
   * 「锁定已生效」这个前提在没有证据的情况下被下游依赖。
   */
  it('后台报告清理失败：重试一次，两次都失败仍不抛错也不阻断锁定', async () => {
    sendSpy.mockResolvedValue({ success: false, error: 'SESSION_CLEAR_FAILED' } as never);
    const { lockSession } = await import('@/utils/sessionLock');

    await expect(lockSession()).resolves.toBeUndefined();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(clearSession, '密钥销毁已完成，重试只针对通知通道').toHaveBeenCalledTimes(1);
  });

  it('回执成功时不重复广播', async () => {
    sendSpy.mockResolvedValue({ success: true } as never);
    const { lockSession } = await import('@/utils/sessionLock');

    await lockSession();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
