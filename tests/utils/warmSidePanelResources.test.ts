import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * warmSidePanelResources.ts 单元测试
 *
 * 覆盖四部分可观察契约：
 * - extractSidePanelAssetUrls：从侧边栏 HTML 提取 module 脚本 src、modulepreload 依赖 href
 *   与样式表 href，兼容属性顺序与 media 属性，忽略非 module 脚本 / 非 stylesheet 链接，去重且保持顺序；
 * - extractDynamicImportUrls：从入口 JS 文本中提取动态 import chunk 的相对路径，去重；
 * - extractStaticImportUrls：从 JS 文本中提取静态 import/export 引用的 chunk 相对路径，
 *   不命中动态 import，去重；
 * - maybeWarmSidePanelResources：常规调用仅在 Windows + 会话失效时预热，
 *   ignoreSessionGate（浏览器首启）跨平台预热，且共用 5min 节流
 *   （时间戳持久化于 storage.session，SW 重启不归零），
 *   预热范围覆盖 HTML 静态资源 + 动态 import chunk + 动态 chunk 的二级静态依赖。
 *
 * 说明：
 * - 环境为 node，全局 chrome 由 WxtVitest 的 fakeBrowser 注入；
 * - getPlatformInfo / getURL / fetch 经 mock 从接缝注入，模块级缓存与节流态
 *   通过 vi.resetModules + 动态 import + storage.session 清理隔离。
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
  // 清理持久化的预热节流时间戳，避免用例间互相污染
  await chrome.storage.session.clear();
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

  it('提取 modulepreload 依赖 chunk', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    const html = `
      <script type="module" crossorigin src="/chunks/sidepanel-ABC.js"></script>
      <link rel="modulepreload" crossorigin href="/chunks/runtime-core.esm-bundler-XYZ.js">
      <link rel="modulepreload" crossorigin href="/chunks/logger-DEF.js">
      <link rel="stylesheet" media="print" crossorigin href="/assets/tokens-GHI.css">
    `;
    expect(extractSidePanelAssetUrls(html)).toEqual([
      '/chunks/sidepanel-ABC.js',
      '/chunks/runtime-core.esm-bundler-XYZ.js',
      '/chunks/logger-DEF.js',
      '/assets/tokens-GHI.css',
    ]);
  });

  it('忽略非 module 脚本与非 stylesheet/modulepreload 链接', async () => {
    const { extractSidePanelAssetUrls } = await loadModule();
    const html = `
      <script src="/inline.js"></script>
      <link rel="icon" href="/favicon.png" />
      <link rel="prefetch" href="/prefetch.js" />
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

describe('extractDynamicImportUrls', () => {
  it('提取 import("./xxx.js") 模式的动态 chunk URL', async () => {
    const { extractDynamicImportUrls } = await loadModule();
    const jsText = `
      const a = () => import("./sessionManager-storage-Bji0hXsq.js");
      const b = () => import("./passwordCrud-BUYgQ1T7.js");
      const c = () => import('./HelpDialog-zSjBNfxB.js');
    `;
    expect(extractDynamicImportUrls(jsText)).toEqual([
      './sessionManager-storage-Bji0hXsq.js',
      './passwordCrud-BUYgQ1T7.js',
      './HelpDialog-zSjBNfxB.js',
    ]);
  });

  it('去重重复的动态 import', async () => {
    const { extractDynamicImportUrls } = await loadModule();
    const jsText = `
      import("./passwordCrud-BUYgQ1T7.js");
      import("./passwordCrud-BUYgQ1T7.js");
      import("./HelpDialog-zSjBNfxB.js");
    `;
    expect(extractDynamicImportUrls(jsText)).toEqual(['./passwordCrud-BUYgQ1T7.js', './HelpDialog-zSjBNfxB.js']);
  });

  it('忽略非 .js 后缀和非相对路径的 import', async () => {
    const { extractDynamicImportUrls } = await loadModule();
    const jsText = `
      import("./style.css");
      import("vue");
      import("@/utils/logger");
      import("./valid-chunk-ABC.js");
    `;
    expect(extractDynamicImportUrls(jsText)).toEqual(['./valid-chunk-ABC.js']);
  });

  it('空文本返回空数组', async () => {
    const { extractDynamicImportUrls } = await loadModule();
    expect(extractDynamicImportUrls('')).toEqual([]);
    expect(extractDynamicImportUrls('const x = 1;')).toEqual([]);
  });
});

describe('extractStaticImportUrls', () => {
  it('提取压缩产物中 from"./xxx.js" 与 import"./xxx.js" 模式的静态引用', async () => {
    const { extractStaticImportUrls } = await loadModule();
    const jsText =
      'import{E as a,b as c}from"./css-Dp9q5L7q.js";import"./tokens-DlSzj_g_.js";export{d}from\'./logger-ABC.js\';';
    expect(extractStaticImportUrls(jsText)).toEqual(['./css-Dp9q5L7q.js', './tokens-DlSzj_g_.js', './logger-ABC.js']);
  });

  it('不命中动态 import（带括号），由 extractDynamicImportUrls 单独处理', async () => {
    const { extractStaticImportUrls } = await loadModule();
    const jsText = 'const a = () => import("./dynamic-chunk-XYZ.js");';
    expect(extractStaticImportUrls(jsText)).toEqual([]);
  });

  it('去重重复的静态引用并忽略非 .js / 非相对路径', async () => {
    const { extractStaticImportUrls } = await loadModule();
    const jsText = 'import{a}from"./dep-A.js";import{b}from"./dep-A.js";import{c}from"vue";import"./style.css";';
    expect(extractStaticImportUrls(jsText)).toEqual(['./dep-A.js']);
  });

  it('空文本返回空数组', async () => {
    const { extractStaticImportUrls } = await loadModule();
    expect(extractStaticImportUrls('')).toEqual([]);
    expect(extractStaticImportUrls('const x = 1;')).toEqual([]);
  });
});

describe('maybeWarmSidePanelResources', () => {
  const htmlWithAssets =
    '<link rel="stylesheet" href="/assets/sidepanel.css" /><script type="module" src="/sidepanel.js"></script>';

  /** 让 fetch 对入口 HTML 返回带资源的文本，对其余资源返回空文本 */
  function setupFetchReturningHtml() {
    fetchMock.mockImplementation((input: string) => {
      if (input === SIDEPANEL_HTML_URL) {
        return Promise.resolve({ text: () => Promise.resolve(htmlWithAssets), ok: true } as Response);
      }
      return Promise.resolve({ text: () => Promise.resolve(''), ok: true } as Response);
    });
  }

  it('非 Windows 平台常规调用直接跳过，不发起任何 fetch', async () => {
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

  it('Windows + 会话有效但 ignoreSessionGate=true（浏览器启动冷缓存）时仍预热', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() + 3_600_000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources({ ignoreSessionGate: true });

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
  });

  it('非 Windows 平台但 ignoreSessionGate=true（浏览器首启冷缓存）时跨平台预热', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'mac' });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources({ ignoreSessionGate: true });

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
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

  it('Windows + 会话失效时预热 modulepreload 依赖 chunk', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });

    const htmlWithModulepreload = `
      <script type="module" crossorigin src="/chunks/sidepanel-ABC.js"></script>
      <link rel="modulepreload" crossorigin href="/chunks/runtime-core-XYZ.js">
      <link rel="modulepreload" crossorigin href="/chunks/logger-DEF.js">
      <link rel="stylesheet" media="print" href="/assets/tokens.css">
    `;
    fetchMock.mockImplementation((input: string) => {
      if (input === SIDEPANEL_HTML_URL) {
        return Promise.resolve({ text: () => Promise.resolve(htmlWithModulepreload), ok: true } as Response);
      }
      // 入口 JS 返回不含动态 import 的文本
      return Promise.resolve({ text: () => Promise.resolve('const x = 1;'), ok: true } as Response);
    });
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/chunks/sidepanel-ABC.js', SIDEPANEL_HTML_URL).href);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/chunks/runtime-core-XYZ.js', SIDEPANEL_HTML_URL).href);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/chunks/logger-DEF.js', SIDEPANEL_HTML_URL).href);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/assets/tokens.css', SIDEPANEL_HTML_URL).href);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('Windows + 会话失效时预热入口 JS 中的动态 import chunk', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });

    const htmlWithEntry = '<script type="module" src="/chunks/sidepanel-ABC.js"></script>';
    const entryJsText =
      'const a = () => import("./sessionManager-storage-XYZ.js"); const b = () => import("./HelpDialog-DEF.js");';

    fetchMock.mockImplementation((input: string) => {
      if (input === SIDEPANEL_HTML_URL) {
        return Promise.resolve({ text: () => Promise.resolve(htmlWithEntry), ok: true } as Response);
      }
      if (input === new URL('/chunks/sidepanel-ABC.js', SIDEPANEL_HTML_URL).href) {
        return Promise.resolve({ text: () => Promise.resolve(entryJsText), ok: true } as Response);
      }
      return Promise.resolve({ text: () => Promise.resolve(''), ok: true } as Response);
    });
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    // HTML + 入口 JS + 2 个动态 chunk = 4 次 fetch
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('./sessionManager-storage-XYZ.js', new URL('/chunks/sidepanel-ABC.js', SIDEPANEL_HTML_URL).href).href,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('./HelpDialog-DEF.js', new URL('/chunks/sidepanel-ABC.js', SIDEPANEL_HTML_URL).href).href,
    );
  });

  it('递归预热动态 chunk 静态引入的二级依赖 chunk，且与已预热资源去重', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });

    const entryHref = new URL('/chunks/sidepanel-ABC.js', SIDEPANEL_HTML_URL).href;
    const authViewHref = new URL('./SidepanelAuthView-QRS.js', entryHref).href;
    const cssChunkHref = new URL('./css-Dp9q5L7q.js', entryHref).href;
    const htmlWithEntry = '<script type="module" src="/chunks/sidepanel-ABC.js"></script>';
    // 入口动态 import 认证视图 chunk；认证视图 chunk 静态引入 EP 重组件 chunk
    // 与入口自身（后者已预热，应被去重不重复 fetch）
    const entryJsText = 'const a = () => import("./SidepanelAuthView-QRS.js");';
    const authViewJsText = 'import{E}from"./css-Dp9q5L7q.js";import{L}from"./sidepanel-ABC.js";';

    fetchMock.mockImplementation((input: string) => {
      if (input === SIDEPANEL_HTML_URL) {
        return Promise.resolve({ text: () => Promise.resolve(htmlWithEntry), ok: true } as Response);
      }
      if (input === entryHref) {
        return Promise.resolve({ text: () => Promise.resolve(entryJsText), ok: true } as Response);
      }
      if (input === authViewHref) {
        return Promise.resolve({ text: () => Promise.resolve(authViewJsText), ok: true } as Response);
      }
      return Promise.resolve({ text: () => Promise.resolve(''), ok: true } as Response);
    });
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    // HTML + 入口 JS + 认证视图 chunk + 二级依赖 css chunk = 4 次 fetch（入口自身被去重）
    expect(fetchMock).toHaveBeenCalledWith(cssChunkHref);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('会话键缺失（视为失效）时也执行预热', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
  });

  it('并发调用共享同一 in-flight，仅执行一轮预热', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    // 两个触发源同刻并发（不 await 第一个）：节流判定含多次 await，
    // 若无 in-flight 互斥会双双通过检查并发执行两轮全量 fetch
    await Promise.all([maybeWarmSidePanelResources(), maybeWarmSidePanelResources()]);

    expect(fetchMock.mock.calls.filter(call => call[0] === SIDEPANEL_HTML_URL).length).toBe(1);
  });

  it('节流窗口内的重复调用被去重', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();
    const callsAfterFirst = fetchMock.mock.calls.length;
    await maybeWarmSidePanelResources();

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('节流时间戳持久化：SW 重启（模块重载）后窗口内调用仍被去重', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();
    const callsAfterFirst = fetchMock.mock.calls.length;

    // 模拟 SW 重启：重置模块（内存镜像归零），storage.session 持久化时间戳保留
    vi.resetModules();
    const { maybeWarmSidePanelResources: reloadedWarm } = await loadModule();
    await reloadedWarm();

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('节流窗口过期后（持久化时间戳过旧）重新执行预热', async () => {
    getPlatformInfoMock.mockResolvedValue({ os: 'win' });
    await chrome.storage.local.set({ session_password_expiry: Date.now() - 1000 });
    // 预置一个已过窗口（6 分钟前，超过 5min 节流）的持久化时间戳
    await chrome.storage.session.set({ sidepanel_warm_at: Date.now() - 6 * 60 * 1000 });
    setupFetchReturningHtml();
    const { maybeWarmSidePanelResources } = await loadModule();

    await maybeWarmSidePanelResources();

    expect(fetchMock).toHaveBeenCalledWith(SIDEPANEL_HTML_URL);
  });
});
