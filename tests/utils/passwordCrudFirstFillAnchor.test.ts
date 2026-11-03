import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 首次成功填充与评价引导锚点
 *
 * 一次性评价引导的年龄锚点是「第一次成功填充」，它由元数据批量落盘处（所有快速填充
 * 路径唯一的汇聚点）写入一次。钉住三件事：批次里出现 lastUsedAt 才记锚点、只改收藏
 * 不记、已有锚点不被后续填充覆盖。
 *
 * `markFirstQuickFill` 有一次性内存闸门，且闸门与 passwordCrud 同属一轮模块实例，
 * 因此每个用例都 resetModules 后重新取一份，避免用例之间互相吃掉写入。
 */

let localStore: Record<string, unknown>;

const localGet = vi.fn(async (key: string) => (key in localStore ? { [key]: localStore[key] } : {}));
const localSet = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(localStore, items);
});

const freshCrud = async () => {
  vi.resetModules();
  return import('@/utils/storage/passwordCrud');
};

beforeEach(() => {
  localStore = {};
  localGet.mockClear();
  localSet.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: localGet, set: localSet },
      session: { set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });
  localStore[STORAGE_KEYS.PASSWORDS] = [makePasswordEntry({ id: 'a' })];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * 入队 → 推进防抖窗口 → 等落盘
 *
 * 锚点是密码数组写成功后 fire-and-forget 另写的键，因此还要再推进一次把微任务排空，
 * 否则断言可能跑在锚点写入之前。返回 flush 时刻本身，供断言锚点取的就是这个时间。
 */
const updateAndFlush = async (
  updatePasswordInSession: (id: string, updates: Record<string, unknown>) => Promise<void>,
  updates: Record<string, unknown>,
): Promise<number> => {
  const pending = updatePasswordInSession('a', updates);
  await vi.advanceTimersByTimeAsync(1500);
  await pending;
  const flushedAt = Date.now();
  await vi.advanceTimersByTimeAsync(1);
  return flushedAt;
};

describe('首次填充锚点', () => {
  it('批次含 lastUsedAt（即有一次真实填充）时写入首次填充时间', async () => {
    const { updatePasswordInSession } = await freshCrud();
    vi.useFakeTimers();

    const flushedAt = await updateAndFlush(updatePasswordInSession, { lastUsedAt: 900 });

    const state = localStore[STORAGE_KEYS.REVIEW_PROMPT_STATE] as { firstFillAt: number };
    expect(state.firstFillAt).toBe(flushedAt);
  });

  it('只改收藏的批次不记锚点：收藏不是使用', async () => {
    const { updatePasswordInSession } = await freshCrud();
    vi.useFakeTimers();

    await updateAndFlush(updatePasswordInSession, { favorite: true, favoriteUsedAt: 900 });

    expect(STORAGE_KEYS.REVIEW_PROMPT_STATE in localStore).toBe(false);
  });

  it('密码数组落盘失败时不记锚点：填充没真正保存就不算「用过一次」', async () => {
    const { updatePasswordInSession } = await freshCrud();
    vi.useFakeTimers();
    localSet.mockRejectedValueOnce(new Error('disk full'));

    await updateAndFlush(updatePasswordInSession, { lastUsedAt: 900 });

    expect(STORAGE_KEYS.REVIEW_PROMPT_STATE in localStore).toBe(false);
  });

  it('已有锚点时保持第一次，后续填充不覆盖', async () => {
    localStore[STORAGE_KEYS.REVIEW_PROMPT_STATE] = { dismissedAt: null, snoozedUntil: null, firstFillAt: 111 };
    const { updatePasswordInSession } = await freshCrud();
    vi.useFakeTimers();

    await updateAndFlush(updatePasswordInSession, { lastUsedAt: 900 });

    const state = localStore[STORAGE_KEYS.REVIEW_PROMPT_STATE] as { firstFillAt: number };
    expect(state.firstFillAt).toBe(111);
  });
});
