/**
 * 会话内备份轻提醒的「本次不再提示」
 *
 * 关闭只活到这次浏览器结束：读写都落在 `chrome.storage.session`（纯内存、关浏览器即清、
 * 默认 TRUSTED_CONTEXTS 不给内容脚本读）。之前这个标记是 `App.vue` 里的一个 `ref`，
 * 于是「本次不再提示」实际只等于「本次文档不再提示」——刷新一次就要重新关掉同一条横幅，
 * 用户读到的是承诺，得到的是反复提醒。
 *
 * 键里只有一个布尔：不含站点、条目数、备份时间或任何库内数据，不构成隐私面。
 *
 * @module utils/backup/nudgeDismissal
 */
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/**
 * 读取「本次浏览器会话是否已经关掉轻提醒」
 *
 * 读失败按「没关过」降级：这条提醒说的是「你还没有退路」，漏报的代价是用户少一次备份机会，
 * 误报的代价是从此不再提醒——两边不对称，所以宁可多说一句。
 */
export async function readBackupNudgeDismissed(): Promise<boolean> {
  try {
    const snap = await chrome.storage.session.get(SESSION_MEMORY_KEYS.BACKUP_NUDGE_DISMISSED);
    return snap[SESSION_MEMORY_KEYS.BACKUP_NUDGE_DISMISSED] === true;
  } catch (error) {
    logger.debug('读取备份轻提醒关闭态失败（按未关闭处理）:', error);
    return false;
  }
}

/**
 * 记下「本次不再提示」
 *
 * 内存标记由调用方同步翻转，这里只负责跨刷新存活；写失败不打扰用户——
 * 最坏是下次刷新再看到一条同样的横幅，不是丢数据。
 */
export async function writeBackupNudgeDismissed(): Promise<void> {
  try {
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.BACKUP_NUDGE_DISMISSED]: true });
  } catch (error) {
    logger.debug('记录备份轻提醒关闭态失败（本次刷新内仍然生效）:', error);
  }
}
