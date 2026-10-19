import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVATION_SNOOZE_MS,
  dismissActivationChecklist,
  getActivationChecklistState,
  normalizeActivationChecklistState,
} from '@/utils/storage/activationChecklist';
import { STORAGE_KEYS } from '@/utils/storageKeys';

describe('activationChecklist 存储', () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: undefined })),
          set: vi.fn(async (_value: Record<string, unknown>) => {}),
        },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
  });

  it('只接受正数 dismissedAt，畸形数据一律视为未暂不提醒', () => {
    expect(normalizeActivationChecklistState(undefined)).toEqual({ dismissedAt: null });
    expect(normalizeActivationChecklistState(null)).toEqual({ dismissedAt: null });
    expect(normalizeActivationChecklistState({ dismissedAt: 'yesterday' })).toEqual({ dismissedAt: null });
    expect(normalizeActivationChecklistState({ dismissedAt: -1 })).toEqual({ dismissedAt: null });
    expect(normalizeActivationChecklistState({ dismissedAt: 1234 })).toEqual({ dismissedAt: 1234 });
  });

  it('读取失败降级为未暂不提醒', async () => {
    (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

    await expect(getActivationChecklistState()).resolves.toEqual({ dismissedAt: null });
  });

  it('暂不提醒写入时间戳，键名固定', async () => {
    await dismissActivationChecklist(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.ACTIVATION_CHECKLIST]: { dismissedAt: 9876 },
    });
  });

  it('暂不提醒有效期为 7 天', () => {
    expect(ACTIVATION_SNOOZE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
