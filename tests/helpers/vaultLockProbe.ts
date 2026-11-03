/**
 * 真 `navigator.locks` 的临界区探针
 *
 * 用途：回答「此刻提交锁是否被人持有」，让「加密派生不得发生在临界区内」这类
 * 结构性约束变成一条可断言、可证伪的行为观测，而不是靠读源码的约定。
 *
 * 口径与限制：
 * - 探针用 **shared + `ifAvailable`** 发起一次即判即得的小请求。`aph-vault-commit` 全仓只以
 *   exclusive 模式取用，因此只要有人持着它，shared 探针就拿不到 → 报「持有」。
 * - Web Locks 是写者优先：排队中的独占同样会让 shared 探针空手而归。这正是被测语义
 *   （`withVaultKeyTransitionQueued`  parked 时新写者进不来），所以一并算作「持有」。
 * - 探针锁空闲时会真的拿到再立刻释放，窗口只有一微任务级；不要用它测吞吐与时序。
 * - 前提由三份用例各自的第一条断言守着（`vaultCommitLockScope.test.ts`、`metadataFlushMarkScope.test.ts`、
 *   `trashPermanentDeleteLockHazard.test.ts`）：宿主必须提供真实 `navigator.locks`。缺环境时探针会当场失败，
 *   而不是让「锁内没做重活」这类断言以 TypeError 的形式混乱地红、或以恒 false 的形式假绿。
 */

/** 与普通整包写提交共用的那把锁（见 `utils/storage/vaultWriteLock.ts`）。 */
export const VAULT_COMMIT_LOCK = 'aph-vault-commit';

/**
 * 该锁此刻是否被人持有（或有一个独占请求正排在前面），即新写者能否立刻进入临界区。
 *
 * @param lockName 锁名，默认提交锁
 * @returns true = 有人持着 / 有独占在排队；false = 临界区是空的
 */
export async function isVaultCommitLockHeld(lockName: string = VAULT_COMMIT_LOCK): Promise<boolean> {
  let held = true;
  await navigator.locks.request(lockName, { mode: 'shared', ifAvailable: true }, lock => {
    held = lock === null;
  });
  return held;
}

/** 宿主是否提供真实 Web Locks；缺省时相关用例必须显式失败而不是空跑。 */
export function hasRealWebLocks(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';
}

/**
 * 让出一个微任务与一次宏任务，使已排队的锁请求有机会被授予。
 * 用于「发起请求 → 等它进入等待态 → 再断言」这类交错编排。
 */
export async function settleLockQueue(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
}
