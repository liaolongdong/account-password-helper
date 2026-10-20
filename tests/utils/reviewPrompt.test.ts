import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

/**
 * markFirstQuickFill 有一次性内存闸门（记录成功后的填充不再读存储），
 * 每个用例都要拿到干净的模块实例，否则用例之间会互相吃掉写入。
 */
async function freshModule() {
  vi.resetModules();
  return import('@/utils/storage/reviewPrompt');
}

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

  it('只接受正数时间戳，畸形数据收敛为未关闭 / 未延后 / 未填充', async () => {
    const { normalizeReviewPromptState } = await freshModule();

    expect(normalizeReviewPromptState(undefined)).toEqual({ dismissedAt: null, snoozedUntil: null, firstFillAt: null });
    expect(normalizeReviewPromptState({ dismissedAt: 'yesterday', snoozedUntil: NaN, firstFillAt: -1 })).toEqual({
      dismissedAt: null,
      snoozedUntil: null,
      firstFillAt: null,
    });
    expect(normalizeReviewPromptState({ dismissedAt: 1234, snoozedUntil: 5678, firstFillAt: 999 })).toEqual({
      dismissedAt: 1234,
      snoozedUntil: 5678,
      firstFillAt: 999,
    });
  });

  it('读取失败降级为未关闭且未延后，不阻塞页面', async () => {
    const { getReviewPromptState } = await freshModule();
    (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

    await expect(getReviewPromptState()).resolves.toEqual({
      dismissedAt: null,
      snoozedUntil: null,
      firstFillAt: null,
    });
  });

  it('首次成功填充写入 firstFillAt，后续填充不再重复读写', async () => {
    const { markFirstQuickFill } = await freshModule();

    await markFirstQuickFill(NOW);
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: null, snoozedUntil: null, firstFillAt: NOW },
    });

    // 闸门已落下：第二次填充既不读也不写，锚点停留在第一次
    (globalThis as any).chrome.storage.local.set.mockClear();
    (globalThis as any).chrome.storage.local.get.mockClear();
    await markFirstQuickFill(NOW + DAY_MS);
    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();
    expect((globalThis as any).chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('已有 firstFillAt 时不覆盖锚点，也不留内存闸门外的写入', async () => {
    const { markFirstQuickFill } = await freshModule();
    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: null, snoozedUntil: null, firstFillAt: NOW - 10 * DAY_MS },
    });

    await markFirstQuickFill(NOW);

    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('写入失败时不落下闸门，下一次填充会重试', async () => {
    const { markFirstQuickFill } = await freshModule();
    (globalThis as any).chrome.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(markFirstQuickFill(NOW)).resolves.toBeUndefined();
    await markFirstQuickFill(NOW + 1000);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledTimes(2);
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: null, snoozedUntil: null, firstFillAt: NOW + 1000 },
    });
  });

  it('已永久关闭时不再写锚点，直接落下闸门', async () => {
    const { markFirstQuickFill } = await freshModule();
    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 555, snoozedUntil: null, firstFillAt: null },
    });

    await markFirstQuickFill(NOW);
    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();

    (globalThis as any).chrome.storage.local.get.mockClear();
    await markFirstQuickFill(NOW + 1000);
    expect((globalThis as any).chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('读存储失败时三处写入全部放弃，绝不把降级空值写回去', async () => {
    const { markFirstQuickFill, dismissReviewPrompt, snoozeReviewPrompt } = await freshModule();
    (globalThis as any).chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

    await markFirstQuickFill(NOW);
    await dismissReviewPrompt(NOW);
    await snoozeReviewPrompt(NOW);

    // 读失败若被当成「没有值」写回去，用户刚点的「不再提醒」会被静默撤销
    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('永久关闭写入关闭时间并清空延后，但保留 firstFillAt', async () => {
    const { dismissReviewPrompt } = await freshModule();
    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: null, snoozedUntil: 4321, firstFillAt: 3_210 },
    });

    await dismissReviewPrompt(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 9876, snoozedUntil: null, firstFillAt: 3_210 },
    });
  });

  it('稍后再说写入 30 天静默截止时间，并保留另一标签页写入的永久关闭与锚点', async () => {
    const { snoozeReviewPrompt, REVIEW_PROMPT_SNOOZE_MS } = await freshModule();
    expect(REVIEW_PROMPT_SNOOZE_MS).toBe(30 * DAY_MS);

    await snoozeReviewPrompt(9876);
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: null, snoozedUntil: 9876 + 30 * DAY_MS, firstFillAt: null },
    });

    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 555, snoozedUntil: null, firstFillAt: 777 },
    });
    await snoozeReviewPrompt(9876);

    expect((globalThis as any).chrome.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: 555, snoozedUntil: 9876 + 30 * DAY_MS, firstFillAt: 777 },
    });
  });

  it('条数大于 1、填充过、且首次填充满 7 天才展示，三者缺一即不展示', async () => {
    const { shouldShowReviewPrompt, REVIEW_PROMPT_MIN_PASSWORDS, REVIEW_PROMPT_MIN_AGE_MS } = await freshModule();
    expect(REVIEW_PROMPT_MIN_PASSWORDS).toBe(2);
    expect(REVIEW_PROMPT_MIN_AGE_MS).toBe(7 * DAY_MS);

    const base = {
      dismissedAt: null,
      snoozedUntil: null,
      firstFillAt: NOW - 7 * DAY_MS,
      passwordCount: 2,
      now: NOW,
    };

    expect(shouldShowReviewPrompt(base)).toBe(true);
    // 第 7 天整算满，差 1 毫秒不算
    expect(shouldShowReviewPrompt({ ...base, firstFillAt: NOW - 7 * DAY_MS + 1 })).toBe(false);
    // 「大于 1 条」：只有 1 条不展示
    expect(shouldShowReviewPrompt({ ...base, passwordCount: 1 })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, passwordCount: 0 })).toBe(false);
    // 从未填充过（含只收藏、只录入）不展示
    expect(shouldShowReviewPrompt({ ...base, firstFillAt: null })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, dismissedAt: NOW })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, snoozedUntil: NOW + 1 })).toBe(false);
    expect(shouldShowReviewPrompt({ ...base, snoozedUntil: NOW })).toBe(true);
  });

  it('条目创建时间与收藏都不参与判定：导入满 7 天但没填过 → 不打扰', async () => {
    const { shouldShowReviewPrompt } = await freshModule();

    expect(
      shouldShowReviewPrompt({
        dismissedAt: null,
        snoozedUntil: null,
        firstFillAt: null,
        passwordCount: 500,
        now: NOW,
      }),
    ).toBe(false);
  });
});
