/**
 * 内容脚本自报 URL / 域名可信性校验回归测试
 *
 * 背景：AUTO_SAVE_PASSWORD / CHECK_CREDENTIAL_STATUS 的 data.url 为内容脚本自报值，
 * 恶意页面可谎报归属域名，把捕获的凭证写入或比对到任意目标站点名下。
 * messageRouter 必须以发送方上下文推导的 sender.tab.url 为准，
 * 仅当自报 URL 与之同主域名时放行，否则 fail-closed。
 *
 * 同理，OPEN_OPTIONS_AND_SITE_RULES 的 data.domain 也是内容脚本自报值，会被选项页
 * 直接写成站点规则主键，路由层必须先规范化/校验再转发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTrustedContentUrl, setupMessageRouter } from '@/entrypoints/background/messageRouter';
import { handleQuickAddPassword } from '@/entrypoints/background/quickAddHandler';
import { openOptionsAndSendMessage, openOptionsPage } from '@/entrypoints/background/optionsPageManager';
import { handleQuickFill } from '@/entrypoints/background/quickFillHandler';
import { handleOpenInlineDropdown } from '@/entrypoints/background/inlineDropdownHandler';
import { warmPasswordCache } from '@/entrypoints/background/passwordCache';
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

/**
 * 捕获 setupMessageRouter 注册的路由监听器
 *
 * @returns 可直接调用的消息处理函数（message, sender, sendResponse）
 */
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

// 路由分发级用例依赖 handler mock 的调用记录做断言；vitest 未全局清 mock，
// 逐个用例前清空调用历史（clearAllMocks 只清 calls/结果，保留工厂里的 stub 实现），
// 保证「内容脚本被拒 → handler 未被调用」这类断言不受相邻用例污染。
beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('GET_PENDING_CIPHER_KEY 路由分发（凭据密钥签发）', () => {
  it('内容脚本发送方经异步通道拿到 64 位 hex 密钥', async () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener(
      { type: MessageType.GET_PENDING_CIPHER_KEY },
      contentSender('https://example.com/'),
      sendResponse,
    );

    // sendResponse 在 Promise 续体中调用，处理器必须返回 true 保持通道
    expect(result).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(sendResponse).toHaveBeenCalledWith({ key: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('无法归属来源（无 tab 上下文）时 fail-closed 返回 key: null', async () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    listener(
      { type: MessageType.GET_PENDING_CIPHER_KEY },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ key: null }));
  });
});

describe('B2 改状态消息的 sender 收口（分发级）', () => {
  /** 扩展内部页发送方：sender.tab 恒为 undefined，url 与扩展同源 */
  const internalSender = { id: chrome.runtime.id } as chrome.runtime.MessageSender;

  describe('UPDATE_PASSWORD_CACHE（预热会驻留明文缓存）', () => {
    it('内容脚本发送方被拒，不触发预热', () => {
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: MessageType.UPDATE_PASSWORD_CACHE },
        contentSender('https://evil.com/'),
        sendResponse,
      );

      expect(warmPasswordCache).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(result).not.toBe(true);
    });

    it('扩展内部页放行，同步预热并回 success', () => {
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener({ type: MessageType.UPDATE_PASSWORD_CACHE }, internalSender, sendResponse);

      expect(warmPasswordCache).toHaveBeenCalledTimes(1);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
      expect(result).not.toBe(true);
    });
  });

  describe('INVALIDATE_PASSWORD_CACHE（远程清会话 + 锁定，破坏性）', () => {
    it('内容脚本发送方被拒，不同步下发 SESSION_EXPIRED', () => {
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: MessageType.INVALIDATE_PASSWORD_CACHE },
        contentSender('https://evil.com/'),
        sendResponse,
      );

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(result).not.toBe(true);
    });
  });

  describe('QUICK_FILL（向活跃标签页注入凭据）', () => {
    it('内容脚本发送方被拒，不调用 handleQuickFill', () => {
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener({ type: MessageType.QUICK_FILL }, contentSender('https://evil.com/'), sendResponse);

      expect(handleQuickFill).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(result).not.toBe(true);
    });

    it('扩展内部页放行，异步结果经 sendResponse 回传', async () => {
      vi.mocked(handleQuickFill).mockResolvedValue(undefined);
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener({ type: MessageType.QUICK_FILL }, internalSender, sendResponse);

      expect(result).toBe(true);
      expect(handleQuickFill).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }));
    });
  });

  describe('OPEN_INLINE_DROPDOWN（展开内联填充面板）', () => {
    it('内容脚本发送方被拒，不调用 handleOpenInlineDropdown', () => {
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: MessageType.OPEN_INLINE_DROPDOWN },
        contentSender('https://evil.com/'),
        sendResponse,
      );

      expect(handleOpenInlineDropdown).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(result).not.toBe(true);
    });

    it('扩展内部页放行，异步结果经 sendResponse 回传', async () => {
      vi.mocked(handleOpenInlineDropdown).mockResolvedValue(undefined);
      const listener = setupAndCaptureListener();
      const sendResponse = vi.fn();

      const result = listener({ type: MessageType.OPEN_INLINE_DROPDOWN }, internalSender, sendResponse);

      expect(result).toBe(true);
      expect(handleOpenInlineDropdown).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }));
    });
  });
});

describe('OPEN_OPTIONS_PAGE 应答真实性（分发级）', () => {
  /** 扩展内部页发送方：popup 的「密码管理」入口 */
  const internalSender = { id: chrome.runtime.id } as chrome.runtime.MessageSender;

  it('选项页打开成功时回 success:true', async () => {
    vi.mocked(openOptionsPage).mockResolvedValue(7);
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener({ type: MessageType.OPEN_OPTIONS_PAGE }, internalSender, sendResponse);

    expect(result).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }));
  });

  it('openOptionsPage 吞掉异常返回 undefined 时如实回 success:false', async () => {
    // 旧实现无条件 `then(() => success:true)`：`chrome.tabs.create` 被拒时 popup 仍以为成功，
    // 于是关掉窗口、用户只看到「点了没反应」，后台日志里也没有任何失败痕迹
    vi.mocked(openOptionsPage).mockResolvedValue(undefined);
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener({ type: MessageType.OPEN_OPTIONS_PAGE }, internalSender, sendResponse);

    expect(result).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: false, error: expect.any(String) }));
  });

  it('openOptionsPage 抛异常时回 success:false 且带上异常原因', async () => {
    vi.mocked(openOptionsPage).mockRejectedValue(new Error('tabs permission denied'));
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    listener({ type: MessageType.OPEN_OPTIONS_PAGE }, internalSender, sendResponse);

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'tabs permission denied' }),
    );
  });
});

describe('B12 消息形状守卫（listener 入口）', () => {
  const sender = contentSender('https://evil.com/');

  it('null 载荷同步回 success:false，且不因 message.type 抛错', () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener(null, sender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).not.toBe(true);
  });

  it('非对象载荷（字符串）被拒', () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener('not-a-message', sender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).not.toBe(true);
  });

  it('缺少 type 字段的对象被拒', () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener({ data: { foo: 'bar' } }, sender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).not.toBe(true);
  });

  it('type 非字符串被拒', () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener({ type: 123 }, sender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).not.toBe(true);
  });
});

describe('OPEN_OPTIONS_AND_SITE_RULES 域名预填收口（分发级）', () => {
  beforeEach(() => {
    vi.mocked(openOptionsAndSendMessage).mockResolvedValue({ success: true });
  });

  /** 取回路由转发给选项页的载荷 */
  const forwardedData = () => {
    const calls = vi.mocked(openOptionsAndSendMessage).mock.calls;
    return calls[calls.length - 1]?.[1];
  };

  it('自报域名先规范化再转发，与内容脚本读取形态一致', async () => {
    const listener = setupAndCaptureListener();
    const sendResponse = vi.fn();

    const result = listener(
      { type: MessageType.OPEN_OPTIONS_AND_SITE_RULES, data: { domain: ' Example.COM ' } },
      contentSender('https://example.com/login'),
      sendResponse,
    );

    expect(result).toBe(true);
    expect(openOptionsAndSendMessage).toHaveBeenCalledWith(MessageType.OPEN_OPTIONS_AND_SITE_RULES, {
      domain: 'example.com',
    });
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }));
  });

  it('URL 形态 / 通配符等非法域名降级为「无预填」，不原样透传', () => {
    const listener = setupAndCaptureListener();

    for (const bad of ['https://example.com', '*.example.com', 'a..b.com', '例え.com', 'x'.repeat(300), 12345, {}]) {
      listener(
        { type: MessageType.OPEN_OPTIONS_AND_SITE_RULES, data: { domain: bad } },
        contentSender('https://a.com/'),
        vi.fn(),
      );
      expect(forwardedData()).toBeUndefined();
    }
  });

  it('无载荷时行为与旧版一致（打开但不预填）', () => {
    const listener = setupAndCaptureListener();

    listener({ type: MessageType.OPEN_OPTIONS_AND_SITE_RULES }, contentSender('https://a.com/'), vi.fn());

    expect(openOptionsAndSendMessage).toHaveBeenCalledWith(MessageType.OPEN_OPTIONS_AND_SITE_RULES, undefined);
  });
});
