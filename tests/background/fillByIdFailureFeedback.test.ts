/**
 * 内联下拉填充失败的反馈通道回归测试（FILL_BY_ID）
 *
 * 背景：`InlineFillDropdown.select()` 发出 FILL_BY_ID 后立刻收起面板，失败只在 content 侧
 * `logger.warn`。而三条「后台就判死」的路径里，content script 从未收到填充指令，页面侧
 * 「找不到表单」的就地引导（FillFailurePrompt）也就不会触发，用户看到的只是「点了没反应」：
 * 1. `isFrameFillable` 拒绝（跨域 iframe 里的账号被点）；
 * 2. 会话已锁定或条目已删除（`getDecryptedEntryById` 返回 null）；
 * 3. `tabs.sendMessage` 抛错（目标 frame 未注入、标签页已销毁）。
 *
 * 本测试锁定这三条路径经 `showPageNotice` 补发页面提示条（不依赖系统通知权限的兜底通道），并锁定边界：
 * - 提示条载荷只取 `tl()` 固定串——异常文本可能夹带 URL 等页面可控内容，不进提示条；
 * - 「Receiving end does not exist」竞态保持静默：用户已经在新页面上，提示条会落在他没点过的页面；
 * - 成功路径不补发；缺失 tabId 时不补发（没有可下发的标签页）；
 * - 被拒 frame 不会触达明文读取（`getDecryptedEntryById` 在门控之后）。
 *
 * 反向验证——移除 messageRouter 中任一 `showPageNotice` 调用，对应断言必然失败。
 */
import { type Mock, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setupMessageRouter } from '@/entrypoints/background/messageRouter';
import { getDecryptedEntryById } from '@/entrypoints/background/passwordCache';
import { showPageNotice } from '@/entrypoints/background/quickFillHandler';
import { isFrameFillable } from '@/utils/frameFill';
import { MessageType } from '@/utils/types';
import { tl } from '@/utils/i18n-lite';

vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 仅测试纯校验函数，将 router 的重依赖全部 mock 为轻量 stub，保证测试密闭
vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getTabIdSync: vi.fn(),
  openSidePanelAndRespond: vi.fn(),
  closeSidePanelWithResponse: vi.fn(),
  isSidePanelOpen: vi.fn(() => false),
  getSidePanelPorts: vi.fn(() => []),
}));

vi.mock('@/entrypoints/background/optionsPageManager', () => ({
  openOptionsPage: vi.fn(),
  openOptionsAndSendMessage: vi.fn(),
}));

vi.mock('@/entrypoints/background/passwordCache', () => ({
  getCachedPasswords: vi.fn(),
  invalidatePasswordCache: vi.fn(),
  getCachedSortConfig: vi.fn(),
  warmPasswordCache: vi.fn(),
  getOrWarmCache: vi.fn(),
  getMatchingAccounts: vi.fn(),
  getDecryptedEntryById: vi.fn(),
  getInlineTotpCode: vi.fn(),
  recordPendingTotpIfEligible: vi.fn(),
  consumePendingTotp: vi.fn(),
  clearPendingTotp: vi.fn(),
  grantCredentialAccessAfterStartupRelock: vi.fn(),
}));

vi.mock('@/entrypoints/background/autoSaveHandler', () => ({
  handleAutoSavePassword: vi.fn(),
  handleCheckCredentialStatus: vi.fn(),
}));

vi.mock('@/entrypoints/background/quickAddHandler', () => ({
  handleQuickAddPassword: vi.fn(),
}));

// 提示条通道本身由 quickFillHandler.test.ts 覆盖，这里只验证「是否被调用、载荷是什么」
vi.mock('@/entrypoints/background/quickFillHandler', () => ({
  handleQuickFill: vi.fn(),
  deliverPageNotice: vi.fn(async () => true),
  showPageNotice: vi.fn(async () => {}),
}));

vi.mock('@/entrypoints/background/inlineDropdownHandler', () => ({
  handleOpenInlineDropdown: vi.fn(),
}));

vi.mock('@/entrypoints/background/backgroundServices', () => ({
  performUpdateCheck: vi.fn(),
  syncSwKeepaliveAlarm: vi.fn(),
  waitForBrowserStartupRelock: vi.fn(async () => true),
}));

vi.mock('@/utils/storage/passwordCrud', () => ({
  METADATA_FIELDS: [],
}));

vi.mock('@/utils/frameFill', () => ({
  isFrameFillable: vi.fn(async () => true),
}));

/** 构造内容脚本发送方上下文（frameId 显式给出，0 表示顶层 frame） */
const contentSender = (tabId: number, frameId: number): chrome.runtime.MessageSender =>
  ({
    id: chrome.runtime.id,
    tab: { id: tabId, url: 'https://example.com/login' },
    frameId,
  }) as chrome.runtime.MessageSender;

/** 无 tab 上下文的发送方（扩展内部页面 / 无法归属来源） */
const noTabSender = (): chrome.runtime.MessageSender => ({ id: chrome.runtime.id }) as chrome.runtime.MessageSender;

/** FILL_BY_ID 载荷 */
const fillData = { id: 'entry-1' };

/**
 * 注册路由并捕获监听器
 *
 * @returns 可直接调用的消息处理函数（message, sender, sendResponse）
 */
const captureListener = () => {
  const addListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener');
  setupMessageRouter();
  const calls = addListenerSpy.mock.calls;
  const listener = calls[calls.length - 1][0] as (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => unknown;
  addListenerSpy.mockRestore();
  return listener;
};

/** 发送一条 FILL_BY_ID（各用例只关心 sender 与响应，载荷统一） */
const sendFillById = (
  listener: ReturnType<typeof captureListener>,
  sender: chrome.runtime.MessageSender,
  sendResponse: Mock,
) => listener({ type: MessageType.FILL_BY_ID, data: fillData }, sender, sendResponse);

const mockedShowPageNotice = vi.mocked(showPageNotice);
const mockedGetEntry = vi.mocked(getDecryptedEntryById);
const mockedIsFrameFillable = vi.mocked(isFrameFillable);

/** 填充指令的下发记录（同时承担「提示条是否真的送达页面」的判据） */
let sendSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsFrameFillable.mockResolvedValue(true);
  mockedGetEntry.mockResolvedValue(null);
  sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined as never);
});

afterEach(() => {
  sendSpy.mockRestore();
});

describe('FILL_BY_ID 被后台拒绝时的页面反馈', () => {
  it('跨域 frame 被拒：补发提示条，且不下发填充指令、不读明文', async () => {
    mockedIsFrameFillable.mockResolvedValue(false);
    const listener = captureListener();
    const sendResponse = vi.fn();

    expect(sendFillById(listener, contentSender(1, 3), sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));

    expect(mockedShowPageNotice).toHaveBeenCalledWith(1, tl('bg.router.frameDenied'));
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: tl('bg.router.frameDenied') });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(mockedGetEntry).not.toHaveBeenCalled();
  });

  it('会话锁定或账号不存在：补发提示条', async () => {
    mockedGetEntry.mockResolvedValue(null);
    const listener = captureListener();
    const sendResponse = vi.fn();

    sendFillById(listener, contentSender(2, 0), sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));

    expect(mockedShowPageNotice).toHaveBeenCalledWith(2, tl('bg.router.sessionOrAccount'));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('缺失 tabId（非页面上下文发起）：只回告发起方，不补发提示条', () => {
    const listener = captureListener();
    const sendResponse = vi.fn();

    // 拿不到 tabId 就无法定向下发，这条分支必须是同步 break（不保持通道）
    expect(sendFillById(listener, noTabSender(), sendResponse)).not.toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(mockedShowPageNotice).not.toHaveBeenCalled();
    expect(mockedIsFrameFillable).not.toHaveBeenCalled();
  });
});

describe('FILL_BY_ID 下发异常时的页面反馈', () => {
  it('目标 frame 未注入：补发固定文案，异常原文不进提示条', async () => {
    mockedGetEntry.mockResolvedValue({ id: 'entry-1', username: 'u', password: 'p' } as never);
    sendSpy.mockRejectedValue(new Error('Could not establish connection. Receiving end https://evil.example/'));
    const listener = captureListener();
    const sendResponse = vi.fn();

    sendFillById(listener, contentSender(5, 0), sendResponse);
    await vi.waitFor(() => expect(mockedShowPageNotice).toHaveBeenCalledTimes(1));

    expect(mockedShowPageNotice.mock.calls[0]).toEqual([5, tl('bg.router.fillFailed')]);
    expect(mockedShowPageNotice.mock.calls[0][1]).not.toContain('evil.example');
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ success: false, message: tl('bg.router.fillFailed') }),
    );
  });

  it('导航/刷新竞态（接收端已不存在）：保持静默，不在新页面补发', async () => {
    mockedGetEntry.mockResolvedValue({ id: 'entry-1', username: 'u', password: 'p' } as never);
    sendSpy.mockRejectedValue(new Error('Receiving end does not exist.'));
    const listener = captureListener();
    const sendResponse = vi.fn();

    sendFillById(listener, contentSender(5, 0), sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));

    expect(mockedShowPageNotice).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: tl('bg.router.fillFailed') });
  });
});

describe('FILL_BY_ID 成功时不产生多余反馈', () => {
  it('填充成功：不补发提示条，仍回传内容脚本结果', async () => {
    mockedGetEntry.mockResolvedValue({ id: 'entry-1', username: 'u', password: 'p' } as never);
    sendSpy.mockResolvedValue({ success: true, message: 'ok' } as never);
    const listener = captureListener();
    const sendResponse = vi.fn();

    sendFillById(listener, contentSender(9, 0), sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'ok' }));

    expect(mockedShowPageNotice).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      9,
      { type: MessageType.FILL_PASSWORD, data: expect.any(Object) },
      { frameId: 0 },
    );
  });
});
