import type { PasswordEntry, EncryptedPasswordEntry, TrashedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { deleteHistoryByEntryIds } from './passwordHistory';
import { removeReminders } from './reminderManager';
import { assertWithinCapacity } from './vaultCapacity';

/**
 * 回收站条目保留天数
 *
 * 对外导出：回收站弹窗的「剩余天数」读数与这里的自动清理必须同一口径，
 * 各自写死 30 的话，改保留期时弹窗会静默显示一个与真实清理规则不符的倒计时。
 */
export const TRASH_RETENTION_DAYS = 30;

/** 一天的毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 毫秒数：30 天 */
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * MS_PER_DAY;

/**
 * 计算某条回收站条目的剩余保留天数（按「已过几个完整 24 小时」扣减，已到期为 0）
 *
 * 纯展示口径，与 {@link cleanExpiredTrash} 的到期判定同源（共用 `TRASH_RETENTION_DAYS`）：
 * 阈值仍由 `now - deletedAt > TRASH_RETENTION_MS` 决定，这里只是把同一个差值换算成天数读数。
 *
 * 读数按**天**而不是按保留期整体换算：`30 - floor(已过天数)` 才会随时间逐格递减，
 * 若除以 `TRASH_RETENTION_MS` 则整月都停在 30、到期当天直接跳到 0。
 * 上限同样夹在 `TRASH_RETENTION_DAYS`：时钟回拨或 `deletedAt` 带未来时间时不给出「31 天」。
 *
 * @param deletedAt 删除时间戳（毫秒）
 * @param now 基准时刻（毫秒），由调用方一次取样，避免同一屏内每行各取一次 `Date.now()`
 * @returns 剩余天数（0 ~ `TRASH_RETENTION_DAYS`）
 */
export const getTrashRemainingDays = (deletedAt: number, now: number = Date.now()): number =>
  Math.min(TRASH_RETENTION_DAYS, Math.max(0, TRASH_RETENTION_DAYS - Math.floor((now - deletedAt) / MS_PER_DAY)));

// ==================== 内部工具 ====================

/**
 * 读取回收站全量数据
 *
 * 读取失败时向上抛出：所有变更类调用方均为读-改-写路径，
 * 静默降级 [] 会把真实回收站整体覆盖清空（数据丢失）。
 * 纯展示调用方（计数/列表）自行包一层容错降级。
 */
async function readTrash(): Promise<TrashedPasswordEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.TRASH);
    return (result[STORAGE_KEYS.TRASH] as TrashedPasswordEntry[] | undefined) || [];
  } catch (error) {
    logger.error('读取回收站失败:', error);
    throw error;
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
 *
 * 读取失败时向上抛出：移入回收站/恢复等调用方会基于读取结果
 * 整体覆写主列表，静默降级 [] 会把真实密码列表清空（数据丢失）。
 */
async function readPasswords(): Promise<(PasswordEntry | EncryptedPasswordEntry)[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    return (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
  } catch (error) {
    logger.error('读取密码列表失败:', error);
    throw error;
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

    // 清理已移入回收站条目的到期提醒（避免对非活跃条目发送通知）
    // 批量化：原本逐个 id 各读一次整包提醒表，批删 100 条 = 100 次串行往返
    await removeReminders(ids).catch(() => {});
  } catch (error) {
    logger.error('移入回收站失败:', error);
    throw error;
  }
}

/**
 * 从回收站恢复条目到密码列表
 *
 * 恢复后的条目追加到主列表末尾；主列表已存在同 id 条目时仅消费回收站副本，不产生重复条目。
 *
 * @param ids 要恢复的条目 ID 列表
 */
export async function restoreFromTrash(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const trash = await readTrash();
    const passwords = await readPasswords();

    // 主列表已有同 id 条目时不再追加：本函数是「读回收站 → 读主列表 → 整体覆写」，
    // 两次并发恢复在同 id 上交错（后一次的主列表读取命中前一次的写入结果）时，
    // 无条件追加会在主列表落出两条同 id 条目，后续按 id 定位的更新/删除只会命中其一，
    // 另一条成为无法单独清理的幽灵数据。正常路径下主列表与回收站按 id 互斥，此判断恒为空操作。
    const existingIds = new Set(passwords.map(entry => entry.id));
    const restoredEntries: (PasswordEntry | EncryptedPasswordEntry)[] = [];
    const remainingTrash: TrashedPasswordEntry[] = [];
    let skippedExisting = 0;

    for (const entry of trash) {
      if (idSet.has(entry.id)) {
        // 移除 deletedAt 字段后恢复
        const { deletedAt: _, ...restored } = entry;
        if (existingIds.has(entry.id)) {
          skippedExisting += 1;
          logger.warn(`恢复跳过主列表已存在的同 id 条目: entryId=${entry.id}`);
        } else {
          restoredEntries.push(restored as PasswordEntry | EncryptedPasswordEntry);
        }
      } else {
        remainingTrash.push(entry);
      }
    }

    if (restoredEntries.length === 0 && skippedExisting === 0) return;

    // 总量守卫：与批量导入同口径——整批要么全恢复要么一条都不动，不静默截断。
    // 「恢复了 5 条中的 2 条」会让回收站看起来没清空，用户无法判断还剩哪些。
    assertWithinCapacity(passwords.length, restoredEntries.length);

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

    // 安全兜底：清理可能残留的到期提醒
    await removeReminders(ids).catch(() => {});
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

    // 安全兜底：清理可能残留的到期提醒
    await removeReminders(entryIds).catch(() => {});
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

    // 安全兜底：清理过期条目可能残留的到期提醒
    await removeReminders(expiredIds).catch(() => {});

    logger.debug(`回收站自动清理: 移除 ${expired.length} 条过期条目`);
  } catch (error) {
    logger.error('清理过期回收站条目失败:', error);
  }
}

/**
 * 获取回收站条目列表（纯展示路径：读取失败降级为空列表，错误已在 readTrash 记录）
 */
export async function getTrashEntries(): Promise<TrashedPasswordEntry[]> {
  try {
    return await readTrash();
  } catch {
    return [];
  }
}

/**
 * 获取回收站条目数量（纯展示路径：读取失败降级为 0）
 */
export async function getTrashCount(): Promise<number> {
  try {
    const trash = await readTrash();
    return trash.length;
  } catch {
    return 0;
  }
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
