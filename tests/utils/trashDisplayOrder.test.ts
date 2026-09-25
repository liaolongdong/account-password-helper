import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, TrashedPasswordEntry } from '@/utils/types';

/**
 * 回收站展示顺序回归测试
 *
 * 背景：条目入回收站是追加写入（`moveToTrash` 落 `[...trash, ...movedEntries]`），
 * 于是「最早删的」排在最前；而打开回收站的人几乎总在找刚误删的那一条。分页（每页默认
 * 100）落地之后，这条刚删的记录恰好落在最后一页，只能靠翻页找。修复方式是读取侧单点
 * 定序为「最近删除在前」，让弹窗的关键词过滤只做减法、不重排。
 *
 * 本套件锁定的不变量：
 * 1. `getTrashEntries` 恒按 `deletedAt` 倒序返回（与存储里的追加序无关）；
 * 2. 同一批删除共享同一个 `deletedAt`，批内维持存储追加序（稳定排序，不给同一批制造抖动）；
 * 3. 定序不改写存储里的那份数组：返回副本，覆写型读-改-写路径（恢复/彻底删除/清空）
 *    读的仍是原始存储内容，不会因为展示顺序而错位。
 */

let storageData: Record<string, unknown>;

const readKey = async (key: string): Promise<Record<string, unknown>> =>
  key in storageData ? { [key]: storageData[key] } : {};

const localGet = vi.fn(readKey);

/** 密文条目形态（展示顺序与字段内容无关，这里只关心 id 与 deletedAt） */
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

/** 按存储追加序写入回收站：数组顺序即「先删的在前」 */
const seedTrash = (items: Array<{ id: string; deletedAt: number }>): void => {
  storageData[STORAGE_KEYS.TRASH] = items.map(({ id, deletedAt }) => ({
    ...cipherEntry(id),
    deletedAt,
  })) as TrashedPasswordEntry[];
};

const storedIds = (): string[] => (storageData[STORAGE_KEYS.TRASH] as { id: string }[]).map(e => e.id);

beforeEach(() => {
  storageData = {};
  localGet.mockImplementation(readKey);
  localGet.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getTrashEntries 的展示顺序', () => {
  it('按删除时间倒序返回，与存储里的追加序相反', async () => {
    const { getTrashEntries } = await import('@/utils/storage/trashManager');
    seedTrash([
      { id: 'oldest', deletedAt: 1_000 },
      { id: 'middle', deletedAt: 2_000 },
      { id: 'newest', deletedAt: 3_000 },
    ]);

    const entries = await getTrashEntries();

    expect(entries.map(e => e.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('同一批删除（deletedAt 相同）维持存储追加序', async () => {
    const { getTrashEntries } = await import('@/utils/storage/trashManager');
    // 批量删除一次取样同一个 now：批内三条时间戳完全相同，稳定排序才让它们有确定读法
    seedTrash([
      { id: 'a', deletedAt: 5_000 },
      { id: 'b', deletedAt: 5_000 },
      { id: 'c', deletedAt: 5_000 },
      { id: 'earlier', deletedAt: 4_000 },
    ]);

    const entries = await getTrashEntries();

    expect(entries.map(e => e.id)).toEqual(['a', 'b', 'c', 'earlier']);
  });

  it('定序作用于副本，存储里的那份数组顺序不变', async () => {
    const { getTrashEntries } = await import('@/utils/storage/trashManager');
    seedTrash([
      { id: 'oldest', deletedAt: 1_000 },
      { id: 'newest', deletedAt: 2_000 },
    ]);

    await getTrashEntries();

    // 覆写型变更路径（恢复/彻底删除）读的是同一份存储内容，展示层不得就地重排它
    expect(storedIds()).toEqual(['oldest', 'newest']);
  });
});
