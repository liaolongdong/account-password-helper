/**
 * 写者与写者的交错落盘（评审报告 P1-1）
 *
 * `withVaultMutation` 用的是 `navigator.locks` 的 **shared** 租约：它挡住的是独占换钥
 * （`withVaultKeyTransition`），**不串行化普通写者**。而密码库的写全是
 * 「读整包 → 改一格 → 写整包」，中间还夹着解密 / 历史快照 / 再加密等 await 边界
 * （2000 条量级为数百毫秒）。两个来源交错时——管理页编辑、网页登录自动保存、
 * 另一张管理页标签——后写者会带着自己的旧快照把前写者的行整片抹掉，
 * 而双方都收到成功回执，丢的那条无从察觉。
 *
 * 现有 `tests/utils/vaultMutationIsolation.test.ts` 只覆盖「写者 vs 独占换钥」这一对，
 * 因此这把锁给人的互斥感是没有证据的。本文件钉住写者-写者这一维：
 * 落盘前重读最新列表并按 id 合并（`commitPasswordRows`），两条改动都必须活下来。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, PasswordEntry } from '@/utils/types';

const SESSION_KEY = 'dk-fixture';

const row = (id: string, overrides: Partial<EncryptedPasswordEntry> = {}): EncryptedPasswordEntry =>
  ({
    id,
    username: `cipher-${id}`,
    password: `cipher-${id}`,
    url: 'https://example.com',
    tag: '',
    remark: '',
    createTime: 1,
    updateTime: 1,
    order: 0,
    favorite: false,
    encrypted: true,
    ...overrides,
  }) as EncryptedPasswordEntry;

/** 模块级存储桩：`set` 立即生效，用于观察两次写入的先后 */
let store: Record<string, unknown>;

vi.mock('@/utils/storage/facades', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/storage/facades')>()),
  getSessionDataKey: vi.fn(async () => SESSION_KEY),
}));

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, encrypted: true })),
  decryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, password: 'plain-p' })),
  deriveEncryptionKey: vi.fn(async () => SESSION_KEY),
  encryptData: vi.fn(async (data: unknown) => `enc:${JSON.stringify(data)}`),
  decryptData: vi.fn(async (data: unknown) => data),
}));

beforeEach(() => {
  vi.clearAllMocks();
  store = { [STORAGE_KEYS.PASSWORDS]: [row('a'), row('b')] };

  const localGet = vi.fn(async (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const found: Record<string, unknown> = {};
    for (const key of list) if (key in store) found[key] = store[key];
    return found;
  });
  const localSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  });

  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet, remove: vi.fn(async (k: string) => delete store[k]) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
    runtime: { id: 'fixture' },
  });

  // 共享租约的透传桩：本文件要证的正是「shared 模式不互斥」，因此不能靠真锁来串行化写者。
  // 若宿主 Node 没有 `navigator.locks`，这里补一个最小实现；已有真实现时不覆盖，
  // 因为 shared + ifAvailable 的语义与透传桩一致（同名字段：立即授予、不排队）。
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
  if (nav && !nav.locks) {
    Object.defineProperty(nav, 'locks', {
      configurable: true,
      value: { request: (_name: string, _opts: unknown, cb: () => Promise<unknown>) => cb() },
    });
  }
});

const rows = (): EncryptedPasswordEntry[] => store[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[];

describe('并发写者不得互相抹掉对方的行', () => {
  it('两次元数据更新同时提交：两条记录的改动都要落盘', async () => {
    const { updatePassword } = await import('@/utils/storage/passwordCrud');

    await Promise.all([
      updatePassword('a', { favorite: true } as Partial<PasswordEntry>),
      updatePassword('b', { favorite: true } as Partial<PasswordEntry>),
    ]);

    const after = rows();
    expect(after.map(r => r.id).sort()).toEqual(['a', 'b']);
    expect(after.find(r => r.id === 'a')?.favorite, '写者 a 的改动被后写者整包覆写抹掉了').toBe(true);
    expect(after.find(r => r.id === 'b')?.favorite).toBe(true);
  });

  it('新增与编辑同时提交：新行与目标行的编辑都要留下', async () => {
    const { savePassword, updatePassword } = await import('@/utils/storage/passwordCrud');

    await Promise.all([
      savePassword({
        username: 'u-new',
        password: 'p-new',
        url: 'https://n.example.com',
        tag: '',
        remark: '',
        createTime: 2,
        updateTime: 2,
      } as Omit<PasswordEntry, 'id' | 'order'>),
      updatePassword('a', { tag: 'edited' } as Partial<PasswordEntry>),
    ]);

    const after = rows();
    expect(after).toHaveLength(3);
    expect(
      after.some(r => r.username === 'u-new'),
      '并发编辑把新增的那条覆盖掉了',
    ).toBe(true);
    expect(after.find(r => r.id === 'a')?.tag).toBe('edited');
  });

  it('目标行在期间被别的来源删除时，本次编辑不得把它复活回来', async () => {
    const crud = await import('@/utils/storage/passwordCrud');
    store[STORAGE_KEYS.PASSWORDS] = [row('b')];
    const get = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    let reads = 0;
    get.mockImplementation(async (keys: string | string[]) => {
      reads += 1;
      // 事务开头那次读还看得见 a（编辑是基于它做的）；落盘前的重读里 a 已被别的来源删除
      const list = reads === 1 ? [row('a'), row('b')] : [row('b')];
      const wanted = Array.isArray(keys) ? keys : [keys];
      const found: Record<string, unknown> = {};
      for (const key of wanted) {
        if (key === STORAGE_KEYS.PASSWORDS) found[key] = list;
        else if (key in store) found[key] = store[key];
      }
      return found;
    });

    await crud.updatePassword('a', { tag: 'late' } as Partial<PasswordEntry>);

    expect(store[STORAGE_KEYS.PASSWORDS], '以删除为准：不得把已被删掉的行写回整包').toEqual([row('b')]);
  });

  it('同一条记录的敏感编辑与元数据写并发时，不以旧密文回卷密码', async () => {
    const crud = await import('@/utils/storage/passwordCrud');
    const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    const original = set.getMockImplementation() as ((items: Record<string, unknown>) => Promise<void>) | undefined;
    set.mockImplementation(async (items: Record<string, unknown>) => {
      const rows = items[STORAGE_KEYS.PASSWORDS];
      // 模拟跨上下文交错：元数据写者以旧密文落盘时慢一拍，敏感写者先完成。
      if (
        Array.isArray(rows) &&
        rows.some(row => row.id === 'a' && row.favorite === true && row.password === 'cipher-a')
      ) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await original?.(items);
    });

    await Promise.all([
      crud.updatePassword('a', { password: 'new-plain-password' } as Partial<PasswordEntry>),
      crud.batchUpdatePasswordMetadata([{ id: 'a', updates: { favorite: true } }]),
    ]);

    const saved = rows().find(row => row.id === 'a');
    expect(saved?.favorite, '收藏改动应当落盘').toBe(true);
    expect(saved?.password, '元数据写者用旧密文回卷了并发完成的密码编辑').toBe('new-plain-password');
  });
});
