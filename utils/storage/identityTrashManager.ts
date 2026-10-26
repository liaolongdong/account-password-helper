/**
 * 身份信息库回收站（软删除 + 30 天 TTL 自动清理）
 *
 * 与密码库 `trashManager.ts` 平行的独立实现，刻意不共用其读写函数：
 * - 两侧落盘形状不同（`TrashedPasswordEntry` 逐字段密文 + `encrypted` 标志，
 *   `TrashedIdentityRecord` 整块 `encryptedPayload`），混放会让 at-rest 安全网
 *   按密码形状误判身份条目为明文残留；
 * - 容量口径不同（`MAX_IDENTITIES` vs `MAX_PASSWORD_ENTRIES` 2000）；
 * - 身份回收站没有密码库的历史记录/到期提醒等附属清理项。
 *
 * 共享的是**口径**而非代码：保留期常量与剩余天数读数复用零依赖模块 `trashRetention` 的
 * `TRASH_RETENTION_DAYS` / `getTrashRemainingDays`，改保留期时两个回收站同步生效，
 * 不会出现「密码弹窗显示 30 天、身份弹窗显示另一套倒计时」的分裂。
 *
 * at-rest 不变量：条目从主列表**原样搬移密文**，本模块任何路径都不产生明文落盘；
 * 写路径均为读-改-写，读失败在任何写入发生前上抛（fail-closed），
 * 与 trashManager「静默降级 [] 会把真实数据整体覆盖清空」的教训同口径。
 */
import type {
  IdentityPayload,
  IdentityRecord,
  IdentityTrashRestoreResult,
  TrashedIdentityRecord,
} from '@/utils/identity/types';
import { MAX_IDENTITIES } from '@/utils/identity/constants';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { isTrashEntryExpired } from './trashRetention';
import { mapWithConcurrency } from '@/utils/concurrency';
import { lazyImport } from '@/utils/lazyImport';
import { withVaultMutation } from './vaultWriteLock';

/**
 * 延迟加载加密模块（整库解密批只在弹窗展示路径使用）
 * 与 identityCrud 同口径：Options 上下文中 PBKDF2/AES-GCM 不进首屏 chunk。
 */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/**
 * 身份回收站写入串行队列
 *
 * move / restore / permanent delete / empty / cleanup 都是「读主列表 + 读回收站 → 整体覆写」。
 * 同一上下文内并发调用时，后写者会用陈旧快照覆盖前一次写入：快速连点两条恢复时，
 * 先完成的一条会被后一条回卷到回收站；清理与新删除交错时还会复活已彻底删除的 PII。
 * 与密码库 `trashManager.ts` 的 `enqueueTrashMutation` 同口径；跨上下文（Options /
 * Background）仍需在写入前依赖 storage 事件与容量守卫，队列只解决同上下文交错。
 */
let identityTrashMutationQueue: Promise<unknown> = Promise.resolve();

function enqueueIdentityTrashMutation<T>(task: () => Promise<T>): Promise<T> {
  // lease 覆盖出队后的实际操作，而不是在持锁状态下等待队列。
  const run = () => withVaultMutation(task);
  const next = identityTrashMutationQueue.then(run, run);
  identityTrashMutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// ==================== 内部工具 ====================

/** 读身份主列表原始记录（失败上抛，同 identityCrud.getAllIdentityRaw） */
async function readIdentityRecords(): Promise<IdentityRecord[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY);
    return (result[STORAGE_KEYS.IDENTITY] as IdentityRecord[] | undefined) || [];
  } catch (error) {
    logger.error('读取身份信息列表失败:', error);
    throw error;
  }
}

/**
 * 读取身份回收站全量数据
 *
 * 读取失败时向上抛出：所有变更类调用方均为读-改-写路径，
 * 静默降级 [] 会把真实回收站整体覆盖清空（数据丢失）。
 * 纯展示调用方（列表/计数）自行包一层容错降级。
 */
async function readIdentityTrash(): Promise<TrashedIdentityRecord[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY_TRASH);
    return (result[STORAGE_KEYS.IDENTITY_TRASH] as TrashedIdentityRecord[] | undefined) || [];
  } catch (error) {
    logger.error('读取身份信息回收站失败:', error);
    throw error;
  }
}

/**
 * 写入身份回收站全量数据
 */
async function writeIdentityTrash(entries: TrashedIdentityRecord[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY_TRASH]: entries });
}

/**
 * 身份回收站恢复容量错误
 *
 * 语义与密码库 `VaultCapacityError` 同口径（`current / incoming / max` 三元组，整批 all-or-nothing），
 * 但刻意定义为独立类、不复用该类：`vaultCapacity.ts` 被 trashManager/passwordCrud 静态引用、
 * 位于 popup 首屏闭包，身份域任何指向它的模块边都会把该 chunk 提升进 popup eager 清单
 *（sidepanelClosure 守卫）。本模块是 Options-only，错误只在身份回收站弹窗消费并分流到
 * 该弹窗自己的 i18n 文案，因此就近定义、保持闭包边界；消息文本不回传给用户，密码侧
 * 既有文案未因本功能改动。
 */
export class IdentityTrashCapacityError extends Error {
  readonly current: number;
  readonly incoming: number;
  readonly max: number;

  constructor(current: number, incoming: number, max: number) {
    super(`条目数超出上限：当前 ${current} 条，本次新增 ${incoming} 条，上限 ${max} 条`);
    this.name = 'IdentityTrashCapacityError';
    this.current = current;
    this.incoming = incoming;
    this.max = max;
  }
}

// ==================== 公开 API ====================

/**
 * 将身份条目移入回收站（软删除）
 *
 * 从主列表取出指定条目，追加 deletedAt 时间戳后写入回收站。密文原样搬移，
 * 安全模型与主列表一致。单次 `chrome.storage.local.set()` 原子更新两个键，
 * 不存在「主列表已删、回收站未落」的中间状态。
 *
 * @param ids 要移入回收站的条目 ID 列表；不存在的 ID 静默忽略
 */
async function moveIdentitiesToTrashInternal(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const records = await readIdentityRecords();
    const trash = await readIdentityTrash();

    const now = Date.now();
    const moved: TrashedIdentityRecord[] = [];
    const remaining: IdentityRecord[] = [];

    for (const record of records) {
      if (idSet.has(record.id)) {
        moved.push({ ...record, deletedAt: now });
      } else {
        remaining.push(record);
      }
    }

    if (moved.length === 0) return;

    await chrome.storage.local.set({
      [STORAGE_KEYS.IDENTITY]: remaining,
      [STORAGE_KEYS.IDENTITY_TRASH]: [...trash, ...moved],
    });
  } catch (error) {
    logger.error('身份信息移入回收站失败:', error);
    throw error;
  }
}

/**
 * 从回收站恢复身份条目到主列表
 *
 * 与密码库同口径：主列表已存在同 id 时仅消费回收站副本，不产生重复条目；
 * 恢复受 `MAX_IDENTITIES` 总量守卫——整批要么全恢复要么一条都不动，
 * 「恢复了 5 条中的 2 条」会让回收站看起来没清空，用户无法判断还剩哪些。
 *
 * 返回计数而不抛错的完整理由见密码库 `restoreFromTrash`（两侧刻意不共用读写代码，
 * 但这一条口径是同一条）：`restored === 0 && skippedExisting === 0` 是一次**空操作**，
 * 静默 return 会让调用方把它报成「已恢复」。
 *
 * @param ids 要恢复的条目 ID 列表
 * @returns `restored`（真的回到主列表的条数）与 `skippedExisting`（主列表已有同 id，仅消费副本）
 * @throws IdentityTrashCapacityError 恢复后将超出身份条目上限
 */
async function restoreIdentitiesFromTrashInternal(ids: string[]): Promise<IdentityTrashRestoreResult> {
  if (!ids.length) return { restored: 0, skippedExisting: 0 };
  try {
    const idSet = new Set(ids);
    const trash = await readIdentityTrash();
    const records = await readIdentityRecords();

    const existingIds = new Set(records.map(record => record.id));
    const restored: IdentityRecord[] = [];
    const remainingTrash: TrashedIdentityRecord[] = [];
    let skippedExisting = 0;

    for (const entry of trash) {
      if (idSet.has(entry.id)) {
        const { deletedAt: _, ...record } = entry;
        if (existingIds.has(entry.id)) {
          skippedExisting += 1;
          logger.warn(`恢复跳过主列表已存在的同 id 身份条目: entryId=${entry.id}`);
        } else {
          restored.push(record);
        }
      } else {
        remainingTrash.push(entry);
      }
    }

    if (restored.length === 0 && skippedExisting === 0) return { restored: 0, skippedExisting: 0 };

    if (records.length + restored.length > MAX_IDENTITIES) {
      throw new IdentityTrashCapacityError(records.length, restored.length, MAX_IDENTITIES);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.IDENTITY]: [...records, ...restored],
      [STORAGE_KEYS.IDENTITY_TRASH]: remainingTrash,
    });
    return { restored: restored.length, skippedExisting };
  } catch (error) {
    logger.error('从回收站恢复身份信息失败:', error);
    throw error;
  }
}

/**
 * 从回收站彻底删除身份条目（不可恢复）
 *
 * @param ids 要彻底删除的条目 ID 列表
 */
async function permanentDeleteIdentitiesFromTrashInternal(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const idSet = new Set(ids);
    const trash = await readIdentityTrash();
    await writeIdentityTrash(trash.filter(entry => !idSet.has(entry.id)));
  } catch (error) {
    logger.error('彻底删除身份信息失败:', error);
    throw error;
  }
}

/**
 * 清空身份回收站（不可恢复）
 */
async function emptyIdentityTrashInternal(): Promise<void> {
  try {
    const trash = await readIdentityTrash();
    if (trash.length === 0) return;
    await writeIdentityTrash([]);
  } catch (error) {
    logger.error('清空身份信息回收站失败:', error);
    throw error;
  }
}

/**
 * 清理过期的身份回收站条目（超过 30 天）
 *
 * 由 background 的回收站清理闹钟触发（与密码库共用同一 alarm）。
 * 到期判定只读明文 `deletedAt`，无需数据密钥。
 */
async function cleanExpiredIdentityTrashInternal(): Promise<void> {
  try {
    const trash = await readIdentityTrash();
    if (trash.length === 0) return;

    const now = Date.now();
    // 到期判定与密码库 `cleanExpiredTrash` 同一阈值同一比较符（共用 trashRetention 的
    // `isTrashEntryExpired`），剩余天数读数（getTrashRemainingDays）只是同一口径的展示换算。
    // `deletedAt` 非有限数按已到期清理——反向判会让畸形条目在盘上永不过期，
    // 与弹窗「剩余 N 天」的承诺矛盾。
    const remaining = trash.filter(entry => !isTrashEntryExpired(entry.deletedAt, now));
    if (remaining.length === trash.length) return;

    await writeIdentityTrash(remaining);
    logger.debug(`身份回收站自动清理: 移除 ${trash.length - remaining.length} 条过期条目`);
  } catch (error) {
    logger.error('清理过期身份信息回收站条目失败:', error);
  }
}

/**
 * 获取身份回收站条目列表（纯展示路径：读取失败降级为空列表，错误已在 readIdentityTrash 记录）
 *
 * 返回顺序恒为**最近删除在前**（与密码库 `getTrashEntries` 同口径：误删的人
 * 几乎总在找刚删的那条，追加序会把它压到列表尾部）。
 */
export async function getIdentityTrashEntries(): Promise<TrashedIdentityRecord[]> {
  try {
    const trash = await readIdentityTrash();
    return [...trash].sort((a, b) => b.deletedAt - a.deletedAt);
  } catch {
    return [];
  }
}

/**
 * 获取身份回收站条目列表（严格读：读取失败上抛）
 *
 * 回收站弹窗必须区分「确实为空」和「读取失败」：前者该展示空态，后者应展示错误
 * 与重试入口。展示外的其他调用方继续用 {@link getIdentityTrashEntries} 的降级语义。
 */
export async function getIdentityTrashEntriesStrict(): Promise<TrashedIdentityRecord[]> {
  const trash = await readIdentityTrash();
  return [...trash].sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * 获取身份回收站条目数量（纯展示路径：读取失败降级为 0）
 */
export async function getIdentityTrashCount(): Promise<number> {
  try {
    const trash = await readIdentityTrash();
    return trash.length;
  } catch {
    return 0;
  }
}

/**
 * 解密回收站条目的展示字段（回收站弹窗专用）
 *
 * 整块 `encryptedPayload` 解密后只取「标题 + 类别」两个展示必需字段，其余 PII
 * 不组装进返回值——展示面收窄到「一张什么证件/卡」的粒度，与列表弹窗
 * 「关闭即释放明文」的驻留口径同取舍。无密钥（会话失效）或单条解密失败时
 * title 返回 null、category 返回空串，由调用方降级为占位符；本函数不外抛。
 *
 * @param entries 回收站原始记录
 * @param dataKey 会话数据密钥（hex）
 * @param titleOf 从 payload 提取标题的回调（`identityDisplayTitle` 回退链，由调用方注入）
 * @returns 与入参同序的「id + 标题（可为 null）+ 类别（解密失败为空串）」数组
 */
export async function decryptIdentityTrashTitles(
  entries: TrashedIdentityRecord[],
  dataKey: string,
  titleOf: (payload: IdentityPayload) => string,
): Promise<{ id: string; title: string | null; category: string }[]> {
  if (entries.length === 0) return [];
  try {
    const enc = await _getEncryption();
    return await mapWithConcurrency(entries, async entry => {
      try {
        const json = await enc.decryptData(entry.encryptedPayload, dataKey);
        const payload = JSON.parse(json) as IdentityPayload;
        return { id: entry.id, title: titleOf(payload), category: payload.category };
      } catch {
        return { id: entry.id, title: null, category: '' };
      }
    });
  } catch (error) {
    logger.error('解密身份回收站条目失败:', error);
    return entries.map(entry => ({ id: entry.id, title: null, category: '' }));
  }
}

/**
 * 获取身份回收站原始数据（供 rekey 使用）
 *
 * rekey 侧的写**不走本模块**：换钥必须把五个数据域 + 校验哈希 + 新会话密钥压进
 * 同一次 `chrome.storage.local.set()`（见 changeMasterPassword 步骤 11），
 * 单独一个替换回收站的导出会破坏那次原子性，因此刻意不提供。
 */
export async function getAllIdentityTrashRaw(): Promise<TrashedIdentityRecord[]> {
  return readIdentityTrash();
}

// ==================== 串行化写入口 ====================
// 具体实现保持原名 + Internal；导出层只负责排队，调用方无需感知并发顺序。

/** 将身份条目移入回收站（软删除） */
export function moveIdentitiesToTrash(ids: string[]): Promise<void> {
  return enqueueIdentityTrashMutation(() => moveIdentitiesToTrashInternal(ids));
}

/** 从回收站恢复身份条目到主列表 */
export function restoreIdentitiesFromTrash(ids: string[]): Promise<IdentityTrashRestoreResult> {
  return enqueueIdentityTrashMutation(() => restoreIdentitiesFromTrashInternal(ids));
}

/** 从回收站彻底删除身份条目 */
export function permanentDeleteIdentitiesFromTrash(ids: string[]): Promise<void> {
  return enqueueIdentityTrashMutation(() => permanentDeleteIdentitiesFromTrashInternal(ids));
}

/** 清空整个身份回收站 */
export function emptyIdentityTrash(): Promise<void> {
  return enqueueIdentityTrashMutation(() => emptyIdentityTrashInternal());
}

/** 清理过期的身份回收站条目（后台闹钟） */
export function cleanExpiredIdentityTrash(): Promise<void> {
  return enqueueIdentityTrashMutation(() => cleanExpiredIdentityTrashInternal());
}
