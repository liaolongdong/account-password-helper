import { generateId } from '@/utils/generateId';
import type { GroupTreeNode, PasswordEntry, PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';

/** Full-path separator. Group names are forbidden from containing this character. */
export const GROUP_PATH_SEPARATOR = '/';

/** Maximum group name length. */
export const MAX_GROUP_NAME_LENGTH = 30;

/**
 * DataTransfer type used when dragging table rows into the group tree.
 *
 * A custom MIME type distinguishes row drags from tree-node drags, which also
 * write `text/plain`.
 */
export const ENTRY_DRAG_MIME = 'application/x-aph-entry-ids';

/** Imported entry that may carry a full group path from a path-based format. */
export type ImportedPasswordEntry = Omit<PasswordEntry, 'id' | 'order'> & {
  /** Full slash-separated group path. Takes precedence over groupId when present. */
  groupPath?: string;
};

/** Parsed import payload: entries plus a group tree when the format provides one. */
export interface ParsedImportData {
  entries: ImportedPasswordEntry[];
  groups: PasswordGroup[];
}

function createGroupNode(group: PasswordGroup): GroupTreeNode {
  return {
    code: group.code,
    name: group.name,
    order: group.order,
    children: [],
  };
}

function sortTree(nodes: GroupTreeNode[]): void {
  nodes.sort((a, b) => a.order - b.order);
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => a.order - b.order);
    stack.push(...node.children);
  }
}

/**
 * Convert a flat adjacency list into a tree with a virtual root and an
 * "ungrouped" leaf.
 *
 * Nodes whose parent no longer exists are attached to the root so corrupt or
 * partially deleted data cannot make entries disappear. Duplicate and reserved
 * codes are ignored, parent cycles are flattened to the root, siblings are
 * sorted by order, and "ungrouped" is always the last child of the root.
 */
export function buildTree(groups: readonly PasswordGroup[]): GroupTreeNode[] {
  const uniqueGroups: PasswordGroup[] = [];
  const seenCodes = new Set<string>();
  for (const group of groups) {
    if (group.code === ROOT_GROUP_CODE || group.code === UNGROUPED_CODE || seenCodes.has(group.code)) {
      continue;
    }
    seenCodes.add(group.code);
    uniqueGroups.push(group);
  }

  const nodeByCode = new Map<string, GroupTreeNode>();
  const childrenByDeclaredParent = new Map<string, string[]>();
  for (const group of uniqueGroups) {
    nodeByCode.set(group.code, createGroupNode(group));
    const children = childrenByDeclaredParent.get(group.parentCode);
    if (children) children.push(group.code);
    else childrenByDeclaredParent.set(group.parentCode, [group.code]);
  }

  const root: GroupTreeNode = {
    code: ROOT_GROUP_CODE,
    name: '',
    order: 0,
    children: [],
    isVirtual: true,
  };

  const rootReachableCodes = new Set<string>();
  const queue: string[] = [];
  for (const group of uniqueGroups) {
    if (group.parentCode === ROOT_GROUP_CODE || !nodeByCode.has(group.parentCode)) {
      rootReachableCodes.add(group.code);
      queue.push(group.code);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const parentCode = queue[index];
    for (const childCode of childrenByDeclaredParent.get(parentCode) ?? []) {
      if (rootReachableCodes.has(childCode)) continue;
      rootReachableCodes.add(childCode);
      queue.push(childCode);
    }
  }

  for (const group of uniqueGroups) {
    const parent =
      rootReachableCodes.has(group.code) && group.parentCode !== ROOT_GROUP_CODE && nodeByCode.has(group.parentCode)
        ? nodeByCode.get(group.parentCode)
        : undefined;
    (parent ?? root).children.push(nodeByCode.get(group.code)!);
  }

  sortTree(root.children);

  root.children.push({
    code: UNGROUPED_CODE,
    name: '',
    order: Number.MAX_SAFE_INTEGER,
    children: [],
    isVirtual: true,
  });

  return [root];
}

/**
 * Return a group's full slash-separated path.
 *
 * Ungrouped, root, and invalid codes return an empty string so pure logic stays
 * independent of UI translations.
 */
export function getGroupPath(code: string | undefined, groups: readonly PasswordGroup[]): string {
  if (!code || code === UNGROUPED_CODE || code === ROOT_GROUP_CODE) return '';
  return buildGroupPathMap(groups).get(code) ?? '';
}

/**
 * Build full paths for a group collection in one pass.
 *
 * This avoids rebuilding an index for every row when large tables need the
 * group column. Invalid and cyclic parent chains degrade to the resolvable
 * suffix, matching getGroupPath.
 */
export function buildGroupPathMap(groups: readonly PasswordGroup[]): Map<string, string> {
  const groupByCode = new Map(groups.map(group => [group.code, group]));
  const paths = new Map<string, string>();

  const resolve = (code: string): string => {
    const cached = paths.get(code);
    if (cached !== undefined) return cached;

    const chain: PasswordGroup[] = [];
    const visited = new Set<string>();
    let current = groupByCode.get(code);
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      chain.push(current);
      current = current.parentCode === ROOT_GROUP_CODE ? undefined : groupByCode.get(current.parentCode);
    }

    const prefix = current ? (paths.get(current.code) ?? '') : '';
    let path = prefix;
    while (chain.length > 0) {
      const group = chain.pop()!;
      path = path ? `${path}${GROUP_PATH_SEPARATOR}${group.name}` : group.name;
      paths.set(group.code, path);
    }
    return paths.get(code) ?? '';
  };

  for (const group of groups) resolve(group.code);
  return paths;
}

/**
 * Return the starting group and all of its descendants.
 *
 * Invalid codes return an empty set. Ungrouped returns only itself.
 */
export function getDescendantCodes(code: string, groups: readonly PasswordGroup[]): Set<string> {
  const result = new Set<string>();
  if (code === UNGROUPED_CODE) {
    result.add(UNGROUPED_CODE);
    return result;
  }
  if (!groups.some(group => group.code === code)) return result;

  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    const children = childrenByParent.get(group.parentCode);
    if (children) children.push(group.code);
    else childrenByParent.set(group.parentCode, [group.code]);
  }

  const stack = [code];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;

    result.add(current);
    for (const child of childrenByParent.get(current) ?? []) stack.push(child);
  }

  return result;
}

/**
 * Filter group-tree nodes by name while retaining the ancestor chains of
 * matches. The root and ungrouped nodes are always retained so the tree never
 * becomes empty.
 */
export function filterGroupsByKeyword(groups: readonly PasswordGroup[], keyword: string): Set<string> {
  const kept = new Set<string>([ROOT_GROUP_CODE, UNGROUPED_CODE]);
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    for (const group of groups) kept.add(group.code);
    return kept;
  }

  const groupByCode = new Map(groups.map(group => [group.code, group]));
  for (const group of groups) {
    if (!group.name.toLowerCase().includes(normalizedKeyword)) continue;

    let current: PasswordGroup | undefined = group;
    const visited = new Set<string>();
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      kept.add(current.code);
      current = current.parentCode === ROOT_GROUP_CODE ? undefined : groupByCode.get(current.parentCode);
    }
  }

  return kept;
}

/**
 * Resolve an entry's group id to a currently valid group.
 *
 * Missing, empty, ungrouped, and dangling ids all map to the virtual
 * "ungrouped" node.
 */
export function resolveEntryGroupId(groupId: string | undefined, groups: readonly PasswordGroup[]): string {
  if (!groupId || groupId === UNGROUPED_CODE) return UNGROUPED_CODE;
  return groups.some(group => group.code === groupId) ? groupId : UNGROUPED_CODE;
}

/**
 * Ensure a full group path exists, creating missing levels as needed.
 *
 * This is the import and sync boundary for path-based group data. Same-name
 * siblings are reused, empty segments are ignored, and the input array is not
 * mutated.
 */
export function ensureGroupByPath(
  path: string,
  groups: readonly PasswordGroup[],
): { code: string; created: PasswordGroup[] } {
  const segments = String(path ?? '')
    .split(GROUP_PATH_SEPARATOR)
    .map(segment => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return { code: UNGROUPED_CODE, created: [] };

  const groupBySiblingName = new Map<string, PasswordGroup>();
  const maxOrderByParent = new Map<string, number>();
  for (const group of groups) {
    const key = `${group.parentCode}\0${group.name}`;
    if (!groupBySiblingName.has(key)) groupBySiblingName.set(key, group);
    maxOrderByParent.set(group.parentCode, Math.max(maxOrderByParent.get(group.parentCode) ?? -1, group.order));
  }

  const created: PasswordGroup[] = [];
  let parentCode = ROOT_GROUP_CODE;
  let currentCode = ROOT_GROUP_CODE;

  for (const segment of segments) {
    const normalizedSegment = segment.slice(0, MAX_GROUP_NAME_LENGTH);
    const siblingKey = `${parentCode}\0${normalizedSegment}`;
    const existing = groupBySiblingName.get(siblingKey);
    if (existing) {
      currentCode = existing.code;
      parentCode = existing.code;
      continue;
    }

    const nextOrder = (maxOrderByParent.get(parentCode) ?? -1) + 1;
    const newGroup: PasswordGroup = {
      code: generateId(),
      name: normalizedSegment,
      parentCode,
      order: nextOrder,
    };

    groupBySiblingName.set(siblingKey, newGroup);
    maxOrderByParent.set(parentCode, nextOrder);
    created.push(newGroup);
    currentCode = newGroup.code;
    parentCode = newGroup.code;
  }

  return { code: currentCode, created };
}

/**
 * Merge an imported group tree into the existing tree.
 *
 * Imported codes are never trusted as stable identifiers: names are matched
 * among siblings, existing groups are reused, and newly created groups receive
 * fresh codes. The returned map translates each imported code to its resolved
 * local code.
 */
export function mergeImportedGroups(
  imported: readonly PasswordGroup[],
  existing: readonly PasswordGroup[],
): { groups: PasswordGroup[]; codeMap: Map<string, string> } {
  const groups: PasswordGroup[] = existing.map(group => ({ ...group }));
  const codeMap = new Map<string, string>();
  if (imported.length === 0) return { groups, codeMap };

  const importedByCode = new Map<string, PasswordGroup>();
  for (const group of imported) {
    if (!importedByCode.has(group.code)) importedByCode.set(group.code, group);
  }

  const childrenByCode = new Map<string, PasswordGroup[]>();
  for (const group of importedByCode.values()) {
    const children = childrenByCode.get(group.parentCode);
    if (children) children.push(group);
    else childrenByCode.set(group.parentCode, [group]);
  }

  const siblingKey = (name: string, parentCode: string): string => `${parentCode}\0${name}`;
  const groupBySiblingName = new Map<string, PasswordGroup>();
  const nextOrderByParent = new Map<string, number>();
  for (const group of groups) {
    const key = siblingKey(group.name, group.parentCode);
    if (!groupBySiblingName.has(key)) groupBySiblingName.set(key, group);
    nextOrderByParent.set(group.parentCode, Math.max(nextOrderByParent.get(group.parentCode) ?? -1, group.order));
  }

  const materialize = (group: PasswordGroup, parentCode: string): string => {
    const key = siblingKey(group.name, parentCode);
    const reused = groupBySiblingName.get(key);
    if (reused) return reused.code;

    const nextOrder = (nextOrderByParent.get(parentCode) ?? -1) + 1;
    const created: PasswordGroup = {
      code: generateId(),
      name: group.name,
      parentCode,
      order: nextOrder,
    };
    groups.push(created);
    groupBySiblingName.set(key, created);
    nextOrderByParent.set(parentCode, nextOrder);
    return created.code;
  };

  const visited = new Set<string>();
  const importedCodes = new Set(importedByCode.keys());
  const queue: PasswordGroup[] = [];
  for (const group of importedByCode.values()) {
    if (!importedCodes.has(group.parentCode)) queue.push(group);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const group = queue[index];
    if (visited.has(group.code)) continue;
    visited.add(group.code);

    const mappedParent =
      group.parentCode === ROOT_GROUP_CODE ? ROOT_GROUP_CODE : (codeMap.get(group.parentCode) ?? ROOT_GROUP_CODE);
    codeMap.set(group.code, materialize(group, mappedParent));
    queue.push(...(childrenByCode.get(group.code) ?? []));
  }

  // Corrupt cyclic data is still preserved as root-level groups rather than
  // silently dropping entries that reference it.
  for (const group of importedByCode.values()) {
    if (!visited.has(group.code)) codeMap.set(group.code, materialize(group, ROOT_GROUP_CODE));
  }

  return { groups, codeMap };
}

/**
 * Resolve an imported payload into storage-ready entries and the complete
 * merged group array.
 *
 * Path-based imports are created level by level and share same-name siblings.
 * Code-based imports use the mapping produced by mergeImportedGroups.
 */
export function resolveImportedGroups(
  data: ParsedImportData,
  existing: readonly PasswordGroup[],
): { entries: Omit<PasswordEntry, 'id' | 'order'>[]; groups: PasswordGroup[] } {
  const { groups, codeMap } = mergeImportedGroups(data.groups, existing);
  const entries: Omit<PasswordEntry, 'id' | 'order'>[] = [];

  for (const entry of data.entries) {
    const { groupPath, ...rest } = entry;
    let groupId: string | undefined;
    if (groupPath && groupPath.trim()) {
      const resolved = ensureGroupByPath(groupPath, groups);
      groups.push(...resolved.created);
      groupId = resolved.code === UNGROUPED_CODE ? undefined : resolved.code;
    } else if (entry.groupId) {
      groupId = codeMap.get(entry.groupId);
    }
    entries.push({ ...rest, groupId });
  }

  return { entries, groups };
}

/**
 * Count entries per group with descendant aggregation.
 *
 * The root counts every entry, while ungrouped counts entries with no valid
 * group id. These counts feed the `name (N)` labels in the tree.
 */
export function countEntriesByGroup(
  groups: readonly PasswordGroup[],
  entries: readonly { groupId?: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group.code, 0);
  counts.set(ROOT_GROUP_CODE, 0);
  counts.set(UNGROUPED_CODE, 0);

  const groupByCode = new Map(groups.map(group => [group.code, group]));
  for (const entry of entries) {
    counts.set(ROOT_GROUP_CODE, (counts.get(ROOT_GROUP_CODE) ?? 0) + 1);

    const resolved =
      entry.groupId && entry.groupId !== UNGROUPED_CODE && groupByCode.has(entry.groupId)
        ? entry.groupId
        : UNGROUPED_CODE;
    if (resolved === UNGROUPED_CODE) {
      counts.set(UNGROUPED_CODE, (counts.get(UNGROUPED_CODE) ?? 0) + 1);
      continue;
    }

    let current: PasswordGroup | undefined = groupByCode.get(resolved);
    const visited = new Set<string>();
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      counts.set(current.code, (counts.get(current.code) ?? 0) + 1);
      current = current.parentCode === ROOT_GROUP_CODE ? undefined : groupByCode.get(current.parentCode);
    }
  }

  return counts;
}

/**
 * Validate a group name against sibling-level constraints.
 *
 * The caller must exclude the group being renamed from `siblings`.
 */
export function validateGroupName(
  name: string,
  siblings: readonly PasswordGroup[],
): 'empty' | 'tooLong' | 'invalidChar' | 'duplicate' | null {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) return 'empty';
  if (normalizedName.length > MAX_GROUP_NAME_LENGTH) return 'tooLong';
  if (normalizedName.includes(GROUP_PATH_SEPARATOR)) return 'invalidChar';
  if (siblings.some(group => group.name === normalizedName)) return 'duplicate';
  return null;
}
