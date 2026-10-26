import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry } from '@/utils/types';

/**
 * rekey 保留主密码提示语的回归测试
 *
 * 背景：`changeMasterPassword` 的第 11 步用**全新对象字面量**覆写 `master_password_config`
 * （只带 hashedPassword / salt / kdf）。提示语作为该对象上的新增字段，一旦不显式携带，
 * 用户每改一次主密码，提示语就被静默抹掉——解锁页那条「回想」退路随之消失，
 * 而 UI 上没有任何地方会告诉用户它没了。属于「新增可选字段被整对象覆写吃掉」这一类
 * 只在事后才暴露的缺陷，因此把它钉成断言。
 *
 * 与 `changeMasterPassword.test.ts` 同一注入方式：mock 加密模块回显入参，
 * 避开真实 PBKDF2 600k 轮，观测点只放在落盘形状上。
 */

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

/** 写入一份带指定 hint 形状的主密码配置 */
const seedConfig = (hint: unknown): void => {
  const config: Record<string, unknown> = { hashedPassword: 'old-verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' };
  if (hint !== undefined) config.hint = hint;
  storageData[STORAGE_KEYS.MASTER_PASSWORD] = config;
};

beforeEach(() => {
  vi.clearAllMocks();
  storageData = {
    [STORAGE_KEYS.PASSWORDS]: [cipherEntry('p1')],
    [STORAGE_KEYS.TRASH]: [],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [],
    [STORAGE_KEYS.IDENTITY]: [],
    [STORAGE_KEYS.IDENTITY_TRASH]: [],
  };

  deriveEncryptionKey.mockImplementation(async (password: string) => `key:${password}`);
  deriveVerifierHash.mockImplementation(async (password: string) => `verifier:${password}`);

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storageData ? { [key]: storageData[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storageData, items);
        }),
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

/** 取落盘后的主密码配置 */
const writtenConfig = (): Record<string, unknown> =>
  storageData[STORAGE_KEYS.MASTER_PASSWORD] as Record<string, unknown>;

describe('changeMasterPassword 对提示语的处置', () => {
  it('改主密码后提示语原样保留，校验值与 salt 仍按新值/旧 salt 落盘', async () => {
    seedConfig('孩子名字 + 入职年份');
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'New-pw#1');

    expect(writtenConfig()).toMatchObject({
      hint: '孩子名字 + 入职年份',
      hashedPassword: 'verifier:New-pw#1',
      salt: 'the-salt',
      kdf: 'pbkdf2-sha256',
    });
  });

  it('存量配置没有提示语时，rekey 后也不写入该字段（省略而非空串）', async () => {
    seedConfig(undefined);
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'New-pw#1');

    expect('hint' in writtenConfig()).toBe(false);
  });

  it('配置里是空串提示语时按「未设置」处置，不把空串继续搬过去', async () => {
    seedConfig('');
    const { changeMasterPassword } = await import('@/utils/storage/changeMasterPassword');

    await changeMasterPassword('old-pw', 'New-pw#1');

    expect('hint' in writtenConfig()).toBe(false);
  });
});
