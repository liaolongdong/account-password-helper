/**
 * 空密码条目改出真实口令时，不许往历史里塞一条空快照
 *
 * `updatePassword` 的历史门是 `'password' in updates && updates.password !== currentPlain.password`
 * （utils/storage/passwordCrud.ts:350），它问的是「这次有没有换掉一把口令」。纯手机号登录条目
 * （`password` 为空串，快速添加今天就允许这个形状）从 `''` 变成 `'p1'` 时代次为真，于是
 * `snapshotPasswordHistoryWithinLease(id, '')` 落一条**不含任何口令**的记录。
 *
 * 危害不是多一行噪声：每条目的历史按 `maxCount`（默认 3）**截断最旧的**
 * （utils/storage/passwordHistory.ts:100-111），空快照会占掉一格、把真正该留的旧口令挤出去——
 * 用户随后再改两次密码，第一把真口令就永久查不到了。
 *
 * 桩与 `passwordCrudLegacyPlaintext.test.ts` 同形：`encryptPasswordEntry` 对空串不产密文
 * （与真实实现 `entry.password ? encryptData(...) : ''` 一致），因此空旧值会以 `''` 直接进历史。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { PasswordEntry } from '@/utils/types';

const SESSION_KEY = 'session-key';

vi.mock('@/utils/storage/facades', () => ({
  getSessionDataKey: vi.fn(async () => SESSION_KEY),
}));

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => {
    const out = { ...entry, encrypted: true } as Record<string, unknown>;
    for (const key of ['username', 'password', 'url', 'remark', 'totp']) {
      if (typeof out[key] === 'string' && out[key]) out[key] = `enc:${out[key]}`;
    }
    return out;
  }),
  decryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => {
    if (entry.encrypted !== true) {
      const { encrypted: _encrypted, ...rest } = entry;
      return rest as Record<string, unknown>;
    }
    const out = { ...entry } as Record<string, unknown>;
    for (const key of ['username', 'password', 'url', 'remark', 'totp']) {
      if (typeof out[key] === 'string') out[key] = String(out[key]).replace(/^enc:/, '');
    }
    return out;
  }),
  deriveEncryptionKey: vi.fn(async () => SESSION_KEY),
  encryptData: vi.fn(async (data: unknown) => `enc:${JSON.stringify(data)}`),
  decryptData: vi.fn(async (data: unknown) => JSON.parse(String(data).replace(/^enc:/, ''))),
}));

let store: Record<string, unknown>;

/** 纯手机号登录条目的落盘形状：username 是手机号，password 为空串 */
const mobileOnlyRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'a',
    username: '13800000000',
    password: '',
    url: 'https://passport.example.com',
    remark: 'r0',
    totp: '',
    tag: '',
    createTime: 1,
    updateTime: 1,
    order: 0,
    favorite: false,
    encrypted: true,
    ...overrides,
  }) as unknown as PasswordEntry;

beforeEach(() => {
  vi.clearAllMocks();
  store = { [STORAGE_KEYS.PASSWORDS]: [mobileOnlyRow()] };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const found: Record<string, unknown> = {};
          for (const key of list) if (key in store) found[key] = store[key];
          return found;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
    runtime: { id: 'fixture' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const historyRecords = (): Record<string, unknown>[] =>
  (store[STORAGE_KEYS.PASSWORD_HISTORY] as Record<string, unknown>[] | undefined) ?? [];

describe('空密码条目的历史快照', () => {
  it('从空密码改成真实口令：不写历史（空快照不许占掉一格 maxCount）', async () => {
    const { updatePassword } = await import('@/utils/storage/passwordCrud');

    await updatePassword('a', { password: 'p1' } as Partial<PasswordEntry>);

    expect(historyRecords()).toEqual([]);
    // 新口令本身照常落盘，收口的只是历史这一侧
    const row = (store[STORAGE_KEYS.PASSWORDS] as Record<string, unknown>[])[0];
    expect(row.password).toBe('enc:p1');
  });

  it('真实旧口令仍要留档：门只挡空值，不能顺手把历史功能关掉', async () => {
    store[STORAGE_KEYS.PASSWORDS] = [mobileOnlyRow({ password: 'enc:p0' })];
    const { updatePassword } = await import('@/utils/storage/passwordCrud');

    await updatePassword('a', { password: 'p1' } as Partial<PasswordEntry>);

    const records = historyRecords();
    expect(records).toHaveLength(1);
    expect(records[0].entryId).toBe('a');
    expect(records[0].password, '留档的应是被取代的那一份旧密文').toBe('enc:p0');
  });
});
