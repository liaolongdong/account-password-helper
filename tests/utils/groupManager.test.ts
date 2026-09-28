import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

let localStore: Record<string, unknown>;

const jsonRoundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const localGet = vi.fn(async (key: string | string[]) => {
  const keys = Array.isArray(key) ? key : [key];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in localStore) out[k] = localStore[k];
  return out;
});
const localSet = vi.fn(async (items: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(items)) localStore[key] = jsonRoundTrip(value);
});
const localRemove = vi.fn(async (key: string | string[]) => {
  for (const k of Array.isArray(key) ? key : [key]) delete localStore[k];
});

beforeEach(() => {
  localStore = {};
  localGet.mockClear();
  localSet.mockClear();
  localRemove.mockClear();
  vi.stubGlobal('chrome', {
    storage: { local: { get: localGet, set: localSet, remove: localRemove } },
  });
});

afterEach(() => vi.unstubAllGlobals());

import {
  createGroup,
  deleteGroup,
  getAllGroups,
  moveGroup,
  renameGroup,
  reorderGroups,
  saveGroups,
} from '@/utils/storage/groupManager';

const seed = (groups: PasswordGroup[]) => {
  localStore[STORAGE_KEYS.PASSWORD_GROUPS] = jsonRoundTrip(groups);
};
const seedPasswords = (entries: unknown[]) => {
  localStore[STORAGE_KEYS.PASSWORDS] = jsonRoundTrip(entries);
};
const readGroups = () => localStore[STORAGE_KEYS.PASSWORD_GROUPS] as PasswordGroup[];
const readPasswords = () => localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;

describe('getAllGroups', () => {
  it('无键时返回空数组', async () => {
    expect(await getAllGroups()).toEqual([]);
  });

  it('返回已存分组', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    expect(await getAllGroups()).toEqual([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
  });

  it('非数组脏数据降级为空数组', async () => {
    localStore[STORAGE_KEYS.PASSWORD_GROUPS] = 'corrupted';
    expect(await getAllGroups()).toEqual([]);
  });

  it('存储读取异常向上抛出，不降级为空数组', async () => {
    localGet.mockImplementationOnce(async () => {
      throw new Error('read failed');
    });
    await expect(getAllGroups()).rejects.toThrow('read failed');
  });

  it('过滤掉缺字段或 order 非法的脏项', async () => {
    localStore[STORAGE_KEYS.PASSWORD_GROUPS] = [
      { code: 'a' },
      null,
      { code: 'b', name: 'B' },
      { code: 'c', name: 'C', parentCode: ROOT_GROUP_CODE, order: Number.NaN },
      { code: 'd', name: 'D', parentCode: ROOT_GROUP_CODE, order: 0 },
    ];
    expect(await getAllGroups()).toEqual([{ code: 'd', name: 'D', parentCode: ROOT_GROUP_CODE, order: 0 }]);
  });
});

describe('createGroup', () => {
  it('在根下创建一级分组，order 取同级末尾', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    const created = await createGroup('B', ROOT_GROUP_CODE);
    expect(created.name).toBe('B');
    expect(created.parentCode).toBe(ROOT_GROUP_CODE);
    expect(created.order).toBe(1);
    expect(readGroups()).toHaveLength(2);
  });

  it('创建子分组挂在指定父级下', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    expect((await createGroup('A1', 'a')).parentCode).toBe('a');
  });

  it('名称自动 trim', async () => {
    seed([]);
    expect((await createGroup('  工作  ', ROOT_GROUP_CODE)).name).toBe('工作');
  });

  it('同级重名抛错', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await expect(createGroup('A', ROOT_GROUP_CODE)).rejects.toThrow('duplicate');
  });

  it('不同级同名允许', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await expect(createGroup('A', 'a')).resolves.toBeDefined();
  });

  it('空名 / 含斜杠 / 超长 分别抛对应错误', async () => {
    seed([]);
    await expect(createGroup('   ', ROOT_GROUP_CODE)).rejects.toThrow('empty');
    await expect(createGroup('a/b', ROOT_GROUP_CODE)).rejects.toThrow('invalidChar');
    await expect(createGroup('a'.repeat(31), ROOT_GROUP_CODE)).rejects.toThrow('tooLong');
  });

  it('不允许在未分组下建子分组', async () => {
    seed([]);
    await expect(createGroup('X', UNGROUPED_CODE)).rejects.toThrow('invalidParent');
  });

  it('不允许在未知父级下建子分组', async () => {
    seed([]);
    await expect(createGroup('X', 'missing')).rejects.toThrow('invalidParent');
  });
});

describe('renameGroup', () => {
  it('重命名成功', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await renameGroup('a', 'A2');
    expect(readGroups()[0].name).toBe('A2');
  });

  it('与其他同级重名抛错', async () => {
    seed([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'b', name: 'B', parentCode: ROOT_GROUP_CODE, order: 1 },
    ]);
    await expect(renameGroup('a', 'B')).rejects.toThrow('duplicate');
  });

  it('改回自身当前名称不报重名', async () => {
    seed([{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }]);
    await expect(renameGroup('a', 'A')).resolves.toBeUndefined();
  });

  it('不存在的 code 静默返回', async () => {
    seed([]);
    await expect(renameGroup('nope', 'X')).resolves.toBeUndefined();
  });

  it('拒绝重命名未分组虚拟节点', async () => {
    seed([]);
    await expect(renameGroup(UNGROUPED_CODE, 'X')).rejects.toThrow('invalidParent');
  });
});

describe('moveGroup', () => {
  const tree: PasswordGroup[] = [
    { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
    { code: 'b', name: 'B', parentCode: 'a', order: 0 },
    { code: 'c', name: 'C', parentCode: ROOT_GROUP_CODE, order: 1 },
  ];

  it('移动到另一父级下', async () => {
    seed(tree);
    await moveGroup('b', 'c');
    expect(readGroups().find(g => g.code === 'b')!.parentCode).toBe('c');
  });

  it('移动到根变为一级分组', async () => {
    seed(tree);
    await moveGroup('b', ROOT_GROUP_CODE);
    expect(readGroups().find(g => g.code === 'b')!.parentCode).toBe(ROOT_GROUP_CODE);
  });

  it('禁止移入自己的子孙或自身（防环）', async () => {
    seed(tree);
    await expect(moveGroup('a', 'b')).rejects.toThrow('cycle');
    await expect(moveGroup('a', 'a')).rejects.toThrow('cycle');
  });

  it('禁止移入未分组', async () => {
    seed(tree);
    await expect(moveGroup('a', UNGROUPED_CODE)).rejects.toThrow('invalidParent');
  });

  it('禁止移入不存在的父级', async () => {
    seed(tree);
    await expect(moveGroup('a', 'missing')).rejects.toThrow('invalidParent');
  });

  it('禁止移动到已有同名节点的层级', async () => {
    seed([
      { code: 'p', name: 'P', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'moving', name: 'X', parentCode: 'p', order: 0 },
      { code: 'q', name: 'Q', parentCode: ROOT_GROUP_CODE, order: 1 },
      { code: 'existing', name: 'X', parentCode: 'q', order: 0 },
    ]);

    await expect(moveGroup('moving', 'q')).rejects.toThrow('duplicate');
    expect(readGroups().find(group => group.code === 'moving')!.parentCode).toBe('p');
  });
});

describe('reorderGroups', () => {
  it('按给定顺序重写同级 order', async () => {
    seed([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'b', name: 'B', parentCode: ROOT_GROUP_CODE, order: 1 },
      { code: 'c', name: 'C', parentCode: ROOT_GROUP_CODE, order: 2 },
    ]);
    await reorderGroups(ROOT_GROUP_CODE, ['c', 'a', 'b']);
    const groups = readGroups();
    expect(groups.find(g => g.code === 'c')!.order).toBe(0);
    expect(groups.find(g => g.code === 'a')!.order).toBe(1);
    expect(groups.find(g => g.code === 'b')!.order).toBe(2);
  });

  it('不影响其他层级的 order', async () => {
    seed([
      { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
      { code: 'a1', name: 'A1', parentCode: 'a', order: 5 },
    ]);
    await reorderGroups(ROOT_GROUP_CODE, ['a']);
    expect(readGroups().find(g => g.code === 'a1')!.order).toBe(5);
  });
});

describe('deleteGroup', () => {
  const tree: PasswordGroup[] = [
    { code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 },
    { code: 'a1', name: 'A1', parentCode: 'a', order: 0 },
    { code: 'b', name: 'B', parentCode: ROOT_GROUP_CODE, order: 1 },
  ];

  it('toUngrouped：级联删分组，条目 groupId 被清空', async () => {
    seed(tree);
    seedPasswords([
      makePasswordEntry({ id: '1', groupId: 'a', updateTime: 111 }),
      makePasswordEntry({ id: '2', groupId: 'a1' }),
      makePasswordEntry({ id: '3', groupId: 'b' }),
    ]);
    await deleteGroup('a', 'toUngrouped');

    expect(readGroups().map(g => g.code)).toEqual(['b']);
    const passwords = readPasswords();
    expect('groupId' in passwords[0]).toBe(false);
    expect(passwords[0].updateTime).toBe(111);
    expect('groupId' in passwords[1]).toBe(false);
    expect(passwords[2].groupId).toBe('b');
  });

  it('toUngrouped 对加密条目仍走轻量元数据路径', async () => {
    seed(tree);
    seedPasswords([
      {
        ...makePasswordEntry({ id: '1', groupId: 'a' }),
        encrypted: true,
        username: 'cipher-user',
        password: 'cipher-pass',
      },
    ]);

    await expect(deleteGroup('a', 'toUngrouped')).resolves.toBeUndefined();
    const [entry] = readPasswords();
    expect('groupId' in entry).toBe(false);
    expect(entry.password).toBe('cipher-pass');
  });

  it('toTrash：级联删分组，条目移入回收站', async () => {
    seed(tree);
    seedPasswords([
      makePasswordEntry({ id: '1', groupId: 'a' }),
      makePasswordEntry({ id: '2', groupId: 'a1' }),
      makePasswordEntry({ id: '3', groupId: 'b' }),
    ]);
    await deleteGroup('a', 'toTrash');

    expect(readGroups().map(g => g.code)).toEqual(['b']);
    expect(readPasswords().map(p => p.id)).toEqual(['3']);
    const trash = localStore[STORAGE_KEYS.TRASH] as Array<Record<string, unknown>>;
    expect(trash.map(e => e.id).sort()).toEqual(['1', '2']);
    expect(trash[0].deletedAt).toBeTypeOf('number');
  });

  it('toUngrouped 与分组删除在同一次落盘失败时都不生效', async () => {
    seed(tree);
    seedPasswords([makePasswordEntry({ id: '1', groupId: 'a', updateTime: 111 })]);
    localSet.mockImplementationOnce(async () => {
      throw new Error('write failed');
    });

    await expect(deleteGroup('a', 'toUngrouped')).rejects.toThrow('write failed');
    expect(readGroups().map(group => group.code)).toEqual(['a', 'a1', 'b']);
    expect(readPasswords()[0].groupId).toBe('a');
  });

  it('toTrash 与分组删除在同一次落盘失败时都不生效', async () => {
    seed(tree);
    seedPasswords([makePasswordEntry({ id: '1', groupId: 'a' })]);
    localSet.mockImplementationOnce(async () => {
      throw new Error('write failed');
    });

    await expect(deleteGroup('a', 'toTrash')).rejects.toThrow('write failed');
    expect(readGroups().map(group => group.code)).toEqual(['a', 'a1', 'b']);
    expect(readPasswords()[0].id).toBe('1');
    expect(localStore[STORAGE_KEYS.TRASH]).toBeUndefined();
  });

  it('空分组直接删除，不触碰条目', async () => {
    seed(tree);
    seedPasswords([makePasswordEntry({ id: '3', groupId: 'a1' })]);
    await deleteGroup('b', 'toUngrouped');
    expect(
      readGroups()
        .map(g => g.code)
        .sort(),
    ).toEqual(['a', 'a1']);
    expect(readPasswords()[0].groupId).toBe('a1');
  });

  it('拒绝删除虚拟节点', async () => {
    seed(tree);
    await expect(deleteGroup(ROOT_GROUP_CODE, 'toUngrouped')).rejects.toThrow('virtual');
    await expect(deleteGroup(UNGROUPED_CODE, 'toUngrouped')).rejects.toThrow('virtual');
  });

  it('不存在的 code 静默返回', async () => {
    seed(tree);
    await expect(deleteGroup('nope', 'toUngrouped')).resolves.toBeUndefined();
  });
});

describe('saveGroups', () => {
  it('整体写回', async () => {
    const groups: PasswordGroup[] = [{ code: 'a', name: 'A', parentCode: ROOT_GROUP_CODE, order: 0 }];
    await saveGroups(groups);
    expect(readGroups()).toEqual(groups);
  });

  it('写入异常向上抛出', async () => {
    localSet.mockImplementationOnce(async () => {
      throw new Error('write failed');
    });

    await expect(saveGroups([])).rejects.toThrow('write failed');
  });
});
