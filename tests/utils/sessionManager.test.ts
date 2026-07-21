import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sessionManager.ts 特征化测试
 *
 * sessionManager 是 window 定时器驱动的单例，本身不含纯有效期计算
 * （有效期判定在 StorageUtils.isSessionValid 中）。此处锁定其可观察契约：
 * - 定时轮询中，仅当会话「由有效变为无效」时才触发过期；
 * - 过期处理先 clearSession 再派发 `sessionExpired` 事件；
 * - initSessionManager 启动轮询并注册 beforeunload 清理。
 *
 * 说明：
 * - 环境为 node，无 window，故对 window / CustomEvent 打桩；
 * - StorageUtils 经模块 mock 从接缝注入；
 * - 轮询回调经 window.setInterval 桩捕获后手动触发（避免真实 60s 等待）；
 * - handleSessionExpired 在源码中为「不 await」的 fire-and-forget，
 *   故每次触发后用 flush() 冲洗微/宏任务，确保其副作用完成。
 */

const { isSessionValid, clearSession } = vi.hoisted(() => ({
  isSessionValid: vi.fn<() => Promise<boolean>>(),
  clearSession: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/utils/storage', () => ({
  StorageUtils: { isSessionValid, clearSession },
}));

let capturedTick: (() => Promise<void>) | undefined;
let events: string[];
let addEventListenerSpy: ReturnType<typeof vi.fn>;

/** 冲洗一次宏任务，等待未 await 的 handleSessionExpired 副作用完成 */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  events = [];
  capturedTick = undefined;
  addEventListenerSpy = vi.fn();

  isSessionValid.mockReset();
  clearSession.mockReset().mockImplementation(async () => {
    events.push('clearSession');
  });

  vi.stubGlobal('window', {
    setInterval: (cb: () => Promise<void>) => {
      capturedTick = cb;
      return 1;
    },
    clearInterval: vi.fn(),
    addEventListener: addEventListenerSpy,
    dispatchEvent: (e: { type: string }) => {
      events.push(`dispatch:${e.type}`);
      return true;
    },
  });
  vi.stubGlobal(
    'CustomEvent',
    class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 载入全新的 sessionManager 单例（配合 resetModules 隔离状态） */
async function loadManager() {
  return import('@/utils/sessionManager');
}

describe('会话过期触发逻辑', () => {
  it('首次检查即无效时不触发过期（避免首次打开误触发）', async () => {
    isSessionValid.mockResolvedValue(false);
    const { sessionManager } = await loadManager();
    sessionManager.startSessionCheck();

    expect(capturedTick).toBeTypeOf('function');
    await capturedTick!();
    await flush();

    expect(events).toEqual([]);
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('会话由有效变为无效时触发：先 clearSession，再派发 sessionExpired', async () => {
    const { sessionManager } = await loadManager();
    sessionManager.startSessionCheck();

    isSessionValid.mockResolvedValue(true);
    await capturedTick!();
    await flush();

    isSessionValid.mockResolvedValue(false);
    await capturedTick!();
    await flush();

    expect(events).toEqual(['clearSession', 'dispatch:sessionExpired']);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('会话持续有效时不触发过期', async () => {
    isSessionValid.mockResolvedValue(true);
    const { sessionManager } = await loadManager();
    sessionManager.startSessionCheck();

    await capturedTick!();
    await flush();
    await capturedTick!();
    await flush();

    expect(events).toEqual([]);
  });

  it('会话已处于无效（无效→无效）时不重复触发', async () => {
    const { sessionManager } = await loadManager();
    sessionManager.startSessionCheck();

    isSessionValid.mockResolvedValue(true);
    await capturedTick!();
    await flush();

    isSessionValid.mockResolvedValue(false);
    await capturedTick!(); // 有效→无效：触发一次
    await flush();
    await capturedTick!(); // 无效→无效：不再触发
    await flush();

    expect(events).toEqual(['clearSession', 'dispatch:sessionExpired']);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });
});

describe('initSessionManager', () => {
  it('启动会话轮询并注册 beforeunload 卸载清理', async () => {
    isSessionValid.mockResolvedValue(true);
    const { initSessionManager } = await loadManager();
    initSessionManager();

    expect(capturedTick).toBeTypeOf('function');
    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });
});
