/**
 * 回收站保留期口径（密码库与身份库共用）
 *
 * 从 `trashManager.ts` 抽出的独立轻量模块：两侧回收站（密码逐字段密文 vs 身份整块
 * blob）刻意不共用读写代码，但**必须**共用保留期常量、到期阈值与剩余天数读数，
 * 否则改保留期时两个弹窗会出现两种倒计时读数。
 *
 * 抽出的另一处关键动机是构建闭包：`trashManager.ts` 静态依赖 passwordHistory /
 * reminderManager / vaultCapacity（密码域专属），身份回收站或 UI 若直接向它取常量，
 * 会把整条密码读写链拉进共享 chunk，波及 popup 首屏的 modulepreload 清单
 *（守卫见 `tests/architecture/sidepanelClosure.test.ts`）。本模块零业务依赖。
 */

/**
 * 回收站条目保留天数
 *
 * 对外导出：回收站弹窗的「剩余天数」读数与这里的自动清理必须同一口径，
 * 各自写死 30 的话，改保留期时弹窗会静默显示一个与真实清理规则不符的倒计时。
 */
export const TRASH_RETENTION_DAYS = 30;

/** 一天的毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 毫秒数：30 天
 *
 * 对外导出：身份回收站的到期清理（`identityTrashManager.cleanExpiredIdentityTrash`）
 * 必须与密码库 `cleanExpiredTrash` 同一阈值同一比较符，否则两个回收站在保留期
 * 边界上会差出±1 天的判若两人。
 */
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * MS_PER_DAY;

/**
 * 一条回收站条目此刻是否已到期
 *
 * 与两侧 `cleanExpired*` 同一阈值同一比较符（`>` 而非 `>=`：第 30 天整不算到期，
 * 满 30 天零 1 毫秒才清）。
 *
 * `deletedAt` 非有限数（历史脏数据、跨版本残留、手工写入的 storage）一律**判为已到期**。
 * 反向判会连带两个后果：条目在盘上永不过期（与弹窗「剩余 N 天」的承诺矛盾，PII 无限期
 * 驻留），且 `getTrashRemainingDays` 的减法会把 NaN 直接渲染进表格。这些条目本就是用户
 * 主动删除的软删除副本，隐私承诺优先于副本可找回性。
 * 密码库侧 `trashManager.cleanExpiredTrash` 因 popup 首屏闭包不能 import 本模块
 *（守卫见 `tests/utils/trashRetentionDays.test.ts`），保持着语义一致的内联副本，改这里须同步改它。
 *
 * @param deletedAt 条目的删除时间戳（毫秒）
 * @param now 基准时刻（毫秒）
 */
export const isTrashEntryExpired = (deletedAt: number, now: number): boolean =>
  !Number.isFinite(deletedAt) || now - deletedAt > TRASH_RETENTION_MS;

/**
 * 计算某条回收站条目的剩余保留天数（按「已过几个完整 24 小时」扣减，已到期为 0）
 *
 * 纯展示口径，与两侧 `cleanExpired*` 的到期判定同源（共用 `TRASH_RETENTION_DAYS`）：
 * 阈值仍由 `now - deletedAt > TRASH_RETENTION_MS` 决定，这里只是把同一个差值换算成天数读数。
 *
 * 读数按**天**而不是按保留期整体换算：`30 - floor(已过天数)` 才会随时间逐格递减，
 * 若除以 `TRASH_RETENTION_MS` 则整月都停在 30、到期当天直接跳到 0。
 * 上限同样夹在 `TRASH_RETENTION_DAYS`：时钟回拨或 `deletedAt` 带未来时间时不给出「31 天」。
 * `deletedAt` 非有限数时读 0，与 {@link isTrashEntryExpired} 的「判为已到期」同档，
 * 避免 NaN 经减法渗进表格读数。
 *
 * @param deletedAt 删除时间戳（毫秒）
 * @param now 基准时刻（毫秒），由调用方一次取样，避免同一屏内每行各取一次 `Date.now()`
 * @returns 剩余天数（0 ~ `TRASH_RETENTION_DAYS`）
 */
export const getTrashRemainingDays = (deletedAt: number, now: number = Date.now()): number =>
  Number.isFinite(deletedAt)
    ? Math.min(TRASH_RETENTION_DAYS, Math.max(0, TRASH_RETENTION_DAYS - Math.floor((now - deletedAt) / MS_PER_DAY)))
    : 0;
