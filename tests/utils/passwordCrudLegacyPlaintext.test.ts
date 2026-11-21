/**
 * at-rest 迁移窗口里，敏感编辑不得把未迁移的明文行写成「密文标记 + 明文值」的混排行
 *
 * 敏感编辑落盘时会逐字段收口：本次没写到的敏感字段取锁内重读那一行的值——这是评审
 * 2026-11-02 Q1 的修复，前提是**盘上那些值是密文**。老库迁移到 at-rest 密文之前的行不满足
 * 这个前提：`decryptPasswordEntry` 对 `encrypted !== true` 的行是原样返回明文（不报错，挡不住），
 * 于是本次重加密出来的 `encrypted: true` 标记会配上从旧行搬过来的明文 `username`/`url`/`totp`。
 *
 * 这种混排行比纯明文行更坏：迁移侧的判据是 `encrypted === true`（sessionManager-storage.ts），
 * 混排行被当成「已迁移」永久跳过，明文就冻在一行自称已加密的记录里；而自动保存恰恰只写
 * `{password, tag, remark}` 三个字段（autoSaveManager.ts），其余四个敏感字段全靠回填。
 *
 * 这里同时锁住另一半：回填的语义是「不覆盖对方并发改过的值」，所以对明文行也要拿**锁内重读**
 * 那一份明文去合并，而不是拿事务开头的旧值。
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

/** 与 `utils/encryption.ts` 同形的敏感字段清单（漏一个就等于放过一个明文写盘通道）；hoisted 供 vi.mock 工厂引用 */
const { SENSITIVE_KEYS } = vi.hoisted(() => ({
  SENSITIVE_KEYS: ['username', 'password', 'url', 'remark', 'totp', 'pathScope'],
}));

/** 与真实实现同形的桩：`encrypted !== true` 原样返回，否则按 `enc:` 前缀可逆往返 */
vi.mock('@/utils/encryption', () => ({
  encryptPasswordEntry: vi.fn(async (entry: Record<string, unknown>) => {
    const out = { ...entry, encrypted: true } as Record<string, unknown>;
    for (const key of SENSITIVE_KEYS) {
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
    for (const key of SENSITIVE_KEYS) {
      if (typeof out[key] === 'string') out[key] = String(out[key]).replace(/^enc:/, '');
    }
    return out;
  }),
  deriveEncryptionKey: vi.fn(async () => SESSION_KEY),
  encryptData: vi.fn(async (data: unknown) => `enc:${JSON.stringify(data)}`),
  decryptData: vi.fn(async (data: unknown) => JSON.parse(String(data).replace(/^enc:/, ''))),
}));

let store: Record<string, unknown>;

/** 迁移前的老行：敏感字段是明文，且没有 `encrypted: true` 标记 */
const plainRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'a',
    username: 'u0',
    password: 'p0',
    url: 'https://example.com',
    remark: 'r0',
    totp: '',
    pathScope: '/#/desktop',
    tag: '',
    createTime: 1,
    updateTime: 1,
    order: 0,
    favorite: false,
    ...overrides,
  }) as unknown as PasswordEntry;

beforeEach(() => {
  vi.clearAllMocks();
  store = { [STORAGE_KEYS.PASSWORDS]: [plainRow()] };
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

const rowOf = (): Record<string, unknown> => (store[STORAGE_KEYS.PASSWORDS] as Record<string, unknown>[])[0];

describe('未迁移明文行的敏感编辑', () => {
  it('落盘的行六个敏感字段全是密文：不许把明文值搬进 encrypted:true 的行', async () => {
    const { updatePassword } = await import('@/utils/storage/passwordCrud');

    // 自动保存的形状：只写 password/tag/remark，其余敏感字段全靠「取最新那一行」
    await updatePassword('a', { password: 'p1', tag: 't1', remark: 'r1' } as Partial<PasswordEntry>);

    const written = rowOf();
    expect(written.encrypted, '本次编辑后这行该自称已加密').toBe(true);
    // username/url/pathScope 本次没写到：回填过来的必须是密文，不能是盘上那份明文
    expect(written.username, '明文值被搬进了自称已加密的行——迁移按 encrypted 跳过，明文从此冻在盘上').toBe('enc:u0');
    expect(written.url, '同上').toBe('enc:https://example.com');
    expect(written.pathScope, '同上（pathScope 与 url 同级敏感，漏登记就会以明文落盘）').toBe('enc:/#/desktop');
    expect(written.password).toBe('enc:p1');
    expect(written.remark).toBe('enc:r1');
  });

  it('只改 pathScope 也必须走重加密分支：不许把它当元数据以明文写进 encrypted:true 的行', async () => {
    // 已加密行：其余敏感字段都是密文。修复前 pathScope 不在 SENSITIVE_FIELDS 里，
    // 这次更新会命中「仅元数据」快路径，把明文 pathScope 直接盖在密文行上——
    // 之后 decryptPasswordEntry 解它会抛错，整条条目连带解密失败。
    store[STORAGE_KEYS.PASSWORDS] = [
      plainRow({
        username: 'enc:u0',
        password: 'enc:p0',
        url: 'enc:https://example.com',
        remark: 'enc:r0',
        pathScope: 'enc:/#/desktop',
        encrypted: true,
      }),
    ];
    const { updatePassword } = await import('@/utils/storage/passwordCrud');

    await updatePassword('a', { pathScope: '/#/admin' } as Partial<PasswordEntry>);

    const written = rowOf();
    expect(written.encrypted).toBe(true);
    expect(written.pathScope, 'pathScope 被当成元数据以明文落盘，整条条目此后无法解密').toBe('enc:/#/admin');
    expect(written.username, '本次没写的敏感字段必须回填锁内最新密文').toBe('enc:u0');
    expect(written.password).toBe('enc:p0');
  });

  it('明文行也要以锁内重读的那一份为准合并：并发写进去的明文值不许被旧快照回卷', async () => {
    const { updatePassword } = await import('@/utils/storage/passwordCrud');

    // 预读到的是 u0，落盘重读时对方已经把 username 改成 u-OTHER（仍是明文）
    let passwordsReads = 0;
    const localGet = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    const readStore = localGet.getMockImplementation() as (keys: string | string[]) => Promise<Record<string, unknown>>;
    localGet.mockImplementation(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const found = await readStore(list);
      if (!list.includes(STORAGE_KEYS.PASSWORDS)) return found;
      passwordsReads += 1;
      if (passwordsReads > 1) {
        found[STORAGE_KEYS.PASSWORDS] = [plainRow({ username: 'u-OTHER', updateTime: 555 })];
      }
      return found;
    });

    await updatePassword('a', { password: 'p1' } as Partial<PasswordEntry>);

    const written = rowOf();
    expect(passwordsReads, '夹具没走到「锁内重读」那一步，本用例在空跑').toBeGreaterThanOrEqual(2);
    expect(written.username, '对方刚改的明文用户名被本次编辑用旧值覆盖了').toBe('enc:u-OTHER');
  });
});
