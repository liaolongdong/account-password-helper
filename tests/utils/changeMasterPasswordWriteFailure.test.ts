/**
 * 修改主密码（rekey）的原子写入与回滚回归测试
 *
 * 背景：`changeMasterPassword` 的收尾是**一次** `chrome.storage.local.set()` 把
 * 「四块数据密文 + 新校验哈希 + 新会话密钥材料」同时落地。这一步之所以设计成单次原子写，
 * 是因为各上下文的 storage 监听器会在「新密文已落盘、会话密钥仍是旧值」的中间状态里
 * 用旧密钥解新密文、全部失败并把列表清空。对应的失败处理同样关键：
 * - 写盘失败必须把原错误如实上抛（弹窗据此提示用户），并且**主动清会话**——
 *   此刻内存镜像与 storage.session 已被 `prepareSessionRekey` 换成新密钥，而磁盘仍是
 *   旧密文，留着这套「新密钥 + 旧密文」的组合比强制重新解锁危险得多；
 * - 清理动作自身失败不得吞掉写盘错误（用户看到的是「写入失败」，不是 undefined）；
 * - 写盘之前的任一步骤失败则完全不进回滚分支：会话密钥尚未准备，磁盘也从未被写过。
 *
 * `sessionManager-storage` 只替掉 `prepareSessionRekey` / `clearSession` 两个观测点
 * （其余导出沿用真实模块，`SESSION_STORAGE_KEYS` 必须是真值，否则连入参都构造不出来）。
 * 加密模块同样以回显 mock 注入，避开 600k PBKDF2 并让「哪把密钥参与了写入」可断言。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import type { EncryptedPasswordEntry } from '@/utils/types';

const { prepareSessionRekey, clearSession } = vi.hoisted(() => ({
  prepareSessionRekey: vi.fn<(dataKey: string, validityHours: number) => Promise<Record<string, unknown>>>(),
  clearSession: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/utils/sessionManager-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/sessionManager-storage')>();
  return { ...actual, prepareSessionRekey, clearSession };
});

const { deriveEncryptionKey, deriveVerifierHash } = vi.hoisted(() => ({
  deriveEncryptionKey: vi.fn<(password: string) => Promise<string>>(),
  deriveVerifierHash: vi.fn<(password: string, salt: string) => Promise<string>>(),
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
  encryptData: vi.fn(async (data: string, key?: string) => `enc:${key ?? ''}:${data}`),
  decryptData: vi.fn(async (data: string) => data.replace(/^enc:/, '')),
}));

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: vi.fn(async () => true),
}));

/** at-rest 密文条目；可选地指定「旧钥解不开」以构造解密阶段失败 */
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

const SESSION_WRITE_KEYS = [
  SESSION_STORAGE_KEYS.WRAP_KEY,
  SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
  SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
  SESSION_STORAGE_KEYS.VALIDITY_HOURS,
] as const;

let storageData: Record<string, unknown>;
let localSet: ReturnType<typeof vi.fn>;
let localRemove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  prepareSessionRekey.mockImplementation(async (dataKey, validityHours) => ({
    [SESSION_STORAGE_KEYS.WRAP_KEY]: `wrap:${dataKey}`,
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: `wrapped:${dataKey}`,
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: 1_700_000_000_000,
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
  }));
  clearSession.mockResolvedValue(undefined);
  deriveEncryptionKey.mockImplementation(async (password: string) => `key:${password}`);
  deriveVerifierHash.mockImplementation(async (password: string) => `verifier:${password}`);

  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.IDENTITY]: [],
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: 24,
  };

  localSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageData, items);
  });
  localRemove = vi.fn(async (key: string) => {
    delete storageData[key];
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storageData ? { [key]: storageData[key] } : {})),
        set: localSet,
        remove: localRemove,
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  });
});

describe('原子写入成功时的载荷形状', () => {
  it('四块数据 + 校验哈希 + 会话密钥材料在同一次 set 里落盘', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'new-pw');

    expect(localSet).toHaveBeenCalledTimes(1);
    const payload = localSet.mock.calls[0][0] as Record<string, unknown>;
    for (const key of [
      STORAGE_KEYS.PASSWORDS,
      STORAGE_KEYS.TRASH,
      STORAGE_KEYS.PASSWORD_HISTORY,
      STORAGE_KEYS.IDENTITY,
      STORAGE_KEYS.MASTER_PASSWORD,
      ...SESSION_WRITE_KEYS,
    ]) {
      expect(payload, `单次 set 必须携带 ${key}，否则存在「新密文 + 旧会话密钥」窗口`).toHaveProperty(key);
    }
    // 分步写（先数据后会话）正是这里要防的回归：拆成两次即判失败
    expect(localSet).toHaveBeenCalledTimes(1);
  });

  it('准备会话密钥发生在写盘之前，且落盘的校验值由新密码派生', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'new-pw');

    expect(prepareSessionRekey).toHaveBeenCalledWith('key:new-pw', 24);
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'verifier:new-pw' });
  });
});

describe('写盘失败：回滚与会话清理', () => {
  const writeError = () => Object.assign(new Error('MAX_WRITE_BUFFER_SIZE exceeded'), { code: 'WRITE_FAILED' });

  it('把 storage 的原始错误如实上抛，供弹窗提示「写入失败」', async () => {
    const error = writeError();
    localSet.mockRejectedValueOnce(error);
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toBe(error);
  });

  it('磁盘仍是旧密文与旧校验值：失败的 rekey 不留半成品', async () => {
    localSet.mockRejectedValueOnce(writeError());
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'new-pw').catch(() => undefined);

    const entries = storageData[STORAGE_KEYS.PASSWORDS] as { password: string }[];
    expect(entries[0]?.password).toBe('cipher');
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({
      hashedPassword: 'old-verifier',
      salt: 'the-salt',
    });
    // 会话密钥材料同样没落盘（磁盘上的登录态仍是旧的一套）
    expect(storageData).not.toHaveProperty(SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY);
  });

  it('清会话恰好一次：内存/storage.session 已是新密钥，必须强制重新解锁', async () => {
    localSet.mockRejectedValueOnce(writeError());
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'new-pw').catch(() => undefined);

    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('清理自身抛错时不覆盖写盘错误（catch 里还有一句 throw error）', async () => {
    const error = writeError();
    localSet.mockRejectedValueOnce(error);
    clearSession.mockRejectedValueOnce(new Error('clearSession unavailable'));
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toBe(error);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('写盘失败后不再执行遗留清理（第 12 步不可达）', async () => {
    localSet.mockRejectedValueOnce(writeError());
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'new-pw').catch(() => undefined);

    expect(localRemove).not.toHaveBeenCalled();
  });
});

describe('写盘之前的失败：不写、不清会话', () => {
  it('旧钥解不开某条密码：直接抛出，storage 未被触碰', async () => {
    const enc = await import('@/utils/encryption');
    vi.mocked(enc.decryptPasswordEntry).mockImplementation(async entry => {
      if ((entry as unknown as { id: string }).id === 'p1') throw new Error('bad key');
      return entry as never;
    });
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toThrow('bad key');

    expect(localSet).not.toHaveBeenCalled();
    expect(clearSession, '会话密钥尚未准备，无需回滚，也不该被顺带清掉').not.toHaveBeenCalled();
    expect(prepareSessionRekey).not.toHaveBeenCalled();
  });

  it('旧密码校验失败：连派生新密钥都不发生', async () => {
    const masterPassword = await import('@/utils/storage/masterPassword');
    vi.mocked(masterPassword.verifyMasterPassword).mockResolvedValueOnce(false);
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('wrong-old', 'new-pw')).rejects.toThrow('当前密码验证失败');

    expect(deriveEncryptionKey).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
});
