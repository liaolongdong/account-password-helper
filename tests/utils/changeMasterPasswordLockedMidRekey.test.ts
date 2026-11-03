import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import type { EncryptedPasswordEntry, TrashedPasswordEntry } from '@/utils/types';

/**
 * rekey 提交与发布之间，另一个窗口把库锁了
 *
 * `commitVaultRekey` 的漂移复验比的是**盘上**的会话键与五域密文；而这两样都判不出这件事：
 * 别的上下文 `clearSession()` 先把 `session_wrapped_data_key` 从盘上删掉，本次事务随后的提交
 * 又把它连同新的包裹密钥一起写回去——复验读到的仍是「和 prepared 逐字节相同」，本上下文的
 * `sessionEpoch` 也从没动过。唯一还活着的信号，是锁定方自己在 `storage.session` 里留下的
 * `SESSION_LOCK_STATE { locked: true }` 镜像。
 *
 * 不采纳它，后果是评审报告 P0-1 那一类的「锁说谎」：用户按下的立即锁定被这次换钥复活成
 * 解锁态（各上下文的明文镜像与 `locked:false` 一并写回），而 UI 收到的是
 * 「改密成功且保持解锁」。所以两条都要钉：
 * 1. 发布侧见锁定镜像即拒绝采纳，并回执 `false`（此前是静默 `return`）；
 * 2. 提交侧拿到 `false` 就撤销自己刚写上去的会话材料（走 `clearSession` 的同一口径），改报 `relockRequired: true`，
 *    五域新密文照常保留（数据已经换钥成功，只有会话不复活）。
 *
 * 加密模块以回显密钥的桩注入（与 `changeMasterPasswordConcurrentWrite.test.ts` 同口径），
 * 避免 600k 次 PBKDF2；`storage.session` 用一份真实的内存存储，因为本用例判的就是它的读数。
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

/**
 * 本次换钥写回、被拒绝采纳后必须撤销的会话材料。
 *
 * 不含 `WRAP_KEY`：`clearSession` 刻意留着它（缺了 `WRAPPED_DATA_KEY` 单独存在无意义，
 * 留着省一次删除写），撤销口径与锁定路径同一，测试不该钉出第二份清单。
 */
const SESSION_MATERIAL = [
  SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
  SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
  SESSION_STORAGE_KEYS.VALIDITY_HOURS,
];

let storageData: Record<string, unknown>;
let sessionData: Record<string, unknown>;
let localSet: ReturnType<typeof vi.fn>;

const keysOf = (keys: string | string[] | null | undefined): string[] =>
  keys === null || keys === undefined ? Object.keys(storageData) : Array.isArray(keys) ? keys : [keys];

beforeEach(() => {
  vi.clearAllMocks();
  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [trashEntry('t1')],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.IDENTITY]: [],
    [STORAGE_KEYS.IDENTITY_TRASH]: [],
    [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
    // 解锁态夹具：缺这一项会被判成「基线已锁定」而跳过会话材料的准备与发布（P0-1 的那道闸）
    [SESSION_STORAGE_KEYS.WRAP_KEY]: 'baseline-wrap',
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'baseline-wrapped',
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 3_600_000,
    [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: 24,
  };
  // 另一个窗口在我们重加密期间按下了「立即锁定」——它写下的就是这枚镜像
  sessionData = { [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: true } };

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

  const localGet = vi.fn(async (keys: string | string[]) => {
    const found: Record<string, unknown> = {};
    for (const key of keysOf(keys)) {
      if (key in storageData) found[key] = storageData[key];
    }
    return found;
  });

  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: vi.fn(async () => ({})),
    },
    storage: {
      local: {
        get: localGet,
        set: localSet,
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of keysOf(keys)) delete storageData[key];
        }),
      },
      session: {
        // 读侧必须按真实语义返回「只含请求键」的对象，桩若一律返回全量，
        // publish 的镜像判据会读到别处的键而假绿
        get: vi.fn(async (keys?: string | string[] | null) => {
          const found: Record<string, unknown> = {};
          for (const key of keysOf(keys)) {
            if (key in sessionData) found[key] = sessionData[key];
          }
          return found;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(sessionData, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of keysOf(keys)) delete sessionData[key];
        }),
        clear: vi.fn(async () => {
          sessionData = {};
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rekey 提交后被别的窗口锁定', () => {
  it('不采纳、撤销本次写回的会话材料，并把结果改报为需要重新解锁', async () => {
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    const result = await changeMasterPassword('old-pw', 'New-pw#1');

    expect(result, '锁定镜像在场时不得回执「保持解锁」').toMatchObject({ relockRequired: true });
    // 新钥数据照常落盘（撤销的只是会话材料，不是这次换钥）
    expect((storageData[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[])[0]?.password).toBe('cipher:key:New-pw#1');
    // 盘上不得留下可被复活成解锁态的四项材料
    for (const key of SESSION_MATERIAL) {
      expect(storageData[key], `会话材料 ${key} 应被撤销`).toBeUndefined();
    }
    // 明文镜像与锁定状态都没被改写
    expect(sessionData[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
    expect(sessionData[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
  });

  it('没有锁定镜像时照常采纳并回执保持解锁（上一条不是永远红）', async () => {
    delete sessionData[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE];
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    const result = await changeMasterPassword('old-pw', 'New-pw#2');

    expect(result).toMatchObject({ relockRequired: false });
    expect(storageData[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBeTypeOf('string');
    expect(sessionData[SESSION_MEMORY_KEYS.DATA_KEY]).toBe('key:New-pw#2');
  });
});
