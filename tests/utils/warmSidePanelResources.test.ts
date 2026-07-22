import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * warmSidePanelResources.ts 单元测试
 *
 * 覆盖两部分可观察契约：
 * - extractSidePanelAssetUrls：从侧边栏 HTML 提取 module 脚本 src 与样式表 href，
 *   兼容属性顺序与 media 属性，忽略非 module 脚本 / 非 stylesheet 链接，去重且保持顺序；
 * - maybeWarmSidePanelResources：仅在 Windows + 会话失效时预热，且共用 60s 节流。
 *
 * 说明：
 * - 环境为 node，全局 chrome 由 WxtVitest 的 fakeBrowser 注入；
 * - getPlatformInfo / getURL / fetch 经 mock 从接缝注入，模块级缓存与节流态
 *   通过 vi.resetModules + 动态 import 隔离。
 */

const getPlatformInfoMock = vi.fn<() => Promise<{ os: string }>>();
const fetchMock = vi.fn();

/** mock getURL 返回的侧边栏入口绝对 URL（chrome-extension 协议，贴近运行时） */
const SIDEPANEL_HTML_URL = 'chrome-extension://abcdefghijklmnop/sidepanel.html';

beforeEach(async () => {
  vi.resetModules();
  getPlatformInfoMock.mockReset();
  fetchMock.mockReset();

  chrome.runtime.getPlatformInfo = getPlatformInfoMock as unknown as typeof chrome.runtime.getPlatformInfo;
  chrome.runtime.getURL = vi.fn(() => SIDEPANEL_HTML_URL) as unknown as typeof chrome.runtime.getURL;
  global.fetch = fetchMock as unknown as typeof fetch;

  await chrome.storage.local.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 载入全新的 warmSidePanelResources 模块（配合 resetModules 隔离模块级缓存/节流态） */
async function loadModule() {
  return import('@/utils/warmSidePanelResources');
}

describe('extractSidePanelAssetUrls', () => {
  it('提取 module 脚本 src 与样式表 href（脚本在前）', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    const html = `
      <link rel="stylesheet" href="/assets/sidepanel.css" />
      <script type="module" src="/sidepanel.js"></script>
    `;
    expect(extractSidePanelAssetUrls(html)).toEqual(['/sidepanel.js', '/assets/sidepanel.css']);
  });

  it('兼容属性顺序（src/href 位于 type/rel 之前）与 media 属性', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    const html = `
      <script src="/entry.js" type="module"></script>
      <link href="/style.css" media="print" rel="stylesheet" />
    `;
    expect(extractSidePanelAssetUrls(html)).toEqual(['/entry.js', '/style.css']);
  });

  it('忽略非 module 脚本与非 stylesheet 链接', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    const html = `
      <script src="/inline.js"></script>
      <link rel="icon" href="/favicon.png" />
      <script type="module" src="/main.js"></script>
    `;
    expect(extractSidePanelAssetUrls(html)).toEqual(['/main.js']);
  });

  it('去重重复出现的 URL', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    const html = `
      <script type="module" src="/main.js"></script>
      <script type="module" src="/main.js"></script>
    `;
    expect(extractSidePanelAssetUrls(html)).toEqual(['/main.js']);
  });

  it('无匹配 / 空字符串返回空数组', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    expect(extractSidePanelAssetUrls('')).toEqual([]);
    expect(extractSidePanelAssetUrls('<div>no assets here</div>')).toEqual([]);
  });
});

describe('maybeWarmSidePanelResources', () => {
  const htmlWithAssets =
    '<link rel="stylesheet" href="/assets/sidepanel.css" /><script type="module" src="/sidepanel.js"></script>';

  /** 让 fetch 对入口 HTML 返回带资源的文本，对其余资源返回空文本 */
  function setupFetchReturningHtml() {
    fetchMock.mockImplementation((input: string) => {
      if (input === SIDEPANEL_HTML_URL) {
        return Promise.resolve({ text: () => Promise.resolve(htmlWithAssets) } as Response);
      }
      return Promise.resolve({ text: () => Promise.resolve('') } as Response);
    });
  }

  it('非 Windows 平台直接跳过，不发起任何 fetch', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'mac' });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Windows 但会话有效时跳过，不发起任何 fetch', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() + 3_600_000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Windows + 会话失效时预热 sidepanel.html 及其入口资源', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/sidepanel.js', SIDEPANEL_HTML_URL).href);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/assets/sidepanel.css', SIDEPANEL_HTML_URL).href);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('会话键缺失（视为失效）时也执行预热', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
  });

  it('60s 节流窗口内的重复调用被去重', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();
    const callsAfterFirst = fetchMock.mock.calls.length;
    await maybeWarmSidePanelResources();

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
