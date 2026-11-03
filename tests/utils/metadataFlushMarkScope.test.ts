/**
 * 元数据 flush 的打标必须落在提交锁内（评审 2026-11-02 Minor 10）
 *
 * `METADATA_FLUSH_AT` 是给 SW 的 `storage.onChanged` 认「仅元数据变更」用的暗号：命中就原地修补
 * 内存缓存与快照（保住侧边栏快路径），没命中就整包失效。它消费即删且只活 3 秒，而现在打标发生在
 * **取提交锁之前**——那段空档里别的写者完全可以触发一次 onChanged 把这枚标记吃掉，或让本次落盘排到
 * TTL 之后，结果是一次普通收藏操作把侧边栏快照整包打穿。
 *
 * 判据：写标记的那一刻，提交锁必须正被本次 flush 持着（即标记与数据落盘在同一临界区内）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry } from '@/utils/types';
import { hasRealWebLocks, isVaultCommitLockHeld } from '@/tests/helpers/vaultLockProbe';

let store: Record<string, unknown>;
/** 每次写 `METADATA_FLUSH_AT` 的那一刻「提交锁是否被持着」。 */
let heldWhenMarked: boolean[];

const row = (id: string): EncryptedPasswordEntry =>
  ({
    id,
    username: 'cipher',
    password: 'cipher',
    url: 'https://example.com',
    tag: '',
    remark: '',
    createTime: 1,
    updateTime: 1,
    order: 0,
    favorite: false,
    encrypted: true,
  }) as unknown as EncryptedPasswordEntry;

beforeEach(() => {
  vi.clearAllMocks();
  heldWhenMarked = [];
  store = { [STORAGE_KEYS.PASSWORDS]: [row('a')] };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const found: Record<string, unknown> = {};
          for (const key of list) if (key in store) found[key] = store[key];
          return found;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: undefined })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          if (SESSION_MEMORY_KEYS.METADATA_FLUSH_AT in items) {
            heldWhenMarked.push(await isVaultCommitLockHeld());
          }
        }),
        remove: vi.fn(async () => {}),
      },
    },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('探针的运行前提', () => {
  it('宿主必须提供真实 navigator.locks，否则本文件的临界区断言全是空跑', () => {
    expect(hasRealWebLocks(), '探针依赖真 Web Locks 的持有/排队语义；缺环境时宁可当场失败，不允许静默绿').toBe(true);
  });
});

describe('打标与落盘的同一临界区', () => {
  it('写 METADATA_FLUSH_AT 时提交锁必须已被本次 flush 持有', async () => {
    const { updatePasswordInSession } = await import('@/utils/storage/passwordCrud');

    const settled = updatePasswordInSession('a', { favorite: true });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(settled).resolves.toBeUndefined();

    expect(heldWhenMarked, '用例空跑：flush 压根没打标，判据失去牙齿').toHaveLength(1);
    expect(heldWhenMarked[0], '打标在锁外＝标记可被别的写者抢先消费，元数据落盘退化成整包缓存失效').toBe(true);

    // 数据确实落盘了（不是只打标就返回）
    const rows = store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[];
    expect(rows[0].favorite).toBe(true);
  });

  it('批次没命中任何条目时不得留下标记', async () => {
    const { updatePasswordInSession } = await import('@/utils/storage/passwordCrud');

    const settled = updatePasswordInSession('ghost-not-in-store', { favorite: true });
    await vi.advanceTimersByTimeAsync(1500);
    await settled;

    // 收窄之后根本不该打标：没有数据要落盘，就没有暗号可留。
    expect(heldWhenMarked, '空批次仍去打标＝给 SW 留了一枚会被别人消费的暗号').toHaveLength(0);
    expect(store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[]).toHaveLength(1);
    expect((store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[])[0].favorite).toBe(false);
  });
});
