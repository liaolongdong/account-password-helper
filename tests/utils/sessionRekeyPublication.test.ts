import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

const KEY = '1234567890abcdef'.repeat(4);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  // Chrome IPC 返回独立快照；fakeBrowser 的引用复用会把陈旧读取意外变成最新值。
  for (const area of [chrome.storage.local, chrome.storage.session]) {
    const get = area.get.bind(area);
    const set = area.set.bind(area);
    vi.spyOn(area, 'get').mockImplementation(async keys => structuredClone(await get(keys)));
    vi.spyOn(area, 'set').mockImplementation(async items => set(structuredClone(items)));
  }
});

/** 明确控制读取/提交的暂停点，不靠延时猜测竞态窗口。 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('rekey session publication', () => {
  it.each([false, true])(
    '锁定镜像读取挂起时 clear 可独立完成，旧读取不得复活密钥（跨上下文=%s）',
    async crossContext => {
      const session = await import('@/utils/sessionManager-storage');
      const prepared = await session.prepareSessionRekey(KEY, 24);
      await chrome.storage.local.set(prepared);
      await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: false } });
      if (crossContext) vi.resetModules();
      const locking = crossContext ? await import('@/utils/sessionManager-storage') : session;
      const readStarted = deferred<void>();
      const releaseRead = deferred<void>();
      const get = chrome.storage.session.get.bind(chrome.storage.session);
      vi.spyOn(chrome.storage.session, 'get').mockImplementationOnce(async keys => {
        const snapshot = structuredClone(await get(keys));
        readStarted.resolve();
        await releaseRead.promise;
        return snapshot;
      });

      const publication = session.publishSessionRekey(KEY, prepared);
      await readStarted.promise;
      // 必须在释放读取前完成：把整条 publish 放进锁会在这里死锁。
      await locking.clearSession();
      // 模拟换钥提交在另一上下文锁定之后重新落盘；单看 local 配对仍会通过。
      await chrome.storage.local.set(prepared);
      releaseRead.resolve();

      expect(await publication).toBe(false);
      expect(session.isSessionActiveSync()).toBe(false);
      const mirror = await chrome.storage.session.get(null);
      expect(mirror[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
      expect(mirror[SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED]).toBeUndefined();
      expect(mirror[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
    },
  );

  it('另一上下文的迟到发布写必须先于 clear 删除完成', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await chrome.storage.local.set(prepared);
    vi.resetModules();
    const locking = await import('@/utils/sessionManager-storage');
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const set = chrome.storage.session.set.bind(chrome.storage.session);
    vi.spyOn(chrome.storage.session, 'set').mockImplementationOnce(async items => {
      const snapshot = structuredClone(items);
      writeStarted.resolve();
      await releaseWrite.promise;
      await set(snapshot);
    });

    const publication = session.publishSessionRekey(KEY, prepared);
    await writeStarted.promise;
    const clearing = locking.clearSession();
    // 无互斥时 clear 已经删除并写 locked:true；随后旧 set 会把密钥及解锁镜像写回来。
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    releaseWrite.resolve();
    await Promise.all([publication, clearing]);

    const mirror = await chrome.storage.session.get(null);
    expect(mirror[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
    expect(mirror[SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED]).toBeUndefined();
    expect(mirror[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
  });

  it('等待短提交锁时仍同步销毁本上下文内存，迟到写失败不得报告采纳', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await chrome.storage.local.set(prepared);
    await session.publishSessionRekey(KEY, prepared);
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    vi.spyOn(chrome.storage.session, 'set').mockImplementationOnce(async () => {
      writeStarted.resolve();
      await releaseWrite.promise;
      throw new Error('session write failed');
    });
    const publication = session.publishSessionRekey(KEY, prepared);
    await writeStarted.promise;
    const clearing = session.clearSession();
    expect(session.isSessionActiveSync()).toBe(false);
    releaseWrite.resolve();
    expect(await publication).toBe(false);
    await clearing;
    expect(await session.getSessionDataKey()).toBeNull();
  });

  it('prepares wrapped material without publishing an uncommitted key', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const beforeLocal = await chrome.storage.local.get(null);
    const beforeSession = await chrome.storage.session.get(null);
    const prepared = await session.prepareSessionRekey(KEY, 24);
    expect(prepared[session.SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBeTypeOf('string');
    expect(await chrome.storage.local.get(null)).toEqual(beforeLocal);
    expect(await chrome.storage.session.get(null)).toEqual(beforeSession);
    expect(await session.getSessionDataKey()).toBeNull();
  });

  it('does not publish until the matching local commit exists', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await session.publishSessionRekey(KEY, prepared);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
    await chrome.storage.local.set(prepared);
    await session.publishSessionRekey(KEY, prepared);
    expect((await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY]).toBe(KEY);
  });

  it('cannot republish prepared material after the session was locked', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await chrome.storage.local.set(prepared);
    await session.clearSession();
    await session.publishSessionRekey(KEY, prepared);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
  });

  /**
   * 锁定发生在**别的上下文**时，本上下文的 epoch 与盘上读数都看不出这件事
   *
   * 别的窗口 `clearSession()` 会删掉盘上的 `session_wrapped_data_key`，但本次事务随后的提交
   * 又把它写回，于是「与 prepared 逐字节相同」这条复验照样通过。唯一还活着的信号是锁定方在
   * `storage.session` 里留下的 `SESSION_LOCK_STATE { locked: true }` 镜像——采纳前必须读它。
   * 回执从静默 `return` 变成 `false`，调用方才可能据此撤销材料并改报「需要重新解锁」。
   */
  it('refuses to adopt while another context has recorded a lock, and reports it', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await chrome.storage.local.set(prepared);
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: true } });

    const published = await session.publishSessionRekey(KEY, prepared);

    expect(published, '锁定镜像在场时发布必须回执未采纳').toBe(false);
    const mirror = await chrome.storage.session.get(null);
    expect(mirror[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
    expect(mirror[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
  });

  it('reports adoption explicitly: true on success, false when the committed key is absent', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);

    expect(await session.publishSessionRekey(KEY, prepared), '盘上没有对应提交时应回执 false').toBe(false);

    await chrome.storage.local.set(prepared);
    expect(await session.publishSessionRekey(KEY, prepared)).toBe(true);
    expect((await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY]).toBe(KEY);
  });

  it('锁定会话时成对删除明文镜像与其配对指纹，不留孤立条目', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const prepared = await session.prepareSessionRekey(KEY, 24);
    await chrome.storage.local.set(prepared);
    await session.publishSessionRekey(KEY, prepared);

    // 先确认两枚都真的在，否则下面的「都空了」可以空过
    const published = await chrome.storage.session.get([
      SESSION_MEMORY_KEYS.DATA_KEY,
      SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED,
    ]);
    expect(published[SESSION_MEMORY_KEYS.DATA_KEY]).toBe(KEY);
    expect(published[SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED]).toBeTypeOf('string');

    await session.clearSession();

    // 读侧靠这两枚配对判断「内存里的明文镜像是否还对应当前密文」；只删前者会在锁定后的
    // 会话里残留一枚孤立指纹，与 publishSessionRekey 的成对移除口径不一致。
    const after = await chrome.storage.session.get([
      SESSION_MEMORY_KEYS.DATA_KEY,
      SESSION_MEMORY_KEYS.DATA_KEY_WRAPPED,
    ]);
    expect(after).toEqual({});
  });
});
