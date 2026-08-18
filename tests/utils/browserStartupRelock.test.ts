import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markBrowserStartupRelockCurrentSessionReady,
  recoverBrowserStartupRelockAfterAuthentication,
  setBrowserStartupRelockState,
  waitForBrowserStartupRelockBeforeAuthentication,
  waitForBrowserStartupRelockMarker,
  waitForBrowserStartupRelockStatus,
} from '@/utils/browserStartupRelock';

beforeEach(async () => {
  vi.useFakeTimers();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('waitForBrowserStartupRelockMarker', () => {
  it('pending 完成后放行', async () => {
    await setBrowserStartupRelockState('pending');
    const waiting = waitForBrowserStartupRelockMarker();
    setTimeout(() => void setBrowserStartupRelockState('complete'), 50);

    await vi.advanceTimersByTimeAsync(50);
    await expect(waiting).resolves.toBe(true);
  });

  it('failed 与 storage 读取失败均保持锁定', async () => {
    await setBrowserStartupRelockState('failed');
    await expect(waitForBrowserStartupRelockMarker()).resolves.toBe(false);

    vi.spyOn(chrome.storage.session, 'get').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(waitForBrowserStartupRelockMarker()).resolves.toBe(false);
  });

  it('pending 超时只标记数据源暂不可用，不伪装成权威会话失效', async () => {
    await setBrowserStartupRelockState('pending');
    const waiting = waitForBrowserStartupRelockStatus();

    await vi.advanceTimersByTimeAsync(1500);

    await expect(waiting).resolves.toBe('unavailable');
    await setBrowserStartupRelockState('failed');
    await expect(waitForBrowserStartupRelockMarker()).resolves.toBe(false);
  });

  it('marker 尚未写入时按重锁配置 fail-closed，默认关闭则放行', async () => {
    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: true } });
    const guarded = waitForBrowserStartupRelockMarker();
    setTimeout(() => void setBrowserStartupRelockState('pending'), 0);

    await expect(guarded).resolves.toBe(false);

    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: false } });
    await chrome.storage.session.clear();
    await expect(waitForBrowserStartupRelockMarker()).resolves.toBe(true);
  });

  it('非认证初始化不能覆盖 pending/failed，显式认证可精确恢复 failed', async () => {
    await setBrowserStartupRelockState('pending');
    await expect(markBrowserStartupRelockCurrentSessionReady()).resolves.toBe(false);

    await setBrowserStartupRelockState('failed');
    await expect(markBrowserStartupRelockCurrentSessionReady()).resolves.toBe(false);
    await expect(waitForBrowserStartupRelockMarker()).resolves.toBe(false);

    await expect(recoverBrowserStartupRelockAfterAuthentication()).resolves.toBe(true);
    await expect(waitForBrowserStartupRelockMarker()).resolves.toBe(true);
  });

  it('新会话写入前等待 pending 完成，避免迟到清理删除刚创建的会话', async () => {
    await setBrowserStartupRelockState('pending');
    const waiting = waitForBrowserStartupRelockBeforeAuthentication();
    setTimeout(() => void setBrowserStartupRelockState('complete'), 50);

    await vi.advanceTimersByTimeAsync(50);

    await expect(waiting).resolves.toBe(true);
  });

  it('重锁开启且 marker 尚未提交时不会提前创建会话，会等待启动处理进入终态', async () => {
    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: true } });
    const waiting = waitForBrowserStartupRelockBeforeAuthentication();
    setTimeout(() => void setBrowserStartupRelockState('pending'), 25);
    setTimeout(() => void setBrowserStartupRelockState('complete'), 75);

    await vi.advanceTimersByTimeAsync(75);

    await expect(waiting).resolves.toBe(true);
  });
});
