import type { VaultErrorCode } from '@/utils/recoveryTypes';

// 刻意不把 `VAULT_ERROR_CODES` 当值导入：本模块在 popup 首屏的 eager 依赖图里，
// 为一个常量引入值依赖，Rollup 就会把 `recoveryTypes` 切成独立 chunk 挂进 popup.html
// 的 modulepreload（eager 文件数 +1，被 `tests/architecture/sidepanelClosure.test.ts` 挡下）。
// 类型导入会被编译期擦除，零运行时成本；下面这个具名常量仍要求字面量是 `VaultErrorCode`
// 的成员，登记表里改名或拼错照样编译失败。
const VAULT_BUSY: VaultErrorCode = 'VAULT_BUSY';

const VAULT_WRITE_LOCK = 'aph-vault-key-transition';

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
 * 侧边栏 / Popup 同属扩展 origin，彼此互斥成立；但内容脚本里跑的代码（`isSessionValid` 的旧版
 * 会话迁移路径会经到这里）用的是**宿主页面**的 lock space，它的共享租约挡不住扩展侧的独占换钥。
 * 因此「跨上下文不写坏五域」的保证只覆盖扩展自身上下文发起的写入；内容脚本不得新增直接写库的路径。
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
