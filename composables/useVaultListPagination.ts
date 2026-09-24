import { computed, ref, watch, type Ref } from 'vue';
import { DEFAULT_PAGE_SIZE } from '@/utils/vaultPagination';

/**
 * 管理页密码列表分页
 *
 * 存在理由：条目总量上限收到 2000 之后，「一次渲染全部命中行」就是管理页最大的单项成本
 * （首屏成本按组件实例计价，见 docs/ARCHITECTURE.md「管理页大 Vault 渲染性能」）。
 * 侧边栏那套 `v-for` + `v-memo` 的分片渲染在这里不可照搬——`el-table` 每换一次 `data`
 * 引用都会重排当前已渲染的全部行，实测把一次整表重排变成 15 次（19.9s → 39.4s）。
 * 因此这里只做一件事：让 `el-table` 每轮拿到的 `data` 恒为一页，页数由用户显式翻页改变。
 *
 * 本 composable 不持有过滤/排序逻辑，只按引用切片，因此与 `filteredPasswords` 的
 * 过滤、排序、防抖、拼音预热完全解耦；也不负责「列表内容变了要不要回第一页」——
 * 那由调用方通过 `resetSignal` 决定（见 `usePasswordManagement`），因为「内容变化」里
 * 只有筛选与排序口径变化需要回第一页，删除/就地编辑不需要。
 *
 * 档位常量与页码条算法（零 Vue、可独立单测）住在 `@/utils/vaultPagination`，这里只拥有状态。
 *
 * @param source 已过滤并排序的完整列表（只读来源）
 * @param resetSignal 复位信号：其值变化时回到第 1 页
 * @returns 分页状态与当前页切片
 */
export function useVaultListPagination<T>(source: Ref<T[]>, resetSignal: Ref<unknown>) {
  /** 当前页码，从 1 开始 */
  const currentPage = ref(1);

  /** 每页条数 */
  const pageSize = ref<number>(DEFAULT_PAGE_SIZE);

  /** 命中总条数（分页前） */
  const totalCount = computed(() => source.value.length);

  /** 总页数：至少 1，保证「第 1 / 1 页」在没有数据时也有确定读法 */
  const pageCount = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)));

  /** 当前页切片：交给 `el-table` 作为 `data` */
  const pagedEntries = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return source.value.slice(start, start + pageSize.value);
  });

  /**
   * 页数变少时把页码收进合法区间
   *
   * 触发场景是删除与筛选：整屏条目被删完后当前页可能已不存在，
   * 不钳位就会停在空白页，用户读到的是「表格空了」而不是「这里的东西被删完了」。
   * 用 `pageCount` 而不是列表长度作为依赖，翻页本身不会惊动它。
   */
  watch(pageCount, count => {
    if (currentPage.value > count) currentPage.value = count;
  });

  /** 筛选/排序口径变化回到第 1 页：与「命中数」读数保持同一份可见集合 */
  watch(resetSignal, () => {
    if (currentPage.value !== 1) currentPage.value = 1;
  });

  /**
   * 让列表中的某个下标落在当前页上
   *
   * 保存条目后原有的「滚动到该行并高亮 6 秒」依赖该行的 DOM 存在，分页后目标行
   * 可能在别的页，因此定位必须先换页、再由调用方在下一帧执行滚动。
   *
   * @param index 目标行在完整命中列表中的下标
   * @returns 换页后的页码；下标越界时返回当前页码且不改状态
   */
  const revealIndex = (index: number): number => {
    if (index < 0 || index >= totalCount.value) return currentPage.value;
    currentPage.value = Math.floor(index / pageSize.value) + 1;
    return currentPage.value;
  };

  return {
    currentPage,
    pageSize,
    totalCount,
    pageCount,
    pagedEntries,
    revealIndex,
  };
}
