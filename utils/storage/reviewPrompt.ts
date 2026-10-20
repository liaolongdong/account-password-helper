import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 一次性评价引导状态
 *
 * 只保存三个时间戳：首次成功填充、永久关闭、延后截止。不含账号、密码、条目内容、
 * 评分或任何可推导用户身份的数据，也不上传。
 *
 * 年龄锚点必须是 `firstFillAt` 而非条目上的 `lastUsedAt`：后者每次填充都被刷新，
 * 只用一条账号的用户会把门槛无限推后，甚至永远达不到。
 */
export interface ReviewPromptState {
  /** 永久关闭时间；null 表示从未关闭，仍可展示 */
  dismissedAt: number | null;
  /** 延后到该时间之前不再展示；null 表示没有延后 */
  snoozedUntil: number | null;
  /** 第一次成功快速填充的时间；null 表示从未填充过，不满足触发条件 */
  firstFillAt: number | null;
}

/** 保存的密码要多于 1 条（即至少 2 条）才可能询问评价 */
export const REVIEW_PROMPT_MIN_PASSWORDS = 2;

/** 首次成功填充满 7 天才询问，让用户先真正体验到填充价值 */
export const REVIEW_PROMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 「稍后再说」的静默期，避免频繁打扰 */
export const REVIEW_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_STATE: ReviewPromptState = { dismissedAt: null, snoozedUntil: null, firstFillAt: null };

/** 把不可信的时间戳收敛为 null 或正数 */
function asPositiveTimestamp(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : null;
}

/** 把 storage 里的不可信数据收敛为合法状态 */
export function normalizeReviewPromptState(value: unknown): ReviewPromptState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STATE };
  const { dismissedAt, snoozedUntil, firstFillAt } = value as {
    dismissedAt?: unknown;
    snoozedUntil?: unknown;
    firstFillAt?: unknown;
  };
  return {
    dismissedAt: asPositiveTimestamp(dismissedAt),
    snoozedUntil: asPositiveTimestamp(snoozedUntil),
    firstFillAt: asPositiveTimestamp(firstFillAt),
  };
}

/**
 * 读取评价引导状态（展示用，失败降级为「未关闭」）
 *
 * 只用于页面决定要不要展示；写入路径不要用这个，降级值会让读失败被当成「没有值」
 * 并在 read-modify-write 时抹掉用户已写入的永久关闭。
 */
export async function getReviewPromptState(): Promise<ReviewPromptState> {
  try {
    return await readReviewPromptStateOrThrow();
  } catch (error) {
    logger.error('读取评价引导状态失败:', error);
    return { ...DEFAULT_STATE };
  }
}

/**
 * 读取原始状态，读失败直接抛
 *
 * 三处写入都是「读全量 → 合并 → 写全量」，因此读失败时必须放弃写入：把降级出来的
 * 空状态写回去等于撤销用户的永久关闭，卡片会复活，比丢一次延后严重得多。
 */
async function readReviewPromptStateOrThrow(): Promise<ReviewPromptState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.REVIEW_PROMPT_STATE);
  return normalizeReviewPromptState(result[STORAGE_KEYS.REVIEW_PROMPT_STATE]);
}

/**
 * 已记录锚点的进程内闸门
 *
 * 锚点只写一次，落盘成功（或已确认无需再写）后本上下文的后续填充不再读写存储。
 * 闸门不是事实来源：Service Worker 被回收后重新实例化会再读一次存储，
 * 那时 `firstFillAt` 已存在，只会补上闸门、不会重复写入。
 */
let _firstFillRecorded = false;

/**
 * 记录「第一次成功快速填充」的时刻
 *
 * 由元数据批量落盘处调用（填充路径唯一的汇聚点），只在锚点缺失时写入，已存在则原样
 * 保留；已永久关闭时锚点不再影响展示，直接落下闸门。读写失败都不落下闸门，
 * 下一次填充自然重试。
 */
export async function markFirstQuickFill(at: number = Date.now()): Promise<void> {
  if (_firstFillRecorded) return;
  try {
    const current = await readReviewPromptStateOrThrow();
    if (current.firstFillAt !== null || current.dismissedAt !== null) {
      _firstFillRecorded = true;
      return;
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { ...current, firstFillAt: at },
    });
    _firstFillRecorded = true;
  } catch (error) {
    logger.error('记录首次填充时间失败:', error);
  }
}

/** 永久关闭评价引导；保留首次填充锚点，失败只记日志，页面已在本地隐藏 */
export async function dismissReviewPrompt(at: number = Date.now()): Promise<void> {
  try {
    const current = await readReviewPromptStateOrThrow();
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { ...current, dismissedAt: at, snoozedUntil: null },
    });
  } catch (error) {
    logger.error('保存评价引导状态失败:', error);
  }
}

/** 延后评价引导；保留首次填充锚点与另一标签页写入的永久关闭，失败只记日志 */
export async function snoozeReviewPrompt(at: number = Date.now()): Promise<void> {
  try {
    // 先读再写：另一个标签页可能刚刚永久关闭，延后不能把它改回未关闭状态。
    // 读失败时放弃本次延后——宁可卡片下次照常出现，也不能把永久关闭抹掉。
    const current = await readReviewPromptStateOrThrow();
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_PROMPT_STATE]: { ...current, snoozedUntil: at + REVIEW_PROMPT_SNOOZE_MS },
    });
  } catch (error) {
    logger.error('保存评价引导延后状态失败:', error);
  }
}

/**
 * 是否展示评价引导
 *
 * 三条都要满足：保存的密码多于 1 条、确实成功填充过一次、且首次填充已满 7 天。
 * 永久关闭后不再展示；选择「稍后再说」会在 30 天内保持静默。
 */
export function shouldShowReviewPrompt(input: {
  dismissedAt: number | null;
  snoozedUntil: number | null;
  firstFillAt: number | null;
  passwordCount: number;
  now?: number;
}): boolean {
  if (input.dismissedAt !== null) return false;
  if (input.passwordCount < REVIEW_PROMPT_MIN_PASSWORDS) return false;
  if (input.firstFillAt === null) return false;
  const now = input.now ?? Date.now();
  if (input.snoozedUntil !== null && input.snoozedUntil > now) return false;
  return now - input.firstFillAt >= REVIEW_PROMPT_MIN_AGE_MS;
}
