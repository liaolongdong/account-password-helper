import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissReviewPrompt,
  getReviewPromptState,
  normalizeReviewPromptState,
  REVIEW_PROMPT_MIN_PASSWORDS,
  shouldShowReviewPrompt,
} from '@/utils/storage/reviewPrompt';
import { STORAGE_KEYS } from '@/utils/storageKeys';

describe('一次性评价引导存储', () => {
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

  it('只接受正数关闭时间，畸形数据视为未关闭', () => {
    expect(normalizeReviewPromptState(undefined)).toEqual({ dismissedAt: null });
    expect(normalizeReviewPromptState({ dismissedAt: 'yesterday' })).toEqual({ dismissedAt: null });
    expect(normalizeReviewPromptState({ dismissedAt: -1 })).toEqual({ dismissedAt: null });
    expect(normalizeReviewPromptState({ dismissedAt: 1234 })).toEqual({ dismissedAt: 1234 });
  });

  it('读取失败降级为未关闭，不阻塞页面', async () => {
    (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

    await expect(getReviewPromptState()).resolves.toEqual({ dismissedAt: null });
  });

  it('关闭后写入时间戳，键名固定', async () => {
    await dismissReviewPrompt(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 9876 },
    });
  });

  it('只在条目足够且完成正向路径后展示一次', () => {
    expect(REVIEW_PROMPT_MIN_PASSWORDS).toBe(3);
    expect(shouldShowReviewPrompt({ dismissedAt: null, passwordCount: 2, positiveMoment: true })).toBe(false);
    expect(shouldShowReviewPrompt({ dismissedAt: null, passwordCount: 3, positiveMoment: false })).toBe(false);
    expect(shouldShowReviewPrompt({ dismissedAt: 1234, passwordCount: 10, positiveMoment: true })).toBe(false);
    expect(shouldShowReviewPrompt({ dismissedAt: null, passwordCount: 3, positiveMoment: true })).toBe(true);
  });
});
