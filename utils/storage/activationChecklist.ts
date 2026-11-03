import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 安全起步清单的“暂不提醒”状态
 *
 * 只保存一个时间戳，不含账号、密码或任何条目内容；完成状态由页面实时派生，
 * 不落盘（密码数量、最近备份时间、体检趋势都已有各自的事实来源）。
 */
export interface ActivationChecklistState {
  /** 上次点击「暂不提醒」的时间；null 表示从未暂不提醒 */
  dismissedAt: number | null;
}

/** 暂不提醒的有效期：7 天后如果仍未完成，下次打开管理页会再次出现 */
export const ACTIVATION_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_STATE: ActivationChecklistState = { dismissedAt: null };

/** 把 storage 里的不可信数据收敛为合法状态 */
export function normalizeActivationChecklistState(value: unknown): ActivationChecklistState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STATE };
  const dismissedAt = (value as { dismissedAt?: unknown }).dismissedAt;
  return {
    dismissedAt:
      typeof dismissedAt === 'number' && Number.isFinite(dismissedAt) && dismissedAt > 0 ? dismissedAt : null,
  };
}

/** 读取暂不提醒状态；失败降级为「未暂不提醒」，不影响清单主流程 */
export async function getActivationChecklistState(): Promise<ActivationChecklistState> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ACTIVATION_CHECKLIST);
    return normalizeActivationChecklistState(result[STORAGE_KEYS.ACTIVATION_CHECKLIST]);
  } catch (error) {
    logger.error('读取安全起步清单状态失败:', error);
    return { ...DEFAULT_STATE };
  }
}

/** 记录「暂不提醒」时间；失败只记日志，页面已在本地隐藏，下次打开会再评估 */
export async function dismissActivationChecklist(at: number = Date.now()): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.ACTIVATION_CHECKLIST]: { dismissedAt: at },
    });
  } catch (error) {
    logger.error('保存安全起步清单状态失败:', error);
  }
}
