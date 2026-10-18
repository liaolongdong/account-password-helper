import type { PasswordEntry, EncryptedPasswordEntry, TrashedPasswordEntry, TrashRestoreResult } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { deleteHistoryByEntryIds } from './passwordHistory';
import { removeReminders } from './reminderManager';
import { assertWithinCapacity } from './vaultCapacity';

/**
 * 回收站写入串行队列
 *
 * move / restore / permanent delete / empty / cleanup 都是「读主列表 + 读回收站 → 整体覆写」。
 * 同一上下文内并发调用时，后写者会用陈旧快照覆盖前一次写入，表现为刚删的条目复活或恢复被回滚。
 * 这里按调用顺序串行化写操作；读取路径不排队（单次 storage.set 本身原子）。
 * 跨上下文（Options 与 Background）仍以 storage.onChanged 与既有守卫协调。
 */
let trashMutationQueue: Promise<unknown> = Promise.resolve();

function enqueueTrashMutation<T>(task: () => Promise<T>): Promise<T> {
  const next = trashMutationQueue.then(task, task);
  trashMutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * 本模块的到期阈值（= trashRetention.TRASH_RETENTION_MS）。
 *
 * 刻意写成字面量而不是 `import { TRASH_RETENTION_MS }`：trashManager 被 passwordCrud
 * 静态引用、位于 popup 首屏闭包内，任何指向 trashRetention 的模块边都会把该 chunk
 * 提升进 eager 清单（sidepanelClosure 守卫会当场失败）。口径单一事实源在
 * trashRetention.ts，由回收站天数测试断言两者永远相等。
 */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
async function moveToTrashInternal(ids: string[]): Promise<void> {
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
 * 计数原样返回而不抛错：`restored === 0 && skippedExisting === 0` 表示请求的 id 已不在
 * 回收站——弹窗开着的那几秒里到期清理恰好跑过，或另一张管理页标签把它彻底删除了，两种都会
 * 落到这里。这是一次**空操作**而不是异常，静默 return 会让调用方把它报成「已恢复」，
 * 所以两个计数交给调用方分流（没恢复的条数由调用方按 `ids.length` 自行推得）。
 *
 * @param ids 要恢复的条目 ID 列表
 * @returns `restored`（真的回到主列表的条数）与 `skippedExisting`（主列表已有同 id，仅消费副本）
 */
async function restoreFromTrashInternal(ids: string[]): Promise<TrashRestoreResult> {
  if (!ids.length) return { restored: 0, skippedExisting: 0 };
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

    if (restoredEntries.length === 0 && skippedExisting === 0) return { restored: 0, skippedExisting: 0 };

    // 总量守卫：与批量导入同口径——整批要么全恢复要么一条都不动，不静默截断。
    // 「恢复了 5 条中的 2 条」会让回收站看起来没清空，用户无法判断还剩哪些。
    assertWithinCapacity(passwords.length, restoredEntries.length);

    // 原子写入：同时更新 passwords 和 trash
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: [...passwords, ...restoredEntries],
      [STORAGE_KEYS.TRASH]: remainingTrash,
    });
    return { restored: restoredEntries.length, skippedExisting };
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
async function permanentDeleteFromTrashInternal(ids: string[]): Promise<void> {
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
async function emptyTrashInternal(): Promise<void> {
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
async function cleanExpiredTrashInternal(): Promise<void> {
  try {
    const trash = await readTrash();
    if (trash.length === 0) return;

    const now = Date.now();
    const expired: TrashedPasswordEntry[] = [];
    const remaining: TrashedPasswordEntry[] = [];

    for (const entry of trash) {
      // 语义与 trashRetention.isTrashEntryExpired 一致（本模块因 popup 首屏闭包不能 import 它，
      // 与上面的阈值字面量同属"本地副本 + 断言钉死"那一套，改一边必须改另一边）：
      // `deletedAt` 非有限数按已到期处理，反向判会让畸形条目在盘上永不过期，
      // 与回收站弹窗「剩余 N 天」的承诺矛盾。
      const due = !Number.isFinite(entry.deletedAt) || now - entry.deletedAt > TRASH_RETENTION_MS;
      if (due) {
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
 *
 * 返回顺序恒为**最近删除在前**。条目是追加写入的（`moveToTrash` 落的是
 * `[...trash, ...movedEntries]`），最早删的因此排在最前，而打开回收站的人几乎总在找
 * 「刚误删的那一条」——分页之后它恰好落在最后一页。这里单点定序，消费方（回收站弹窗）
 * 的关键词过滤只做减法、不重排，两条规则叠加后的顺序才是用户看到的那一列。
 *
 * 同一批删除共享同一个 `deletedAt`（`moveToTrash` 一次取样），批内维持原追加序，
 * 依赖的是 `Array.prototype.sort` 的稳定性（ECMAScript 2019 起为规范要求）。
 */
export async function getTrashEntries(): Promise<TrashedPasswordEntry[]> {
  try {
    const trash = await readTrash();
    return [...trash].sort((a, b) => b.deletedAt - a.deletedAt);
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
async function replaceAllTrashInternal(entries: TrashedPasswordEntry[]): Promise<void> {
  try {
    await writeTrash(entries);
  } catch (error) {
    logger.error('替换回收站数据失败:', error);
    throw error;
  }
}

// ==================== 串行化写入口 ====================
// 具体实现保持原名 + Internal；导出层只负责排队，调用方无需感知并发顺序。

/** 将密码条目移入回收站（软删除） */
export function moveToTrash(ids: string[]): Promise<void> {
  return enqueueTrashMutation(() => moveToTrashInternal(ids));
}

/** 从回收站恢复条目到密码列表 */
export function restoreFromTrash(ids: string[]): Promise<TrashRestoreResult> {
  return enqueueTrashMutation(() => restoreFromTrashInternal(ids));
}

/** 从回收站彻底删除条目 */
export function permanentDeleteFromTrash(ids: string[]): Promise<void> {
  return enqueueTrashMutation(() => permanentDeleteFromTrashInternal(ids));
}

/** 清空整个回收站 */
export function emptyTrash(): Promise<void> {
  return enqueueTrashMutation(() => emptyTrashInternal());
}

/** 清理过期的回收站条目（后台闹钟） */
export function cleanExpiredTrash(): Promise<void> {
  return enqueueTrashMutation(() => cleanExpiredTrashInternal());
}

/** 批量替换回收站全部数据（rekey） */
export function replaceAllTrash(entries: TrashedPasswordEntry[]): Promise<void> {
  return enqueueTrashMutation(() => replaceAllTrashInternal(entries));
}
