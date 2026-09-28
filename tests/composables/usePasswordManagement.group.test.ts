import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { PasswordEntryWithUI, PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

let localStore: Record<string, unknown>;
const jsonRoundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

beforeEach(() => {
  localStore = {};
  vi.stubGlobal('ElMessage', {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in localStore) out[k] = localStore[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) localStore[k] = jsonRoundTrip(v);
        }),
        remove: vi.fn(async () => {}),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn(async () => {}) },
  });
});

afterEach(() => vi.unstubAllGlobals());

import { usePasswordManagement } from '@/composables/usePasswordManagement';

const GROUPS: PasswordGroup[] = [
  { code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 },
  { code: 'projA', name: '项目A', parentCode: 'work', order: 0 },
  { code: 'life', name: '生活', parentCode: ROOT_GROUP_CODE, order: 1 },
];

/** 建立带预置数据的 composable 实例（直接注入 passwords，绕过解密加载） */
async function setup(entries: ReturnType<typeof makePasswordEntry>[], groups = GROUPS) {
  localStore[STORAGE_KEYS.PASSWORD_GROUPS] = jsonRoundTrip(groups);
  const composable = usePasswordManagement({ validityForm: ref({ validityHours: 24 }) });
  composable.passwords.value = entries;
  composable.groups.value = groups;
  await nextTick();
  return composable;
}

describe('分组过滤联动', () => {
  const entries = [
    makePasswordEntry({ id: '1', username: 'a', groupId: 'work' }),
    makePasswordEntry({ id: '2', username: 'b', groupId: 'projA' }),
    makePasswordEntry({ id: '3', username: 'c', groupId: 'life' }),
    makePasswordEntry({ id: '4', username: 'd' }),
  ];

  it('默认选中根节点时不过滤（全库）', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    expect(selectedGroupCode.value).toBe(ROOT_GROUP_CODE);
    expect(filteredPasswords.value.map(p => p.id).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('选中父分组时聚合本级 + 子孙条目', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    selectedGroupCode.value = 'work';
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id).sort()).toEqual(['1', '2']);
  });

  it('选中叶子分组时只含该分组条目', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    selectedGroupCode.value = 'projA';
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id)).toEqual(['2']);
  });

  it('选中未分组时只含无有效 groupId 的条目', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup(entries);
    selectedGroupCode.value = UNGROUPED_CODE;
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id)).toEqual(['4']);
  });

  it('指向已删除分组的条目归入未分组', async () => {
    const { filteredPasswords, selectedGroupCode } = await setup([
      makePasswordEntry({ id: '9', groupId: 'deleted-group' }),
    ]);
    selectedGroupCode.value = UNGROUPED_CODE;
    await nextTick();
    expect(filteredPasswords.value.map(p => p.id)).toEqual(['9']);
  });

  it('切换分组时清空选中并回到第 1 页', async () => {
    const { selectedGroupCode, selectedIds, currentPage } = await setup(entries);
    selectedIds.value = ['1', '2'];
    currentPage.value = 3;
    selectedGroupCode.value = 'life';
    await nextTick();
    expect(selectedIds.value).toEqual([]);
    expect(currentPage.value).toBe(1);
  });
});

describe('groupPath 注入', () => {
  it('每行注入 / 拼接的全路径，未分组为空串', async () => {
    const { filteredPasswords } = await setup([
      makePasswordEntry({ id: '1', groupId: 'projA' }),
      makePasswordEntry({ id: '2', groupId: 'life' }),
      makePasswordEntry({ id: '3' }),
    ]);
    const byId = Object.fromEntries(filteredPasswords.value.map(p => [p.id, p.groupPath]));
    expect(byId['1']).toBe('工作/项目A');
    expect(byId['2']).toBe('生活');
    expect(byId['3']).toBe('');
  });

  it('pagedPasswords 携带 groupPath', async () => {
    const { pagedPasswords } = await setup([makePasswordEntry({ id: '1', groupId: 'work' })]);
    expect(pagedPasswords.value[0].groupPath).toBe('工作');
  });

  it('过滤结果保留源条目引用，密码显隐仍然响应式', async () => {
    const source = makePasswordEntry({ id: '1', groupId: 'work' });
    const composable = await setup([source]);
    const { filteredPasswords, togglePasswordVisibility } = composable;

    const row = filteredPasswords.value[0];
    expect(row).toBe(composable.passwords.value[0]);
    togglePasswordVisibility(row);
    await nextTick();

    expect((composable.passwords.value[0] as PasswordEntryWithUI).showPassword).toBe(true);
  });
});

describe('分组树派生数据', () => {
  it('groupTree 含虚拟根与未分组', async () => {
    const { groupTree } = await setup([]);
    expect(groupTree.value).toHaveLength(1);
    expect(groupTree.value[0].code).toBe(ROOT_GROUP_CODE);
    expect(groupTree.value[0].children.map(c => c.code)).toEqual(['work', 'life', UNGROUPED_CODE]);
  });

  it('groupEntryCounts 聚合子孙计数', async () => {
    const { groupEntryCounts } = await setup([
      makePasswordEntry({ id: '1', groupId: 'projA' }),
      makePasswordEntry({ id: '2', groupId: 'work' }),
      makePasswordEntry({ id: '3' }),
    ]);
    expect(groupEntryCounts.value.get('work')).toBe(2);
    expect(groupEntryCounts.value.get('projA')).toBe(1);
    expect(groupEntryCounts.value.get(UNGROUPED_CODE)).toBe(1);
    expect(groupEntryCounts.value.get(ROOT_GROUP_CODE)).toBe(3);
  });
});

describe('分组状态可靠性', () => {
  it('当前分组被移除后自动回到根节点，列表不会被过滤为空', async () => {
    const entries = [makePasswordEntry({ id: '1', groupId: 'work' }), makePasswordEntry({ id: '2', groupId: 'life' })];
    const composable = await setup(entries);
    composable.selectedGroupCode.value = 'work';
    await nextTick();

    composable.groups.value = GROUPS.filter(group => group.code !== 'work');
    await nextTick();

    expect(composable.selectedGroupCode.value).toBe(ROOT_GROUP_CODE);
    expect(composable.filteredPasswords.value.map(entry => entry.id).sort()).toEqual(['1', '2']);
  });

  it('移动到有效分组时保留更新时间并同步本地状态', async () => {
    const entry = makePasswordEntry({ id: '1', groupId: 'work', updateTime: 123 });
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(entry)];
    const composable = await setup([entry]);

    const moved = await composable.moveEntriesToGroup(['1'], 'life');

    expect(moved).toBe(true);
    expect(composable.passwords.value[0].groupId).toBe('life');
    const stored = localStore[STORAGE_KEYS.PASSWORDS] as Array<Record<string, unknown>>;
    expect(stored[0].groupId).toBe('life');
    expect(stored[0].updateTime).toBe(123);
  });

  it('移动到不存在分组时拒绝写入并保留原状态', async () => {
    const entry = makePasswordEntry({ id: '1', groupId: 'work', updateTime: 123 });
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(entry)];
    const composable = await setup([entry]);
    const setMock = vi.mocked(chrome.storage.local.set);
    setMock.mockClear();

    const moved = await composable.moveEntriesToGroup(['1'], 'missing-group');

    expect(moved).toBe(false);
    expect(setMock).not.toHaveBeenCalled();
    expect(composable.passwords.value[0].groupId).toBe('work');
  });

  it('目标分组已被其他标签页删除时，写入前复核存储并拒绝', async () => {
    const entry = makePasswordEntry({ id: '1', groupId: 'work', updateTime: 123 });
    localStore[STORAGE_KEYS.PASSWORDS] = [jsonRoundTrip(entry)];
    const composable = await setup([entry]);
    localStore[STORAGE_KEYS.PASSWORD_GROUPS] = jsonRoundTrip(GROUPS.filter(group => group.code !== 'life'));
    const setMock = vi.mocked(chrome.storage.local.set);
    setMock.mockClear();

    const moved = await composable.moveEntriesToGroup(['1'], 'life');

    expect(moved).toBe(false);
    expect(setMock).not.toHaveBeenCalled();
    expect(composable.passwords.value[0].groupId).toBe('work');
  });

  it('删除分组失败时返回 false，调用方可保留确认对话框', async () => {
    const composable = await setup([makePasswordEntry({ id: '1', groupId: 'life' })]);
    const setMock = vi.mocked(chrome.storage.local.set);
    setMock.mockRejectedValueOnce(new Error('storage failed'));

    await expect(composable.deleteGroup('life', 'toUngrouped')).resolves.toBe(false);
  });
});
