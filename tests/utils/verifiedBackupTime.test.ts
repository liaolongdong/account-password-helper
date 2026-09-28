import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 「最近成功备份」时间戳存储单元测试
 *
 * 覆盖 getLastVerifiedBackupAt / markVerifiedBackupAt：
 * - 读取已存数字；无键 / 非数字 / 读取异常时降级为 null（不抛）；
 * - 写入透传时间戳；缺省回落当前时间。
 *
 * chrome.storage.local 以内存实现打桩，保持 hermetic。
 */

let store: Record<string, unknown>;
const storageGet = vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {}));
const storageSet = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(store, items);
});

beforeEach(() => {
  store = {};
  storageGet.mockClear();
  storageSet.mockClear();
  vi.stubGlobal('chrome', { storage: { local: { get: storageGet, set: storageSet } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { getLastVerifiedBackupAt, markVerifiedBackupAt } from '@/utils/storage/configManager';

describe('getLastVerifiedBackupAt', () => {
  it('读取已存的合法时间戳', async () => {
    store[STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT] = 1_700_000_000_000;
    await expect(getLastVerifiedBackupAt()).resolves.toBe(1_700_000_000_000);
  });

  it('从未成功备份（无键）→ null', async () => {
    await expect(getLastVerifiedBackupAt()).resolves.toBeNull();
  });

  it('存储值非数字（损坏/伪造）→ null', async () => {
    store[STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT] = 'not-a-number';
    await expect(getLastVerifiedBackupAt()).resolves.toBeNull();
  });

  it('storage 读取异常 → 降级 null 不抛出', async () => {
    storageGet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(getLastVerifiedBackupAt()).resolves.toBeNull();
  });
});

describe('markVerifiedBackupAt', () => {
  it('写入指定时间戳', async () => {
    await markVerifiedBackupAt(1_600_000_000_000);
    expect(storageSet).toHaveBeenCalledWith({ [STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT]: 1_600_000_000_000 });
    expect(store[STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT]).toBe(1_600_000_000_000);
  });

  it('缺省回落当前时间（写入正整数时间戳）', async () => {
    const before = Date.now();
    await markVerifiedBackupAt();
    const written = store[STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT] as number;
    expect(typeof written).toBe('number');
    expect(written).toBeGreaterThanOrEqual(before);
    expect(written).toBeLessThanOrEqual(Date.now());
  });
});
