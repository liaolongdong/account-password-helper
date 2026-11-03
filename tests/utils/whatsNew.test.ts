import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWhatsNewState,
  markWhatsNewSeen,
  normalizeWhatsNewState,
  shouldShowWhatsNew,
} from '@/utils/storage/whatsNew';
import { STORAGE_KEYS } from '@/utils/storageKeys';

describe('Whats New 存储', () => {
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

  it('只接受非空字符串版本号，畸形数据视为未读', () => {
    expect(normalizeWhatsNewState(undefined)).toEqual({ seenVersion: null });
    expect(normalizeWhatsNewState(null)).toEqual({ seenVersion: null });
    expect(normalizeWhatsNewState({ seenVersion: 123 })).toEqual({ seenVersion: null });
    expect(normalizeWhatsNewState({ seenVersion: '   ' })).toEqual({ seenVersion: null });
    expect(normalizeWhatsNewState({ seenVersion: ' 3.16.0 ' })).toEqual({ seenVersion: '3.16.0' });
  });

  it('读取失败降级为未读，不阻塞页面', async () => {
    (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

    await expect(getWhatsNewState()).resolves.toEqual({ seenVersion: null });
  });

  it('写入已读版本，键名固定且不含其他字段', async () => {
    await markWhatsNewSeen('3.16.0');

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.WHATS_NEW_SEEN_VERSION]: { seenVersion: '3.16.0' },
    });
  });

  it('首次安装不展示；已有密码库且版本未读或变化时展示', () => {
    expect(shouldShowWhatsNew({ seenVersion: null, currentVersion: '3.16.0', hasVault: false })).toBe(false);
    expect(shouldShowWhatsNew({ seenVersion: null, currentVersion: '3.16.0', hasVault: true })).toBe(true);
    expect(shouldShowWhatsNew({ seenVersion: '3.15.0', currentVersion: '3.16.0', hasVault: true })).toBe(true);
    expect(shouldShowWhatsNew({ seenVersion: '3.16.0', currentVersion: '3.16.0', hasVault: true })).toBe(false);
  });
});
