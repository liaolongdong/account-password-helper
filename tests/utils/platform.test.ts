import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * platform.ts 单元测试
 *
 * 锁定 isWindowsPlatform 的可观察契约：
 * - os === 'win' → true；其它平台 → false；
 * - 结果在模块生命周期内缓存（多次调用仅触发一次 getPlatformInfo）；
 * - 并发调用共享同一 in-flight（并发去重）；
 * - getPlatformInfo 抛错时回退为 false，且该回退结果同样被缓存。
 *
 * 说明：
 * - 环境为 node，全局 chrome 由 WxtVitest 的 fakeBrowser 注入；
 * - getPlatformInfo 经 mock 从接缝注入，模块内部缓存通过 vi.resetModules + 动态 import 隔离。
 */

const getPlatformInfoMock = vi.fn<() => Promise<{ os: string }>>();

beforeEach(() => {
  vi.resetModules();
  getPlatformInfoMock.mockReset();
  // 将 mock 注入 fake chrome.runtime，模块在调用时读取，故 mock 生效
  chrome.runtime.getPlatformInfo = getPlatformInfoMock as unknown as typeof chrome.runtime.getPlatformInfo;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 载入全新的 platform 模块（配合 resetModules 隔离模块级缓存） */
async function loadPlatform() {
  return import('@/utils/platform');
}

describe('isWindowsPlatform', () => {
  it('os 为 win 时返回 true', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    const { isWindowsPlatform } = await loadPlatform();

    await expect(isWindowsPlatform()).resolves.toBe(true);
  });

  it('os 为 mac 时返回 false', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'mac' });
    const { isWindowsPlatform } = await loadPlatform();

    await expect(isWindowsPlatform()).resolves.toBe(false);
  });

  it('os 为其它平台（linux）时返回 false', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'linux' });
    const { isWindowsPlatform } = await loadPlatform();

    await expect(isWindowsPlatform()).resolves.toBe(false);
  });

  it('多次调用命中缓存，仅触发一次 getPlatformInfo', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    const { isWindowsPlatform } = await loadPlatform();

    await isWindowsPlatform();
    await isWindowsPlatform();
    await isWindowsPlatform();

    expect(getPlatformInfoMock).toHaveBeenCalledTimes(1);
  });

  it('并发调用共享同一 in-flight，仅触发一次 getPlatformInfo', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    const { isWindowsPlatform } = await loadPlatform();

    const [a, b] = await Promise.all([isWindowsPlatform(), isWindowsPlatform()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(getPlatformInfoMock).toHaveBeenCalledTimes(1);
  });

  it('getPlatformInfo 抛错时回退为 false，且回退结果被缓存', async () => {
    getPlatformInfoMock.mockRejectedValue(new Error('platform info unavailable'));
    const { isWindowsPlatform } = await loadPlatform();

    await expect(isWindowsPlatform()).resolves.toBe(false);
    // 回退结果已缓存：再次调用不再触发 getPlatformInfo
    await expect(isWindowsPlatform()).resolves.toBe(false);
    expect(getPlatformInfoMock).toHaveBeenCalledTimes(1);
  });
});
