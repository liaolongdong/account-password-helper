/**
 * Options 列表多列排序测试（usePasswordManagement）
 *
 * 锁定契约：
 * 1. 列点击循环：不在链中 → 追加升序；升序 → 降序；降序 → 移除该列；
 * 2. 连点不同列按点击顺序叠加成排序链（先点为主排序）；
 * 3. 点击已在链中的列只改方向/存在性，不改变其优先级位置；
 * 4. removeSortCriterion 单独移除某一列；clearSortChain 清空回退默认；
 * 5. 排序链持久化到 storage，并从 storage 恢复；
 * 6. 旧单列配置（password_sort_config）自动迁移为长度 1 的排序链。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/** 排空微任务与 fakeBrowser 存储 Promise 链，让创建时发起的排序链异步加载落定 */
const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

/** 构造 n 条仅 id/username 不同的条目 */
function makeEntries(n: number) {
  return Array.from({ length: n }, (_, i) => makePasswordEntry({ id: `id-${i}`, username: `user-${i}`, order: i }));
}

describe('usePasswordManagement 多列排序', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(async () => {
    // 清除持久化排序链与旧单列键，确保每个用例从空链（默认排序）起算
    await chrome.storage.local.remove([STORAGE_KEYS.OPTIONS_SORT_CHAIN, STORAGE_KEYS.SORT_CONFIG]);
    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await flushAsync();
  });

  afterEach(() => {
    scope.stop();
  });

  it('首次点击列追加为升序', () => {
    mgmt.handleColumnSort('username');
    expect(mgmt.sortChain.value).toEqual([{ prop: 'username', order: 'ascending' }]);
  });

  it('再次点击同列由升序转降序', () => {
    mgmt.handleColumnSort('username');
    mgmt.handleColumnSort('username');
    expect(mgmt.sortChain.value).toEqual([{ prop: 'username', order: 'descending' }]);
  });

  it('第三次点击同列从链中移除（升 → 降 → 移除）', () => {
    mgmt.handleColumnSort('username');
    mgmt.handleColumnSort('username');
    mgmt.handleColumnSort('username');
    expect(mgmt.sortChain.value).toEqual([]);
  });

  it('连点不同列按点击顺序叠加，先点为主排序', () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('createTime');
    expect(mgmt.sortChain.value).toEqual([
      { prop: 'tag', order: 'ascending' },
      { prop: 'createTime', order: 'ascending' },
    ]);
  });

  it('点击已在链中的列只改方向，不改变优先级位置', () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('createTime');
    // 二次点击首位 tag → 转降序，仍在第一位
    mgmt.handleColumnSort('tag');
    expect(mgmt.sortChain.value).toEqual([
      { prop: 'tag', order: 'descending' },
      { prop: 'createTime', order: 'ascending' },
    ]);
  });

  it('removeSortCriterion 单独移除指定列', () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('createTime');
    mgmt.removeSortCriterion('tag');
    expect(mgmt.sortChain.value).toEqual([{ prop: 'createTime', order: 'ascending' }]);
  });

  it('clearSortChain 清空回退默认排序', () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('createTime');
    mgmt.clearSortChain();
    expect(mgmt.sortChain.value).toEqual([]);
  });

  it('moveSortCriterion 拖拽调整优先级顺序', () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('createTime');
    mgmt.handleColumnSort('username');
    // 把末位 username（下标 2）拖到首位
    mgmt.moveSortCriterion(2, 0);
    expect(mgmt.sortChain.value.map(c => c.prop)).toEqual(['username', 'tag', 'createTime']);
  });

  it('moveSortCriterion 中间项前移保持其余相对顺序', () => {
    mgmt.handleColumnSort('a');
    mgmt.handleColumnSort('b');
    mgmt.handleColumnSort('c');
    // b（下标 1）移到 c 之后（下标 2）
    mgmt.moveSortCriterion(1, 2);
    expect(mgmt.sortChain.value.map(c => c.prop)).toEqual(['a', 'c', 'b']);
  });

  it('moveSortCriterion 越界或同位时忽略', () => {
    mgmt.handleColumnSort('a');
    mgmt.handleColumnSort('b');
    mgmt.moveSortCriterion(0, 0);
    mgmt.moveSortCriterion(0, 5);
    mgmt.moveSortCriterion(-1, 1);
    expect(mgmt.sortChain.value.map(c => c.prop)).toEqual(['a', 'b']);
  });

  it('moveSortCriterion 持久化新顺序', async () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('username');
    mgmt.moveSortCriterion(1, 0);
    await flushAsync();

    const stored = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS_SORT_CHAIN);
    const chain = stored[STORAGE_KEYS.OPTIONS_SORT_CHAIN] as Array<{ prop: string }>;
    expect(chain.map(c => c.prop)).toEqual(['username', 'tag']);
  });

  it('排序链持久化到 storage', async () => {
    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('username');
    await flushAsync();

    const stored = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS_SORT_CHAIN);
    expect(stored[STORAGE_KEYS.OPTIONS_SORT_CHAIN]).toEqual([
      { prop: 'tag', order: 'ascending' },
      { prop: 'username', order: 'ascending' },
    ]);
  });

  it('从 storage 恢复用户排序链偏好', async () => {
    await StorageUtils.saveOptionsSortChain([
      { prop: 'tag', order: 'descending' },
      { prop: 'createTime', order: 'ascending' },
    ]);
    await flushAsync();

    const scope2 = effectScope();
    const mgmt2 = scope2.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await flushAsync();

    expect(mgmt2.sortChain.value).toEqual([
      { prop: 'tag', order: 'descending' },
      { prop: 'createTime', order: 'ascending' },
    ]);
    scope2.stop();
  });

  it('旧单列配置自动迁移为长度 1 的排序链', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.SORT_CONFIG]: { prop: 'username', order: 'ascending' } });
    await flushAsync();

    const scope2 = effectScope();
    const mgmt2 = scope2.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await flushAsync();

    expect(mgmt2.sortChain.value).toEqual([{ prop: 'username', order: 'ascending' }]);
    scope2.stop();
  });

  it('旧单列配置 order 为 null 时迁移为空链（默认排序）', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.SORT_CONFIG]: { prop: 'username', order: null } });
    await flushAsync();

    const scope2 = effectScope();
    const mgmt2 = scope2.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await flushAsync();

    expect(mgmt2.sortChain.value).toEqual([]);
    scope2.stop();
  });

  it('排序链变化时回到第一页', async () => {
    mgmt.passwords.value = makeEntries(200);
    await nextTick();
    mgmt.currentPage.value = 3;
    await nextTick();
    expect(mgmt.currentPage.value).toBe(3);

    mgmt.handleColumnSort('username');
    await nextTick();
    expect(mgmt.currentPage.value).toBe(1);
  });

  it('filteredPasswords 按排序链顺序重排（先主键后次键）', async () => {
    mgmt.passwords.value = [
      makePasswordEntry({ id: '1', tag: 'b', username: 'x' }),
      makePasswordEntry({ id: '2', tag: 'a', username: 'z' }),
      makePasswordEntry({ id: '3', tag: 'a', username: 'y' }),
    ];
    await nextTick();

    mgmt.handleColumnSort('tag');
    mgmt.handleColumnSort('username');
    await nextTick();

    expect(mgmt.filteredPasswords.value.map(e => e.id)).toEqual(['3', '2', '1']);
  });
});
