/**
 * 首次安装自动打开管理页（`entrypoints/background.ts` 的 onInstalled 接线）
 *
 * 这条行为只在「用户刚装好插件」那一刻发生一次，真机之外没有任何路径能触发它，
 * 也没有构建产物可断言——而它的价值恰恰是新手能否找到设置主密码 / 新手引导 /
 * 页内指引这三样东西的入口。装错档（`install` 写成 `update`、或整段被顺手删掉）
 * 不会报错、不会变红，只表现为「新装的用户不知道自己该干什么」。
 *
 * 因此这里把入口的 `main` 真的跑一遍：捕获注册到 `onInstalled` 上的回调，
 * 按不同 `reason` 直接调用，再核对 `openOptionsPage` 的调用次数与时序。
 * 其余 setup / init 全部桩成空函数——本用例要验的是接线，不是它们的内部行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 按调用顺序记录桩函数被触发的名字，用于断言「开页发生在初始化之后且不阻塞」 */
const callOrder = vi.hoisted(() => [] as string[]);

const openOptionsPageMock = vi.hoisted(() =>
  vi.fn(async () => {
    callOrder.push('openOptionsPage');
    return 1234;
  }),
);

vi.mock('@/entrypoints/background/optionsPageManager', () => ({
  openOptionsPage: openOptionsPageMock,
}));

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  setupSidePanelListeners: vi.fn(() => callOrder.push('setupSidePanelListeners')),
}));

vi.mock('@/entrypoints/background/messageRouter', () => ({
  setupMessageRouter: vi.fn(() => callOrder.push('setupMessageRouter')),
}));

vi.mock('@/entrypoints/background/contextMenuManager', () => ({
  setupContextMenu: vi.fn(() => callOrder.push('setupContextMenu')),
}));

vi.mock('@/entrypoints/background/backgroundServices', () => ({
  setupBackgroundServices: vi.fn(() => callOrder.push('setupBackgroundServices')),
  initBackgroundConfig: vi.fn(() => callOrder.push('initBackgroundConfig')),
  beginBrowserStartupRelock: vi.fn(),
  markInstalledBrowserSessionReady: vi.fn(async () => {
    callOrder.push('markInstalledBrowserSessionReady');
    return false;
  }),
}));

vi.mock('@/utils/storage/configManager', () => ({
  freezeLegacyFillDefaults: vi.fn(async () => {
    callOrder.push('freezeLegacyFillDefaults');
  }),
}));

/** 预热走动态 import + fetch，与用例无关，桩掉避免真实网络行为 */
vi.mock('@/utils/warmSidePanelResources', () => ({
  maybeWarmSidePanelResources: vi.fn(async () => {
    callOrder.push('warm');
  }),
}));

import background from '@/entrypoints/background';

type OnInstalledCallback = (details: chrome.runtime.InstalledDetails) => void;

/** 跑一次入口 main，取回注册到 `onInstalled` 上的回调 */
function captureOnInstalledCallback(): OnInstalledCallback {
  const listeners: OnInstalledCallback[] = [];
  const spy = vi.spyOn(chrome.runtime.onInstalled, 'addListener').mockImplementation(cb => {
    listeners.push(cb as OnInstalledCallback);
  });
  (background.main as (ctx?: unknown) => void)();
  spy.mockRestore();
  expect(listeners, '入口没有注册 onInstalled 监听').toHaveLength(1);
  // main 里那批 setup* 与本用例无关，清掉记录，让断言只反映监听回调自己的调用序列
  callOrder.length = 0;
  return listeners[0];
}

describe('首次安装自动打开管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
  });

  it('install：开页排在落盘与配置初始化之后，且不 await 预热', () => {
    const onInstalled = captureOnInstalledCallback();

    onInstalled({ reason: 'install' });

    // 同步快照：三条都是监听函数体内按源码顺序同步发起的调用。
    // `openOptionsPage` 落在最后且与 `warm` 同帧，证明它没被 await（预热走动态 import，
    // 只会在微任务里补进 callOrder），也证明它排在配置初始化之后。
    expect(callOrder).toEqual(['markInstalledBrowserSessionReady', 'initBackgroundConfig', 'openOptionsPage']);
  });

  it('update：不开页，但仍然冻结存量用户的历史填充默认值', () => {
    const onInstalled = captureOnInstalledCallback();

    onInstalled({ reason: 'update' });

    expect(openOptionsPageMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['markInstalledBrowserSessionReady', 'freezeLegacyFillDefaults', 'initBackgroundConfig']);
  });

  it('chrome_update：不开页，也不冻结默认值', () => {
    const onInstalled = captureOnInstalledCallback();

    onInstalled({ reason: 'chrome_update' });

    expect(openOptionsPageMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['markInstalledBrowserSessionReady', 'initBackgroundConfig']);
  });

  it('预热照常触发：开页分支不吃掉跨平台预热', async () => {
    const onInstalled = captureOnInstalledCallback();

    onInstalled({ reason: 'install' });
    await vi.waitFor(() => expect(callOrder).toContain('warm'));

    expect(openOptionsPageMock).toHaveBeenCalledTimes(1);
  });
});
