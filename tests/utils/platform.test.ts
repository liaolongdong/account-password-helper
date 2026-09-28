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
 * 并锁定 isMacPlatform 的同步嗅探契约：userAgentData.platform 优先于已废弃的
 * navigator.platform，两者皆不可得时按非 Apple 平台处理。该判定必须可预测：
 * Node 会将 `navigator.platform` 继承为宿主机的值（在 macOS 上为 `MacIntel`），
 * 因此本组用例全部显式覆盖全局 navigator 的形态，不依赖运行机器（覆盖方式见
 * describe 内注释：不用 vi.stubGlobal，以免连带清除 fakeBrowser 注入的 chrome）。
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

/**
 * isMacPlatform 同步嗅探
 *
 * 不涉 chrome.runtime，每次调用直读 navigator，故无模块级缓存需隔离。
 */
describe('isMacPlatform', () => {
  /**
   * Node 22 将 navigator 定义为 globalThis 上的可配置访问器属性，可安全覆盖与还原。
   *
   * 此处刻意不用 vi.stubGlobal / vi.unstubAllGlobals：后者会把 WxtVitest 注入的
   * chrome 全局一并清除，使后续用例的 beforeEach 在 chrome.runtime 上抛
   * ReferenceError。手动还原只影响 navigator 自身。
   */
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  });

  /** 以指定形态覆盖全局 navigator；不传参则模拟 navigator 不可得 */
  function stubNavigator(shape?: { platform?: string; userAgentPlatform?: string }) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: shape
        ? {
            platform: shape.platform,
            userAgentData: shape.userAgentPlatform ? { platform: shape.userAgentPlatform } : undefined,
          }
        : undefined,
    });
  }

  it('navigator.platform 为 MacIntel 时返回 true', async () => {
    stubNavigator({ platform: 'MacIntel' });
    const { isMacPlatform } = await loadPlatform();

    expect(isMacPlatform()).toBe(true);
  });

  it('userAgentData.platform 为 macOS 时返回 true', async () => {
    stubNavigator({ userAgentPlatform: 'macOS' });
    const { isMacPlatform } = await loadPlatform();

    expect(isMacPlatform()).toBe(true);
  });

  it('iOS 设备（iPhone / iPad）同样归为 Apple 平台', async () => {
    const { isMacPlatform } = await loadPlatform();

    stubNavigator({ platform: 'iPhone' });
    expect(isMacPlatform()).toBe(true);

    stubNavigator({ platform: 'iPad' });
    expect(isMacPlatform()).toBe(true);
  });

  it('userAgentData.platform 优先于已废弃的 navigator.platform', async () => {
    // 结构化 UA 明确为 Windows 时，不得因遗留的 MacIntel 而误判
    stubNavigator({ platform: 'MacIntel', userAgentPlatform: 'Windows' });
    const { isMacPlatform } = await loadPlatform();

    expect(isMacPlatform()).toBe(false);
  });

  it('Windows 与 Linux 平台返回 false', async () => {
    const { isMacPlatform } = await loadPlatform();

    stubNavigator({ platform: 'Win32' });
    expect(isMacPlatform()).toBe(false);

    stubNavigator({ platform: 'Linux x86_64' });
    expect(isMacPlatform()).toBe(false);
  });

  it('navigator 不可得时返回 false（如 Node 测试环境无 DOM navigator）', async () => {
    stubNavigator();
    const { isMacPlatform } = await loadPlatform();

    expect(isMacPlatform()).toBe(false);
  });

  it('platform 字段缺失或为空时返回 false，不抛异常', async () => {
    const { isMacPlatform } = await loadPlatform();

    stubNavigator({ platform: '' });
    expect(isMacPlatform()).toBe(false);

    stubNavigator({});
    expect(isMacPlatform()).toBe(false);
  });
});
