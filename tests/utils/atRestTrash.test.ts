import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncryptedPasswordEntry, PasswordEntry } from '@/utils/types';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * at-rest 密文不变量的回收站覆盖回归测试（A3）
 *
 * 背景：`moveToTrash` 原样搬移磁盘条目（`{ ...entry, deletedAt }`），而旧版本升级
 * 的明文迁移窗口内主列表可能仍有明文；此时被删除的条目会把明文带进回收站，
 * 而 `ensurePasswordsEncryptedAtRest` 只扫 `PASSWORDS`，该明文将在 30 天 TTL 内
 * 一直驻留 storage.local —— at-rest 不变量存在缺口。
 *
 * 锁定不变量：迁移扫描范围含 `TRASH`；回收站条目密文化后保留 `deletedAt`；
 * 同列密文与明文共存时只替换明文条目（不丢条目、不改顺序、不二次加密）；
 * 未发生变化的列表不被写回（避免覆盖并发写入）；稳态全密文零写入；
 * 仍有明文时不置完成标志。
 */

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

/** 明文 → 可辨识密文（保留其余字段，含 deletedAt） */
vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'data-key'),
  encryptData: vi.fn(async (v: string) => `enc(${v})`),
  decryptData: vi.fn(async () => 'plain'),
  clearCryptoKeyCache: vi.fn(),
  encryptPasswordEntry: vi.fn(
    async (entry: PasswordEntry): Promise<EncryptedPasswordEntry> =>
      ({
        ...entry,
        username: entry.username ? `enc(${entry.username})` : '',
        password: entry.password ? `enc(${entry.password})` : '',
        url: entry.url ? `enc(${entry.url})` : '',
        remark: entry.remark ? `enc(${entry.remark})` : '',
        totp: entry.totp ? `enc(${entry.totp})` : '',
        encrypted: true,
      }) as EncryptedPasswordEntry,
  ),
  decryptPasswordEntry: vi.fn(),
}));

const plain = (id: string, updateTime = 1000): PasswordEntry =>
  ({
    id,
    username: `user-${id}`,
    password: `pwd-${id}`,
    url: 'https://example.com',
    tag: '',
    remark: '',
    totp: '',
    createTime: 900,
    updateTime,
  }) as PasswordEntry;

const cipher = (id: string): EncryptedPasswordEntry =>
  ({ ...plain(id), username: `enc(user-${id})`, encrypted: true }) as EncryptedPasswordEntry;

/** 五字段均为 mock 加密器形态的密文条目，用于构造「同列密文与明文共存」的快照 */
const cipherFull = (id: string): EncryptedPasswordEntry =>
  ({
    ...plain(id),
    username: `enc(user-${id})`,
    password: `enc(pwd-${id})`,
    url: 'enc(https://example.com)',
    remark: '',
    totp: '',
    encrypted: true,
  }) as EncryptedPasswordEntry;

const readList = async <T>(key: string): Promise<T[]> =>
  ((await chrome.storage.local.get(key))[key] as T[] | undefined) || [];

beforeEach(async () => {
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  // 模块 mock 的函数实例在本文件内共享，resetModules 不会重置调用记录，
  // 逐个清空后各用例的「加密了几条 / 有没有加密」断言才只反映自身行为
  const enc = await import('@/utils/encryption');
  vi.mocked(enc.deriveEncryptionKey).mockClear();
  vi.mocked(enc.encryptPasswordEntry).mockClear();
  vi.mocked(enc.decryptPasswordEntry).mockClear();
});

/** 登录流程语义：显式主密码驱动一次全量 at-rest 密文化 */
const migrate = async (): Promise<void> => {
  const { migrateUnencryptedEntries } = await import('@/utils/sessionManager-storage');
  await migrateUnencryptedEntries('master-password');
};

describe('at-rest 不变量覆盖回收站', () => {
  it('主列表全密文、回收站有明文时，回收站条目被密文化且保留 deletedAt', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [cipher('p1')],
      [STORAGE_KEYS.TRASH]: [{ ...plain('t1'), deletedAt: 555 }],
    });

    await migrate();

    const trash = await readList<EncryptedPasswordEntry & { deletedAt?: number }>(STORAGE_KEYS.TRASH);
    expect(trash).toHaveLength(1);
    expect(trash[0].encrypted).toBe(true);
    expect(trash[0].password).toBe('enc(pwd-t1)');
    expect(trash[0].deletedAt).toBe(555);
  });

  it('回收站待密文化时不因主列表已干净而提前写回主列表', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [cipher('p1')],
      [STORAGE_KEYS.TRASH]: [plain('t1')],
    });

    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    await migrate();

    const writtenKeys = setSpy.mock.calls.flatMap(([arg]) => Object.keys((arg ?? {}) as object));
    expect(writtenKeys).toContain(STORAGE_KEYS.TRASH);
    expect(writtenKeys).not.toContain(STORAGE_KEYS.PASSWORDS);
    setSpy.mockRestore();
  });

  it('两列都有明文时一并密文化（主列表行为保持不变）', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [plain('p1')],
      [STORAGE_KEYS.TRASH]: [plain('t1')],
    });

    await migrate();

    expect((await readList<EncryptedPasswordEntry>(STORAGE_KEYS.PASSWORDS))[0].encrypted).toBe(true);
    expect((await readList<EncryptedPasswordEntry>(STORAGE_KEYS.TRASH))[0].encrypted).toBe(true);
  });

  it('同一列内密文与明文共存时，只替换明文条目且不丢条目、不改顺序', async () => {
    // 回归守卫：实现若把「逐条替换」写成「筛选出明文重加密后整体替换」，
    // 已密文条目会在写回时被静默丢弃（回收站数据丢失）
    const { encryptPasswordEntry } = await import('@/utils/encryption');
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [cipherFull('p1')],
      [STORAGE_KEYS.TRASH]: [
        { ...cipherFull('t1'), deletedAt: 777 },
        { ...plain('t2'), deletedAt: 888 },
        cipherFull('t3'),
      ],
    });

    await migrate();

    const trash = await readList<EncryptedPasswordEntry & { deletedAt?: number }>(STORAGE_KEYS.TRASH);
    expect(trash.map(e => e.id)).toEqual(['t1', 't2', 't3']);
    // 已密文条目原样保留（未被二次加密）
    expect(trash[0].password).toBe('enc(pwd-t1)');
    expect(trash[2].password).toBe('enc(pwd-t3)');
    // 明文条目被替换，deletedAt 与其余密文条目的标记一并保留
    expect(trash[1].password).toBe('enc(pwd-t2)');
    expect(trash[1].encrypted).toBe(true);
    expect(trash[0].deletedAt).toBe(777);
    expect(trash[1].deletedAt).toBe(888);
    expect(trash[2].deletedAt).toBeUndefined();
    // 仅明文条目进入加密器，共 1 次
    expect(vi.mocked(encryptPasswordEntry)).toHaveBeenCalledTimes(1);
  });

  it('两列均已全密文（稳态）时快速返回：零加密、零写入', async () => {
    // 排空前序用例可能残留的 fire-and-forget 迁移，避免把它的写入算到本用例头上
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [cipherFull('p1')],
      [STORAGE_KEYS.TRASH]: [{ ...cipherFull('t1'), deletedAt: 777 }],
    });

    const { encryptPasswordEntry } = await import('@/utils/encryption');
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    await migrate();

    expect(vi.mocked(encryptPasswordEntry)).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('回收站条目在快照后被并发修改时原样保留，下一轮迁移继续处理', async () => {
    // requestReEncryptAtRest 走会话数据密钥（无显式主密码），预置 storage.session 热缓存
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: 'data-key' });
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [],
      [STORAGE_KEYS.TRASH]: [plain('t1', 1000)],
    });

    const { requestReEncryptAtRest } = await import('@/utils/sessionManager-storage');
    // 预先并发修改：第 2 次「主列表 + 回收站」批量读取（即迁移函数的重读快照）
    // 返回被并发改过的条目，updateTime 与待加密快照不符，本轮必须放弃替换
    const realGet = chrome.storage.local.get.bind(chrome.storage.local) as (
      keys?: unknown,
    ) => Promise<Record<string, unknown>>;
    let atRestReads = 0;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys: unknown) => {
      const readsAtRest = Array.isArray(keys) && keys.includes(STORAGE_KEYS.TRASH);
      if (!readsAtRest) return realGet(keys);
      atRestReads += 1;
      const entry = atRestReads === 2 ? plain('t1', 2000) : plain('t1', 1000);
      return { [STORAGE_KEYS.PASSWORDS]: [], [STORAGE_KEYS.TRASH]: [entry] };
    });

    requestReEncryptAtRest();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(atRestReads).toBe(2);
    vi.restoreAllMocks();

    const afterFirst = await readList<{ encrypted?: boolean; updateTime: number }>(STORAGE_KEYS.TRASH);
    expect(afterFirst[0].encrypted).toBeUndefined();
    expect(afterFirst[0].updateTime).toBe(1000);

    // 未置完成标志（仍有明文）→ 下一次触发继续密文化
    await migrate();
    expect((await readList<EncryptedPasswordEntry>(STORAGE_KEYS.TRASH))[0].encrypted).toBe(true);
  });

  it('无任何条目时快速完成，不写入 storage', async () => {
    // 等待前序用例可能残留的 fire-and-forget 迁移落地，避免把它的写入算到本用例头上
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    await migrate();
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
