import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordHistoryRecord } from '@/utils/types';

/**
 * passwordHistory.ts 单元测试
 *
 * 测试快照、截断、查询、删除等核心逻辑。
 * 通过 mock chrome.storage.local 验证读写行为。
 */

let storageData: Record<string, any> = {};

beforeEach(() => {
  storageData = {};

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          // 密码历史配置：返回默认值（启用，3条）
          if (key === 'password_history_config') {
            return { [key]: storageData[key] ?? { enabled: true, maxCount: 3 } };
          }
          return { [key]: storageData[key] };
        }),
        set: vi.fn(async (data: Record<string, any>) => {
          Object.assign(storageData, data);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('passwordHistory', () => {
  it('snapshotPasswordHistory 追加一条历史记录', async () => {
    const { snapshotPasswordHistory, getPasswordHistory } = await import('@/utils/storage/passwordHistory');

    await snapshotPasswordHistory('entry-1', 'encrypted-old-pw');
    const history = await getPasswordHistory('entry-1');

    expect(history).toHaveLength(1);
    expect(history[0].entryId).toBe('entry-1');
    expect(history[0].password).toBe('encrypted-old-pw');
    expect(history[0].changedAt).toBeGreaterThan(0);
  });

  it('snapshotPasswordHistory 超过默认3条时截断最旧的', async () => {
    const { snapshotPasswordHistory, getPasswordHistory } = await import('@/utils/storage/passwordHistory');

    // 预置 3 条历史
    const existing: PasswordHistoryRecord[] = [];
    for (let i = 1; i <= 3; i++) {
      existing.push({ entryId: 'entry-1', password: `pw-${i}`, changedAt: i * 1000 });
    }
    storageData['password_change_history'] = existing;

    // 追加第 4 条
    await snapshotPasswordHistory('entry-1', 'pw-4');

    const history = await getPasswordHistory('entry-1');
    expect(history).toHaveLength(3);
    // 最旧的 pw-1 应被截断，最新的 pw-4 应在前面
    expect(history[0].password).toBe('pw-4');
    expect(history.find(r => r.password === 'pw-1')).toBeUndefined();
  });

  it('snapshotPasswordHistory 配置禁用时跳过快照', async () => {
    // 覆盖配置为禁用
    storageData['password_history_config'] = { enabled: false, maxCount: 3 };
    const { snapshotPasswordHistory, getPasswordHistory } = await import('@/utils/storage/passwordHistory');

    await snapshotPasswordHistory('entry-1', 'encrypted-old-pw');
    const history = await getPasswordHistory('entry-1');

    // 禁用时不应追加任何记录
    expect(history).toHaveLength(0);
  });

  it('getPasswordHistory 按时间倒序返回', async () => {
    const { getPasswordHistory } = await import('@/utils/storage/passwordHistory');

    storageData['password_change_history'] = [
      { entryId: 'a', password: 'first', changedAt: 100 },
      { entryId: 'a', password: 'second', changedAt: 200 },
      { entryId: 'a', password: 'third', changedAt: 300 },
    ];

    const history = await getPasswordHistory('a');
    expect(history[0].password).toBe('third');
    expect(history[2].password).toBe('first');
  });

  it('deleteHistoryByEntryId 只删除指定条目的记录', async () => {
    const { deleteHistoryByEntryId, getPasswordHistory } = await import('@/utils/storage/passwordHistory');

    storageData['password_change_history'] = [
      { entryId: 'a', password: 'pw-a', changedAt: 100 },
      { entryId: 'b', password: 'pw-b', changedAt: 200 },
    ];

    await deleteHistoryByEntryId('a');
    const historyA = await getPasswordHistory('a');
    const historyB = await getPasswordHistory('b');

    expect(historyA).toHaveLength(0);
    expect(historyB).toHaveLength(1);
  });

  it('deleteHistoryByEntryIds 批量删除', async () => {
    const { deleteHistoryByEntryIds, getAllHistoryRaw } = await import('@/utils/storage/passwordHistory');

    storageData['password_change_history'] = [
      { entryId: 'a', password: 'pw-a', changedAt: 100 },
      { entryId: 'b', password: 'pw-b', changedAt: 200 },
      { entryId: 'c', password: 'pw-c', changedAt: 300 },
    ];

    await deleteHistoryByEntryIds(['a', 'c']);
    const all = await getAllHistoryRaw();
    expect(all).toHaveLength(1);
    expect(all[0].entryId).toBe('b');
  });

  it('replaceAllHistory 替换全部', async () => {
    const { replaceAllHistory, getAllHistoryRaw } = await import('@/utils/storage/passwordHistory');

    storageData['password_change_history'] = [{ entryId: 'x', password: 'old', changedAt: 1 }];

    const newRecords: PasswordHistoryRecord[] = [
      { entryId: 'y', password: 'new-1', changedAt: 100 },
      { entryId: 'y', password: 'new-2', changedAt: 200 },
    ];
    await replaceAllHistory(newRecords);

    const all = await getAllHistoryRaw();
    expect(all).toHaveLength(2);
    expect(all[0].entryId).toBe('y');
  });
});
