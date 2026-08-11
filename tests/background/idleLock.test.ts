import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { MessageType } from '@/utils/types';

/**
 * backgroundServices.handleIdleStateChange 单元测试
 *
 * 覆盖闲置锁定核心决策语义：
 * - 'idle'（闲置达用户设定阈值）与 'locked'（系统锁屏/屏保）均触发锁定；
 * - 'active' 等其他状态不触发；
 * - 闲置锁定未启用（minutes=0 / 未配置）时任何状态均不锁定；
 * - 锁定动作链：clearSession → 侧边栏 port 通知 SESSION_EXPIRED → runtime 广播。
 *
 * 重依赖均经 mock 从接缝注入：
 * - @/utils/storage（动态导入的 StorageUtils.clearSession）；
 * - @/utils/platform（平台判定固定为非 Windows，使保活同步走确定性分支）；
 * - sidePanelManager.getSidePanelPort（控制 port 有无）。
 */

const clearSessionMock = vi.fn(async () => {});
vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    clearSession: () => clearSessionMock(),
  },
}));

vi.mock('@/utils/platform', () => ({
  detectWindowsPlatform: vi.fn(async () => false),
}));

const postMessageMock = vi.fn();
const getSidePanelPortMock = vi.fn(() => null as { postMessage: typeof postMessageMock } | null);
vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPort: () => getSidePanelPortMock(),
}));

import { handleIdleStateChange } from '@/entrypoints/background/backgroundServices';

/** 写入闲置锁定配置（分钟数） */
async function setIdleLockMinutes(minutes: number): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.IDLE_LOCK_CONFIG]: { idleLockMinutes: minutes },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  getSidePanelPortMock.mockReturnValue(null);
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

describe('handleIdleStateChange', () => {
  it("'active' 状态不触发锁定", async () => {
    await setIdleLockMinutes(10);
    await handleIdleStateChange('active');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('闲置锁定未启用（minutes=0）时 idle 不锁定', async () => {
    await setIdleLockMinutes(0);
    await handleIdleStateChange('idle');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('闲置锁定未配置时 locked 不锁定', async () => {
    await handleIdleStateChange('locked');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it("闲置达阈值（'idle'）触发锁定并清除会话", async () => {
    await setIdleLockMinutes(10);
    await handleIdleStateChange('idle');
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it("系统锁屏（'locked'）触发锁定并清除会话", async () => {
    await setIdleLockMinutes(10);
    await handleIdleStateChange('locked');
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it('锁定时通知侧边栏 port 并广播 SESSION_EXPIRED', async () => {
    getSidePanelPortMock.mockReturnValue({ postMessage: postMessageMock });
    await setIdleLockMinutes(10);

    await handleIdleStateChange('idle');

    expect(postMessageMock).toHaveBeenCalledWith({ type: MessageType.SESSION_EXPIRED });
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it('侧边栏 port 不存在时锁定流程正常完成（无 port 通知）', async () => {
    getSidePanelPortMock.mockReturnValue(null);
    await setIdleLockMinutes(5);

    await handleIdleStateChange('idle');

    expect(postMessageMock).not.toHaveBeenCalled();
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });
});
