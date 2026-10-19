import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 一次性评价引导状态
 *
 * 只保存关闭时间戳，不含账号、密码、评分或任何用户行为数据。关闭后终生不再展示；
 * 触发条件由页面派生（至少保存过一条密码），不额外记录使用天数或安装时间。
 */
export interface ReviewPromptState {
  /** 关闭时间；null 表示从未关闭，仍可展示 */
  dismissedAt: number | null;
}

/** 至少保存过一条密码就可以询问评价 */
export const REVIEW_PROMPT_MIN_PASSWORDS = 1;

const DEFAULT_STATE: ReviewPromptState = { dismissedAt: null };

/** 把 storage 里的不可信数据收敛为合法状态 */
export function normalizeReviewPromptState(value: unknown): ReviewPromptState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STATE };
  const dismissedAt = (value as { dismissedAt?: unknown }).dismissedAt;
  return {
    dismissedAt:
      typeof dismissedAt === 'number' && Number.isFinite(dismissedAt) && dismissedAt > 0 ? dismissedAt : null,
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

/** 关闭评价引导；失败只记日志，页面已在本地隐藏 */
export async function dismissReviewPrompt(at: number = Date.now()): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { dismissedAt: at },
    });
  } catch (error) {
    logger.error('保存评价引导状态失败:', error);
  }
}

/**
 * 是否展示评价引导
 *
 * 保存第一条密码后就询问一次；新用户还没有条目，因此不会在首次打开空库时打扰。
 * 是否已经询问过只看关闭时间戳，不依赖备份或体检完成态。
 */
export function shouldShowReviewPrompt(input: { dismissedAt: number | null; passwordCount: number }): boolean {
  return input.dismissedAt === null && input.passwordCount >= REVIEW_PROMPT_MIN_PASSWORDS;
}
