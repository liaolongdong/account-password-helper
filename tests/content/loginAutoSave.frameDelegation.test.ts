/** @vitest-environment jsdom */
/**
 * iframe 委托投递的目标 origin 回归测试（A4b）
 *
 * 自动保存的「未能自动保存，请手动添加」提示曾以 `postMessage(..., '*')` 发给顶层 frame：
 * 顶层文档在解析 origin 与投递之间发生导航（TOCTOU）时，这条提示会连同当前页面 URL
 * 一起落到此刻占据顶层的任意文档。收口后投递目标锁死为解析出的顶层 origin，
 * 且 origin 解析不出来时不再广播，只在当前 frame 渲染。
 *
 * 盯住四条契约：
 * 1. 跨主域名 iframe —— 提示仍委托顶层渲染（位置不变），但 targetOrigin 是具体 origin 而非 `'*'`；
 * 2. 同主域名 iframe —— 弹窗委托路径同样锁定顶层 origin，且回传链路照常工作；
 * 3. `ancestorOrigins` 解析不出顶层 origin（sandbox iframe）—— 不做跨帧投递，退回当前 frame；
 * 4. `postMessage` 抛错 —— 仍退回当前 frame 渲染（既有降级路径不变）。
 *
 * 白盒调用私有方法（同 tests/content/loginAutoSave.pendingStorage.test.ts），
 * 因为这四条都是「投递出口」的契约，与凭证如何被捕获无关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostMessageType } from '@/utils/domain';
import type { NotificationType, PendingCredentials } from '@/entrypoints/content/types';

/** 解析出的顶层 origin */
const TOP_ORIGIN = 'https://top.example';
/** 载荷中绝不该出现的凭据片段 */
const SECRET = 'S3cr3t!Passw0rd';
const USERNAME = 'alice@example.com';

/** 每个用例捕获到的 postMessage 调用（data + targetOrigin） */
let sent: { data: Record<string, unknown>; targetOrigin: unknown }[] = [];

/** isSameMainDomain 的按用例可控返回值（顶层 frame 与当前 frame 是否同主域名） */
const env = vi.hoisted(() => ({ sameMainDomain: true }));

const notificationSpy = vi.hoisted(() => vi.fn());

vi.mock('@/entrypoints/content/NativeNotification', () => ({
  showNativeNotification: notificationSpy,
}));

vi.mock('@/utils/domain', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/domain')>();
  return {
    ...actual,
    isSameMainDomain: (a: string, b: string) => (void [a, b], env.sameMainDomain),
  };
});

vi.mock('@/utils/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    StorageUtils: {
      ...actual.StorageUtils,
      getAutoSaveConfig: vi.fn(async () => ({ enabled: false, domainPatterns: [], excludedDomains: [] })),
      isSessionValid: vi.fn(async () => false),
    },
  };
});

/** 被测模块的白盒视图 */
interface DelegationInternals {
  delegatePromptToTopFrame(pending: PendingCredentials, risk?: undefined): void;
  delegateNotificationToTopFrame(message: string, type: NotificationType, topOrigin?: string): void;
}

interface LoginAutoSaveModule {
  LoginAutoSave: new () => DelegationInternals;
}

/** 重新导入模块并构造实例（隔离模块级状态） */
const createInstance = async (): Promise<DelegationInternals> => {
  vi.resetModules();
  const mod = (await import('@/entrypoints/content/LoginAutoSave')) as unknown as LoginAutoSaveModule;
  return new mod.LoginAutoSave();
};

const pendingOf = (overrides: Partial<PendingCredentials> = {}): PendingCredentials => ({
  username: USERNAME,
  password: SECRET,
  url: TOP_ORIGIN,
  tag: 'Example',
  remark: 'auto saved',
  tagEdited: false,
  remarkEdited: false,
  timestamp: Date.now(),
  mode: 'save',
  ...overrides,
});

/**
 * 桩 `location.ancestorOrigins`
 *
 * 真实取值是只读的 DOMStringList，这里用数组替代：被测代码只按 `[length - 1]` 取末位，
 * 两者在该访问方式上等价。jsdom 未实现该 Chrome 专有属性，故每次显式安装、用例结束移除。
 */
const setAncestorOrigins = (origins: string[]): void => {
  Object.defineProperty(window.location, 'ancestorOrigins', {
    value: origins,
    configurable: true,
    writable: true,
  });
};

/** 拦截 postMessage（jsdom 下 `window.top === window`，因此拦到的就是委托出口） */
const trackPostMessage = (impl?: (data: unknown) => void): void => {
  vi.spyOn(window, 'postMessage').mockImplementation(((data: unknown, targetOrigin?: unknown) => {
    impl?.(data);
    sent.push({ data: data as Record<string, unknown>, targetOrigin });
  }) as never);
};

/** 模拟顶层 frame 回传用户操作结果，用于注销同主域名路径注册的 message 监听与超时定时器 */
const settleDelegatedPrompt = async (requestId: unknown): Promise<void> => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: PostMessageType.SAVE_PROMPT_RESULT, requestId, action: 'dismiss' },
    }),
  );
  await Promise.resolve();
};

describe('iframe 委托投递的目标 origin', () => {
  beforeEach(() => {
    env.sameMainDomain = true;
    sent = [];
    notificationSpy.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window.location, 'ancestorOrigins');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('跨主域名 iframe：提示发给解析出的顶层 origin，不再以 "*" 广播', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    env.sameMainDomain = false;
    trackPostMessage();
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());

    expect(sent).toHaveLength(1);
    expect(sent[0].targetOrigin).toBe(TOP_ORIGIN);
    expect(sent[0].targetOrigin).not.toBe('*');
    expect(sent[0].data).toMatchObject({
      type: PostMessageType.SHOW_NOTIFICATION,
      data: { type: 'warning' },
    });
    // 提示仍在顶层 frame 渲染（位置与交互不变），只是投递目标被收窄
    expect(notificationSpy).not.toHaveBeenCalled();
    // 委托的是提示，不是凭据
    const payload = JSON.stringify(sent[0].data);
    expect(payload).not.toContain(SECRET);
    expect(payload).not.toContain(USERNAME);
  });

  it('同主域名 iframe：弹窗委托同样锁定顶层 origin', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    env.sameMainDomain = true;
    trackPostMessage();
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());

    expect(sent).toHaveLength(1);
    expect(sent[0].data).toMatchObject({ type: PostMessageType.SHOW_SAVE_PROMPT });
    expect(sent[0].targetOrigin).toBe(TOP_ORIGIN);
    await settleDelegatedPrompt((sent[0].data as { requestId: unknown }).requestId);
    expect(sent).toHaveLength(1);
  });

  it('ancestorOrigins 解析不出顶层 origin（sandbox iframe）：不跨帧投递，退回当前 frame 渲染', async () => {
    setAncestorOrigins([]);
    env.sameMainDomain = false;
    trackPostMessage();
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());

    expect(sent).toHaveLength(0);
    expect(notificationSpy).toHaveBeenCalledTimes(1);
    expect(notificationSpy.mock.calls[0][1]).toBe('warning');
  });

  it('postMessage 抛错：仍退回当前 frame 渲染（既有降级路径不变）', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    env.sameMainDomain = false;
    trackPostMessage(() => {
      throw new Error('postMessage failed');
    });
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());

    expect(notificationSpy).toHaveBeenCalledTimes(1);
  });

  it('直接调用通知委托且未给出 origin：不做跨帧投递', async () => {
    trackPostMessage();
    const instance = await createInstance();

    instance.delegateNotificationToTopFrame('请在当前页面手动添加账号', 'warning');

    expect(sent).toHaveLength(0);
    expect(notificationSpy).toHaveBeenCalledTimes(1);
  });
});
