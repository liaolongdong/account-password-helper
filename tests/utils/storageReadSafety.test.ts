import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, TrashedPasswordEntry, PasswordHistoryRecord } from '@/utils/types';

/**
 * 存储读取失败安全性回归测试
 *
 * 背景：存储读取层曾把瞬时读取失败静默降级为空数组，导致读-改-写路径
 * （保存/批量保存/回收站恢复/清空/修改主密码 rekey）用「仅含新数据」的
 * 数组整体覆盖真实数据，造成不可逆丢失。
 *
 * 本套件锁定修复后的不变量：
 * 1. 所有读-改-写路径在读取失败时必须拒绝且绝不写入（数据原样保留）；
 * 2. 纯展示路径（回收站列表/计数、密码历史查询）仍可降级为空值，不抛错。
 *
 * chrome.storage.local 以内存桩实现，`failKey` 命中时 get 抛错，
 * 模拟瞬时存储读取失败（配额/杀毒拦截/序列化异常等）。
 */

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'mock-data-key'),
  deriveVerifierHash: vi.fn(async () => 'mock-verifier'),
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, encrypted: true })),
  decryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, encrypted: false })),
  encryptData: vi.fn(async (data: string) => `enc:${data}`),
  decryptData: vi.fn(async (data: string) => data.replace(/^enc:/, '')),
}));

let storageData: Record<string, unknown>;
let failKey: string | null;
const localGet = vi.fn(async (key: string) => {
  if (failKey && key === failKey) throw new Error('simulated storage read failure');
  return key in storageData ? { [key]: storageData[key] } : {};
});
const localSet = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(storageData, items);
});
const localRemove = vi.fn(async (key: string) => {
  delete storageData[key];
});

/** at-rest 密文条目形态 */
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

beforeEach(() => {
  storageData = {};
  failKey = null;
  localGet.mockClear();
  localSet.mockClear();
  localRemove.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet, remove: localRemove },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('密码列表写路径：读取失败时拒绝且不覆盖真实数据', () => {
  it('getAllPasswordsRaw 读取失败时抛出而非返回空数组', async () => {
    const { getAllPasswordsRaw } = await import('@/utils/storage/passwordCrud');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('existing')];
    failKey = STORAGE_KEYS.PASSWORDS;

    await expect(getAllPasswordsRaw()).rejects.toThrow('simulated storage read failure');
  });

  it('savePassword 读取失败时拒绝且不写入（真实列表不被清空）', async () => {
    const { savePassword } = await import('@/utils/storage/passwordCrud');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('existing')];
    failKey = STORAGE_KEYS.PASSWORDS;

    await expect(
      savePassword({
        username: 'u',
        password: 'p',
        url: 'https://example.com',
        tag: '',
        remark: '',
        createTime: 1,
        updateTime: 1,
      }),
    ).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(1);
  });

  it('batchSavePasswords 读取失败时拒绝且不写入', async () => {
    const { batchSavePasswords } = await import('@/utils/storage/passwordCrud');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('existing')];
    failKey = STORAGE_KEYS.PASSWORDS;

    await expect(
      batchSavePasswords([
        {
          username: 'u',
          password: 'p',
          url: 'https://example.com',
          tag: '',
          remark: '',
          createTime: 1,
          updateTime: 1,
        },
      ]),
    ).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(1);
  });

  it('updatePassword 读取失败时拒绝且不写入', async () => {
    const { updatePassword } = await import('@/utils/storage/passwordCrud');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('existing')];
    failKey = STORAGE_KEYS.PASSWORDS;

    await expect(updatePassword('existing', { tag: 'work' })).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
  });
});

describe('回收站写路径：读取失败时拒绝且不覆盖真实数据', () => {
  it('restoreFromTrash 主列表读取失败时拒绝，主列表与回收站均不被清空', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('keep-1'), cipherEntry('keep-2')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('restore-me')];
    failKey = STORAGE_KEYS.PASSWORDS;

    await expect(restoreFromTrash(['restore-me'])).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(2);
    expect(storageData[STORAGE_KEYS.TRASH]).toHaveLength(1);
  });

  it('moveToTrash 回收站读取失败时拒绝，既有回收站条目不被覆盖丢失', async () => {
    const { moveToTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('to-trash'), cipherEntry('keep')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('old-trash')];
    failKey = STORAGE_KEYS.TRASH;

    await expect(moveToTrash(['to-trash'])).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toHaveLength(2);
    expect(storageData[STORAGE_KEYS.TRASH]).toHaveLength(1);
  });

  it('emptyTrash 读取失败时拒绝，回收站不被清空', async () => {
    const { emptyTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('t1'), trashEntry('t2')];
    failKey = STORAGE_KEYS.TRASH;

    await expect(emptyTrash()).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.TRASH]).toHaveLength(2);
  });

  it('permanentDeleteFromTrash 读取失败时拒绝，回收站不被清空', async () => {
    const { permanentDeleteFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('t1'), trashEntry('t2')];
    failKey = STORAGE_KEYS.TRASH;

    await expect(permanentDeleteFromTrash(['t1'])).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.TRASH]).toHaveLength(2);
  });
});

describe('历史记录写路径：读取失败时不覆盖', () => {
  it('snapshotPasswordHistory 读取失败时静默跳过且不写入（历史不被清空）', async () => {
    const { snapshotPasswordHistory } = await import('@/utils/storage/passwordHistory');
    const existing: PasswordHistoryRecord[] = [{ entryId: 'a', password: 'old-cipher', changedAt: 1 }];
    storageData[STORAGE_KEYS.PASSWORD_HISTORY] = existing;
    failKey = STORAGE_KEYS.PASSWORD_HISTORY;

    // 快照失败不阻塞主流程（保持既有语义），但绝不能把历史清空
    await snapshotPasswordHistory('a', 'new-cipher');

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORD_HISTORY]).toEqual(existing);
  });
});

describe('修改主密码（rekey）：任一存储读取失败即中止，绝不原子写入', () => {
  it('密码列表读取失败时 rekey 拒绝，三块数据与会话密钥均未写入', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('p1')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('t1')];
    storageData[STORAGE_KEYS.PASSWORD_HISTORY] = [{ entryId: 'p1', password: 'enc:h', changedAt: 1 }];
    storageData[STORAGE_KEYS.MASTER_PASSWORD] = { hashedPassword: 'old', salt: 'the-salt', kdf: 'pbkdf2-sha256' };
    failKey = STORAGE_KEYS.PASSWORDS;

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'old' });
  });

  it('回收站读取失败时 rekey 拒绝，密码列表不被重新加密覆盖', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('p1')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('t1')];
    storageData[STORAGE_KEYS.PASSWORD_HISTORY] = [];
    storageData[STORAGE_KEYS.MASTER_PASSWORD] = { hashedPassword: 'old', salt: 'the-salt', kdf: 'pbkdf2-sha256' };
    failKey = STORAGE_KEYS.TRASH;

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.PASSWORDS]).toEqual([cipherEntry('p1')]);
  });
});

describe('纯展示路径：读取失败仍可降级，不向用户抛错', () => {
  it('getTrashEntries / getTrashCount 读取失败时降级为空列表 / 0', async () => {
    const { getTrashEntries, getTrashCount } = await import('@/utils/storage/trashManager');
    failKey = STORAGE_KEYS.TRASH;

    await expect(getTrashEntries()).resolves.toEqual([]);
    await expect(getTrashCount()).resolves.toBe(0);
  });

  it('getPasswordHistory 读取失败时降级为空列表', async () => {
    const { getPasswordHistory } = await import('@/utils/storage/passwordHistory');
    failKey = STORAGE_KEYS.PASSWORD_HISTORY;

    await expect(getPasswordHistory('a')).resolves.toEqual([]);
  });
});
