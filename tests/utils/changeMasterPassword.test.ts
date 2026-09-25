import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, PasswordHistoryRecord } from '@/utils/types';

/**
 * 修改主密码（rekey）回归测试：口令归一化 + 历史记录容错
 *
 * 背景一：主密码在全仓只应有一种归一化口径。`setMasterPassword` /
 * `verifyMasterPassword` / `useAuthFlow` 的登录路径都对输入做 `trim()`，
 * 但 `changeMasterPassword` 曾把 UI 原样透传的新密码直接用于
 * `deriveEncryptionKey` 与 `deriveVerifierHash`。用户在弹窗里粘贴带首尾空格的
 * 新密码时会「改密成功」，但此后 `verifyMasterPassword` 永远以 trim 后的输入
 * 比对未 trim 的校验值 —— 全库永久锁死，只能靠 .aph 备份恢复。
 *
 * 背景二：历史记录的解密循环曾把「旧钥解不开」等同于「丢弃」，一次 rekey 直接
 * 删除这些用户的密码变更历史，与同文件身份库 `reencryptAll`「失败者原样携带」
 * 以及 `getAllHistory`「跳过但不回写」的口径相矛盾。
 *
 * 本套件锁定修复后的不变量：
 * 1. 派生数据密钥与校验值时收到的是同一个 trim 后的字符串；
 * 2. 落盘的校验值由 trim 后的新密码派生（与 set/verify 同口径）；
 * 3. trim 后为空的输入被拒绝，且不写任何 storage（与 setMasterPassword 一致）；
 * 4. 旧钥解不开的历史记录逐字保留，rekey 前后记录条数不变，可解记录仍用新钥重加密。
 *
 * 加密模块以 mock 注入并回显入参，避免 600k 次 PBKDF2 拖慢测试，
 * 同时让「派生函数收到的是什么字符串」成为可直接断言的观测点。
 */

const { deriveEncryptionKey, deriveVerifierHash } = vi.hoisted(() => ({
  deriveEncryptionKey: vi.fn<(password: string) => Promise<string>>(),
  deriveVerifierHash: vi.fn<(password: string, salt: string) => Promise<string>>(),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey,
  deriveVerifierHash,
  // 回显所使用的数据密钥（真实签名 (entry, '', dataKey)），使「落盘条目由哪把密钥加密」可断言
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>, _s: string, key: string) => ({
    ...entry,
    password: `cipher:${key}`,
  })),
  decryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>, _s: string, key: string) => ({
    ...entry,
    password: `plain:${key}`,
  })),
  // 回显所使用的数据密钥，使「历史密码由哪把密钥重新加密」成为可断言的观测点
  encryptData: vi.fn(async (data: string, key?: string) => `enc:${key ?? ''}:${data}`),
  decryptData: vi.fn(async (data: string) => data.replace(/^enc:/, '')),
}));

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: vi.fn(async () => true),
}));

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

let storageData: Record<string, unknown>;
let localSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
  };

  // 回显入参：使「未 trim 的密码」在断言中不可能与「已 trim」混淆
  deriveEncryptionKey.mockImplementation(async (password: string) => `key:${password}`);
  deriveVerifierHash.mockImplementation(async (password: string) => `verifier:${password}`);

  localSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageData, items);
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storageData ? { [key]: storageData[key] } : {})),
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

describe('changeMasterPassword 口令归一化', () => {
  it('新密码带首尾空格时，校验值由 trim 后的密码派生', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', ' new-pw ');

    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'verifier:new-pw' });
  });

  it('新密码带首尾空格时，数据密钥与校验值收到同一个字符串', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', ' new-pw ');

    expect(deriveEncryptionKey).toHaveBeenCalledWith('new-pw');
    expect(deriveVerifierHash).toHaveBeenCalledWith('new-pw', 'the-salt');
  });

  it('旧密码带首尾空格时，仍按 trim 后口径派生旧数据密钥', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword(' old-pw ', 'new-pw');

    expect(deriveEncryptionKey).toHaveBeenCalledWith('old-pw');
  });

  it('落盘条目由 trim 后的新数据密钥重新加密，salt 与 kdf 原样保留', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', ' new-pw ');

    const entries = storageData[STORAGE_KEYS.PASSWORDS] as { password: string }[];
    // 两层回显叠加：encryptPasswordEntry 的 `cipher:` + deriveEncryptionKey 的 `key:`
    expect(entries[0]?.password).toBe('cipher:key:new-pw');
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ salt: 'the-salt', kdf: 'pbkdf2-sha256' });
  });

  it('trim 后为空的新密码被拒绝，且不写任何数据', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', '   ')).rejects.toThrow();

    expect(localSet).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'old-verifier' });
  });
});

describe('changeMasterPassword 历史记录容错', () => {
  /** 让哨兵值解不开，其余记录走「剥掉 enc: 前缀」的默认回显 */
  const makeOneRecordUndecryptable = async (sentinel: string) => {
    const enc = await import('@/utils/encryption');
    vi.mocked(enc.decryptData).mockImplementation(async (data: string) => {
      if (data === sentinel) throw new Error('simulated wrong-key decryption failure');
      return data.replace(/^enc:/, '');
    });
  };

  it('旧钥解不开的历史记录原样落盘，rekey 不删除任何历史条目', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    await makeOneRecordUndecryptable('undecryptable');
    storageData[STORAGE_KEYS.PASSWORD_HISTORY] = [
      { entryId: 'p1', password: 'undecryptable', changedAt: 2 },
      { entryId: 'p1', password: 'enc:hist-1', changedAt: 1 },
    ];

    await changeMasterPassword('old-pw', 'new-pw');

    const history = storageData[STORAGE_KEYS.PASSWORD_HISTORY] as PasswordHistoryRecord[];
    expect(history).toHaveLength(2);
    // 不可解记录逐字节保留（仍为旧钥密文），不再被静默丢弃
    expect(history).toContainEqual({ entryId: 'p1', password: 'undecryptable', changedAt: 2 });
  });

  it('可解的历史记录仍由新数据密钥重新加密，与不可解记录并存', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    await makeOneRecordUndecryptable('undecryptable');
    storageData[STORAGE_KEYS.PASSWORD_HISTORY] = [
      { entryId: 'p1', password: 'undecryptable', changedAt: 2 },
      { entryId: 'p1', password: 'enc:hist-1', changedAt: 1 },
    ];

    await changeMasterPassword('old-pw', 'new-pw');

    const history = storageData[STORAGE_KEYS.PASSWORD_HISTORY] as PasswordHistoryRecord[];
    // encryptData 回显 `enc:<key>:<plain>`，key 段即步骤 7 派生的新数据密钥
    expect(history).toContainEqual({ entryId: 'p1', password: 'enc:key:new-pw:hist-1', changedAt: 1 });
  });

  it('条目级并行后每条记录仍与自己的密码配对，且顺序与入参一致', async () => {
    // 并行回填按下标 zip（`historyOutcomes[i] ↔ rawHistory[i]`）：一旦下标错位，
    // 记录之间会互换了密码字段而条数不变 —— 单看长度/`toContainEqual` 未必能发现，
    // 故这里断言完整数组的逐位内容。
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    storageData[STORAGE_KEYS.PASSWORD_HISTORY] = [
      { entryId: 'p1', password: 'enc:h1', changedAt: 3 },
      { entryId: 'p2', password: 'enc:h2', changedAt: 2 },
      { entryId: 'p3', password: 'enc:h3', changedAt: 1 },
    ];

    await changeMasterPassword('old-pw', 'new-pw');

    expect(storageData[STORAGE_KEYS.PASSWORD_HISTORY]).toEqual([
      { entryId: 'p1', password: 'enc:key:new-pw:h1', changedAt: 3 },
      { entryId: 'p2', password: 'enc:key:new-pw:h2', changedAt: 2 },
      { entryId: 'p3', password: 'enc:key:new-pw:h3', changedAt: 1 },
    ]);
  });
});
