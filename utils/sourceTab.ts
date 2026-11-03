/**
 * 来源标签页的归属与形状收口
 *
 * 「回到原网页」把用户从管理页送回他刚才待过的那个标签页，所以这个数字必须是浏览器盖章的
 * 事实，不能是页面自报的取值：网页一旦能自选 tabId，就能在管理页里安放一枚把用户带去任意
 * 站点的按钮，而点击时机恰是「刚从身份库复制了证件号」、注意力最放松的那一刻。
 *
 * 口径对齐既有两处同类判据：`resolveTrustedContentUrl`（凭证归属以 `sender.tab.url` 为准）
 * 与 `DELEGATE_PAGE_NOTICE`（tabId 只从 sender 推导）。两处都不接受自报值，本模块同样不接受。
 *
 * @module utils/sourceTab
 */

/**
 * 可以承载「回到原网页」的页面协议
 *
 * 白名单而非黑名单：新出现的伪协议（`chrome://`、`devtools://`、`view-source:` 等）默认落榜，
 * 不必逐个列举就已经被拒。内容脚本今天只在 http(s) 与 file 上运行，白名单与事实同宽，
 * 没有牺牲任何真实场景。
 */
const NAVIGABLE_SOURCE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'file:']);

/**
 * 把跨上下文消息里的 `sourceTabId` 收窄成合法形态
 *
 * 消息通道是跨进程边界，编译期类型不构成校验：非数字、非整数、负数、超出安全整数范围
 * 一律视为「没带」，交由调用方走「不显示回程出口」的降级路径。
 *
 * @param value 消息里的原始值（不可信）
 * @returns 合法的 tabId，非法时 `undefined`
 */
export function normalizeSourceTabId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 判定一个 URL 是否可作为「回到原网页」的去路
 *
 * 白名单而非黑名单：新出现的伪协议（`chrome://`、`devtools://`、`view-source:` 等）默认落榜，
 * 不必逐个列举就已经被拒。内容脚本今天只在 http(s) 与 file 上运行，白名单与事实同宽，
 * 没有牺牲任何真实场景。判据在模块里只写这一处，`resolveSourceTabId`（入口）与
 * `useVaultReturn.returnToSource`（落地前复核）共用，否则两处白名单会各自漂移。
 *
 * @param url 待判定的 URL（不可信来源，按 `unknown` 处理）
 * @returns 协议在白名单内且 URL 非空时为 `true`
 */
export function isNavigableSourceUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    return NAVIGABLE_SOURCE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * 从发送方上下文推导可回程的来源标签页
 *
 * 两个条件缺一不可：tabId 形状合法，**且**该标签页的 URL 协议在白名单内。
 * URL 缺失（未授予 host 权限的上下文、被策略抹掉的场景）时 fail-closed——
 * 宁可不给回程出口，也不给一个来路不明的标签页。
 *
 * @param tabId `sender.tab?.id`（浏览器盖章，非页面自报）
 * @param tabUrl `sender.tab?.url`
 * @returns 可回程的 tabId，不可用时 `undefined`
 */
export function resolveSourceTabId(tabId: unknown, tabUrl: unknown): number | undefined {
  const id = normalizeSourceTabId(tabId);
  if (id === undefined || typeof tabUrl !== 'string') return undefined;
  return isNavigableSourceUrl(tabUrl) ? id : undefined;
}
