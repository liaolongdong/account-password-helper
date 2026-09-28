import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry, TrashedPasswordEntry } from '@/utils/types';

/**
 * 回收站恢复同 id 去重回归测试
 *
 * 背景：`restoreFromTrash` 是「读回收站 → 读主列表 → 整体覆写」的读-改-写路径，
 * 追加恢复条目前不检查主列表是否已存在同 id。两次恢复在同 id 上交错（后一次的
 * 主列表读取命中前一次的落盘结果）时，主列表会落出两条同 id 条目，后续按 id 定位
 * 的更新/删除只命中其一，另一条成为无法单独清理的幽灵数据。
 *
 * 本套件锁定修复后的不变量：
 * 1. 交错恢复收敛为单份，主列表不出现重复 id；
 * 2. 去重仅跳过重复条目，同批次其他条目照常恢复；
 * 3. 正常路径（主列表无同 id）行为与修复前完全一致：追加到末尾且不残留 deletedAt；
 * 4. 未命中回收站条目时依旧不写入（早退语义未变）。
 *
 * chrome.storage.local 以内存桩实现，交错用例通过受控读取时窗复现竞态窗口。
 */

let storageData: Record<string, unknown>;

const readKey = async (key: string): Promise<Record<string, unknown>> =>
  key in storageData ? { [key]: storageData[key] } : {};
const writeItems = async (items: Record<string, unknown>): Promise<void> => {
  Object.assign(storageData, items);
};
const localGet = vi.fn(readKey);
const localSet = vi.fn(writeItems);

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

const trashEntry = (id: string): TrashedPasswordEntry => ({
  ...cipherEntry(id),
  deletedAt: 1234,
});

/** 取主列表 id 序列，便于断言追加顺序 */
const passwordIds = (): string[] => (storageData[STORAGE_KEYS.PASSWORDS] as { id: string }[]).map(e => e.id);
const trashIds = (): string[] => (storageData[STORAGE_KEYS.TRASH] as { id: string }[]).map(e => e.id);

beforeEach(() => {
  storageData = {};
  localGet.mockImplementation(readKey);
  localSet.mockImplementation(writeItems);
  localGet.mockClear();
  localSet.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet, remove: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('同 id 去重', () => {
  it('两次恢复在同 id 上交错时收敛为单份，主列表不出现重复条目', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('dup')];
    storageData[STORAGE_KEYS.PASSWORDS] = [];

    // 把第二次主列表读取推迟到第一次落盘之后，复现竞态窗口：
    // 两次调用的回收站读取都命中含 `dup` 的旧快照，后一次的主列表读取却看到已恢复的条目
    let markFirstWriteLanded!: () => void;
    const firstWriteLanded = new Promise<void>(resolve => {
      markFirstWriteLanded = resolve;
    });
    let passwordsReads = 0;
    localGet.mockImplementation(async (key: string) => {
      if (key === STORAGE_KEYS.PASSWORDS) {
        passwordsReads += 1;
        if (passwordsReads === 2) await firstWriteLanded;
      }
      return readKey(key);
    });
    localSet.mockImplementation(async (items: Record<string, unknown>) => {
      await writeItems(items);
      markFirstWriteLanded();
    });

    await Promise.all([restoreFromTrash(['dup']), restoreFromTrash(['dup'])]);

    expect(passwordIds()).toEqual(['dup']);
    expect(trashIds()).toEqual([]);
  });

  it('主列表已存在同 id 时仅消费回收站副本，不追加第二条', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('dup'), cipherEntry('keep')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('dup')];

    await restoreFromTrash(['dup']);

    expect(passwordIds()).toEqual(['dup', 'keep']);
    expect(trashIds()).toEqual([]);
  });

  it('同批次混合恢复：重复条目被跳过，其余条目照常落盘', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('dup')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('dup'), trashEntry('fresh'), trashEntry('untouched')];

    await restoreFromTrash(['dup', 'fresh']);

    expect(passwordIds()).toEqual(['dup', 'fresh']);
    expect(trashIds()).toEqual(['untouched']);
  });
});

describe('正常恢复路径行为等价', () => {
  it('主列表无同 id 时追加到末尾且不带 deletedAt', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('keep')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('restore-me'), trashEntry('stay')];

    await restoreFromTrash(['restore-me']);

    expect(passwordIds()).toEqual(['keep', 'restore-me']);
    const restored = (storageData[STORAGE_KEYS.PASSWORDS] as Record<string, unknown>[])[1];
    expect(restored).not.toHaveProperty('deletedAt');
    expect(restored).toMatchObject({ id: 'restore-me', encrypted: true });
    expect(trashIds()).toEqual(['stay']);
  });

  it('ids 未命中任何回收站条目时不写入', async () => {
    const { restoreFromTrash } = await import('@/utils/storage/trashManager');
    storageData[STORAGE_KEYS.PASSWORDS] = [cipherEntry('keep')];
    storageData[STORAGE_KEYS.TRASH] = [trashEntry('other')];

    await restoreFromTrash(['not-in-trash']);

    expect(localSet).not.toHaveBeenCalled();
    expect(passwordIds()).toEqual(['keep']);
    expect(trashIds()).toEqual(['other']);
  });
});
