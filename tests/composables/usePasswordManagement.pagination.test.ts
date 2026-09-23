/**
 * Options 列表分页测试（usePasswordManagement）
 *
 * 背景：导入数百条后 el-table 全量渲染导致整页卡顿（每行约 12 个 tooltip 实例，
 * 任意变更触发整表重建）。分页把表格渲染成本从 O(全部条目) 降到 O(pageSize)。
 *
 * 锁定契约：
 * 1. 表格数据源 pagedPasswords 只渲染当前页，不超过 pageSize 条；
 * 2. 页码切换取到正确的切片窗口（以 filteredPasswords 为基准，不依赖具体排序）；
 * 3. 结果集变短使当前页越界时收敛到最后一页，不出现空白页；
 * 4. 过滤条件变化时回到第一页；
 * 5. 翻页后剔除不在当前页的选中 id，避免批量操作误删不可见条目；
 * 6. 自定义每页条数：切换后保持视口位置（首条不换页）并持久化到 storage。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { DEFAULT_OPTIONS_PAGE_SIZE } from '@/utils/storage/configManager';
import { StorageUtils } from '@/utils/storage';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/** 默认每页条数（空存储下异步加载落定的值） */
const PAGE_SIZE = DEFAULT_OPTIONS_PAGE_SIZE;

/** 排空微任务与 fakeBrowser 存储 Promise 链，让创建时发起的 pageSize 异步加载落定 */
const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

/** 构造 n 条仅 id/username 不同的条目 */
function makeEntries(n: number) {
  return Array.from({ length: n }, (_, i) => makePasswordEntry({ id: `id-${i}`, username: `user-${i}`, order: i }));
}

describe('usePasswordManagement 列表分页', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(async () => {
    // fakeBrowser storage 在同文件内跨用例累积：先清除持久化的每页条数，
    // 确保每个用例新建 composable 时异步加载都从默认档位起算（隔离「持久化」用例的写入）
    await chrome.storage.local.remove(STORAGE_KEYS.OPTIONS_PAGE_SIZE);
    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    // 等待创建时发起的每页条数异步加载落定（空存储 → 默认值），避免迟到回调覆盖用例设置
    await flushAsync();
  });

  afterEach(() => {
    scope.stop();
  });

  it('数据源只渲染当前页，条数不超过 pageSize', () => {
    mgmt.passwords.value = makeEntries(PAGE_SIZE * 2 + 10);

    expect(mgmt.filteredPasswords.value.length).toBe(PAGE_SIZE * 2 + 10);
    expect(mgmt.pagedPasswords.value.length).toBe(PAGE_SIZE);
  });

  it('切换页码取到正确的切片窗口', () => {
    mgmt.passwords.value = makeEntries(PAGE_SIZE * 2 + 10);
    const all = mgmt.filteredPasswords.value;

    // 第一页
    expect(mgmt.pagedPasswords.value).toEqual(all.slice(0, PAGE_SIZE));

    // 第二页
    mgmt.currentPage.value = 2;
    expect(mgmt.pagedPasswords.value).toEqual(all.slice(PAGE_SIZE, PAGE_SIZE * 2));

    // 最后一页（余数页）
    mgmt.currentPage.value = 3;
    expect(mgmt.pagedPasswords.value).toEqual(all.slice(PAGE_SIZE * 2));
  });

  it('结果集变短使当前页越界时收敛到最后一页', async () => {
    mgmt.passwords.value = makeEntries(PAGE_SIZE * 3);
    mgmt.currentPage.value = 3;
    await nextTick();

    // 收缩到只剩一页多一点（maxPage = 2）
    mgmt.passwords.value = makeEntries(PAGE_SIZE + 5);
    await nextTick();

    expect(mgmt.currentPage.value).toBe(2);
    expect(mgmt.pagedPasswords.value.length).toBe(5);
  });

  it('过滤条件变化时回到第一页', async () => {
    mgmt.passwords.value = makeEntries(PAGE_SIZE * 3);
    mgmt.currentPage.value = 3;
    await nextTick();
    expect(mgmt.currentPage.value).toBe(3);

    // 收藏过滤属于结果集语义变化，应回到第一页
    mgmt.favoriteOnly.value = true;
    await nextTick();
    expect(mgmt.currentPage.value).toBe(1);
  });

  it('翻页后剔除已不可见的旧页选中项', async () => {
    mgmt.passwords.value = makeEntries(PAGE_SIZE * 2);
    await nextTick();
    const all = mgmt.filteredPasswords.value;
    const pageOneId = all[0].id;

    // 模拟用户在第一页勾选一条（handleSelectionChange 只会写入可见行）
    mgmt.selectedIds.value = [pageOneId];
    await nextTick();
    expect(mgmt.selectedIds.value).toEqual([pageOneId]);

    // 翻到第二页：第一页的勾选项不再可见（el-table 视觉选中态同样随 DOM 销毁而丢失），
    // 必须从 selectedIds 剔除，否则「批量删除」会误删不可见条目
    mgmt.currentPage.value = 2;
    await nextTick();
    expect(mgmt.selectedIds.value).toEqual([]);
  });

  it('未超过一页时不产生多余分页窗口', () => {
    mgmt.passwords.value = makeEntries(PAGE_SIZE - 5);
    expect(mgmt.pagedPasswords.value.length).toBe(PAGE_SIZE - 5);
    expect(mgmt.currentPage.value).toBe(1);
  });

  describe('自定义每页条数', () => {
    it('切换档位后每页渲染条数随之变化', async () => {
      mgmt.passwords.value = makeEntries(100);
      await nextTick();
      expect(mgmt.pagedPasswords.value.length).toBe(PAGE_SIZE);

      mgmt.handlePageSizeChange(20);
      await nextTick();
      expect(mgmt.pageSize.value).toBe(20);
      expect(mgmt.pagedPasswords.value.length).toBe(20);
    });

    it('切换档位保持视口位置（当前页首条不换页）', async () => {
      mgmt.passwords.value = makeEntries(200);
      await nextTick();

      // 默认 50/页，翻到第 2 页 → 首条为全量索引 50
      mgmt.currentPage.value = 2;
      await nextTick();
      const firstBefore = mgmt.pagedPasswords.value[0];

      // 切到 20/页：索引 50 落在第 3 页（floor(50/20)+1=3，覆盖索引 40~59）
      // 视口保持的契约是「原首条仍可见、不被换页甩掉」，而非「仍是新页首行」
      // （50 不是 20 的整数倍，新页首行只能是索引 40）
      mgmt.handlePageSizeChange(20);
      await nextTick();
      expect(mgmt.currentPage.value).toBe(3);
      expect(mgmt.pagedPasswords.value.some(p => p.id === firstBefore.id)).toBe(true);
    });

    it('切换档位持久化到 storage', async () => {
      mgmt.passwords.value = makeEntries(100);
      await nextTick();

      mgmt.handlePageSizeChange(100);
      await flushAsync();

      const stored = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS_PAGE_SIZE);
      expect(stored[STORAGE_KEYS.OPTIONS_PAGE_SIZE]).toBe(100);
    });

    it('页大小变化使当前页越界时收敛到最后一页', async () => {
      mgmt.passwords.value = makeEntries(60);
      await nextTick();
      // 默认 50/页 → 第 2 页有 10 条
      mgmt.currentPage.value = 2;
      await nextTick();
      expect(mgmt.currentPage.value).toBe(2);

      // 切到 100/页 → 只有 1 页，第 2 页越界应收敛到 1
      mgmt.handlePageSizeChange(100);
      await nextTick();
      expect(mgmt.currentPage.value).toBe(1);
      expect(mgmt.pagedPasswords.value.length).toBe(60);
    });

    it('从 storage 恢复用户偏好的每页条数', async () => {
      await StorageUtils.setOptionsPageSize(20);
      await flushAsync();

      // 新建 composable 模拟页面重新加载：异步读取应把 pageSize 恢复为 20
      const scope2 = effectScope();
      const mgmt2 = scope2.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
      await flushAsync();

      expect(mgmt2.pageSize.value).toBe(20);
      scope2.stop();
    });
  });
});
