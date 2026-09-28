import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

type BrowserStartupRelockStatus = 'pending' | 'complete' | 'failed';

export type BrowserStartupRelockWaitStatus = 'ready' | 'blocked' | 'unavailable';

interface BrowserStartupRelockState {
  status: BrowserStartupRelockStatus;
  updatedAt: number;
}

interface BrowserStartupRelockRecovery {
  recoveredAt: number;
  /** 仅显式认证可以恢复 failed，且必须精确引用本次失败。 */
  failedUpdatedAt: number | null;
}

/**
 * 屏障等待节奏：25ms 轮询、最长 1.5s
 *
 * 与「侧边栏秒开」预算的关系（评审时评估过、结论是保留现状）：
 * - 常态成本只有 1～2 次 storage 读取——`complete` 命中第一次 `storage.session.get` 即放行；
 *   标记缺失（浏览器刚启动且未开启重启锁定）再补一次 `storage.local` 读配置。
 * - 1.5s 只在 `pending` 未结束时才会吃满，即「用户开启了浏览器重启锁定 + 浏览器冷启动」这一
 *   窗口；此时侧边栏本来就要重新输入主密码，屏障不是用户感知的瓶颈。
 * - 缩短超时或改成只读内存 Promise，会把「启动清理 `clearSession` 晚于新会话创建」的竞态
 *   重新暴露成明文泄露——那是 fail-closed 语义的立足点，性能收益远小于代价，故不动。
 */
const BARRIER_POLL_INTERVAL_MS = 25;
const BARRIER_WAIT_TIMEOUT_MS = 1500;

export async function setBrowserStartupRelockState(status: BrowserStartupRelockStatus): Promise<void> {
  await chrome.storage.session.set({
    [SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE]: { status, updatedAt: Date.now() },
  });
}

function parseBrowserStartupRelockState(result: Record<string, unknown>): BrowserStartupRelockState | null {
  const value = result[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE] as
    Partial<BrowserStartupRelockState> | undefined;
  if (
    !value ||
    (value.status !== 'pending' && value.status !== 'complete' && value.status !== 'failed') ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }
  return value as BrowserStartupRelockState;
}

function parseBrowserStartupRelockRecovery(result: Record<string, unknown>): BrowserStartupRelockRecovery | null {
  const value = result[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY] as
    Partial<BrowserStartupRelockRecovery> | undefined;
  if (!value || typeof value.recoveredAt !== 'number') return null;
  if (value.failedUpdatedAt !== null && typeof value.failedUpdatedAt !== 'number') return null;
  return value as BrowserStartupRelockRecovery;
}

export async function getBrowserStartupRelockState(): Promise<BrowserStartupRelockState | null> {
  const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE);
  return parseBrowserStartupRelockState(result);
}

async function setBrowserStartupRelockRecovery(failedUpdatedAt: number | null): Promise<void> {
  await chrome.storage.session.set({
    [SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY]: {
      recoveredAt: Date.now(),
      failedUpdatedAt,
    },
  });
}

/**
 * 等待 onStartup 重锁完成。状态缺失时必须结合持久配置判定：默认关闭可直接放行；
 * 已开启“重启后重新锁定”则 fail-closed，覆盖浏览器刚启动、onStartup 尚未来得及
 * 写入 pending 的竞态窗口。读取失败或 pending 超时同样不得返回/解密会话期明文。
 */
export async function waitForBrowserStartupRelockStatus(): Promise<BrowserStartupRelockWaitStatus> {
  const deadline = Date.now() + BARRIER_WAIT_TIMEOUT_MS;
  try {
    while (true) {
      const markerResult = await chrome.storage.session.get([
        SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE,
        SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY,
      ]);
      const state = parseBrowserStartupRelockState(markerResult);
      const recovery = parseBrowserStartupRelockRecovery(markerResult);
      if (!state) {
        if (recovery) return 'ready';
        const configResult = await chrome.storage.local.get(STORAGE_KEYS.IDLE_LOCK_CONFIG);
        const config = configResult[STORAGE_KEYS.IDLE_LOCK_CONFIG] as { relockOnBrowserRestart?: boolean } | undefined;
        return config?.relockOnBrowserRestart === true ? 'blocked' : 'ready';
      }
      if (state.status === 'complete') return 'ready';
      if (state.status === 'failed') {
        return recovery?.failedUpdatedAt === state.updatedAt ? 'ready' : 'blocked';
      }
      if (Date.now() >= deadline) return 'unavailable';
      await new Promise(resolve => setTimeout(resolve, BARRIER_POLL_INTERVAL_MS));
    }
  } catch {
    return 'unavailable';
  }
}

/** 安全门兼容接口：超时/读取失败与明确阻断均 fail-closed。 */
export async function waitForBrowserStartupRelockMarker(): Promise<boolean> {
  return (await waitForBrowserStartupRelockStatus()) === 'ready';
}

/**
 * 安装/升级或用户修改“下次重启重锁”配置时，标记当前浏览器会话已初始化。
 * pending/failed 永不被该非认证路径恢复，避免覆盖正在清理或清理失败的安全状态。
 */
export async function markBrowserStartupRelockCurrentSessionReady(): Promise<boolean> {
  try {
    const state = await getBrowserStartupRelockState();
    if (state?.status === 'pending' || state?.status === 'failed') return false;
    await setBrowserStartupRelockRecovery(null);
    return true;
  } catch {
    return false;
  }
}

/**
 * 显式认证写入新会话前仅等待正在执行的启动重锁结束。
 * failed/缺失状态允许继续认证，由成功后的 recovery 标记安全恢复；pending 超时则拒绝
 * 创建会话，避免迟到的 clearSession 把刚创建的新会话再次清除。
 */
export async function waitForBrowserStartupRelockBeforeAuthentication(): Promise<boolean> {
  const deadline = Date.now() + BARRIER_WAIT_TIMEOUT_MS;
  let relockRequired: boolean | null = null;
  try {
    while (true) {
      const markerResult = await chrome.storage.session.get([
        SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE,
        SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY,
      ]);
      const state = parseBrowserStartupRelockState(markerResult);
      const recovery = parseBrowserStartupRelockRecovery(markerResult);
      if (state?.status === 'complete' || state?.status === 'failed') return true;
      if (!state && recovery) return true;
      if (!state && relockRequired === null) {
        const configResult = await chrome.storage.local.get(STORAGE_KEYS.IDLE_LOCK_CONFIG);
        const config = configResult[STORAGE_KEYS.IDLE_LOCK_CONFIG] as { relockOnBrowserRestart?: boolean } | undefined;
        relockRequired = config?.relockOnBrowserRestart === true;
      }
      if (!state && relockRequired === false) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, BARRIER_POLL_INTERVAL_MS));
    }
  } catch {
    return false;
  }
}

/**
 * 显式主密码认证并成功创建新会话后的恢复路径。
 *
 * pending 必须先结束，防止启动 clearSession 在新会话创建后才落地；failed 仅通过
 * 精确引用其 updatedAt 的独立 recovery 标记恢复，绝不改写 startup state 本身。
 */
export async function recoverBrowserStartupRelockAfterAuthentication(): Promise<boolean> {
  const deadline = Date.now() + BARRIER_WAIT_TIMEOUT_MS;
  try {
    while (true) {
      const state = await getBrowserStartupRelockState();
      if (state?.status === 'pending') {
        if (Date.now() >= deadline) return false;
        await new Promise(resolve => setTimeout(resolve, BARRIER_POLL_INTERVAL_MS));
        continue;
      }
      await setBrowserStartupRelockRecovery(state?.status === 'failed' ? state.updatedAt : null);
      return true;
    }
  } catch {
    return false;
  }
}
