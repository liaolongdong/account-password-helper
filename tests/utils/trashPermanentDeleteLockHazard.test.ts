/**
 * 回收站彻底删除在「排队独占换钥」面前不得半提交（评审 2026-11-02 S2）
 *
 * `enqueueTrashMutation` 全程持有 shared 租约 + 提交锁；而 397ed1c 新引入的
 * `withVaultKeyTransitionQueued`（不带 `ifAvailable`）是全仓第一个会**停在队列里**的独占请求。
 * Web Locks 写者优先，于是临界区内部那句「会再取一次租约」的公开 `deleteHistoryByEntryIds`
 * 当场 `VAULT_BUSY`——此时条目**已经离开回收站**，历史清理却没跑：
 * 用户看到「彻底删除失败」，而那条被删条目的旧口令密文永久留在 `PASSWORD_HISTORY` 里无人回收。
 *
 * 正确口径：临界区内只调不再取租约的租约内版本。嵌套本身在 main 上就有，但改动前所有独占都带
 * `ifAvailable`、从不排队，所以这条路径不可达；本用例把「可达」这件事钉死。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { PasswordHistoryRecord, TrashedPasswordEntry } from '@/utils/types';
import { hasRealWebLocks, settleLockQueue } from '@/tests/helpers/vaultLockProbe';

let storageData: Record<string, unknown> = {};
/** 首次「写回收站整包」的闸门：用它把独占请求准确地停在临界区中途。 */
let trashWriteGate: { promise: Promise<void>; resolve: () => void } | null = null;
let trashWriteStarted: (() => void) | null = null;

const trashedEntry = (id: string): TrashedPasswordEntry =>
  ({
    id,
    url: 'example.com',
    username: `user-${id}`,
    encryptedData: `cipher-${id}`,
    createTime: 1,
    updateTime: 1,
    deletedAt: 2,
  }) as unknown as TrashedPasswordEntry;

const historyRecord = (entryId: string): PasswordHistoryRecord => ({
  entryId,
  password: `old-cipher-${entryId}`,
  changedAt: 1,
});

const trashIds = (): string[] => ((storageData[STORAGE_KEYS.TRASH] as TrashedPasswordEntry[]) ?? []).map(e => e.id);
const historyEntryIds = (): string[] =>
  ((storageData[STORAGE_KEYS.PASSWORD_HISTORY] as PasswordHistoryRecord[]) ?? []).map(r => r.entryId);

beforeEach(() => {
  storageData = {
    [STORAGE_KEYS.TRASH]: [trashedEntry('a')],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [historyRecord('a')],
    [STORAGE_KEYS.PASSWORD_REMINDERS]: [],
    [STORAGE_KEYS.PASSWORDS]: [],
  };
  trashWriteGate = null;
  trashWriteStarted = null;

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
        set: vi.fn(async (data: Record<string, unknown>) => {
          if (Object.prototype.hasOwnProperty.call(data, STORAGE_KEYS.TRASH) && trashWriteGate) {
            // 第一次写回收站挂起，等测试放行——模拟临界区中途有另一个上下文的换钥到达。
            const gate = trashWriteGate;
            trashWriteStarted?.();
            await gate.promise;
          }
          Object.assign(storageData, data);
        }),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('彻底删除与排队换钥的交错', () => {
  it('宿主必须提供真实 navigator.locks，否则本文件的交错断言全是空跑', () => {
    expect(hasRealWebLocks(), '探针依赖真 Web Locks 的写者优先语义；缺环境时宁可当场失败，不允许静默绿').toBe(true);
  });

  it('独占换钥排在临界区中途时，彻底删除仍须走完历史清理', async () => {
    const { permanentDeleteFromTrash } = await import('@/utils/storage/trashManager');
    const { withVaultKeyTransitionQueued } = await import('@/utils/storage/vaultWriteLock');

    let released!: () => void;
    trashWriteGate = { promise: new Promise<void>(r => (released = r)), resolve: () => {} };
    let started!: () => void;
    const startedSignal = new Promise<void>(r => (started = r));
    trashWriteStarted = started;

    const deleteOp = permanentDeleteFromTrash(['a']);
    await startedSignal;

    // 条目还没落盘，此时让一个「排队独占」进来——它会停在 shared 租约之后。
    let transitionRan = false;
    const parkedTransition = withVaultKeyTransitionQueued(async () => {
      transitionRan = true;
    });
    await settleLockQueue();

    released();
    await expect(
      deleteOp,
      '历史清理那一步在临界区内又取一次租约，会被排队中的独占挡成 VAULT_BUSY',
    ).resolves.toBeUndefined();
    expect(historyEntryIds(), '条目已离开回收站却留下历史密文＝无人回收、用户也无法重试').toEqual([]);
    expect(trashIds()).toEqual([]);

    await parkedTransition;
    expect(transitionRan).toBe(true);
  });
});

/**
 * 结构性防线：禁止再把「会取租约的公开版本」调进已持租约的临界区。
 *
 * 行为用例证明今天是对的；这条防止将来重构时把 `...WithinLease` 换回公开签名——
 * 那种改法行为测试不一定测得到（取决于有没有排队独占在场），却一定会重新引入半提交。
 */
describe('回收站不得在临界区内嵌套取租约', () => {
  it('trashManager 只引用租约内版本的历史清理', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(__dirname, '../../utils/storage/trashManager.ts'), 'utf8');

    expect(src, '公开版 deleteHistoryByEntryIds 自带 withVaultMutation，在临界区内嵌套即自锁').not.toMatch(
      /import\s*\{[^}]*\bdeleteHistoryByEntryIds\b[^}]*\}\s*from\s*'\.\/passwordHistory'/,
    );
    expect(src).toMatch(/deleteHistoryByEntryIdsWithinLease/);
  });
});

/**
 * 租约嵌套只是半提交的两条触发路径之一，另一条是**真实的写盘失败**（agents.md 点名的 Windows 慢盘 /
 * 杀毒扫描）。上一轮我只修了前者，却在注释里写成「半提交已消除」——那属于过度宣称：
 * `deleteHistoryByEntryIdsInternal` 把失败吞进 catch 只记日志，于是条目已经离开回收站、历史密文却没清掉，
 * 用户收到「删除成功」，而且再没有重试路径（条目 id 已不在任何列表里，也没有孤儿历史清扫器）。
 *
 * 正确形状有两半：清理失败必须上抛；且历史清理要排在摘条目**之前**，失败时条目仍留在回收站里可重试。
 */
describe('历史清理写盘失败时不得留下无人认领的密文', () => {
  const rejectHistoryWrite = (): void => {
    const setSpy = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    setSpy.mockImplementation(async (data: Record<string, unknown>) => {
      if (Object.prototype.hasOwnProperty.call(data, STORAGE_KEYS.PASSWORD_HISTORY)) {
        throw new Error('storage write rejected');
      }
      Object.assign(storageData, data);
    });
  };

  it('彻底删除：历史清理失败必须上抛，且条目仍留在回收站里等重试', async () => {
    rejectHistoryWrite();
    const { permanentDeleteFromTrash } = await import('@/utils/storage/trashManager');

    await expect(
      permanentDeleteFromTrash(['a']),
      '吞掉失败等于向用户谎报「已彻底删除」，而那些旧口令密文再没人认领',
    ).rejects.toThrow(/storage write rejected/);
    expect(trashIds(), '条目被摘走就不再出现在回收站里，用户没有任何重试入口').toEqual(['a']);
    expect(historyEntryIds()).toEqual(['a']);
  });

  it('清空回收站：同一形状', async () => {
    rejectHistoryWrite();
    const { emptyTrash } = await import('@/utils/storage/trashManager');

    await expect(emptyTrash()).rejects.toThrow(/storage write rejected/);
    expect(trashIds()).toEqual(['a']);
  });
});
