/**
 * 两个上下文并发做敏感编辑时，不得互相抹掉对方的字段（评审 2026-11-02 Q1）
 *
 * `updatePassword` 的敏感路径在**事务开头**读整包、解密那一行、合并、重加密，然后才进提交锁落盘。
 * 提交锁里虽然会重读最新快照，但只把 `PRESERVED_METADATA_FIELDS` 那 5 个元数据字段回填过来——
 * `username`/`password`/`url`/`remark`/`totp` 全都在这份**旧明文快照**里被重新加密写回。
 *
 * 于是两张管理页标签（或标签与 SW）同时编辑同一条：一个改密码、一个改备注，后落盘的那个会拿
 * 自己的旧快照把前者的字段整片盖掉，而**两边都收到「保存成功」**。同上下文内不会翻车，因为
 * `queuePasswordWrite` 已经把它自己排队了；跨上下文没有那把内存队列，只有提交锁。
 *
 * 这里用两个独立求值的模块实例模拟两个上下文（各自的内存队列互不知情，共享同一份 storage 与
 * 同一把真 `navigator.locks`），这是本仓唯一能证伪这条的路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, PasswordEntry } from '@/utils/types';

const SESSION_KEY = 'session-key';

/** 敏感字段的「密文」用前缀模拟：让 encrypt/decrypt 成为可逆往返，落盘结果就能逐字段核对 */
const strip = (value: unknown): string => String(value ?? '').replace(/^enc:/, '');

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

const cipherRow = (): EncryptedPasswordEntry =>
  ({
    id: 'a',
    username: 'enc:u0',
    password: 'enc:p0',
    url: 'enc:https://example.com',
    remark: 'enc:r0',
    totp: '',
    tag: '',
    createTime: 1,
    updateTime: 1,
    order: 0,
    favorite: false,
    encrypted: true,
  }) as unknown as EncryptedPasswordEntry;

beforeEach(() => {
  vi.clearAllMocks();
  store = { [STORAGE_KEYS.PASSWORDS]: [cipherRow()] };
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

const rows = (): EncryptedPasswordEntry[] => store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[];
const rowOf = (): Record<string, unknown> => rows()[0] as unknown as Record<string, unknown>;

/** 起一个独立的模块实例，代表一个扩展上下文（自己的内存写队列，共享同一份 storage 与真提交锁） */
async function createContext(): Promise<{
  updatePassword: (id: string, updates: Partial<PasswordEntry>) => Promise<void>;
}> {
  vi.resetModules();
  const crud = await import('@/utils/storage/passwordCrud');
  return { updatePassword: crud.updatePassword };
}

describe('跨上下文的敏感编辑', () => {
  it('两个上下文各改一个敏感字段：两处改动都必须落盘', async () => {
    const tabA = await createContext();
    const tabB = await createContext();

    await Promise.all([
      tabA.updatePassword('a', { password: 'p1' } as Partial<PasswordEntry>),
      tabB.updatePassword('a', { remark: '备注改了' } as Partial<PasswordEntry>),
    ]);

    const written = rowOf();
    expect(strip(written.password), '后落盘的一方拿事务开头的旧明文快照整行重加密，把对方的密码改动盖掉了').toBe('p1');
    expect(strip(written.remark), '同理，备注被另一方盖回旧值').toBe('备注改了');
    expect(rows(), '不得凭空多出行').toHaveLength(1);
  });

  it('敏感编辑不得回卷另一上下文刚完成的收藏（原有 PRESERVED 口径仍成立）', async () => {
    const tabA = await createContext();
    const tabB = await createContext();

    await Promise.all([
      tabA.updatePassword('a', { password: 'p1' } as Partial<PasswordEntry>),
      tabB.updatePassword('a', { favorite: true } as Partial<PasswordEntry>),
    ]);

    const written = rowOf();
    expect(strip(written.password)).toBe('p1');
    expect(written.favorite).toBe(true);
  });

  it('同一条目同一字段被两处并发修改时，仍是后写者胜（本次不引入冲突拒绝，那属于需要拍板的口径）', async () => {
    const tabA = await createContext();
    const tabB = await createContext();

    await Promise.all([
      tabA.updatePassword('a', { password: 'p1' } as Partial<PasswordEntry>),
      tabB.updatePassword('a', { password: 'p2' } as Partial<PasswordEntry>),
    ]);

    expect(['p1', 'p2']).toContain(strip(rowOf().password));
  });

  it('条目在期间被删除时以删除为准，不用本次编辑把它复活', async () => {
    const tabA = await createContext();

    // 事务已经读到行；落盘前那次重读报告「条目已不存在」。只对 PASSWORDS 的读计数并翻转——
    // 任意一次 get 都推进游标的话，将来进锁前多插一次读就会让本用例绿着空跑，不再覆盖这一支。
    const localGet = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    let passwordsReads = 0;
    localGet.mockImplementation(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const found: Record<string, unknown> = {};
      const asksPasswords = list.includes(STORAGE_KEYS.PASSWORDS);
      if (asksPasswords) passwordsReads += 1;
      for (const key of list) {
        if (key === STORAGE_KEYS.PASSWORDS && passwordsReads > 1) continue;
        if (key in store) found[key] = store[key];
      }
      return found;
    });

    await tabA.updatePassword('a', { remark: 'r1' } as Partial<PasswordEntry>);
    expect(rows()).toHaveLength(1);
    expect(strip(rowOf().remark)).toBe('r0');
    expect(
      passwordsReads,
      'PASSWORDS 读次数变了（当前实现应为「早退读 + 锁内重读」共 2 次）：本用例的锁内删除分支可能已不被覆盖',
    ).toBe(2);
  });
});
