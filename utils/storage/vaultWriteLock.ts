import type { VaultErrorCode } from '@/utils/recoveryTypes';

// 刻意不把 `VAULT_ERROR_CODES` 当值导入：本模块在 popup 首屏的 eager 依赖图里，
// 为一个常量引入值依赖，Rollup 就会把 `recoveryTypes` 切成独立 chunk 挂进 popup.html
// 的 modulepreload（eager 文件数 +1，被 `tests/architecture/sidepanelClosure.test.ts` 挡下）。
// 类型导入会被编译期擦除，零运行时成本；下面这个具名常量仍要求字面量是 `VaultErrorCode`
// 的成员，登记表里改名或拼错照样编译失败。
const VAULT_BUSY: VaultErrorCode = 'VAULT_BUSY';

const VAULT_WRITE_LOCK = 'aph-vault-key-transition';

/**
 * 普通写入提交锁：所有“读整包 → 改 → 写整包”的提交都必须在这把锁下完成。
 *
 * 它与 key-transition 锁分开：换钥仍用 shared/exclusive 的 fail-fast 语义挡住写者；
 * 提交锁则把写者之间的「落盘前重读 + 写」串成队列，跨扩展上下文也成立。不能用同一把
 * shared 租约兼做这件事——shared 模式不互斥，正是旧报告 P1-1 漏掉的那一维。
 */
const VAULT_COMMIT_LOCK = 'aph-vault-commit';

/** 重试预算：换钥是低频、秒级完成的用户动作，一次短暂等待就能覆盖绝大多数碰撞。 */
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Shared, non-queued leases allow nested writers without deadlocking behind a key transition.
 *
 * 刻意不排队：普通写入拿不到租约就立刻 `VAULT_BUSY`，由调用方决定补救（回队重试 / 本地化提示）。
 * 把等待塞进这里会让每个被挡住的写入平白多等数百毫秒，还会打断以假定时器驱动租约时序的守卫测试。
 *
 * **租约的作用域前提**：`navigator.locks` 按调用上下文的 origin 分组，扩展的 SW / Options /
 * 侧边栏 / Popup 同属扩展 origin，彼此互斥成立；但内容脚本里跑的代码用的是**宿主页面**的 lock space，
 * 它的共享租约挡不住扩展侧的独占换钥。因此「跨上下文不写坏五域」的保证只覆盖扩展自身上下文发起的
 * 写入；内容脚本不得新增直接写库的路径。内容脚本原先会经此处的旧版会话迁移（写会话密钥材料与主密码
 * 校验配置）已由 `utils/runtimeContext.ts` 的 `isWebPageContext` 在入口处挡掉，迁移改由扩展自身上下文完成。
 */
export function withVaultMutation<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(VAULT_WRITE_LOCK, { mode: 'shared', ifAvailable: true }, async lock => {
    if (!lock) throw Object.assign(new Error('Vault is busy changing keys'), { code: VAULT_BUSY });
    return operation();
  });
}

/** Exclusive key-transition leases stay fail-fast: the transition is the rare, user-initiated side. */
export function withVaultKeyTransition<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(VAULT_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw Object.assign(new Error('Vault has an unfinished write'), { code: VAULT_BUSY });
    return operation();
  });
}

/**
 * 排队等待独占租约的破坏性操作（目前只有“清空全部数据”）。
 *
 * 普通换钥失败即回执，让用户重试；但重置不能这样做：它一旦与在途元数据 flush 交错，
 * 旧整包可能在 clear() 之后被写回。这里不使用 ifAvailable，先等所有 shared 写者结束，
 * 再执行清空；清空完成后才释放租约，新的写者只能读到空库。
 *
 * 不要给普通写入或换钥使用：它会让 UI 无限等待一个卡住的写者；这是破坏性重置的专属口径。
 */
export function withVaultKeyTransitionQueued<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(VAULT_WRITE_LOCK, { mode: 'exclusive' }, () => operation());
}

/**
 * 串行化跨上下文的整包提交（读最新快照 + 合并 + 单次 set）。
 *
 * 只在已经持有 `withVaultMutation` 的写路径内调用；不要在这里再取 key-transition 锁。
 */
export function withVaultCommit<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(VAULT_COMMIT_LOCK, { mode: 'exclusive' }, () => operation());
}

/**
 * 共享租约的有界重试，只给「错过就不可重放」的写入用——目前是网页登录触发的自动保存。
 *
 * 换钥窗口可到秒级，而一次登录凭据不会自己再触发一遍保存；让这种写入为一个
 * 秒级窗口判死，代价不对等。超预算仍按 `VAULT_BUSY` 抛出，由调用方给本地化提示，
 * 绝不静默成功。
 */
export async function withVaultMutationRetry<T>(
  operation: () => Promise<T>,
  { attempts = RETRY_ATTEMPTS, delayMs = RETRY_DELAY_MS }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withVaultMutation(operation);
    } catch (error) {
      if ((error as { code?: string })?.code !== VAULT_BUSY || attempt >= attempts - 1) throw error;
      await wait(delayMs);
    }
  }
}
