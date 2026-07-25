import type { PasswordEntry, EncryptedPasswordEntry, TrashedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { deleteHistoryByEntryIds } from './passwordHistory';

/** 回收站条目保留天数 */
const TRASH_RETENTION_DAYS = 30;

/** 毫秒数：30 天 */
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ==================== 内部工具 ====================

/**
 * 读取回收站全量数据
 */
async function readTrash(): Promise<TrashedPasswordEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.TRASH);
    return (result[STORAGE_KEYS.TRASH] as TrashedPasswordEntry[] | undefined) || [];
  } catch (error) {
    logger.error('读取回收站失败:', error);
    return [];
  }
}

/**
 * 写入回收站全量数据
 */
async function writeTrash(entries: TrashedPasswordEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.TRASH]: entries });
}

/**
 * 读取密码列表全量原始数据
 */
async function readPasswords(): Promise<(PasswordEntry | EncryptedPasswordEntry)[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    return (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
  } catch (error) {
    logger.error('读取密码列表失败:', error);
    return [];
  }
}

// ==================== 公开 API ====================

/**
 * 将密码条目移入回收站（软删除）
 *
 * 从密码列表中取出指定条目，追加 deletedAt 时间戳后写入回收站。
 * 条目保持密文状态不变，安全模型与主列表一致。
 *
 * @param ids 要移入回收站的条目 ID 列表
 */
export async function moveToTrash(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const passwords = await readPasswords();
    const trash = await readTrash();

    const now = Date.now();
    const movedEntries: TrashedPasswordEntry[] = [];
    const remainingPasswords: (PasswordEntry | EncryptedPasswordEntry)[] = [];

    for (const entry of passwords) {
      if (idSet.has(entry.id)) {
        movedEntries.push({ ...entry, deletedAt: now } as TrashedPasswordEntry);
      } else {
        remainingPasswords.push(entry);
      }
    }

    if (movedEntries.length === 0) return;

    // 原子写入：同时更新 passwords 和 trash
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: remainingPasswords,
      [STORAGE_KEYS.TRASH]: [...trash, ...movedEntries],
    });
  } catch (error) {
    logger.error('移入回收站失败:', error);
    throw error;
  }
}

/**
 * 从回收站恢复条目到密码列表
 *
 * @param ids 要恢复的条目 ID 列表
 */
export async function restoreFromTrash(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const trash = await readTrash();
    const passwords = await readPasswords();

    const restoredEntries: (PasswordEntry | EncryptedPasswordEntry)[] = [];
    const remainingTrash: TrashedPasswordEntry[] = [];

    for (const entry of trash) {
      if (idSet.has(entry.id)) {
        // 移除 deletedAt 字段后恢复
        const { deletedAt: _, ...restored } = entry;
        restoredEntries.push(restored as PasswordEntry | EncryptedPasswordEntry);
      } else {
        remainingTrash.push(entry);
      }
    }

    if (restoredEntries.length === 0) return;

    // 原子写入：同时更新 passwords 和 trash
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [...passwords, ...restoredEntries],
      [STORAGE_KEYS.TRASH]: remainingTrash,
    });
  } catch (error) {
    logger.error('从回收站恢复失败:', error);
    throw error;
  }
}

/**
 * 从回收站彻底删除条目
 *
 * 同时清理对应的密码修改历史记录。
 *
 * @param ids 要彻底删除的条目 ID 列表
 */
export async function permanentDeleteFromTrash(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const trash = await readTrash();
    const remainingTrash = trash.filter(entry => !idSet.has(entry.id));

    await writeTrash(remainingTrash);

    // 清理对应的密码历史记录
    await deleteHistoryByEntryIds(ids);
  } catch (error) {
    logger.error('彻底删除失败:', error);
    throw error;
  }
}

/**
 * 清空整个回收站
 *
 * 同时清理所有回收站条目的密码修改历史。
 */
export async function emptyTrash(): Promise<void> {
  try {
    const trash = await readTrash();
    if (trash.length === 0) return;

    const entryIds = trash.map(entry => entry.id);
    await writeTrash([]);
    await deleteHistoryByEntryIds(entryIds);
  } catch (error) {
    logger.error('清空回收站失败:', error);
    throw error;
  }
}

/**
 * 清理过期的回收站条目（超过 30 天）
 *
 * 由 background 定时闹钟触发，自动清理到期条目。
 */
export async function cleanExpiredTrash(): Promise<void> {
  try {
    const trash = await readTrash();
    if (trash.length === 0) return;

    const now = Date.now();
    const expired: TrashedPasswordEntry[] = [];
    const remaining: TrashedPasswordEntry[] = [];

    for (const entry of trash) {
      if (now - entry.deletedAt > TRASH_RETENTION_MS) {
        expired.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    if (expired.length === 0) return;

    await writeTrash(remaining);

    // 清理过期条目的历史记录
    const expiredIds = expired.map(e => e.id);
    await deleteHistoryByEntryIds(expiredIds);

    logger.debug(`回收站自动清理: 移除 ${expired.length} 条过期条目`);
  } catch (error) {
    logger.error('清理过期回收站条目失败:', error);
  }
}

/**
 * 获取回收站条目列表
 */
export async function getTrashEntries(): Promise<TrashedPasswordEntry[]> {
  return readTrash();
}

/**
 * 获取回收站条目数量
 */
export async function getTrashCount(): Promise<number> {
  const trash = await readTrash();
  return trash.length;
}

/**
 * 获取回收站原始数据（供 rekey 使用）
 */
export async function getAllTrashRaw(): Promise<TrashedPasswordEntry[]> {
  return readTrash();
}

/**
 * 批量替换回收站全部数据（供 rekey 写入）
 *
 * @param entries 重新加密后的回收站数组
 */
export async function replaceAllTrash(entries: TrashedPasswordEntry[]): Promise<void> {
  try {
    await writeTrash(entries);
  } catch (error) {
    logger.error('替换回收站数据失败:', error);
    throw error;
  }
}
