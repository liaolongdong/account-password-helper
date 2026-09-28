/**
 * 管理页每页条数档位（叶子常量，零依赖）
 *
 * 之所以不与页码算法（`utils/vaultPagination.ts`）同处一个文件：档位是**跨入口共享**的
 * 配置常量——存储层 `utils/storage/configManager.ts` 要在读写落盘档位时用它做白名单判据，
 * 而页码算法只有 Options 页消费。放在一起会让 options-only 的 `buildPagerItems`
 * 随 configManager 被拽进 sidepanel 的 modulepreload 闭包（本扩展有秒开 SLA）。
 * 拆成叶子模块后共享闭包只带上这一份常量，算法仍留在 Options 侧。
 *
 * 顺带符合 agents.md 的边界：纯常量与无状态判据归 `utils/`，响应式状态归 `composables/`。
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
 * 默认档位
 *
 * 取 100 的理由是实测出来的，不是外推的：同一份产物下按 `mount` 场景实测（真机数据见
 * `docs/PERF_LARGE_VAULT_EVALUATION.md` 9.11），每页 100 时 600 / 1200 / 2000 条的挂载与
 * 交互成本已不可区分（DOM 探针三档逐字一致），剩下的 2~4 秒是扩展页启动与数据层底盘，
 * 与页大小无关，属 P3 的范围。再往上的 200 档没有单独实测（按 9.10 的 rows² 曲线，
 * 一次 flush 里的行数翻倍会把这一页的重排成本推到约 3~4 倍），2000 条上限下 100 条至多 20 页，
 * 页码条仍在一行内放得下。
 *
 * 显式标 `number` 而非字面量类型：消费侧（响应式 `pageSize` ref、存储读写）都是 `number`，
 * 收窄成 `100` 反而让每次换档赋值触发类型不兼容。
 */
export const DEFAULT_PAGE_SIZE: number = 100;

/** 合法档位类型：`PAGE_SIZE_OPTIONS` 三项之一 */
export type VaultPageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/**
 * 判定任意值是否为合法档位（类型守卫）
 *
 * 档位一旦落盘就要面对「存储里的值不是 50/100/200」这件事：导入的历史配置、手改存储、
 * 未来档位集合调整都可能留下非法值，而它直接决定一次喂给 `el-table` 的行数——
 * 0 或负数会让 `slice` 恒空，用户读到的是「列表被清空」。白名单比范围校验更严，
 * 也让 200 这个成本上限不会因为存储里的一个数被绕过。
 *
 * @param value 待判定值（来自存储等不可信来源）
 * @returns 是否恰好等于某个已提供档位
 */
export function isVaultPageSize(value: unknown): value is VaultPageSize {
  return (PAGE_SIZE_OPTIONS as readonly unknown[]).includes(value);
}
