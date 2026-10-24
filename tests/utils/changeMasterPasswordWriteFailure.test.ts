/**
 * 修改主密码（rekey）的原子写入与回滚回归测试
 *
 * 背景：`changeMasterPassword` 的收尾是**一次** `chrome.storage.local.set()` 把
 * 「五块数据密文（密码 / 密码回收站 / 历史 / 个人信息 / 个人信息回收站）+ 新校验哈希 +
 * 新会话密钥材料」同时落地。这一步之所以设计成单次原子写，
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

const { prepareSessionRekey, publishSessionRekey, clearSession } = vi.hoisted(() => ({
  prepareSessionRekey: vi.fn<(dataKey: string, validityHours: number) => Promise<Record<string, unknown>>>(),
  publishSessionRekey: vi.fn<(dataKey: string, prepared: Record<string, unknown>) => Promise<void>>(),
  clearSession: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/utils/sessionManager-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/sessionManager-storage')>();
  return { ...actual, prepareSessionRekey, publishSessionRekey, clearSession };
});

const {
  deriveEncryptionKey,
  deriveVerifierHash,
  encryptPasswordEntry,
  decryptPasswordEntry,
  encryptData,
  decryptData,
} = vi.hoisted(() => ({
  deriveEncryptionKey: vi.fn<(password: string) => Promise<string>>(),
  deriveVerifierHash: vi.fn<(password: string, salt: string) => Promise<string>>(),
  encryptPasswordEntry: vi.fn(),
  decryptPasswordEntry: vi.fn(),
  encryptData: vi.fn(),
  decryptData: vi.fn(),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey,
  deriveVerifierHash,
  encryptPasswordEntry,
  decryptPasswordEntry,
  encryptData,
  decryptData,
}));

/** 回显型加密桩：`clearAllMocks` 只清调用记录、不还原 `mockImplementation`，故每个用例前都要重设。 */
const stubEncryptionEcho = (): void => {
  encryptPasswordEntry.mockImplementation(async (entry: Record<string, unknown>, _s: string, key: string) => ({
    ...entry,
    password: `cipher:${key}`,
  }));
  decryptPasswordEntry.mockImplementation(async (entry: Record<string, unknown>, _s: string, key: string) => ({
    ...entry,
    password: `plain:${key}`,
  }));
  encryptData.mockImplementation(async (data: string, key?: string) => `enc:${key ?? ''}:${data}`);
  decryptData.mockImplementation(async (data: string) => data.replace(/^enc:/, ''));
};

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
  stubEncryptionEcho();
  prepareSessionRekey.mockImplementation(async (dataKey, validityHours) => ({
    [SESSION_STORAGE_KEYS.WRAP_KEY]: `wrap:${dataKey}`,
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: `wrapped:${dataKey}`,
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: 1_700_000_000_000,
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
  }));
  clearSession.mockResolvedValue(undefined);
  publishSessionRekey.mockResolvedValue(undefined);
  deriveEncryptionKey.mockImplementation(async (password: string) => `key:${password}`);
  deriveVerifierHash.mockImplementation(async (password: string) => `verifier:${password}`);

  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.IDENTITY]: [],
    [STORAGE_KEYS.IDENTITY_TRASH]: [],
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: 24,
    // 会话键基线：提交前的守卫靠比对这几项发现「期间有人锁定/重建了会话」
    [SESSION_STORAGE_KEYS.WRAP_KEY]: 'baseline-wrap',
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'baseline-wrapped',
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: 1_600_000_000_000,
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
        // 真实 `chrome.storage.local.get` 同时接受单键与键数组；提交前的会话键守卫正是按数组读，
        // 桩若只认单键会让那条比对永远读到「两边都是空」，守卫形同未测。
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const found: Record<string, unknown> = {};
          for (const key of list) {
            if (key in storageData) found[key] = storageData[key];
          }
          return found;
        }),
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
  it('五块数据 + 校验哈希 + 会话密钥材料在同一次 set 里落盘', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'new-pw');

    expect(localSet).toHaveBeenCalledTimes(1);
    const payload = localSet.mock.calls[0][0] as Record<string, unknown>;
    for (const key of [
      STORAGE_KEYS.PASSWORDS,
      STORAGE_KEYS.TRASH,
      STORAGE_KEYS.PASSWORD_HISTORY,
      STORAGE_KEYS.IDENTITY,
      STORAGE_KEYS.IDENTITY_TRASH,
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
    // 会话密钥材料同样没落盘：磁盘上仍是基线那套旧登录态，而不是 prepareSessionRekey 备好的新键
    expect(storageData[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBe('baseline-wrapped');
    expect(storageData[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]).toBe(1_600_000_000_000);
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

/**
 * 提交点之后才失败的两种情形，语义必须与「写盘失败」区分开：
 * - 会话材料发布失败：新密文与新校验哈希已经生效，只能告诉调用方「改密已成功、需要重新解锁」，
 *   若照旧抛出，弹窗会显示「写入失败」，用户继续用旧密码解锁必然失败；
 * - 只剩旧版遗留 blob 清理失败：一致性不受影响，保持成功语义，不得反向推翻已提交的事实。
 */
describe('提交成功之后的失败：不得伪装成未提交', () => {
  it('发布新会话密钥失败时返回 relock-required，并把已提交的新密钥留在盘上', async () => {
    publishSessionRekey.mockRejectedValueOnce(new Error('session readback failed'));
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).resolves.toBe('relock-required');

    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'verifier:new-pw' });
    expect(clearSession, '发布失败必须清会话，避免留下新钥/旧库不一致的解锁态').toHaveBeenCalledTimes(1);
  });

  it('仅旧版遗留清理失败时仍报告改密成功，不清会话', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');
    localRemove.mockRejectedValueOnce(new Error('remove unavailable'));

    await expect(changeMasterPassword('old-pw', 'new-pw')).resolves.toBeUndefined();

    expect(clearSession).not.toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'verifier:new-pw' });
  });
});

describe('并发锁定与提交守卫', () => {
  /**
   * 会话键也纳入提交前的比对。
   *
   * `clearSession` 刻意不在租约内（它同时是恢复流程自己的提交步骤），所以「用户点了立即锁定」
   * 与「换钥正在收尾」之间只能靠读数比对兜住：比对不过就必须整笔作废，
   * 否则那批早已准备好的新会话键会把用户刚清掉的会话复活成有效状态。
   */
  it('换钥期间发生的锁定会作废整笔提交，而不是把会话复活', async () => {
    prepareSessionRekey.mockImplementation(async (dataKey, validityHours) => {
      delete storageData[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY];
      delete storageData[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY];
      return {
        [SESSION_STORAGE_KEYS.WRAP_KEY]: `wrap:${dataKey}`,
        [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: `wrapped:${dataKey}`,
        [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: 1_700_000_000_000,
        [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
      };
    });
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await expect(changeMasterPassword('old-pw', 'new-pw')).rejects.toMatchObject({ code: 'REKEY_CONCURRENT_WRITE' });
    expect(localSet).not.toHaveBeenCalled();
    expect(publishSessionRekey).not.toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalled();
    expect(storageData[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ hashedPassword: 'old-verifier' });
  });
});
