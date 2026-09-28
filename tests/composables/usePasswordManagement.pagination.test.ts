/** @vitest-environment jsdom */

/**
 * 管理页分页接线回归测试（usePasswordManagement）
 *
 * 分页本身由 `useVaultListPagination` 负责（那里断言切片与钳位）；这里只钉住**接线**：
 * 表格吃的是当前页、命中读数用的仍是全集、跨页选中能被如实计数、「保存/创建副本后定位到目标行」
 * 这条链路会先把用户带到目标所在页，以及定位高亮的时长与清理时序。
 *
 * 五条各自对应一个真实故障形状：
 * 1. `:data` 误接 `filteredPasswords` → 分页形同不存在，2000 条照样整表卡死；
 * 2. 复位信号接在整条列表上 → 每删一条就被弹回第 1 页，无法连续清理同一页；
 * 3. 只报「已选 N 条」而不报差额 → 用户以为跨页勾选丢了；
 * 4. 定位不换页 → 副本落在第 1 页，而用户停在第 3 页，表现为「复制了但没看到」；
 * 5. 高亮定时器不受控 → 改动时长无人发现，或作用域销毁后回调仍回来动已卸载的行。
 */
import { beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { usePasswordManagement, ROW_HIGHLIGHT_MS } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';

/** 造一条最小可用条目：`updateTime` 递增，默认排序（更新时间降序）下即 r{n}…r1 */
const makeEntry = (index: number, patch: Partial<PasswordEntry> = {}): PasswordEntry => ({
  id: `r${index}`,
  username: index > 100 ? `ux${index}` : `u${index}`,
  password: 'p',
  url: '',
  tag: '',
  remark: '',
  totp: '',
  createTime: 1_000_000 + index,
  updateTime: 1_000_000 + index,
  order: index,
  ...patch,
});

const makeList = (n: number): PasswordEntry[] => Array.from({ length: n }, (_, i) => makeEntry(i + 1));

/** jsdom 未实现 `scrollIntoView`（`Element.prototype` 上根本没有这个方法，故不能用 `vi.spyOn`） */
Element.prototype.scrollIntoView = (): void => {};

/**
 * 挂一行可定位的表格行壳
 *
 * `el-table` 渲染出的真实行由 e2e 覆盖；这里只需要 `findPasswordRow` 按 `.${id}` 能命中一个
 * 节点，让「换页 → 高亮 → 到点摘除」这条时序链在单测里可观测。
 */
const attachRow = (id: string): void => {
  const row = document.createElement('tr');
  row.className = id;
  document.body.appendChild(row);
};

describe('usePasswordManagement 的分页接线', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;
  let saveSpy: MockInstance<typeof StorageUtils.savePassword>;

  beforeEach(() => {
    document.body.innerHTML = '';
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    });

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    mgmt.passwords.value = makeList(250);
    saveSpy = vi.spyOn(StorageUtils, 'savePassword');
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  /**
   * 让创建副本返回一条固定 ID 的条目
   *
   * ID 要能被当选择器用：`findPasswordRow` 查的是 `.${id}`，测试因此需要一个可预知的值。
   * `updateTime` 取当下，副本按默认排序（更新时间降序）落到第 1 页首位。
   */
  const mockCopy = (id: string) => {
    saveSpy.mockImplementation(async payload => ({
      ...makeEntry(999, payload),
      id,
      updateTime: Date.now(),
    }));
  };

  it('表格只吃当前页，命中读数仍是完整命中集', () => {
    expect(mgmt.filteredPasswords.value).toHaveLength(250);
    expect(mgmt.totalCount.value).toBe(250);
    expect(mgmt.pageCount.value).toBe(3);
    expect(mgmt.pagedEntries.value).toHaveLength(100);
    // 默认排序更新时间降序：第 1 页必须是最新的一批
    expect(mgmt.pagedEntries.value[0].id).toBe('r250');
  });

  it('筛选口径变化回第 1 页，就地改内容不弹回', async () => {
    mgmt.currentPage.value = 3;
    await nextTick();
    expect(mgmt.currentPage.value).toBe(3);

    // 就地编辑一条：列表内容变了，但用户看的就是这一页，不该被弹走
    Object.assign(mgmt.passwords.value[0], { remark: 'edited' });
    await nextTick();
    expect(mgmt.currentPage.value).toBe(3);

    mgmt.debouncedSearchKeyword.value = 'ux';
    await nextTick();
    expect(mgmt.currentPage.value, '搜索口径变化后停在越界页会读到空白').toBe(1);
    expect(mgmt.totalCount.value).toBe(150);
  });

  it('跨页选中的差额被如实计数', async () => {
    // r250 在第 1 页，r150 在第 2 页，r1 在第 3 页
    mgmt.selectedIds.value = ['r250', 'r150', 'r1'];
    expect(mgmt.offPageSelectedCount.value).toBe(2);

    mgmt.currentPage.value = 3;
    await nextTick();
    expect(mgmt.offPageSelectedCount.value).toBe(2);
  });

  it('创建副本会把用户带到副本所在页', async () => {
    mgmt.currentPage.value = 3;
    mockCopy('copy-1');

    await mgmt.copyPassword(mgmt.passwords.value[249]);

    expect(mgmt.currentPage.value, '副本按更新时间排到第 1 页，停留原页等于没定位').toBe(1);
    expect(mgmt.pagedEntries.value[0].id).toBe('copy-1');
  });

  it('副本被当前筛选排除时不硬翻页（维持原「找不到行就什么都不做」）', async () => {
    mgmt.debouncedSearchKeyword.value = 'ux';
    await nextTick();
    mgmt.currentPage.value = 2;
    mockCopy('copy-2');

    // r1 的账号名不含 ux，其副本同样不匹配当前关键词
    await mgmt.copyPassword(mgmt.passwords.value[0]);

    expect(mgmt.filteredPasswords.value.some(entry => entry.id === 'copy-2')).toBe(false);
    expect(mgmt.currentPage.value).toBe(2);
  });

  it('定位高亮恰好持续 ROW_HIGHLIGHT_MS，到点自动摘除', async () => {
    vi.useFakeTimers();
    attachRow('copy-hl');
    mockCopy('copy-hl');

    await mgmt.copyPassword(mgmt.passwords.value[249]);
    await nextTick();

    const row = document.querySelector<HTMLElement>('.copy-hl')!;
    expect(row.classList.contains('new-item'), '副本落在第 1 页，定位必须给它挂上高亮').toBe(true);

    vi.advanceTimersByTime(ROW_HIGHLIGHT_MS - 1);
    expect(row.classList.contains('new-item'), '未到点就摘掉，等于把这段提示悄悄缩短').toBe(true);

    vi.advanceTimersByTime(1);
    expect(row.classList.contains('new-item')).toBe(false);
  });

  it('销毁时取消挂起中的高亮定时器，不再回头改 DOM', async () => {
    vi.useFakeTimers();
    attachRow('copy-hl');
    mockCopy('copy-hl');

    await mgmt.copyPassword(mgmt.passwords.value[249]);
    await nextTick();

    const row = document.querySelector<HTMLElement>('.copy-hl')!;
    expect(row.classList.contains('new-item')).toBe(true);

    scope.stop();
    vi.advanceTimersByTime(ROW_HIGHLIGHT_MS * 2);

    // 定时器由 `onScopeDispose` 清掉：卸载后不再有回调回来触碰这行 DOM。
    // 类名留在原地不影响观感——那张表已经不存在，重挂时是全新的行。
    expect(row.classList.contains('new-item'), '销毁后仍有定时器打进来改 DOM').toBe(true);
  });
});
