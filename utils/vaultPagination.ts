/**
 * 管理页分页的纯计算件（零 Vue）
 *
 * 与 `composables/useVaultListPagination.ts` 的分工按 agents.md 的技术栈边界划定：
 * 这里只有「给定页码/档位/总页数算出该显示什么」的无状态算法，可脱离组件实例直接单测；
 * 那边只持有响应式状态（`currentPage` / `pageSize`）与其副作用（钳位、复位两个 watcher）。
 * 页码条组件 `components/options/VaultPagination.vue` 消费本文件，不因此引到 composable 的状态所有权。
 *
 * 档位常量（`PAGE_SIZE_OPTIONS` / `DEFAULT_PAGE_SIZE` / `isVaultPageSize`）住在
 * `utils/vaultPageSize.ts`：它被存储层共享，而本文件的算法只有 Options 页消费，
 * 同处一文件会把算法带进 sidepanel 首屏闭包（详见那个文件的文件头）。
 */

/**
 * 分页条需要展示的页码项
 *
 * 省略号只有一种标记：`buildPagerItems` 顺序构造，凡相邻两个页码之间有空档就插一个，
 * 不需要区分前后（另一端永远还有页码可点，读屏按顺序读即可）。
 */
export type PaginationPagerItem = number | 'prev-ellipsis';

/**
 * 换档位后应该停在哪一页
 *
 * 按「当前页首条在新档位下落到第几页」换算，而不是回第 1 页：用户在第 7 页改档位时
 * 回第 1 页会把他正在看的内容丢掉。
 *
 * 新总页数必须在这里就地重算：调用发生在 `update:pageSize` 生效之前，此刻组件读到的
 * `pageCount` 仍是**旧档位**算出来的值，拿它钳位会把用户送到别的位置——
 * 250 条 / 每页 200 / 停在第 2 页改成 50 时，正确落点是第 5 页（原首条仍在眼前），
 * 用旧 `pageCount` 钳会得到第 2 页（51～100 条）。
 *
 * @param firstIndexOfPage 换档位前当前页首条的绝对下标
 * @param nextSize 新的每页条数
 * @param totalCount 命中总条数
 * @returns 新档位下的合法页码（至少 1）
 */
export const pageForSizeChange = (firstIndexOfPage: number, nextSize: number, totalCount: number): number => {
  const nextPageCount = Math.max(1, Math.ceil(totalCount / nextSize));
  return Math.min(nextPageCount, Math.floor(firstIndexOfPage / nextSize) + 1);
};

/**
 * 生成页码条的可见页码
 *
 * 首尾恒显，当前页左右各 1 页，中间用省略号折叠——2000 条 / 每页 100 时最多 20 页，
 * 全展开会把页码条撑成一整行，反而盖过「第几页」这个主信息。
 *
 * @param current 当前页
 * @param total 总页数
 * @returns 页码项序列（含省略号标记）
 */
export function buildPagerItems(current: number, total: number): PaginationPagerItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: PaginationPagerItem[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) items.push('prev-ellipsis');
    items.push(page);
    previous = page;
  }
  return items;
}
