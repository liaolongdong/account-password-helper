/**
 * 锁定态身份库召唤的「解锁后续接」记录
 *
 * 页面侧的召唤（字段提示气泡、输入框右键）落到管理页时可能正处锁定态：身份库解密依赖会话数据密钥，
 * 此时开窗只会得到一张空列表，所以门禁必须挡下。挡下之后这一次点击不该跟着蒸发——本模块只负责
 * 判定「这一次召唤还算不算数」，记录本身由调用方（管理页内存）持有。
 *
 * 三条刻意的取舍：
 * - **只活在这份文档的内存里**，不落 `chrome.storage`：记录携带的检索词可能是用户姓名（PII），
 *   落盘就是把它留到会话之外；同一粒度的既有先例是 `identityVaultVerifiedThisSession`
 *   （见 `utils/identityVaultAccess.ts`），管理页刷新或重开后回到「没有待续接」是可接受的偏保守方向。
 * - **有过期时间**：自动打开含 PII 的库只在用户仍处在这条链路上时才算「替他省一步」，
 *   几分钟后再弹出既突兀也是暴露面——所以过期即丢，而不是无限期等解锁。
 * - **单次消费**：续接判定不写回、不清零，调用方取走即清；否则同一次召唤会在之后每次解锁都重放。
 *
 * 与 `pendingSiteRuleDomain`（站点规则引导）同一口径：解锁那一刻自动续上未解锁期间的引导。
 *
 * @module utils/identity/summonIntent
 */

/** 一次身份库召唤携带的两个已收口标签 */
export interface IdentitySummonIntent {
  /** 预填检索框的搜索词；缺失即「不预填」，与「筛成空」刻意不同 */
  keyword?: string;
  /** 召唤发生在哪个标签页，供库内「回到原网页」使用；缺失即本轮不提供回程 */
  sourceTabId?: number;
}

/** 带记下时刻的待续接记录 */
export interface PendingIdentitySummon extends IdentitySummonIntent {
  /** 记下这条召唤的时刻（`Date.now()`），只用于与本模块的 TTL 比较 */
  takenAt: number;
}

/**
 * 续接有效期（毫秒）
 *
 * 取 60 秒的依据是这条链路的实际步长：管理页被激活 → 在主密码框输入 → 点解锁，正常都在十几秒内完成；
 * 超过一分钟还停在锁定态，用户大概率已经离开这件事，再自动开窗就成了惊扰。
 * 它只是「还算不算数」的判据，不是定时器——不做后台计时，因此没有需要清理的副作用。
 */
export const IDENTITY_SUMMON_TTL_MS = 60_000;

/**
 * 取走仍可续接的那次召唤（纯函数，不改动入参）
 *
 * 过期判据取**绝对差**：系统时间被校正（NTP 回拨、手动改时钟）时，「记下时刻在未来」会让
 * 有符号差值永远是负数、于是这条记录再也过不了期。方向不确定时就按失败方向收——
 * 丢掉最多让用户再右键一次（本功能引入前的行为），留着却可能在很久之后自动弹出含 PII 的库。
 *
 * @param pending 当前记录的待续接召唤，`null` 表示没有
 * @param now 比较用的当前时刻，默认 `Date.now()`（测试注入以避开真实计时）
 * @returns 未过期时返回两个标签，过期或没有记录时返回 `null`
 */
export function takeIdentitySummon(
  pending: PendingIdentitySummon | null,
  now: number = Date.now(),
): IdentitySummonIntent | null {
  if (!pending) return null;
  if (Math.abs(now - pending.takenAt) > IDENTITY_SUMMON_TTL_MS) return null;
  return { keyword: pending.keyword, sourceTabId: pending.sourceTabId };
}
