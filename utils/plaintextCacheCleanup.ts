/**
 * 「以明文为键」的派生记忆缓存清理登记处
 *
 * 背景：为削减大列表渲染/检索成本，仓库里有两类模块级记忆缓存的**键直接取自
 * 解密后的条目字段**（拼音命中区间取自用户名/标签/备注/URL，标签呈现记录取自
 * 条目原始 tag）。它们属明文在内存中的派生残留：安全基线要求不延长明文的存活时间，
 * 因此锁定、过期、改密以及「其他上下文清了会话」时都必须随手销毁，
 * 与 CryptoKey 句柄缓存同覆盖范围。
 *
 * 为什么是登记处而不是让会话模块直接 import 那两个模块：
 * - 会话模块是密码学与会话边界，反向依赖搜索/呈现模块属层次倒置；
 * - 动态 import 会把 `tagUtils` 整份拉进 Background 产物（实测 `background.js` +2.3 KB），
 *   而 SW 根本不渲染标签、那把缓存在那里恒为空——为不存在的缓存付冷启动解析成本；
 * - 登记处自身零依赖，调用点因此是**同步**清理，不留「异步清理尚未落地」的窗口。
 *
 * 语义：只有被真正加载过的模块才有东西可清（登记发生在其模块初始化时），
 * 因此未加载该模块的上下文既不必加载它，也不会漏清。
 */

/** 已登记的清理器（各模块在自身初始化时登记一次，模块级初始化每上下文仅执行一次） */
const cleaners = new Set<() => void>();

/**
 * 登记一个明文键缓存的清理器
 *
 * 由持有此类缓存的模块在模块顶层调用。
 *
 * @param cleaner 同步清理函数，只做内存丢弃、不触碰 storage
 */
export function registerPlaintextCacheCleaner(cleaner: () => void): void {
  cleaners.add(cleaner);
}

/**
 * 执行全部已登记的清理器
 *
 * 由会话边界在 `clearSession()` 与跨上下文会话重置两处调用。
 */
export function clearPlaintextKeyedCaches(): void {
  for (const cleaner of cleaners) cleaner();
}
