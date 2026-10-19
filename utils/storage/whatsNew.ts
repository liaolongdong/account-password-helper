import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * 「本次更新」已读版本
 *
 * 只保存版本号字符串，不含账号、密码、条目数量或任何可推导用户行为的数据。
 * 首次安装不弹更新卡片：页面初始化时若尚未设置主密码，直接把当前版本记为已读；
 * 只有已有密码库的用户升级后才展示一次。
 */
export interface WhatsNewState {
  /** 已读版本号；null 表示尚未记录（已有密码库时视为待展示） */
  seenVersion: string | null;
}

const DEFAULT_STATE: WhatsNewState = { seenVersion: null };

/** 把 storage 里的不可信数据收敛为合法状态 */
export function normalizeWhatsNewState(value: unknown): WhatsNewState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STATE };
  const seenVersion = (value as { seenVersion?: unknown }).seenVersion;
  return {
    seenVersion: typeof seenVersion === 'string' && seenVersion.trim() ? seenVersion.trim() : null,
  };
}

/** 读取已读版本；失败降级为未读，不影响主流程 */
export async function getWhatsNewState(): Promise<WhatsNewState> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.WHATS_NEW_SEEN_VERSION);
    return normalizeWhatsNewState(result[STORAGE_KEYS.WHATS_NEW_SEEN_VERSION]);
  } catch (error) {
    logger.error('读取「本次更新」状态失败:', error);
    return { ...DEFAULT_STATE };
  }
}

/** 记录当前版本已读；失败只记日志，页面已在本地隐藏 */
export async function markWhatsNewSeen(version: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WHATS_NEW_SEEN_VERSION]: { seenVersion: version },
    });
  } catch (error) {
    logger.error('保存「本次更新」状态失败:', error);
  }
}

/**
 * 是否展示更新卡片
 *
 * 没有密码库时返回 false（首次安装不打扰）；已有密码库且版本未记录或与当前
 * 版本不同则展示。版本比较只做字符串相等，不做语义化版本排序——目标只是
 * 「这次打开是否已经看过」。
 */
export function shouldShowWhatsNew(input: {
  seenVersion: string | null;
  currentVersion: string;
  hasVault: boolean;
}): boolean {
  if (!input.hasVault) return false;
  return input.seenVersion !== input.currentVersion;
}
