import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};
const mockChromeStorage = {
  local: {
    get: vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of keyList) {
        if (key in mockStorage) {
          result[key] = mockStorage[key];
        }
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
    }),
  },
};

vi.stubGlobal('chrome', { storage: mockChromeStorage });

// 动态导入模块（在 mock 设置后）
const {
  getReminders,
  setReminder,
  removeReminder,
  getDueReminders,
  markNotified,
  getReminderForEntry,
  cleanOrphanReminders,
} = await import('@/utils/storage/reminderManager');

describe('reminderManager', () => {
  beforeEach(() => {
    // 清空 mock storage
    delete mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS];
    vi.clearAllMocks();
  });

  describe('getReminders', () => {
    it('无数据时应返回空对象', async () => {
      const result = await getReminders();
      expect(result).toEqual({});
    });

    it('有数据时应返回正确映射', async () => {
      const reminders = {
        'id-1': { entryId: 'id-1', username: 'user1', remindAt: 1000, createdAt: 500, notified: false },
      };
      mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] = reminders;
      const result = await getReminders();
      expect(result).toEqual(reminders);
    });
  });

  describe('setReminder', () => {
    it('应正确设置提醒', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      await setReminder('entry-1', 'testuser', 30);

      const stored = mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] as Record<string, unknown>;
      expect(stored['entry-1']).toEqual({
        entryId: 'entry-1',
        username: 'testuser',
        remindAt: now + 30 * 24 * 60 * 60 * 1000,
        createdAt: now,
        notified: false,
      });

      vi.restoreAllMocks();
    });

    it('应覆盖已存在的同 ID 提醒', async () => {
      await setReminder('entry-1', 'user1', 7);
      await setReminder('entry-1', 'user1', 90);

      const stored = mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] as Record<string, { remindAt: number }>;
      // 第二次设置应覆盖第一次
      const expectedDelta = 90 * 24 * 60 * 60 * 1000;
      expect(stored['entry-1'].remindAt).toBeGreaterThan(Date.now() + expectedDelta - 1000);
    });
  });

  describe('removeReminder', () => {
    it('应删除指定条目的提醒', async () => {
      await setReminder('entry-1', 'user1', 30);
      await setReminder('entry-2', 'user2', 60);

      await removeReminder('entry-1');

      const stored = mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] as Record<string, unknown>;
      expect(stored['entry-1']).toBeUndefined();
      expect(stored['entry-2']).toBeDefined();
    });

    it('删除不存在的条目应无副作用', async () => {
      await removeReminder('nonexistent');
      // 不应抛错
    });
  });

  describe('getDueReminders', () => {
    it('应返回已到期且未通知的提醒', async () => {
      const past = Date.now() - 1000;
      const future = Date.now() + 100000;

      mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] = {
        'id-1': { entryId: 'id-1', username: 'expired', remindAt: past, createdAt: 0, notified: false },
        'id-2': { entryId: 'id-2', username: 'future', remindAt: future, createdAt: 0, notified: false },
        'id-3': { entryId: 'id-3', username: 'already-notified', remindAt: past, createdAt: 0, notified: true },
      };

      const due = await getDueReminders();
      expect(due).toHaveLength(1);
      expect(due[0].entryId).toBe('id-1');
    });

    it('无到期提醒时应返回空数组', async () => {
      const future = Date.now() + 100000;
      mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] = {
        'id-1': { entryId: 'id-1', username: 'user', remindAt: future, createdAt: 0, notified: false },
      };

      const due = await getDueReminders();
      expect(due).toHaveLength(0);
    });
  });

  describe('markNotified', () => {
    it('应将指定条目标记为已通知', async () => {
      mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] = {
        'id-1': { entryId: 'id-1', username: 'user', remindAt: 1000, createdAt: 0, notified: false },
      };

      await markNotified('id-1');

      const stored = mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] as Record<string, { notified: boolean }>;
      expect(stored['id-1'].notified).toBe(true);
    });
  });

  describe('getReminderForEntry', () => {
    it('存在时应返回提醒配置', async () => {
      const reminder = { entryId: 'id-1', username: 'user', remindAt: 1000, createdAt: 0, notified: false };
      mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] = { 'id-1': reminder };

      const result = await getReminderForEntry('id-1');
      expect(result).toEqual(reminder);
    });

    it('不存在时应返回 undefined', async () => {
      const result = await getReminderForEntry('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('cleanOrphanReminders', () => {
    it('应清除不在有效 ID 集合中的提醒', async () => {
      mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] = {
        'valid-1': { entryId: 'valid-1', username: 'u1', remindAt: 1000, createdAt: 0 },
        'orphan-1': { entryId: 'orphan-1', username: 'u2', remindAt: 2000, createdAt: 0 },
        'valid-2': { entryId: 'valid-2', username: 'u3', remindAt: 3000, createdAt: 0 },
      };

      await cleanOrphanReminders(new Set(['valid-1', 'valid-2']));

      const stored = mockStorage[STORAGE_KEYS.PASSWORD_REMINDERS] as Record<string, unknown>;
      expect(stored['valid-1']).toBeDefined();
      expect(stored['valid-2']).toBeDefined();
      expect(stored['orphan-1']).toBeUndefined();
    });
  });
});
