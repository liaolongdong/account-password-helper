import { describe, expect, it } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import {
  ENTRY_DRAG_MIME,
  GROUP_PATH_SEPARATOR,
  MAX_GROUP_NAME_LENGTH,
  buildTree,
  countEntriesByGroup,
  ensureGroupByPath,
  filterGroupsByKeyword,
  getDescendantCodes,
  getGroupPath,
  resolveEntryGroupId,
  validateGroupName,
} from '@/utils/groupTree';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';

const makeGroup = (code: string, name: string, parentCode: string, order = 0): PasswordGroup => ({
  code,
  name,
  parentCode,
  order,
});

const GROUPS: PasswordGroup[] = [
  makeGroup('work', 'Work', ROOT_GROUP_CODE, 0),
  makeGroup('life', 'Life', ROOT_GROUP_CODE, 1),
  makeGroup('projA', 'Project A', 'work', 0),
  makeGroup('projB', 'Project B', 'work', 1),
  makeGroup('fe', 'Frontend', 'projA', 0),
];

function flattenTree(nodes: ReturnType<typeof buildTree>): ReturnType<typeof buildTree> {
  const result: ReturnType<typeof buildTree> = [];
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    result.push(node);
    stack.push(...node.children);
  }

  return result;
}

describe('group tree constants', () => {
  it('exports the path, name-length, and drag MIME contracts', () => {
    expect(GROUP_PATH_SEPARATOR).toBe('/');
    expect(MAX_GROUP_NAME_LENGTH).toBe(30);
    expect(ENTRY_DRAG_MIME).toBe('application/x-aph-entry-ids');
  });
});

describe('buildTree', () => {
  it('returns one root, sorts top-level groups, and keeps ungrouped last', () => {
    const tree = buildTree(GROUPS);

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.code).toBe(ROOT_GROUP_CODE);
    expect(root.isVirtual).toBe(true);
    expect(root.children.map(child => child.code)).toEqual(['work', 'life', UNGROUPED_CODE]);
  });

  it('builds nested levels correctly', () => {
    const root = buildTree(GROUPS)[0];
    const work = root.children.find(child => child.code === 'work')!;

    expect(work.children.map(child => child.code)).toEqual(['projA', 'projB']);
    expect(work.children.find(child => child.code === 'projA')!.children.map(child => child.code)).toEqual(['fe']);
  });

  it('sorts out-of-order siblings by their order value', () => {
    const shuffled = [GROUPS[1], GROUPS[4], GROUPS[0], GROUPS[3], GROUPS[2]];

    const root = buildTree(shuffled)[0];
    const work = root.children.find(child => child.code === 'work')!;

    expect(root.children.map(child => child.code)).toEqual(['work', 'life', UNGROUPED_CODE]);
    expect(work.children.map(child => child.code)).toEqual(['projA', 'projB']);
  });

  it('does not mutate the input array or group objects', () => {
    const before = GROUPS.map(group => ({ ...group }));

    buildTree(GROUPS);

    expect(GROUPS).toEqual(before);
  });

  it('marks ungrouped as virtual and gives it no children', () => {
    const ungrouped = buildTree(GROUPS)[0].children.find(child => child.code === UNGROUPED_CODE)!;

    expect(ungrouped.isVirtual).toBe(true);
    expect(ungrouped.children).toEqual([]);
  });

  it('attaches orphaned nodes to the root instead of dropping them', () => {
    const tree = buildTree([makeGroup('orphan', 'Orphan', 'deleted-parent')]);

    expect(tree[0].children.map(child => child.code)).toContain('orphan');
  });

  it('keeps every node visible when parent codes form a cycle', () => {
    const tree = buildTree([makeGroup('a', 'A', 'b', 0), makeGroup('b', 'B', 'a', 1)]);

    expect(tree[0].children.map(child => child.code)).toEqual(['a', 'b', UNGROUPED_CODE]);
    expect(tree[0].children.find(child => child.code === 'a')!.children).toEqual([]);
    expect(tree[0].children.find(child => child.code === 'b')!.children).toEqual([]);
  });

  it('ignores duplicate and reserved codes without creating cycles or repeats', () => {
    const tree = buildTree([
      makeGroup('a', 'Original', 'b', 0),
      makeGroup('a', 'Duplicate', ROOT_GROUP_CODE, 1),
      makeGroup('b', 'B', 'a', 2),
      makeGroup(ROOT_GROUP_CODE, 'Reserved root', ROOT_GROUP_CODE, 3),
      makeGroup(UNGROUPED_CODE, 'Reserved ungrouped', ROOT_GROUP_CODE, 4),
    ]);
    const flattened = flattenTree(tree);

    expect(flattened.map(node => node.code).sort()).toEqual([ROOT_GROUP_CODE, UNGROUPED_CODE, 'a', 'b'].sort());
    expect(flattened.find(node => node.code === 'a')!.name).toBe('Original');
  });

  it('builds a deep chain without recursive stack overflow', () => {
    const depth = 5000;
    const deepGroups = Array.from({ length: depth }, (_, index) =>
      makeGroup(`g${index}`, `Group ${index}`, index === 0 ? ROOT_GROUP_CODE : `g${index - 1}`),
    );

    const flattened = flattenTree(buildTree(deepGroups));

    expect(flattened.filter(node => node.code !== ROOT_GROUP_CODE && node.code !== UNGROUPED_CODE)).toHaveLength(depth);
  });

  it('still returns root plus ungrouped for an empty group list', () => {
    expect(buildTree([])[0].children.map(child => child.code)).toEqual([UNGROUPED_CODE]);
  });
});

describe('getGroupPath', () => {
  it('returns a full slash-separated path', () => {
    expect(getGroupPath('fe', GROUPS)).toBe('Work/Project A/Frontend');
  });

  it('returns the group name for a top-level group', () => {
    expect(getGroupPath('life', GROUPS)).toBe('Life');
  });

  it('returns an empty path for ungrouped, root, invalid, and undefined codes', () => {
    expect(getGroupPath(UNGROUPED_CODE, GROUPS)).toBe('');
    expect(getGroupPath(ROOT_GROUP_CODE, GROUPS)).toBe('');
    expect(getGroupPath('not-exist', GROUPS)).toBe('');
    expect(getGroupPath(undefined, GROUPS)).toBe('');
  });

  it('keeps the resolvable suffix when the parent chain is broken', () => {
    expect(getGroupPath('child', [makeGroup('child', 'Child', 'missing-parent')])).toBe('Child');
  });

  it('does not loop forever for cyclic data', () => {
    const cyclic = [makeGroup('a', 'A', 'b'), makeGroup('b', 'B', 'a')];

    expect(getGroupPath('a', cyclic)).toBeTypeOf('string');
  });
});

describe('getDescendantCodes', () => {
  it('returns the group itself and every descendant', () => {
    expect([...getDescendantCodes('work', GROUPS)].sort()).toEqual(['fe', 'projA', 'projB', 'work']);
  });

  it('returns only the leaf for a leaf group', () => {
    expect([...getDescendantCodes('fe', GROUPS)]).toEqual(['fe']);
  });

  it('returns only the ungrouped code for ungrouped', () => {
    expect([...getDescendantCodes(UNGROUPED_CODE, GROUPS)]).toEqual([UNGROUPED_CODE]);
  });

  it('returns an empty set for an invalid code', () => {
    expect(getDescendantCodes('nope', GROUPS).size).toBe(0);
  });
});

describe('filterGroupsByKeyword', () => {
  it('keeps matching nodes and their ancestor chain', () => {
    const kept = filterGroupsByKeyword(GROUPS, 'Frontend');

    expect([...kept].sort()).toEqual([ROOT_GROUP_CODE, UNGROUPED_CODE, 'fe', 'projA', 'work'].sort());
  });

  it('matches English group names case-insensitively', () => {
    expect(filterGroupsByKeyword([makeGroup('a', 'Work', ROOT_GROUP_CODE)], 'work').has('a')).toBe(true);
  });

  it('keeps every group when the keyword is empty', () => {
    const kept = filterGroupsByKeyword(GROUPS, '');

    for (const group of GROUPS) expect(kept.has(group.code)).toBe(true);
  });

  it('keeps only root and ungrouped when nothing matches', () => {
    const kept = filterGroupsByKeyword(GROUPS, 'zzz');

    expect(kept.has(ROOT_GROUP_CODE)).toBe(true);
    expect(kept.has(UNGROUPED_CODE)).toBe(true);
    expect(kept.has('work')).toBe(false);
  });
});

describe('resolveEntryGroupId', () => {
  it('returns a valid group id unchanged', () => {
    expect(resolveEntryGroupId('work', GROUPS)).toBe('work');
  });

  it('maps missing, empty, and deleted group ids to ungrouped', () => {
    expect(resolveEntryGroupId(undefined, GROUPS)).toBe(UNGROUPED_CODE);
    expect(resolveEntryGroupId('', GROUPS)).toBe(UNGROUPED_CODE);
    expect(resolveEntryGroupId('deleted', GROUPS)).toBe(UNGROUPED_CODE);
  });
});

describe('ensureGroupByPath', () => {
  it('creates each missing level for a new path', () => {
    const { code, created } = ensureGroupByPath('Work/Project A/Frontend', []);

    expect(created).toHaveLength(3);
    expect(created.map(group => group.name)).toEqual(['Work', 'Project A', 'Frontend']);
    expect(created[0].parentCode).toBe(ROOT_GROUP_CODE);
    expect(created[1].parentCode).toBe(created[0].code);
    expect(created[2].parentCode).toBe(created[1].code);
    expect(code).toBe(created[2].code);
  });

  it('reuses same-name siblings and creates only missing levels', () => {
    const { code, created } = ensureGroupByPath('Work/Project C', GROUPS);

    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('Project C');
    expect(created[0].parentCode).toBe('work');
    expect(code).toBe(created[0].code);
  });

  it('creates nothing when the full path already exists', () => {
    const { code, created } = ensureGroupByPath('Work/Project A/Frontend', GROUPS);

    expect(created).toEqual([]);
    expect(code).toBe('fe');
  });

  it('returns ungrouped without creating anything for an empty path', () => {
    const { code, created } = ensureGroupByPath('', GROUPS);

    expect(code).toBe(UNGROUPED_CODE);
    expect(created).toEqual([]);
  });

  it('ignores empty path segments and leading or trailing separators', () => {
    expect(ensureGroupByPath('/Work//Project A/', GROUPS).created).toEqual([]);
  });

  it('assigns a new group the next order among its siblings', () => {
    expect(ensureGroupByPath('New Group', GROUPS).created[0].order).toBe(2);
  });

  it('normalizes overlong path segments and reuses the normalized group', () => {
    const longName = 'a'.repeat(MAX_GROUP_NAME_LENGTH + 1);
    const firstImport = ensureGroupByPath(longName, []);
    const secondImport = ensureGroupByPath(longName, firstImport.created);

    expect(firstImport.created[0].name).toHaveLength(MAX_GROUP_NAME_LENGTH);
    expect(secondImport.created).toEqual([]);
    expect(secondImport.code).toBe(firstImport.code);
  });

  it('does not mutate the input array or group objects', () => {
    const before = GROUPS.map(group => ({ ...group }));

    ensureGroupByPath('New Group/Child', GROUPS);

    expect(GROUPS).toEqual(before);
  });

  it('handles a deep path without quadratic work or recursion', () => {
    const depth = 3000;
    const path = Array.from({ length: depth }, (_, index) => `G${index}`).join('/');

    const { created } = ensureGroupByPath(path, []);

    expect(created).toHaveLength(depth);
    expect(flattenTree(buildTree(created))).toHaveLength(depth + 2);
  });
});

describe('countEntriesByGroup', () => {
  const entries = [
    makePasswordEntry({ id: '1', groupId: 'fe' }),
    makePasswordEntry({ id: '2', groupId: 'projB' }),
    makePasswordEntry({ id: '3', groupId: 'work' }),
    makePasswordEntry({ id: '4' }),
    makePasswordEntry({ id: '5', groupId: 'deleted' }),
  ];

  it('counts direct entries for leaf groups', () => {
    const counts = countEntriesByGroup(GROUPS, entries);

    expect(counts.get('fe')).toBe(1);
    expect(counts.get('projB')).toBe(1);
  });

  it('aggregates descendant entries for parent groups', () => {
    const counts = countEntriesByGroup(GROUPS, entries);

    expect(counts.get('work')).toBe(3);
    expect(counts.get('projA')).toBe(1);
  });

  it('counts every entry for the root', () => {
    expect(countEntriesByGroup(GROUPS, entries).get(ROOT_GROUP_CODE)).toBe(5);
  });

  it('counts missing and invalid group ids as ungrouped', () => {
    expect(countEntriesByGroup(GROUPS, entries).get(UNGROUPED_CODE)).toBe(2);
  });

  it('returns zero counts for every group when there are no entries', () => {
    const counts = countEntriesByGroup(GROUPS, []);

    for (const group of GROUPS) expect(counts.get(group.code)).toBe(0);
    expect(counts.get(ROOT_GROUP_CODE)).toBe(0);
    expect(counts.get(UNGROUPED_CODE)).toBe(0);
  });
});

describe('validateGroupName', () => {
  it('returns empty for whitespace-only names', () => {
    expect(validateGroupName('   ', GROUPS)).toBe('empty');
  });

  it('returns tooLong for names over 30 characters', () => {
    expect(validateGroupName('a'.repeat(31), GROUPS)).toBe('tooLong');
  });

  it('accepts a name at the 30-character boundary', () => {
    expect(validateGroupName('a'.repeat(MAX_GROUP_NAME_LENGTH), GROUPS)).toBe(null);
  });

  it('returns invalidChar for names containing a slash', () => {
    expect(validateGroupName('Work/Child', GROUPS)).toBe('invalidChar');
  });

  it('returns duplicate for a same-level duplicate name', () => {
    expect(validateGroupName('Project A', [makeGroup('x', 'Project A', 'work')])).toBe('duplicate');
  });

  it('detects a duplicate after trimming surrounding whitespace', () => {
    expect(validateGroupName(' Project A ', [makeGroup('x', 'Project A', 'work')])).toBe('duplicate');
  });

  it('allows the same name when it is not among the target-level siblings', () => {
    const work = makeGroup('work', 'Work', ROOT_GROUP_CODE);
    const child = makeGroup('child', 'Project A', work.code);
    const targetLevelSiblings = [child];

    expect(validateGroupName(work.name, targetLevelSiblings)).toBe(null);
  });

  it('returns null for a valid name', () => {
    expect(validateGroupName('New Group', GROUPS)).toBe(null);
  });
});
