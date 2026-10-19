import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveReviewUsage,
  dismissReviewPrompt,
  getReviewPromptState,
  normalizeReviewPromptState,
  REVIEW_PROMPT_MIN_AGE_MS,
  REVIEW_PROMPT_MIN_PASSWORDS,
  REVIEW_PROMPT_SNOOZE_MS,
  shouldShowReviewPrompt,
  snoozeReviewPrompt,
} from '@/utils/storage/reviewPrompt';
import { STORAGE_KEYS } from '@/utils/storageKeys';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

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

  it('只接受正数时间戳，畸形数据收敛为未关闭 / 未延后', () => {
    expect(normalizeReviewPromptState(undefined)).toEqual({ dismissedAt: null, snoozedUntil: null });
    expect(normalizeReviewPromptState({ dismissedAt: 'yesterday', snoozedUntil: NaN })).toEqual({
      dismissedAt: null,
      snoozedUntil: null,
    });
    expect(normalizeReviewPromptState({ dismissedAt: -1, snoozedUntil: Infinity })).toEqual({
      dismissedAt: null,
      snoozedUntil: null,
    });
    expect(normalizeReviewPromptState({ dismissedAt: 1234, snoozedUntil: 5678 })).toEqual({
      dismissedAt: 1234,
      snoozedUntil: 5678,
    });
  });

  it('读取失败降级为未关闭且未延后，不阻塞页面', async () => {
    (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

    await expect(getReviewPromptState()).resolves.toEqual({ dismissedAt: null, snoozedUntil: null });
  });

  it('永久关闭写入关闭时间并清空延后，键名固定', async () => {
    await dismissReviewPrompt(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 9876, snoozedUntil: null },
    });
  });

  it('稍后再说写入 30 天静默截止时间，并保留另一标签页写入的永久关闭', async () => {
    expect(REVIEW_PROMPT_SNOOZE_MS).toBe(30 * DAY_MS);

    await snoozeReviewPrompt(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: {
        dismissedAt: null,
        snoozedUntil: 9876 + 30 * DAY_MS,
      },
    });

    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 555, snoozedUntil: null },
    });
    await snoozeReviewPrompt(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: {
        dismissedAt: 555,
        snoozedUntil: 9876 + 30 * DAY_MS,
      },
    });
  });

  it('从条目元数据派生「用过一次」与最早创建时间，使用时间戳不参与年龄锚点', () => {
    expect(deriveReviewUsage([])).toEqual({ hasUsed: false, oldestCreateTime: null });
    expect(deriveReviewUsage([{ createTime: NOW - 30 * DAY_MS }])).toEqual({
      hasUsed: false,
      oldestCreateTime: NOW - 30 * DAY_MS,
    });
    expect(
      deriveReviewUsage([
        { createTime: NOW - 30 * DAY_MS, lastUsedAt: NOW - 5 * DAY_MS },
        { createTime: NOW - 20 * DAY_MS, favoriteUsedAt: NOW - 9 * DAY_MS },
        { createTime: NOW - 10 * DAY_MS, lastUsedAt: 0, favoriteUsedAt: Number.NaN },
      ]),
    ).toEqual({ hasUsed: true, oldestCreateTime: NOW - 30 * DAY_MS });
  });

  it('密码库存在满 7 天且确实用过才展示，关闭与延后都会抑制', () => {
    expect(REVIEW_PROMPT_MIN_PASSWORDS).toBe(1);
    expect(REVIEW_PROMPT_MIN_AGE_MS).toBe(7 * DAY_MS);

    const base = {
      dismissedAt: null,
      snoozedUntil: null,
      passwordCount: 1,
      hasUsed: true,
      oldestCreateTime: NOW - 7 * DAY_MS,
      now: NOW,
    };

    expect(shouldShowReviewPrompt(base)).toBe(true);
    expect(shouldShowReviewPrompt({ ...base, oldestCreateTime: NOW - 7 * DAY_MS + 1 })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, passwordCount: 0 })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, hasUsed: false })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, oldestCreateTime: null })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, dismissedAt: NOW })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, snoozedUntil: NOW + 1 })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, snoozedUntil: NOW })).toBe(true);
  });

  it('日常使用刷新 lastUsedAt 不会把 7 天门槛无限推后', () => {
    const usage = deriveReviewUsage([{ createTime: NOW - 8 * DAY_MS, lastUsedAt: NOW }]);

    expect(
      shouldShowReviewPrompt({
        dismissedAt: null,
        snoozedUntil: null,
        passwordCount: 1,
        hasUsed: usage.hasUsed,
        oldestCreateTime: usage.oldestCreateTime,
        now: NOW,
      }),
    ).toBe(true);
  });
});
