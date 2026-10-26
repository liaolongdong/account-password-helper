/**
 * 元数据防抖落盘与换钥碰撞的 Promise 生命周期（评审报告 P2-3）
 *
 * `updatePasswordInSession` 对外的语义是「数据实际写入 storage 后 resolve」。
 * 但 flush 在**取租约之前**就清空了队列，遇到 `VAULT_BUSY`（换钥进行中）时回队重试——
 * 旧实现在 `finally` 里无条件结算全部 resolve，于是：
 * - 调用方被告知「已保存」，而盘上还是旧值；
 * - 若 SW 恰好在那 1.5 秒重试等待里被回收，收藏 / 使用痕迹 / 排序就静默丢失。
 *
 * 现在只有三种时刻结算：真正落盘成功、写盘失败、重试预算耗尽（避免 Promise 永挂）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry } from '@/utils/types';

const { withVaultMutation } = vi.hoisted(() => ({
  withVaultMutation: vi.fn<(cb: () => Promise<unknown>) => Promise<unknown>>(),
}));

vi.mock('@/utils/storage/vaultWriteLock', () => ({
  withVaultMutation,
  withVaultKeyTransition: (cb: () => Promise<unknown>) => cb(),
  withVaultMutationRetry: (cb: () => Promise<unknown>) => cb(),
}));

let store: Record<string, unknown>;

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
  vi.useFakeTimers();
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
        remove: vi.fn(async (key: string) => delete store[key]),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  });
  // 默认放行租约（真正执行回调），单测里按需改成抛 VAULT_BUSY
  withVaultMutation.mockImplementation(async (cb: () => Promise<unknown>) => cb());
});

const busyError = (): Error => Object.assign(new Error('Vault is busy changing keys'), { code: 'VAULT_BUSY' });

describe('换钥进行中的元数据回队', () => {
  it('BUSY 回队期间不得结算；重试落盘成功后才 resolve', async () => {
    withVaultMutation.mockImplementationOnce(async () => {
      throw busyError();
    });
    const { updatePasswordInSession } = await import('@/utils/storage/passwordCrud');

    let settled = false;
    const pending = updatePasswordInSession('a', { favorite: true }).then(() => {
      settled = true;
    });

    // 第一次防抖窗口到期 → flush 撞上换钥 → 回队，不向调用方谎报
    await vi.advanceTimersByTimeAsync(1500);
    expect(settled, 'BUSY 回队期间提前 resolve 等于向 UI 谎报已保存').toBe(false);
    expect((store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[])[0].favorite).toBe(false);

    // 重试排程到期 → 真正落盘 → 结算
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    expect(settled).toBe(true);
    expect((store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[])[0].favorite).toBe(true);
  });

  it('重试预算耗尽时结算并保留队列，绝不让调用方 Promise 永挂', async () => {
    withVaultMutation.mockImplementation(async () => {
      throw busyError();
    });
    const { updatePasswordInSession } = await import('@/utils/storage/passwordCrud');

    const settled = vi.fn();
    const pending = updatePasswordInSession('a', { favorite: true }).then(settled);

    // 1 次首刷 + 3 次重试预算，全部撞上换钥
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(settled).toHaveBeenCalledTimes(1);
    expect(withVaultMutation).toHaveBeenCalledTimes(4);
  });
});
