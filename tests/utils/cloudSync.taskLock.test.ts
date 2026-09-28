import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { acquireTaskLock, isTargetLocked } from '@/utils/cloudSync/taskLock';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

/**
 * 同步任务互斥锁测试（设计规格 §2.2、§14）
 *
 * 锁定：获取/释放、并发拒绝（busy）、心跳续期、死锁抢占（≥30s）、
 * release 幂等、不误删他人锁、storage.session 异常降级不阻断。
 */

const LOCK_KEY = SESSION_MEMORY_KEYS.CLOUD_SYNC_LOCK;

async function readLocks(): Promise<Record<string, { acquiredAt: number; heartbeatAt: number; pageId: string }>> {
  const result = await fakeBrowser.storage.session.get(LOCK_KEY);
  return (result[LOCK_KEY] ?? {}) as Record<string, { acquiredAt: number; heartbeatAt: number; pageId: string }>;
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('acquireTaskLock：获取与释放', () => {
  it('无锁时获取成功，锁条目写入 storage.session', async () => {
    const result = await acquireTaskLock('feishu:app:tbl');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preempted).toBe(false);
    const locks = await readLocks();
    expect(locks['feishu:app:tbl']).toBeDefined();
    expect(typeof locks['feishu:app:tbl'].pageId).toBe('string');
    await result.handle.release();
    expect((await readLocks())['feishu:app:tbl']).toBeUndefined();
  });

  it('不同 targetKey 互不阻塞', async () => {
    const a = await acquireTaskLock('feishu:doc-a');
    const b = await acquireTaskLock('tencent:doc-b');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) await a.handle.release();
    if (b.ok) await b.handle.release();
  });

  it('release 幂等：重复调用安全', async () => {
    const result = await acquireTaskLock('k1');
    if (!result.ok) throw new Error('expected ok');
    await result.handle.release();
    await expect(result.handle.release()).resolves.toBeUndefined();
    expect(await readLocks()).toEqual({});
  });

  it('release 不误删他人锁（pageId 不匹配时保留）', async () => {
    const result = await acquireTaskLock('k2');
    if (!result.ok) throw new Error('expected ok');
    // 模拟锁被其他页面抢占：改写 pageId
    const locks = await readLocks();
    locks['k2'] = { ...locks['k2'], pageId: 'other-page' };
    await fakeBrowser.storage.session.set({ [LOCK_KEY]: locks });

    await result.handle.release();
    expect((await readLocks())['k2']).toBeDefined();
    expect((await readLocks())['k2'].pageId).toBe('other-page');
  });
});

describe('acquireTaskLock：并发拒绝与死锁抢占', () => {
  it('心跳新鲜（<30s）时拒绝启动，返回 busy', async () => {
    const first = await acquireTaskLock('busy-key');
    const second = await acquireTaskLock('busy-key');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('busy');
      expect(typeof second.heartbeatAt).toBe('number');
    }
    if (first.ok) await first.handle.release();
  });

  it('心跳超 30s 判定残留死锁，强制抢占并标记 preempted', async () => {
    const stale = Date.now() - 31_000;
    await fakeBrowser.storage.session.set({
      [LOCK_KEY]: { 'stale-key': { acquiredAt: stale, heartbeatAt: stale, pageId: 'dead-page' } },
    });
    const result = await acquireTaskLock('stale-key');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preempted).toBe(true);
    const locks = await readLocks();
    expect(locks['stale-key'].pageId).not.toBe('dead-page');
    await result.handle.release();
  });

  it('心跳恰为 30s 边界（>= 判定）即可抢占', async () => {
    const boundary = Date.now() - 30_000;
    await fakeBrowser.storage.session.set({
      [LOCK_KEY]: { 'edge-key': { acquiredAt: boundary, heartbeatAt: boundary, pageId: 'dead' } },
    });
    const result = await acquireTaskLock('edge-key');
    expect(result.ok).toBe(true);
    if (result.ok) await result.handle.release();
  });
});

describe('acquireTaskLock：心跳续期', () => {
  it('每 10s 刷新 heartbeatAt', async () => {
    vi.useFakeTimers();
    try {
      const result = await acquireTaskLock('hb-key');
      if (!result.ok) throw new Error('expected ok');
      const before = (await readLocks())['hb-key'].heartbeatAt;
      await vi.advanceTimersByTimeAsync(10_000);
      const after = (await readLocks())['hb-key'].heartbeatAt;
      expect(after).toBe(before + 10_000);
      await result.handle.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('锁被他人抢占后心跳不覆盖对方条目', async () => {
    vi.useFakeTimers();
    try {
      const result = await acquireTaskLock('hb2');
      if (!result.ok) throw new Error('expected ok');
      const locks = await readLocks();
      locks['hb2'] = { ...locks['hb2'], pageId: 'other-page', heartbeatAt: 123 };
      await fakeBrowser.storage.session.set({ [LOCK_KEY]: locks });

      await vi.advanceTimersByTimeAsync(10_000);
      expect((await readLocks())['hb2'].heartbeatAt).toBe(123);
      await result.handle.release();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isTargetLocked：UI 置灰查询（不获取锁）', () => {
  it('无锁条目返回 false', async () => {
    expect(await isTargetLocked('none')).toBe(false);
  });

  it('新鲜锁返回 true，残留死锁返回 false', async () => {
    const now = Date.now();
    await fakeBrowser.storage.session.set({
      [LOCK_KEY]: {
        fresh: { acquiredAt: now, heartbeatAt: now, pageId: 'p1' },
        stale: { acquiredAt: now - 40_000, heartbeatAt: now - 40_000, pageId: 'p2' },
      },
    });
    expect(await isTargetLocked('fresh')).toBe(true);
    expect(await isTargetLocked('stale')).toBe(false);
  });
});

describe('storage.session 异常降级', () => {
  it('读取失败按无锁处理，不阻断获取', async () => {
    vi.spyOn(fakeBrowser.storage.session, 'get').mockRejectedValueOnce(new Error('IO'));
    const result = await acquireTaskLock('degraded');
    expect(result.ok).toBe(true);
    if (result.ok) await result.handle.release();
  });
});
