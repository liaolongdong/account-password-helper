/**
 * 历史域的整包覆写必须全部排在 `aph-password-history-commit` 之内
 *
 * 密码历史的所有写都是「读整包 → 改 → 写整包」，而 `withVaultMutation` 的 shared 租约按
 * Web Locks 定义不互斥写者：两个来源交错时，后写者会拿自己那份旧快照把对方的快照或删除
 * 整片回卷。历史域因此有了一把自己的排他提交锁。
 *
 * 坑出在「租约内版本」这一层。`snapshotPasswordHistoryWithinLease` /
 * `deleteHistoryByEntryIdsWithinLease` 当初只是为了免掉**嵌套的 vault 租约**（写者优先会把
 * 临界区内的第二次租约挡成 `VAULT_BUSY`，于是回收站留下「条目已摘、历史密文无人回收」的半提交），
 * 但如果顺手把同名的历史锁也一起免掉，彻底删除与改密快照就从锁外写同一个整包——上面那句
 * 「串起来」当场不成立，而调用点看起来一模一样，只有交错时才暴露。
 *
 * 判据用真 `navigator.locks`：先把历史锁占住，再发起这两个入口的写入，断言它进不去；
 * 放开后必须补上。摘掉 `*WithinLease` 里的 `withHistoryCommit`，本文件当场翻红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { PasswordHistoryRecord } from '@/utils/types';
import { hasRealWebLocks, settleLockQueue } from '@/tests/helpers/vaultLockProbe';

/** 历史域的提交锁（见 `utils/storage/passwordHistory.ts` 的 `withHistoryCommit`）。 */
const HISTORY_COMMIT_LOCK = 'aph-password-history-commit';

vi.mock('@/utils/storage/configManager', () => ({
  getPasswordHistoryConfig: vi.fn(async () => ({ enabled: true, maxHistoryPerEntry: 3 })),
}));

let store: Record<string, unknown>;
let setCalls: number;

beforeEach(() => {
  vi.clearAllMocks();
  setCalls = 0;
  store = {
    [STORAGE_KEYS.PASSWORD_HISTORY]: [{ entryId: 'a', password: 'enc:old-1', changedAt: 1 }] as PasswordHistoryRecord[],
  };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const found: Record<string, unknown> = {};
          for (const key of list) if (key in store) found[key] = store[key];
          return found;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          setCalls += 1;
          Object.assign(store, items);
        }),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
    runtime: { id: 'fixture' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * 把历史锁占住，直到返回的 `release()` 被调用。
 *
 * @returns 等待锁被释放的 promise（收尾时 await 它，避免泄漏到下一个用例）
 */
async function holdHistoryLock(): Promise<{ release: () => void; done: Promise<void> }> {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const done = navigator.locks.request(HISTORY_COMMIT_LOCK, { mode: 'exclusive' }, async () => {
    await gate;
  });
  await settleLockQueue();
  return { release, done };
}

const history = (): PasswordHistoryRecord[] => store[STORAGE_KEYS.PASSWORD_HISTORY] as PasswordHistoryRecord[];

describe('租约内版本的持锁范围', () => {
  it('宿主必须提供真实 navigator.locks，否则本文件的判据全是空跑', async () => {
    expect(hasRealWebLocks(), '探针依赖真 Web Locks 的持有/排队语义；缺环境时宁可当场失败').toBe(true);
  });

  it('旧口令快照不得从历史锁外面写整包', async () => {
    const { snapshotPasswordHistoryWithinLease } = await import('@/utils/storage/passwordHistory');
    const { release, done } = await holdHistoryLock();

    const write = snapshotPasswordHistoryWithinLease('a', 'enc:old-2');
    let settled = false;
    void write.then(() => {
      settled = true;
    });
    await settleLockQueue();

    expect(settled, '历史锁被占着，租约内版本却直接落盘了：它绕开了 withHistoryCommit').toBe(false);
    expect(setCalls, '锁外发生过一次整包 set').toBe(0);

    release();
    await write;
    await done;
    expect(
      history().map(r => r.password),
      '放开锁后这次快照必须照常补上',
    ).toContain('enc:old-2');
  });

  it('回收站的批量历史删除不得从历史锁外面写整包', async () => {
    const { deleteHistoryByEntryIdsWithinLease } = await import('@/utils/storage/passwordHistory');
    const { release, done } = await holdHistoryLock();

    const write = deleteHistoryByEntryIdsWithinLease(['a']);
    let settled = false;
    void write.then(() => {
      settled = true;
    });
    await settleLockQueue();

    expect(settled, '同上：删除路径也得排在历史锁里，否则它会与并发快照互相回卷').toBe(false);
    expect(history(), '锁外发生过一次整包 set').toHaveLength(1);

    release();
    await write;
    await done;
    expect(history(), '放开锁后这次删除必须照常完成').toHaveLength(0);
  });
});
