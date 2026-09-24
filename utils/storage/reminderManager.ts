/**
 * 密码到期提醒管理模块
 *
 * 为每条密码条目提供独立的到期提醒功能。提醒数据独立于 PasswordEntry 存储，
 * 不改动现有数据结构，旧版本升级无需迁移。
 *
 * 存储格式：Record<entryId, PasswordReminder>，以 entryId 为 key 便于 O(1) 查找/删除。
 *
 * @module utils/storage/reminderManager
 */

import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';

/**
 * 单条密码的到期提醒配置
 */
export interface PasswordReminder {
  /** 对应的 PasswordEntry ID */
  entryId: string;
  /**
   * 用户名（明文冗余存储，仅用于通知正文展示，避免通知路径触发解密）
   *
   * 口径说明：密码条目本体在 storage.local 中为密文，但数据密钥的包装值按既有设计
   * 同样落盘（重启保持登录），因此「能读到这份明文」与「能解密条目」的攻击面基本等价，
   * 把它挪走并不构成实质收紧；而通知由闹钟在任意时刻发出（含锁定态），去掉它就等于
   * 让提醒正文退化成不含账号的通用文案。故此处保留明文，仅按条目账号容量截断，
   * 避免历史超长/异常账号名继续复制到第二处存储。
   */
  username: string;
  /** 提醒到期时间戳（ms） */
  remindAt: number;
  /** 提醒创建时间戳（ms） */
  createdAt: number;
  /** 是否已通知（避免重复通知） */
  notified?: boolean;
}

/** 提醒数据存储结构 */
type ReminderStore = Record<string, PasswordReminder>;

/**
 * 读取所有提醒配置
 *
 * @returns 提醒映射表（entryId -> PasswordReminder）
 */
export async function getReminders(): Promise<ReminderStore> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORD_REMINDERS);
    return (result[STORAGE_KEYS.PASSWORD_REMINDERS] as ReminderStore) ?? {};
  } catch (error) {
    logger.error('ReminderManager: 读取提醒配置失败:', error);
    return {};
  }
}

/**
 * 设置密码到期提醒
 *
 * 账号名按条目账号容量（码点口径）截断后再冗余存储：正常条目本就受同一上限约束，
 * 只有历史脏数据/异常值会触发截断，避免超长字符串被复制进第二处存储并进入通知正文。
 *
 * @param entryId  PasswordEntry ID
 * @param username 用户名（用于通知展示）
 * @param daysFromNow 从现在起 N 天后提醒
 */
export async function setReminder(entryId: string, username: string, daysFromNow: number): Promise<void> {
  const reminders = await getReminders();
  const now = Date.now();

  reminders[entryId] = {
    entryId,
    // 按码点截断：直接 `slice` 的切点落在代理对中间时，会留下孤立代理字符，
    // 通知正文里渲染成替换符（`🙂` 被切成两半）
    username: Array.from(username).slice(0, PASSWORD_FIELD_LIMITS.username).join(''),
    remindAt: now + daysFromNow * 24 * 60 * 60 * 1000,
    createdAt: now,
    notified: false,
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_REMINDERS]: reminders });
  // 只记 entryId：账号名属敏感标识，不入日志（removeReminders 亦以 entryId 定位）
  logger.debug(`ReminderManager: 已设置提醒 [${entryId}] ${daysFromNow} 天后`);
}

/**
 * 批量移除若干条目的提醒
 *
 * 一次读 → 内存过滤 → 最多一次写，与 `cleanOrphanReminders` 同形态。
 * 调用方（回收站批删/清空/过期清理）原本按 id 循环调用「读整包 + 命中才写」，
 * 删 100 条即 100 次串行 storage 往返；这里收敛为 1 次读 + 至多 1 次写。
 *
 * 行为等价性：原逐个版本是「该 id 命中则写」，本版本是「集合中任一 id 命中则写一次」，
 * 落盘结果（最终提醒表内容）完全一致，只有往返次数不同。
 *
 * @param entryIds 需要清理提醒的条目 ID 集合（接受任意可迭代对象）
 */
export async function removeReminders(entryIds: Iterable<string>): Promise<void> {
  const ids = entryIds instanceof Set ? entryIds : new Set(entryIds);
  if (ids.size === 0) return;

  const reminders = await getReminders();
  let removed = 0;
  for (const id of ids) {
    if (id in reminders) {
      delete reminders[id];
      removed += 1;
    }
  }
  if (removed === 0) return;

  await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_REMINDERS]: reminders });
  // 只记数量：entryId 虽不敏感，但批量场景逐个列出会显著放大日志体积
  logger.debug(`ReminderManager: 已移除 ${removed} 条提醒`);
}

/**
 * 获取所有已到期且未通知的提醒
 *
 * @param now 当前时间戳（ms），默认 Date.now()
 * @returns 到期的提醒列表
 */
export async function getDueReminders(now: number = Date.now()): Promise<PasswordReminder[]> {
  const reminders = await getReminders();
  return Object.values(reminders).filter(r => r.remindAt <= now && !r.notified);
}

/**
 * 标记某条目的提醒为已通知
 *
 * @param entryId PasswordEntry ID
 */
export async function markNotified(entryId: string): Promise<void> {
  const reminders = await getReminders();
  if (!(entryId in reminders)) return;

  reminders[entryId].notified = true;
  await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_REMINDERS]: reminders });
}

/**
 * 批量清理已删除条目的残留提醒
 *
 * 当密码条目被删除时，对应的提醒应一并清除。
 * 此方法可在回收站清理或密码删除时调用。
 *
 * @param validEntryIds 当前有效的 PasswordEntry ID 集合
 */
export async function cleanOrphanReminders(validEntryIds: Set<string>): Promise<void> {
  const reminders = await getReminders();
  let changed = false;

  for (const entryId of Object.keys(reminders)) {
    if (!validEntryIds.has(entryId)) {
      delete reminders[entryId];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_REMINDERS]: reminders });
    logger.debug('ReminderManager: 已清理孤立提醒');
  }
}

/**
 * 获取某条目的提醒配置（若存在）
 *
 * @param entryId PasswordEntry ID
 * @returns 提醒配置，不存在时返回 undefined
 */
export async function getReminderForEntry(entryId: string): Promise<PasswordReminder | undefined> {
  const reminders = await getReminders();
  return reminders[entryId];
}
