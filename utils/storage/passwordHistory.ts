import type { PasswordHistoryRecord } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { getPasswordHistoryConfig } from '@/utils/storage/configManager';

/** 每条密码条目最多保留的历史记录数（默认值，实际从用户配置动态读取） */
const DEFAULT_MAX_HISTORY_PER_ENTRY = 3;

// ==================== 内部工具 ====================

/**
 * 读取全量历史记录原始数据
 *
 * 读取失败时向上抛出：历史快照与 rekey 均为读-改-写路径，
 * 静默降级 [] 会导致写回时把全部历史记录清空（数据丢失）。
 * 展示/删除类调用方已各自持有容错降级。
 */
async function readAllHistory(): Promise<PasswordHistoryRecord[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORD_HISTORY);
    return (result[STORAGE_KEYS.PASSWORD_HISTORY] as PasswordHistoryRecord[] | undefined) || [];
  } catch (error) {
    logger.error('读取密码历史记录失败:', error);
    throw error;
  }
}

/**
 * 写入全量历史记录
 */
async function writeAllHistory(records: PasswordHistoryRecord[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_HISTORY]: records });
}

// ==================== 公开 API ====================

/**
 * 快照密码修改历史
 *
 * 在密码字段变更时调用，将旧密文追加到历史记录。
 * 超过用户配置的最大保留数时截断最旧的记录。
 * 配置为禁用时跳过快照。
 *
 * @param entryId 密码条目 ID
 * @param encryptedOldPassword 旧密码密文（直接从 storage 读取的加密态值）
 */
export async function snapshotPasswordHistory(entryId: string, encryptedOldPassword: string): Promise<void> {
  try {
    // 读取用户配置：禁用时跳过快照
    const config = await getPasswordHistoryConfig();
    if (!config.enabled) return;

    const maxHistory = config.maxCount || DEFAULT_MAX_HISTORY_PER_ENTRY;
    const allHistory = await readAllHistory();

    // 追加新记录
    const newRecord: PasswordHistoryRecord = {
      entryId,
      password: encryptedOldPassword,
      changedAt: Date.now(),
    };
    allHistory.push(newRecord);

    // 截断该条目超出上限的旧记录（按时间升序，移除最旧的）
    const entryRecords = allHistory.filter(r => r.entryId === entryId);
    if (entryRecords.length > maxHistory) {
      // 按 changedAt 升序排列，移除最旧的
      entryRecords.sort((a, b) => a.changedAt - b.changedAt);
      const toRemoveCount = entryRecords.length - maxHistory;
      const toRemoveSet = new Set(entryRecords.slice(0, toRemoveCount));
      const trimmed = allHistory.filter(r => !toRemoveSet.has(r));
      await writeAllHistory(trimmed);
    } else {
      await writeAllHistory(allHistory);
    }
  } catch (error) {
    // 快照失败不应阻塞密码更新主流程，仅记录日志
    logger.error('快照密码历史失败:', error);
  }
}

/**
 * 获取指定条目的密码修改历史
 *
 * @param entryId 密码条目 ID
 * @returns 历史记录列表（按时间倒序，最新在前）
 */
export async function getPasswordHistory(entryId: string): Promise<PasswordHistoryRecord[]> {
  try {
    const allHistory = await readAllHistory();
    return allHistory.filter(r => r.entryId === entryId).sort((a, b) => b.changedAt - a.changedAt);
  } catch (error) {
    logger.error('获取密码历史失败:', error);
    return [];
  }
}

/**
 * 删除指定条目的所有历史记录
 *
 * 在条目被彻底删除（从回收站永久移除）时调用。
 *
 * @param entryId 密码条目 ID
 */
export async function deleteHistoryByEntryId(entryId: string): Promise<void> {
  try {
    const allHistory = await readAllHistory();
    const filtered = allHistory.filter(r => r.entryId !== entryId);
    if (filtered.length !== allHistory.length) {
      await writeAllHistory(filtered);
    }
  } catch (error) {
    logger.error('删除条目历史记录失败:', error);
  }
}

/**
 * 批量删除多个条目的历史记录
 *
 * @param entryIds 要清理的条目 ID 列表
 */
export async function deleteHistoryByEntryIds(entryIds: string[]): Promise<void> {
  if (!entryIds.length) return;
  try {
    const idSet = new Set(entryIds);
    const allHistory = await readAllHistory();
    const filtered = allHistory.filter(r => !idSet.has(r.entryId));
    if (filtered.length !== allHistory.length) {
      await writeAllHistory(filtered);
    }
  } catch (error) {
    logger.error('批量删除条目历史记录失败:', error);
  }
}

/**
 * 获取全量历史记录原始数据（供 rekey 使用）
 */
export async function getAllHistoryRaw(): Promise<PasswordHistoryRecord[]> {
  return readAllHistory();
}

/**
 * 批量替换全部历史记录（供 rekey 写入）
 *
 * @param records 重新加密后的历史记录数组
 */
export async function replaceAllHistory(records: PasswordHistoryRecord[]): Promise<void> {
  try {
    await writeAllHistory(records);
  } catch (error) {
    logger.error('替换全部历史记录失败:', error);
    throw error;
  }
}
