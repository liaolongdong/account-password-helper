/**
 * 内容脚本自报 URL 可信性校验回归测试
 *
 * 背景：AUTO_SAVE_PASSWORD / CHECK_CREDENTIAL_STATUS 的 data.url 为内容脚本自报值，
 * 恶意页面可谎报归属域名，把捕获的凭证写入或比对到任意目标站点名下。
 * messageRouter 必须以发送方上下文推导的 sender.tab.url 为准，
 * 仅当自报 URL 与之同主域名时放行，否则 fail-closed。
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveTrustedContentUrl, setupMessageRouter } from '@/entrypoints/background/messageRouter';
import { handleQuickAddPassword } from '@/entrypoints/background/quickAddHandler';
import { MessageType } from '@/utils/types';

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

vi.mock('@/entrypoints/background/quickFillHandler', () => ({
  handleQuickFill: vi.fn(),
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

/** 构造内容脚本发送方上下文 */
const contentSender = (tabUrl: string, tabId = 1): chrome.runtime.MessageSender =>
  ({ id: chrome.runtime.id, tab: { id: tabId, url: tabUrl } }) as chrome.runtime.MessageSender;

describe('resolveTrustedContentUrl（自报 URL 可信性校验）', () => {
  describe('合法场景（放行）', () => {
    it('顶层页面自报自身 hostname', () => {
      expect(resolveTrustedContentUrl('example.com', contentSender('https://example.com/login'))).toBe('example.com');
    });

    it('自报 host:port 形式被接受（按主机名同主域校验，端口不参与比对）', () => {
      expect(resolveTrustedContentUrl('localhost:3000', contentSender('http://localhost:3000/app'))).toBe(
        'localhost:3000',
      );
      expect(resolveTrustedContentUrl('127.0.0.1:8080', contentSender('http://127.0.0.1:8080/'))).toBe(
        '127.0.0.1:8080',
      );
    });

    it('同主域名跨子域名（顶层与其嵌入的同主域名页面互认）', () => {
      expect(resolveTrustedContentUrl('accounts.example.com', contentSender('https://www.example.com/'))).toBe(
        'accounts.example.com',
      );
    });

    it('两段式 ccTLD 同主域名', () => {
      expect(resolveTrustedContentUrl('login.example.com.cn', contentSender('https://api.example.com.cn/'))).toBe(
        'login.example.com.cn',
      );
    });

    it('自报完整 URL 与发送页面同主域名', () => {
      expect(resolveTrustedContentUrl('https://example.com/path', contentSender('https://example.com/'))).toBe(
        'https://example.com/path',
      );
    });

    it('去除首尾空白后校验并返回', () => {
      expect(resolveTrustedContentUrl('  example.com  ', contentSender('https://example.com/'))).toBe('example.com');
    });
  });

  describe('非法场景（fail-closed 返回 null）', () => {
    it('冒名其他主域名', () => {
      expect(resolveTrustedContentUrl('bank.com', contentSender('https://attacker.com/'))).toBeNull();
    });

    it('冒名两段式 ccTLD 下的其他主域名', () => {
      expect(resolveTrustedContentUrl('evil.com.cn', contentSender('https://x.example.com.cn/'))).toBeNull();
    });

    it('localhost 与 127.0.0.1 互不冒名', () => {
      expect(resolveTrustedContentUrl('localhost', contentSender('http://127.0.0.1:8080/'))).toBeNull();
      expect(resolveTrustedContentUrl('127.0.0.1', contentSender('http://localhost:3000/'))).toBeNull();
    });

    it('自报值无法解析为 URL', () => {
      expect(resolveTrustedContentUrl('not a valid url ???', contentSender('https://example.com/'))).toBeNull();
    });

    it('自报值缺失或非字符串', () => {
      expect(resolveTrustedContentUrl(undefined, contentSender('https://example.com/'))).toBeNull();
      expect(resolveTrustedContentUrl('', contentSender('https://example.com/'))).toBeNull();
      expect(resolveTrustedContentUrl('   ', contentSender('https://example.com/'))).toBeNull();
      expect(resolveTrustedContentUrl(12345, contentSender('https://example.com/'))).toBeNull();
    });

    it('发送方无 tab 上下文（无法校验来源）', () => {
      expect(
        resolveTrustedContentUrl('example.com', { id: chrome.runtime.id } as chrome.runtime.MessageSender),
      ).toBeNull();
    });

    it('发送方 tab.url 缺失', () => {
      expect(
        resolveTrustedContentUrl('example.com', {
          id: chrome.runtime.id,
          tab: { id: 1 },
        } as chrome.runtime.MessageSender),
      ).toBeNull();
    });
  });
});

describe('QUICK_ADD_PASSWORD 路由发送者守卫（分发级）', () => {
  const quickAddData = { username: 'user', password: 'pass', url: 'example.com' };

  /** 捕获 setupMessageRouter 注册的路由监听器 */
  const setupAndCaptureListener = () => {
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

  it('内容脚本发送方被同步拒绝，不落盘', () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener(
      { type: MessageType.QUICK_ADD_PASSWORD, data: quickAddData },
      contentSender('https://evil.com/'),
      sendResponse,
    );

    expect(handleQuickAddPassword).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).not.toBe(true);
  });

  it('扩展内部页面发送方放行，异步结果经 sendResponse 回传', async () => {
    vi.mocked(handleQuickAddPassword).mockResolvedValue({ success: true, message: 'bg.quickAdd.success' });
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener(
      { type: MessageType.QUICK_ADD_PASSWORD, data: quickAddData },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse,
    );

    // 异步路径必须返回 true 保持消息通道
    expect(result).toBe(true);
    expect(handleQuickAddPassword).toHaveBeenCalledWith(quickAddData);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'bg.quickAdd.success' }),
    );
  });
});
