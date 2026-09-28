/**
 * 分组存储层（chrome.storage.local 的 `password_groups` 键）
 *
 * 分组是非敏感组织维度（仅名称 + 层级），不加密存储；日志只记录错误本身，
 * 不记录分组名原文。所有变更均为读-改-写：读取异常必须抛出，不能降级为空数组
 * 覆盖真实分组树。
 */
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { generateId } from '@/utils/generateId';
import { getDescendantCodes, validateGroupName } from '@/utils/groupTree';
import { batchUpdatePasswordMetadata, getAllPasswordsRaw } from './passwordCrud';
import { moveToTrash } from './trashManager';

/**
 * 读取全量分组。
 *
 * 非数组或缺少 code/name 的脏项会降级过滤，避免单条坏数据拖垮整个分组树；
 * chrome.storage 自身读取异常仍向上抛出。
 */
export async function getAllGroups(): Promise<PasswordGroup[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORD_GROUPS);
    const raw = result[STORAGE_KEYS.PASSWORD_GROUPS];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is PasswordGroup =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as PasswordGroup).code === 'string' &&
        typeof (item as PasswordGroup).name === 'string' &&
        typeof (item as PasswordGroup).parentCode === 'string' &&
        typeof (item as PasswordGroup).order === 'number' &&
        Number.isFinite((item as PasswordGroup).order),
    );
  } catch (error) {
    logger.error('读取分组失败:', error);
    throw error;
  }
}

/** 整体写回分组数组。 */
export async function saveGroups(groups: readonly PasswordGroup[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORD_GROUPS]: [...groups] });
  } catch (error) {
    logger.error('保存分组失败:', error);
    throw error;
  }
}

/** 虚拟「未分组」不可作为父级，也不可被改名或删除。 */
function assertNotUngrouped(code: string): void {
  if (code === UNGROUPED_CODE) throw new Error('invalidParent');
}

/** 校验名称；失败时抛出稳定错误标识供调用方映射 i18n。 */
function assertValidName(name: string, siblings: readonly PasswordGroup[]): void {
  const reason = validateGroupName(name, siblings);
  if (reason) throw new Error(reason);
}

/**
 * 新建分组。
 *
 * @param name 分组名（自动 trim，同级唯一、≤30 字符、禁含 `/`）
 * @param parentCode 父分组 code；一级分组传 ROOT_GROUP_CODE
 */
export async function createGroup(name: string, parentCode: string): Promise<PasswordGroup> {
  if (parentCode === UNGROUPED_CODE) throw new Error('invalidParent');

  const groups = await getAllGroups();
  if (parentCode !== ROOT_GROUP_CODE && !groups.some(group => group.code === parentCode)) {
    throw new Error('invalidParent');
  }

  const siblings = groups.filter(group => group.parentCode === parentCode);
  const trimmed = String(name ?? '').trim();
  assertValidName(trimmed, siblings);

  const created: PasswordGroup = {
    code: generateId(),
    name: trimmed,
    parentCode,
    order: siblings.length === 0 ? 0 : Math.max(...siblings.map(group => group.order)) + 1,
  };
  await saveGroups([...groups, created]);
  return created;
}

/** 重命名分组；不存在时静默返回。 */
export async function renameGroup(code: string, name: string): Promise<void> {
  assertNotUngrouped(code);
  const groups = await getAllGroups();
  const target = groups.find(group => group.code === code);
  if (!target) return;

  const trimmed = String(name ?? '').trim();
  const siblings = groups.filter(group => group.parentCode === target.parentCode && group.code !== code);
  assertValidName(trimmed, siblings);

  await saveGroups(groups.map(group => (group.code === code ? { ...group, name: trimmed } : group)));
}

/**
 * 移动分组到新父级。
 *
 * 目标父级不得是自身或自身子孙，避免形成环。
 */
export async function moveGroup(code: string, newParentCode: string): Promise<void> {
  assertNotUngrouped(newParentCode);

  const groups = await getAllGroups();
  if (!groups.some(group => group.code === code)) return;
  if (newParentCode !== ROOT_GROUP_CODE && !groups.some(group => group.code === newParentCode)) {
    throw new Error('invalidParent');
  }
  if (getDescendantCodes(code, groups).has(newParentCode)) throw new Error('cycle');

  const siblings = groups.filter(group => group.parentCode === newParentCode && group.code !== code);
  const moving = groups.find(group => group.code === code)!;
  assertValidName(moving.name, siblings);
  const nextOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(group => group.order)) + 1;
  await saveGroups(
    groups.map(group => (group.code === code ? { ...group, parentCode: newParentCode, order: nextOrder } : group)),
  );
}

/**
 * 同级重排。
 *
 * 仅更新指定父级下、出现在 orderedCodes 中的分组；未列出的同级项保持原 order。
 */
export async function reorderGroups(parentCode: string, orderedCodes: readonly string[]): Promise<void> {
  const groups = await getAllGroups();
  const orderMap = new Map(orderedCodes.map((code, index) => [code, index]));
  await saveGroups(
    groups.map(group =>
      group.parentCode === parentCode && orderMap.has(group.code)
        ? { ...group, order: orderMap.get(group.code)! }
        : group,
    ),
  );
}

/**
 * 删除分组及其所有子孙。
 *
 * - toUngrouped：条目 groupId 清空，归入「未分组」；
 * - toTrash：条目移入回收站，30 天内可恢复。
 *
 * 虚拟根节点与「未分组」节点不可删除；不存在的 code 静默返回。
 */
export async function deleteGroup(code: string, mode: 'toUngrouped' | 'toTrash'): Promise<void> {
  if (code === ROOT_GROUP_CODE || code === UNGROUPED_CODE) throw new Error('virtual');

  const groups = await getAllGroups();
  if (!groups.some(group => group.code === code)) return;

  const doomed = getDescendantCodes(code, groups);
  const passwords = await getAllPasswordsRaw();
  const affectedEntries = passwords.filter(entry => doomed.has(entry.groupId ?? ''));
  const affectedIds = affectedEntries.map(entry => entry.id);
  const remainingGroups = groups.filter(group => !doomed.has(group.code));

  if (mode === 'toTrash') {
    if (affectedIds.length > 0) {
      await moveToTrash(affectedIds, { [STORAGE_KEYS.PASSWORD_GROUPS]: remainingGroups });
      return;
    }
  } else if (affectedEntries.length > 0) {
    await batchUpdatePasswordMetadata(
      affectedEntries.map(entry => ({
        id: entry.id,
        updates: { groupId: undefined, updateTime: entry.updateTime },
      })),
      { [STORAGE_KEYS.PASSWORD_GROUPS]: remainingGroups },
    );
    return;
  }

  await saveGroups(remainingGroups);
}
