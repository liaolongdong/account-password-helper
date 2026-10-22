import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, TrashedPasswordEntry } from '@/utils/types';

/**
 * rekey 的「过期快照不得整数组覆写」回归测试
 *
 * 换主密码是长事务：步骤 3 读快照，步骤 11 用**整数组覆写**落盘，中间隔着全库重加密
 * （2000 条量级要跑几秒）。Chrome 允许同时开两张管理页标签，另一页在这几秒里删条目、
 * 彻底删除或清空回收站，都会先落到盘上、再被本事务的旧快照整体盖掉——
 * 后果是「刚删的记录从两张表一起消失」（不可恢复），或「已彻底删除的 PII 在新密钥下复活」
 * （打掉回收站 30 天到期的隐私承诺）。
 *
 * 钉死两点：
 * 1. 覆写前复验发现漂移时**不产生任何数据写入**，盘上仍是旧钥密文，用户重试即可；
 * 2. 抛出的错误带 `REKEY_CONCURRENT_WRITE` 码，弹窗据此给本地化文案而不是直出中文串。
 *
 * 加密模块以回显密钥的桩注入（与 identityRekey.test.ts 同口径），避免 600k 次 PBKDF2。
 */

const { deriveEncryptionKey, deriveVerifierHash, encryptData, decryptData } = vi.hoisted(() => ({
  deriveEncryptionKey: vi.fn<(password: string) => Promise<string>>(),
  deriveVerifierHash: vi.fn<(password: string, salt: string) => Promise<string>>(),
  encryptData: vi.fn<(data: string, key: string) => Promise<string>>(),
  decryptData: vi.fn<(data: string, key: string) => Promise<string>>(),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey,
  deriveVerifierHash,
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>, _s: string, key: string) => ({
    ...entry,
    password: `cipher:${key}`,
  })),
  decryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>, _s: string, key: string) => ({
    ...entry,
    password: `plain:${key}`,
  })),
  encryptData,
  decryptData,
}));

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: vi.fn(async () => true),
}));

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

const trashEntry = (id: string): TrashedPasswordEntry => ({
  ...(cipherEntry(id) as EncryptedPasswordEntry),
  deletedAt: 111,
});

let storageData: Record<string, unknown>;
let localSet: ReturnType<typeof vi.fn>;
/** TRASH 的读取次数：第 1 次是步骤 3 的快照，第 2 次是覆写前的复验 */
let trashReads: number;
/** 模拟「另一张管理页标签在重加密期间清空了回收站」*/
let concurrentWriter: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  trashReads = 0;
  concurrentWriter = true;
  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [trashEntry('t1')],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.IDENTITY]: [],
    [STORAGE_KEYS.IDENTITY_TRASH]: [],
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
  };

  deriveEncryptionKey.mockImplementation(async password => `key:${password}`);
  deriveVerifierHash.mockImplementation(async (password, salt) => `verifier:${password}:${salt}`);
  encryptData.mockImplementation(async (data, key) => `enc[${key}]:${data}`);
  decryptData.mockImplementation(async (data, key) => {
    const prefix = `enc[${key}]:`;
    if (!String(data).startsWith(prefix)) throw new Error('key mismatch');
    return String(data).slice(prefix.length);
  });

  localSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageData, items);
  });

  const localGet = vi.fn(async (key: string) => {
    if (key === STORAGE_KEYS.TRASH && concurrentWriter) {
      trashReads += 1;
      // 快照读到真实值；复验时另一页已把回收站清空 → 快照过期
      if (trashReads === 2) return { [STORAGE_KEYS.TRASH]: [] };
    }
    return key in storageData ? { [key]: storageData[key] } : {};
  });

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: localGet,
        set: localSet,
        remove: vi.fn(async (key: string) => {
          delete storageData[key];
        }),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rekey 覆写前的快照复验', () => {
  it('重加密期间回收站被别的标签清空时，中止换钥且不落任何数据写', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toMatchObject({
      code: 'REKEY_CONCURRENT_WRITE',
    });

    // 无第二次补写：整次事务没碰过 storage.local.set
    expect(localSet).not.toHaveBeenCalled();
    // 盘上仍是旧钥密文，条目与回收站都在原处
    expect((storageData[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[]).map(e => e.id)).toEqual(['p1']);
    expect((storageData[STORAGE_KEYS.TRASH] as TrashedPasswordEntry[]).map(e => e.id)).toEqual(['t1']);
    expect(trashReads).toBe(2);
  });

  it('同 id 条目被改过（updateTime 变化）也算漂移，不用过期密文覆盖它', async () => {
    let passwordsReads = 0;
    const chromeLocal = (chrome.storage.local as unknown as { get: ReturnType<typeof vi.fn> }).get;
    chromeLocal.mockImplementation(async (key: string) => {
      if (key === STORAGE_KEYS.PASSWORDS) {
        passwordsReads += 1;
        if (passwordsReads === 2) {
          return { [STORAGE_KEYS.PASSWORDS]: [{ ...cipherEntry('p1'), updateTime: 999 }] };
        }
      }
      return key in storageData ? { [key]: storageData[key] } : {};
    });
    concurrentWriter = false;

    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toMatchObject({
      code: 'REKEY_CONCURRENT_WRITE',
    });
    expect(localSet).not.toHaveBeenCalled();
    expect(passwordsReads).toBe(2);
  });

  it('无并发写时正常落盘，只多读一次、不额外写', async () => {
    concurrentWriter = false;
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).resolves.toBeUndefined();

    expect(localSet).toHaveBeenCalledTimes(1);
    expect((storageData[STORAGE_KEYS.TRASH] as TrashedPasswordEntry[]).map(e => e.id)).toEqual(['t1']);
  });
});
