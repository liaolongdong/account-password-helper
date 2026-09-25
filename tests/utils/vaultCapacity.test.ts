import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, PasswordEntry, TrashedPasswordEntry } from '@/utils/types';

/**
 * 账号密码条目总量上限回归测试（utils/storage/vaultCapacity.ts 及其三处接线）
 *
 * 契约有三条，都需要被钉住：
 * 1. **只有会让条数变长的三条路径受限**：savePassword / batchSavePasswords / restoreFromTrash；
 * 2. **超限时一格都不写、且不做任何加密工作**：守卫在读取到当前条数之后、密钥派生与
 *    AES-GCM 之前，所以「保存被上限拒绝」不该付出一次 PBKDF2；
 * 3. **整批要么全写要么全不写**：不做静默截断，截断由导入预览页在用户确认后显式完成。
 *
 * 上限数值本身也是被测对象（用户拍板的口径）：改动它必须是有意的，而不是重构的副作用。
 */

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'mock-data-key'),
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, encrypted: true })),
  decryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, encrypted: false })),
}));

let storageData: Record<string, unknown>;
const localGet = vi.fn(async (key: string) => (key in storageData ? { [key]: storageData[key] } : {}));
const localSet = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(storageData, items);
});

/** at-rest 密文条目形态（只用于计数，不含任何真实凭据） */
const cipherEntry = (id: string): EncryptedPasswordEntry =>
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
    encrypted: true,
  }) as unknown as EncryptedPasswordEntry;

const trashEntry = (id: string): TrashedPasswordEntry => ({ ...cipherEntry(id), deletedAt: Date.now() });

/** 造一份 n 条目的主列表 */
const fillTo = (n: number): EncryptedPasswordEntry[] => Array.from({ length: n }, (_, i) => cipherEntry(`e${i}`));

/** 一条合法的新条目载荷 */
const newEntry = (): Omit<PasswordEntry, 'id' | 'order'> => ({
  username: 'u',
  password: 'p',
  url: 'https://example.com',
  tag: '',
  remark: '',
  createTime: 1,
  updateTime: 1,
});

beforeEach(() => {
  storageData = {};
  localGet.mockClear();
  localSet.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet, remove: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('上限判定（纯函数）', () => {
  it('上限是 2000 条（用户拍板的口径，改动须有意）', async () => {
    const { MAX_PASSWORD_ENTRIES } = await import('@/utils/storage/vaultCapacity');
    expect(MAX_PASSWORD_ENTRIES).toBe(2000);
  });

  it('写入后正好等于上限时放行，超出 1 条即拒绝', async () => {
    const { assertWithinCapacity, isVaultCapacityError } = await import('@/utils/storage/vaultCapacity');
    expect(() => assertWithinCapacity(1999, 1)).not.toThrow();
    expect(() => assertWithinCapacity(2000, 0)).not.toThrow();
    expect(() => assertWithinCapacity(2000, 1)).toThrow();
    try {
      assertWithinCapacity(1995, 6);
    } catch (error) {
      expect(isVaultCapacityError(error)).toBe(true);
    }
  });

  it('判别码可识别，普通错误与自造 code 的普通 Error 不误判', async () => {
    const { isVaultCapacityError, VaultCapacityError, VAULT_CAPACITY_ERROR_CODE } =
      await import('@/utils/storage/vaultCapacity');
    expect(isVaultCapacityError(new VaultCapacityError(2000, 1))).toBe(true);
    expect(isVaultCapacityError(new Error('boom'))).toBe(false);
    const forged = new Error('boom');
    (forged as { code?: string }).code = VAULT_CAPACITY_ERROR_CODE;
    expect(isVaultCapacityError(forged)).toBe(false);
    expect(isVaultCapacityError(undefined)).toBe(false);
  });

  it('剩余额度不会为负', async () => {
    const { remainingCapacity } = await import('@/utils/storage/vaultCapacity');
    expect(remainingCapacity(0)).toBe(2000);
    expect(remainingCapacity(1999)).toBe(1);
    expect(remainingCapacity(2000)).toBe(0);
    expect(remainingCapacity(5000)).toBe(0);
  });

  it('错误消息只含计数，不含条目内容', async () => {
    const { VaultCapacityError } = await import('@/utils/storage/vaultCapacity');
    const message = new VaultCapacityError(2000, 3).message;
    expect(message).toContain('2000');
    expect(message).not.toMatch(/username|password|cipher/i);
  });
});

describe('savePassword：超限拒绝且不加密、不写入', () => {
  it('已满 2000 条时新增被拒绝，列表长度不变', async () => {
    const { savePassword } = await import('@/utils/storage/passwordCrud');
    const enc = await import('@/utils/encryption');
    storageData[STORAGE_KEYS.PASSWORDS] = fillTo(2000);

    await expect(savePassword(newEntry(), 'master-password')).rejects.toThrow(/上限/);

    expect(localSet).not.toHaveBeenCalled();
    expect(enc.encryptPasswordEntry).not.toHaveBeenCalled();
    expect(enc.deriveEncryptionKey).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(2000);
  });

  it('1999 条时新增成功，落盘正好 2000 条', async () => {
    const { savePassword } = await import('@/utils/storage/passwordCrud');
    storageData[STORAGE_KEYS.PASSWORDS] = fillTo(1999);

    await savePassword(newEntry(), 'master-password');

    expect(localSet).toHaveBeenCalledTimes(1);
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(2000);
  });
});

describe('batchSavePasswords：整批要么全写要么全不写', () => {
  it('1990 + 11 条被整批拒绝，不静默截断到 2000', async () => {
    const { batchSavePasswords } = await import('@/utils/storage/passwordCrud');
    const { isVaultCapacityError } = await import('@/utils/storage/vaultCapacity');
    storageData[STORAGE_KEYS.PASSWORDS] = fillTo(1990);

    const error = await batchSavePasswords(Array.from({ length: 11 }, newEntry), 'master-password').catch(e => e);

    expect(isVaultCapacityError(error)).toBe(true);
    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(1990);
  });

  it('1990 + 10 条正好补满上限时放行', async () => {
    const { batchSavePasswords } = await import('@/utils/storage/passwordCrud');
    storageData[STORAGE_KEYS.PASSWORDS] = fillTo(1990);

    await batchSavePasswords(Array.from({ length: 10 }, newEntry), 'master-password');

    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(2000);
  });
});

describe('restoreFromTrash：超限时主列表与回收站都保持原样', () => {
  it('已满 2000 条时恢复被拒绝，回收站条目不会被消费掉', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = fillTo(2000);
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('t1'), trashEntry('t2')];

    await expect(restoreFromTrash(['t1', 't2'])).rejects.toThrow(/上限/);

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(2000);
    expect(storageData[STORAGE_KEYS.TRASH]).toHaveLength(2);
  });

  it('剩余额度只够 1 条时，一次恢复 2 条整批拒绝', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = fillTo(1999);
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('t1'), trashEntry('t2')];

    await expect(restoreFromTrash(['t1', 't2'])).rejects.toThrow(/上限/);
    expect(localSet).not.toHaveBeenCalled();
  });
});
