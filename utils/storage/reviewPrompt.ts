import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 一次性评价引导状态
 *
 * 只保存关闭时间戳，不含账号、密码、评分或任何用户行为数据。关闭后终生不再展示；
 * 触发条件由页面派生（已有若干条目且完成备份与体检），不额外记录使用天数。
 */
export interface ReviewPromptState {
  /** 关闭时间；null 表示从未关闭，仍可展示 */
  dismissedAt: number | null;
}

/** 至少有多少条密码后才考虑评价引导 */
export const REVIEW_PROMPT_MIN_PASSWORDS = 3;

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
 * 只在用户完成「添加条目 → 加密备份 → 安全体检」这条正向路径后询问一次；
 * `positiveMoment` 由页面用安全起步清单的完成态派生，避免新用户刚打开就被打扰。
 */
export function shouldShowReviewPrompt(input: {
  dismissedAt: number | null;
  passwordCount: number;
  positiveMoment: boolean;
}): boolean {
  return input.dismissedAt === null && input.passwordCount >= REVIEW_PROMPT_MIN_PASSWORDS && input.positiveMoment;
}
