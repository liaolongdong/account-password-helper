import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

const storageMocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  getIdleLockConfig: vi.fn(),
}));

vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    clearSession: storageMocks.clearSession,
    getIdleLockConfig: storageMocks.getIdleLockConfig,
  },
}));

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPorts: () => [],
}));

import {
  beginBrowserStartupRelock,
  handleBrowserStartupRelock,
  markInstalledBrowserSessionReady,
  waitForBrowserStartupRelock,
} from '@/entrypoints/background/backgroundServices';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('浏览器启动重锁屏障', () => {
  it('重锁配置关闭时保持原会话且快速完成', async () => {
    storageMocks.getIdleLockConfig.mockResolvedValue({ relockOnBrowserRestart: false });

    await expect(handleBrowserStartupRelock()).resolves.toBe(true);
    expect(storageMocks.clearSession).not.toHaveBeenCalled();
  });

  it('onInstalled 仅在已有当前浏览器会话镜像时写 recovery', async () => {
    await expect(markInstalledBrowserSessionReady()).resolves.toBe(false);
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]: { locked: false, expiresAt: Date.now() + 60_000 },
    });

    await expect(markInstalledBrowserSessionReady()).resolves.toBe(true);
    const recovery = await chrome.storage.session.get(SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY);
    expect(recovery[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY]).toMatchObject({
      failedUpdatedAt: null,
    });
  });

  it('重锁清理失败时 fail-closed', async () => {
    storageMocks.getIdleLockConfig.mockResolvedValue({ relockOnBrowserRestart: true });
    storageMocks.clearSession.mockRejectedValue(new Error('storage unavailable'));

    await expect(handleBrowserStartupRelock()).resolves.toBe(false);
  });

  it('立即到达的数据请求会等待延迟的 clearSession 完成', async () => {
    let finishClear!: () => void;
    storageMocks.getIdleLockConfig.mockResolvedValue({ relockOnBrowserRestart: true });
    storageMocks.clearSession.mockImplementation(() => new Promise<void>(resolve => (finishClear = resolve)));

    beginBrowserStartupRelock();
    const waiting = waitForBrowserStartupRelock();
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(false);
    const pending = await chrome.storage.session.get(SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE);
    expect(pending[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE]).toMatchObject({ status: 'pending' });

    // onInstalled 与 onStartup 交错时不能把 pending 改成 complete/recovery-ready。
    await expect(markInstalledBrowserSessionReady()).resolves.toBe(false);
    const stillPending = await chrome.storage.session.get([
      SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE,
      SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY,
    ]);
    expect(stillPending[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE]).toMatchObject({ status: 'pending' });
    expect(stillPending[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_RECOVERY]).toBeUndefined();

    finishClear();
    await expect(waiting).resolves.toBe(true);
    const complete = await chrome.storage.session.get(SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE);
    expect(complete[SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE]).toMatchObject({ status: 'complete' });
  });
});
