import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * platform.ts 单元测试
 *
 * 锁定 isWindowsPlatform / detectWindowsPlatform 的可观察契约：
 * - os === 'win' → true；其它平台 → false；
 * - 成功结果在模块生命周期内缓存（多次调用仅触发一次 getPlatformInfo），
 *   并持久化到 storage.local 供后续异常兜底；
 * - 并发调用共享同一 in-flight（并发去重）；
 * - getPlatformInfo 抛错时：有持久化兜底则返回持久化值并缓存；
 *   无兜底则 detect 返回 null（isWindowsPlatform 回退 false），失败不缓存，
 *   下次调用重新尝试检测。
 *
 * 说明：
 * - 环境为 node，全局 chrome 由 WxtVitest 的 fakeBrowser 注入；
 * - getPlatformInfo 经 mock 从接缝注入，模块内部缓存通过 vi.resetModules + 动态 import 隔离。
 */

const getPlatformInfoMock = vi.fn<() => Promise<{ os: string }>>();

beforeEach(async () => {
  vi.resetModules();
  getPlatformInfoMock.mockReset();
  // 将 mock 注入 fake chrome.runtime，模块在调用时读取，故 mock 生效
  chrome.runtime.getPlatformInfo = getPlatformInfoMock as unknown as typeof chrome.runtime.getPlatformInfo;
  // 清理平台判定持久化，避免用例间互相污染
  await chrome.storage.local.clear();
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

  it('getPlatformInfo 抛错且无持久化兜底时回退为 false，失败不缓存（下次调用重试）', async () => {
    getPlatformInfoMock.mockRejectedValue(new Error('platform info unavailable'));
    const { isWindowsPlatform } = await loadPlatform();

    await expect(isWindowsPlatform()).resolves.toBe(false);
    // 失败结果不缓存：再次调用会重新触发 getPlatformInfo
    await expect(isWindowsPlatform()).resolves.toBe(false);
    expect(getPlatformInfoMock).toHaveBeenCalledTimes(2);
  });

  it('getPlatformInfo 抛错但存在持久化兜底时返回持久化值并缓存', async () => {
    await chrome.storage.local.set({ platform_is_windows: true });
    getPlatformInfoMock.mockRejectedValue(new Error('platform info unavailable'));
    const { isWindowsPlatform } = await loadPlatform();

    await expect(isWindowsPlatform()).resolves.toBe(true);
    // 兜底结果已缓存：再次调用不再触发 getPlatformInfo
    await expect(isWindowsPlatform()).resolves.toBe(true);
    expect(getPlatformInfoMock).toHaveBeenCalledTimes(1);
  });

  it('检测成功时将结果持久化到 storage.local', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    const { isWindowsPlatform } = await loadPlatform();

    await isWindowsPlatform();
    // fire-and-forget 写入，等待微任务队列排空
    await new Promise(resolve => setTimeout(resolve, 0));

    const result = await chrome.storage.local.get('platform_is_windows');
    expect(result['platform_is_windows']).toBe(true);
  });
});

describe('detectWindowsPlatform', () => {
  it('抛错且无持久化兜底时返回 null（判定不可得）', async () => {
    getPlatformInfoMock.mockRejectedValue(new Error('platform info unavailable'));
    const { detectWindowsPlatform } = await loadPlatform();

    await expect(detectWindowsPlatform()).resolves.toBeNull();
  });

  it('检测成功时返回布尔结果', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'mac' });
    const { detectWindowsPlatform } = await loadPlatform();

    await expect(detectWindowsPlatform()).resolves.toBe(false);
  });
});
