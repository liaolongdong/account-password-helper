/**
 * 管理页分页的纯计算件（零 Vue）
 *
 * 与 `composables/useVaultListPagination.ts` 的分工按 agents.md 的技术栈边界划定：
 * 这里只有「给定页码/档位/总页数算出该显示什么」的无状态算法与配置常量，可脱离组件实例直接单测；
 * 那边只持有响应式状态（`currentPage` / `pageSize`）与其副作用（钳位、复位两个 watcher）。
 * 页码条组件 `components/options/VaultPagination.vue` 消费本文件，不因此引到 composable 的状态所有权。
 */

/**
 * 可选的每页条数
 *
 * 刻意不提供「全部」：管理页的整表挂载成本随行数近似平方增长（600 行中位 16.5 秒、
 * 2000 行 180.2 秒，数据见 docs/PERF_LARGE_VAULT_EVALUATION.md 9.10），
 * 而条目总量上限就是 2000 条——「全部」这一档等于把分页要解决的问题原样留给用户。
 */
export const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

/**
 * 默认每页条数
 *
 * 取 100 的理由是实测出来的，不是外推的：同一份产物下按 `mount` 场景实测（真机数据见
 * `docs/PERF_LARGE_VAULT_EVALUATION.md` 9.11），每页 100 时 600 / 1200 / 2000 条的挂载与
 * 交互成本已不可区分（DOM 探针三档逐字一致），剩下的 2~4 秒是扩展页启动与数据层底盘，
 * 与页大小无关，属 P3 的范围。再往上的 200 档没有单独实测（按 9.10 的 rows² 曲线，
 * 一次 flush 里的行数翻倍会把这一页的重排成本推到约 3~4 倍），2000 条上限下 100 条至多 20 页，
 * 页码条仍在一行内放得下。
 */
export const DEFAULT_PAGE_SIZE: number = 100;

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
