/**
 * 管理页分页 composable 单测（useVaultListPagination）
 *
 * 这个模块是「大 Vault 不再一次渲染整表」的唯一开关：`el-table` 每轮只拿到一页，
 * 而翻页本身不许改动命中集合、命中集合变化不许把用户丢在空白页上。
 * 四条契约各自对应一个真实故障形状：
 * 1. 切片错位 → 用户在同一页看到重复或漏掉的条目；
 * 2. 页数变少不钳位 → 停在越界页，表格空白，读起来像「东西没了」；
 * 3. 复位信号过宽 → 每删一条就被弹回第 1 页，无法连续清理同一页；
 * 4. 换档位时按旧页数钳位 → 用户被送到别的位置，正在看的那批条目凭空「没了」。
 *
 * 换档落点与页码条折叠是零 Vue 的纯计算，住在 `@/utils/vaultPagination`，
 * 其断言见 `tests/utils/vaultPagination.test.ts`；本文件只测响应式状态与两个 watcher。
 *
 * `watch` 的默认 pre flush 在无组件实例的环境里仍走调度队列，故断言前统一 `await nextTick()`。
 */
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/utils/vaultPageSize';
import { useVaultListPagination } from '@/composables/useVaultListPagination';

/** 造 n 条只带序号的条目，够用于纯切片断言 */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, seq: i + 1 }));

/** 在独立 effect scope 里挂载分页，避免 watcher 跨用例泄漏 */
const mount = (n: number) => {
  const source = ref(rows(n));
  const signal = ref('');
  const scope = effectScope();
  const pager = scope.run(() => useVaultListPagination(source, signal))!;
  return { source, signal, pager, scope };
};

describe('useVaultListPagination 切片', () => {
  it('默认停在第 1 页，且只给出一个页大小的条目', () => {
    const { pager, scope } = mount(250);
    expect(pager.currentPage.value).toBe(1);
    expect(pager.pageSize.value).toBe(DEFAULT_PAGE_SIZE);
    expect(pager.totalCount.value).toBe(250);
    expect(pager.pageCount.value).toBe(3);
    expect(pager.pagedEntries.value).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(pager.pagedEntries.value[0].id).toBe('r1');
    expect(pager.pagedEntries.value[DEFAULT_PAGE_SIZE - 1].id).toBe(`r${DEFAULT_PAGE_SIZE}`);
    scope.stop();
  });

  it('末页给出余数条，且不越界、不重复', () => {
    const { pager, scope } = mount(250);
    pager.currentPage.value = 3;
    expect(pager.pagedEntries.value).toHaveLength(50);
    expect(pager.pagedEntries.value[0].id).toBe('r201');
    expect(pager.pagedEntries.value[49].id).toBe('r250');
    scope.stop();
  });

  it('不足一页时总页数按 1 计，空列表同样有确定读数', () => {
    const { pager, scope } = mount(3);
    expect(pager.pageCount.value).toBe(1);
    expect(pager.pagedEntries.value).toHaveLength(3);
    expect(pager.pagedEntries.value[2].id).toBe('r3');
    scope.stop();

    // 全被筛掉时不能算出 0 页，否则「第 1 / 0 页」这种读数会直接呈现给用户
    const empty = mount(0);
    expect(empty.pager.pageCount.value).toBe(1);
    expect(empty.pager.pagedEntries.value).toEqual([]);
    empty.scope.stop();
  });

  it('换页码以外的来源引用变化也会反映最新条目', async () => {
    const { source, pager, scope } = mount(200);
    pager.currentPage.value = 2;
    source.value = rows(200).map(entry => ({ ...entry, id: `${entry.id}x` }));
    await nextTick();
    expect(pager.pagedEntries.value[0].id).toBe('r101x');
    scope.stop();
  });
});

describe('useVaultListPagination 页码合法性', () => {
  it('列表变短导致页数减少时钳回最后一页', async () => {
    const { source, pager, scope } = mount(300);
    pager.currentPage.value = 3;
    expect(pager.pagedEntries.value).toHaveLength(100);

    source.value = rows(150);
    await nextTick();
    expect(pager.pageCount.value).toBe(2);
    expect(pager.currentPage.value).toBe(2);
    expect(pager.pagedEntries.value).toHaveLength(50);
    scope.stop();
  });

  it('清空列表时回到第 1 页而不是停在越界页', async () => {
    const { source, pager, scope } = mount(300);
    pager.currentPage.value = 3;

    source.value = [];
    await nextTick();
    expect(pager.currentPage.value).toBe(1);
    scope.stop();
  });

  it('复位信号变化回第 1 页，未变化时翻页不被打断', async () => {
    const { signal, pager, scope } = mount(500);
    pager.currentPage.value = 4;
    await nextTick();
    expect(pager.currentPage.value).toBe(4);

    signal.value = 'keyword:a';
    await nextTick();
    expect(pager.currentPage.value).toBe(1);

    pager.currentPage.value = 5;
    signal.value = 'keyword:a';
    await nextTick();
    expect(pager.currentPage.value, '同值写入不该把用户弹回第 1 页').toBe(5);
    scope.stop();
  });

  it('改每页条数只重算页数，不把页码钉死', async () => {
    const { pager, scope } = mount(500);
    pager.currentPage.value = 2;
    pager.pageSize.value = PAGE_SIZE_OPTIONS[2];
    await nextTick();
    expect(pager.pageCount.value).toBe(3);
    expect(pager.currentPage.value, '档位变化本身不改页码，由调用方换算可见位置').toBe(2);
    expect(pager.pagedEntries.value).toHaveLength(200);
    scope.stop();
  });
});

describe('useVaultListPagination.revealIndex', () => {
  it('把目标下标所在页换成当前页', () => {
    const { pager, scope } = mount(250);
    expect(pager.revealIndex(0)).toBe(1);
    expect(pager.revealIndex(150)).toBe(2);
    expect(pager.revealIndex(249)).toBe(3);
    expect(pager.currentPage.value).toBe(3);
    scope.stop();
  });

  it('越界下标不动状态（目标行根本不存在时无操作）', () => {
    const { pager, scope } = mount(250);
    pager.currentPage.value = 2;
    expect(pager.revealIndex(-1)).toBe(2);
    expect(pager.revealIndex(250)).toBe(2);
    expect(pager.currentPage.value).toBe(2);
    scope.stop();
  });
});
