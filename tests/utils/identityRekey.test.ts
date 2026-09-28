import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { IdentityRecord } from '@/utils/identity/types';
import type { EncryptedPasswordEntry } from '@/utils/types';

/**
 * 身份库 rekey 全链路回归测试
 *
 * 钉死 R1（换主密码漏掉身份库 → PII 永久不可解）的四条不变量：
 * 1. rekey 后身份库用**新钥**重新加密（旧钥不可解、新钥可解回原文）；
 * 2. 身份库并入**同一次**原子 `chrome.storage.local.set()`（无第二次补写）；
 * 3. `getAllIdentityRaw()` 抛错时整次 rekey 在任何写入发生**之前**中止；
 * 4. 换钥失败/损坏的单条记录原样保留（不因 rekey 丢数据）。
 *
 * 加密模块以 mock 注入并回显密钥，使「由哪把密钥加密」成为可直接断言的观测点，
 * 同时避免 600k 次 PBKDF2 拖慢测试。
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

const identityPayloadJson = JSON.stringify({ pv: 1, category: 'person', name: '张三', phone: '13812345678' });

/** 回显 key 的可逆加密桩，模拟 AES-GCM「错钥即抛」语义 */
const enc = (data: string, key: string) => `enc[${key}]:${data}`;
const dec = (data: string, key: string) => {
  const prefix = `enc[${key}]:`;
  if (!data.startsWith(prefix)) throw new Error('key mismatch');
  return data.slice(prefix.length);
};

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

let storageData: Record<string, unknown>;
let localSet: ReturnType<typeof vi.fn>;
let failIdentityRead: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  failIdentityRead = false;
  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.IDENTITY]: [
      { id: 'i1', encryptedPayload: enc(identityPayloadJson, 'key:old-pw'), createTime: 1, updateTime: 1 },
    ] satisfies IdentityRecord[],
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
  };

  deriveEncryptionKey.mockImplementation(async password => `key:${password}`);
  deriveVerifierHash.mockImplementation(async (password, salt) => `verifier:${password}:${salt}`);
  encryptData.mockImplementation(async (data, key) => enc(data, key));
  decryptData.mockImplementation(async (data, key) => dec(data, key));

  localSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageData, items);
  });

  const localGet = vi.fn(async (key: string) => {
    if (key === STORAGE_KEYS.IDENTITY && failIdentityRead) throw new Error('identity read boom');
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
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('changeMasterPassword 纳入身份库 rekey', () => {
  it('身份库用新钥重新加密：新钥可解回原文、旧钥不可解', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    await changeMasterPassword('old-pw', 'new-pw');

    const identity = (storageData[STORAGE_KEYS.IDENTITY] as IdentityRecord[])[0];
    expect(dec(identity.encryptedPayload, 'key:new-pw')).toBe(identityPayloadJson);
    expect(() => dec(identity.encryptedPayload, 'key:old-pw')).toThrow('key mismatch');
  });

  it('身份库并入同一次原子写入（无第二次补写）', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    await changeMasterPassword('old-pw', 'new-pw');

    expect(localSet).toHaveBeenCalledTimes(1);
    const writtenItems = localSet.mock.calls[0][0] as Record<string, unknown>;
    expect(writtenItems).toHaveProperty(STORAGE_KEYS.IDENTITY);
    expect(writtenItems).toHaveProperty(STORAGE_KEYS.PASSWORDS);
  });

  it('getAllIdentityRaw 抛错时整次 rekey 中止，无任何写入', async () => {
    failIdentityRead = true;
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toThrow('identity read boom');
    expect(localSet).not.toHaveBeenCalled();
  });

  it('rekey 期间无法解密的身份记录原样保留（不丢数据）', async () => {
    const broken: IdentityRecord = { id: 'broken', encryptedPayload: 'corrupted', createTime: 1, updateTime: 1 };
    (storageData[STORAGE_KEYS.IDENTITY] as IdentityRecord[]).push(broken);

    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    await changeMasterPassword('old-pw', 'new-pw');

    const identity = storageData[STORAGE_KEYS.IDENTITY] as IdentityRecord[];
    expect(identity.find(r => r.id === 'broken')?.encryptedPayload).toBe('corrupted');
    expect(identity).toHaveLength(2);
  });
});
