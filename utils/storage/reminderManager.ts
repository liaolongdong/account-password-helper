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

/**
 * 单条密码的到期提醒配置
 */
export interface PasswordReminder {
  /** 对应的 PasswordEntry ID */
  entryId: string;
  /** 用户名（冗余存储，用于通知展示，避免触发解密） */
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
 * @param entryId  PasswordEntry ID
 * @param username 用户名（用于通知展示）
 * @param daysFromNow 从现在起 N 天后提醒
 */
export async function setReminder(entryId: string, username: string, daysFromNow: number): Promise<void> {
  const reminders = await getReminders();
  const now = Date.now();

  reminders[entryId] = {
    entryId,
    username,
    remindAt: now + daysFromNow * 24 * 60 * 60 * 1000,
    createdAt: now,
    notified: false,
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_REMINDERS]: reminders });
  logger.debug(`ReminderManager: 已设置提醒 [${username}] ${daysFromNow} 天后`);
}

/**
 * 移除某条目的提醒
 *
 * @param entryId PasswordEntry ID
 */
export async function removeReminder(entryId: string): Promise<void> {
  const reminders = await getReminders();
  if (!(entryId in reminders)) return;

  delete reminders[entryId];
  await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_REMINDERS]: reminders });
  logger.debug(`ReminderManager: 已移除提醒 [${entryId}]`);
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
