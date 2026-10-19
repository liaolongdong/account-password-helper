import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 一次性评价引导状态
 *
 * 只保存关闭与延后的时间戳，不含账号、密码、评分或任何用户行为数据。
 * 使用情况由条目上已有的 lastUsedAt / favoriteUsedAt 派生，不额外记录使用次数。
 */
export interface ReviewPromptState {
  /** 永久关闭时间；null 表示从未关闭，仍可展示 */
  dismissedAt: number | null;
  /** 延后到该时间之前不再展示；null 表示没有延后 */
  snoozedUntil: number | null;
}

/** 至少保存过一条密码才可能询问评价 */
export const REVIEW_PROMPT_MIN_PASSWORDS = 1;

/** 密码库存在满 7 天才询问，避开刚开始尝鲜的第一周 */
export const REVIEW_PROMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 「稍后再说」的静默期，避免频繁打扰 */
export const REVIEW_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_STATE: ReviewPromptState = { dismissedAt: null, snoozedUntil: null };

/** 把不可信的时间戳收敛为 null 或正数 */
function asPositiveTimestamp(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : null;
}

/** 把 storage 里的不可信数据收敛为合法状态 */
export function normalizeReviewPromptState(value: unknown): ReviewPromptState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STATE };
  const { dismissedAt, snoozedUntil } = value as { dismissedAt?: unknown; snoozedUntil?: unknown };
  return {
    dismissedAt: asPositiveTimestamp(dismissedAt),
    snoozedUntil: asPositiveTimestamp(snoozedUntil),
  };
}

/** 读取评价引导状态；失败降级为「未关闭」，不影响主流程 */
export async function getReviewPromptState(): Promise<ReviewPromptState> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROMPT_STATE);
    return normalizeReviewPromptState(result[STORAGE_KEYS.REVIEW_PROMPT_STATE]);
  } catch (error) {
    logger.error('读取评价引导状态失败:', error);
    return { ...DEFAULT_STATE };
  }
}

/** 永久关闭评价引导；失败只记日志，页面已在本地隐藏 */
export async function dismissReviewPrompt(at: number = Date.now()): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: at, snoozedUntil: null },
    });
  } catch (error) {
    logger.error('保存评价引导状态失败:', error);
  }
}

/** 延后评价引导；失败只记日志，页面已在本地隐藏 */
export async function snoozeReviewPrompt(at: number = Date.now()): Promise<void> {
  try {
    // 先读再写：另一个标签页可能刚刚永久关闭，延后不能把它改回未关闭状态
    const current = await getReviewPromptState();
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: {
        dismissedAt: current.dismissedAt,
        snoozedUntil: at + REVIEW_PROMPT_SNOOZE_MS,
      },
    });
  } catch (error) {
    logger.error('保存评价引导延后状态失败:', error);
  }
}

/**
 * 从条目上派生评价条件所需的信号
 *
 * 填充会刷新 lastUsedAt，收藏会写 favoriteUsedAt，两者都算真实使用；
 * 但它们每次使用都会更新，不能用来衡量「已经用了多久」。年龄锚点因此取最早条目的
 * createTime——它一旦写入不再变化，日常使用不会把 7 天门槛无限往后推。
 */
export function deriveReviewUsage(
  entries: readonly { createTime: number; lastUsedAt?: number; favoriteUsedAt?: number }[],
): { hasUsed: boolean; oldestCreateTime: number | null } {
  let hasUsed = false;
  let oldestCreateTime: number | null = null;
  for (const entry of entries) {
    if (asPositiveTimestamp(entry.lastUsedAt) !== null || asPositiveTimestamp(entry.favoriteUsedAt) !== null) {
      hasUsed = true;
    }
    const createTime = asPositiveTimestamp(entry.createTime);
    if (createTime !== null && (oldestCreateTime === null || createTime < oldestCreateTime)) {
      oldestCreateTime = createTime;
    }
  }
  return { hasUsed, oldestCreateTime };
}

/**
 * 是否展示评价引导
 *
 * 至少保存过一条密码、确实使用过，且密码库已存在满 7 天。永久关闭后不再展示；
 * 选择「稍后再说」会在 30 天内保持静默。
 */
export function shouldShowReviewPrompt(input: {
  dismissedAt: number | null;
  snoozedUntil: number | null;
  passwordCount: number;
  hasUsed: boolean;
  oldestCreateTime: number | null;
  now?: number;
}): boolean {
  if (input.dismissedAt !== null) return false;
  if (input.passwordCount < REVIEW_PROMPT_MIN_PASSWORDS) return false;
  if (!input.hasUsed || input.oldestCreateTime === null) return false;
  const now = input.now ?? Date.now();
  if (input.snoozedUntil !== null && input.snoozedUntil > now) return false;
  return now - input.oldestCreateTime >= REVIEW_PROMPT_MIN_AGE_MS;
}
