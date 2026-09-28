/** @vitest-environment jsdom */
/**
 * iframe 委托投递通道回归测试（A4b / 评审 §5.6）
 *
 * 自动保存的「未能自动保存，请手动添加」提示曾用 `window.top.postMessage` 委托顶层 frame 渲染。
 * 该枚举值是扩展包内公开可得的字符串，宿主页面脚本一次
 * `postMessage({ type: 'APH_SHOW_NOTIFICATION', ... })` 就能冒充扩展在整页右上角
 * （`z-index: 2147483647` + 扩展配色）渲染 200 字符任意文案 —— 钓鱼形状。
 * 收口后提示改走 `chrome.runtime` → background → `tabs.sendMessage({ frameId: 0 })`：
 * 发送方归属由浏览器盖章（页面世界发不出这条消息），投递目标由后台依据 sender 推导。
 *
 * 盯住五条契约：
 * 1. 跨主域名 iframe —— 提示不再经 postMessage 出帧，改由 runtime 委托，且载荷不含凭据；
 * 2. sandbox iframe（ancestorOrigins 取不到顶层 origin）—— 同样经 runtime 委托，位置保持整页右上角；
 * 3. 后台回报未送达 / 调用抛错 —— 退回当前 frame 渲染，绝不静默丢提示；
 * 4. 后台回报已送达 —— 当前 frame 不重复渲染；
 * 5. 同主域名弹窗委托 —— 仍锁定解析出的顶层 origin（这条没动：跨帧携带凭据，targetOrigin
 *    绝不能回退成 `'*'`）。
 *
 * 白盒调用私有方法（同 tests/content/loginAutoSave.pendingStorage.test.ts），
 * 因为前四条都是「投递出口」的契约，与凭证如何被捕获无关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostMessageType } from '@/utils/domain';
import { MessageType } from '@/utils/types';
import type { NotificationType, PendingCredentials } from '@/entrypoints/content/types';

/** 解析出的顶层 origin */
const TOP_ORIGIN = 'https://top.example';
/** 载荷中绝不该出现的凭据片段 */
const SECRET = 'S3cr3t!Passw0rd';
const USERNAME = 'alice@example.com';
/** 委托出去的提示文案（含页面 URL，不含凭据） */
const NOTICE = '检测到登录凭据，请在当前页面手动添加';

/** 每个用例捕获到的 postMessage 调用（data + targetOrigin） */
let sent: { data: Record<string, unknown>; targetOrigin: unknown }[] = [];

/** isSameMainDomain 的按用例可控返回值（顶层 frame 与当前 frame 是否同主域名） */
const env = vi.hoisted(() => ({ sameMainDomain: true }));

const notificationSpy = vi.hoisted(() => vi.fn());
const sendMessageSpy = vi.hoisted(() => vi.fn());

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

/** runtime 消息的最小形状（@types/chrome 把 sendMessage 的入参推成宽松类型） */
interface RuntimeMessageLike {
  type?: unknown;
  data?: { message?: unknown; type?: unknown };
}

/** 被测模块的白盒视图 */
interface DelegationInternals {
  delegatePromptToTopFrame(pending: PendingCredentials, precheck?: undefined): void;
  delegateNotificationToTopFrame(message: string, type: NotificationType): void;
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
const trackPostMessage = (): void => {
  vi.spyOn(window, 'postMessage').mockImplementation(((data: unknown, targetOrigin?: unknown) => {
    sent.push({ data: data as Record<string, unknown>, targetOrigin });
  }) as never);
};

/** 拦截 runtime 消息出口，按可控结果应答后台 */
const trackRuntimeMessage = (reply: () => Promise<unknown>): void => {
  sendMessageSpy.mockImplementation(reply as never);
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(sendMessageSpy as never);
};

/** 只取本次要断言的那类消息（LoginAutoSave 另有密文钥匙等 runtime 调用） */
const noticeMessages = (): RuntimeMessageLike[] =>
  sendMessageSpy.mock.calls
    .map(call => call[0] as RuntimeMessageLike)
    .filter(message => message?.type === MessageType.DELEGATE_PAGE_NOTICE);

/** 冲掉 sendMessage().then().catch() 这条微任务链 */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
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

describe('iframe 提示委托的投递通道', () => {
  beforeEach(() => {
    env.sameMainDomain = true;
    sent = [];
    notificationSpy.mockClear();
    sendMessageSpy.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window.location, 'ancestorOrigins');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('跨主域名 iframe：提示经 runtime 委托，不再以 postMessage 出帧', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    env.sameMainDomain = false;
    trackPostMessage();
    trackRuntimeMessage(async () => ({ success: true }));
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());
    await flushMicrotasks();

    // 一条 postMessage 都不发：既不再向顶层广播，也就没有可被页面伪造的同形状入口
    expect(sent).toHaveLength(0);
    const notices = noticeMessages();
    expect(notices).toHaveLength(1);
    expect(typeof notices[0].data?.message).toBe('string');
    expect(notices[0].data?.message).toBeTruthy();
    expect(notices[0].data?.type).toBe('warning');
    // 委托的是提示，不是凭据
    const payload = JSON.stringify(notices[0]);
    expect(payload).not.toContain(SECRET);
    expect(payload).not.toContain(USERNAME);
    // 后台已送达 → 当前 frame 不重复渲染
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('sandbox iframe：origin 解析不出也照样委托，位置保持整页右上角', async () => {
    setAncestorOrigins([]);
    env.sameMainDomain = false;
    trackPostMessage();
    trackRuntimeMessage(async () => ({ success: true }));
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());
    await flushMicrotasks();

    // 投递目标由后台依据 sender.tab.id + frameId 0 决定，与本地能否解析顶层 origin 无关
    expect(noticeMessages()).toHaveLength(1);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('后台回报未送达：退回当前 frame 渲染，绝不静默丢提示', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    env.sameMainDomain = false;
    trackPostMessage();
    trackRuntimeMessage(async () => ({ success: false }));
    const instance = await createInstance();

    instance.delegateNotificationToTopFrame(NOTICE, 'warning');
    await flushMicrotasks();

    expect(notificationSpy).toHaveBeenCalledTimes(1);
    expect(notificationSpy.mock.calls[0]).toEqual([NOTICE, 'warning']);
  });

  it('后台调用抛错（扩展上下文失效）：同样退回当前 frame 渲染', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    trackPostMessage();
    trackRuntimeMessage(async () => {
      throw new Error('Extension context invalidated');
    });
    const instance = await createInstance();

    instance.delegateNotificationToTopFrame(NOTICE, 'info');
    await flushMicrotasks();

    expect(notificationSpy).toHaveBeenCalledTimes(1);
    expect(notificationSpy.mock.calls[0][1]).toBe('info');
  });

  it('后台应答为空：按未送达处理，退回当前 frame 渲染', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    trackPostMessage();
    trackRuntimeMessage(async () => undefined);
    const instance = await createInstance();

    instance.delegateNotificationToTopFrame(NOTICE, 'warning');
    await flushMicrotasks();

    expect(notificationSpy).toHaveBeenCalledTimes(1);
  });

  it('同主域名 iframe：弹窗委托仍锁定解析出的顶层 origin', async () => {
    setAncestorOrigins([TOP_ORIGIN]);
    env.sameMainDomain = true;
    trackPostMessage();
    trackRuntimeMessage(async () => ({ success: true }));
    const instance = await createInstance();

    instance.delegatePromptToTopFrame(pendingOf());

    expect(sent).toHaveLength(1);
    expect(sent[0].data).toMatchObject({ type: PostMessageType.SHOW_SAVE_PROMPT });
    expect(sent[0].targetOrigin).toBe(TOP_ORIGIN);
    expect(sent[0].targetOrigin).not.toBe('*');
    await settleDelegatedPrompt((sent[0].data as { requestId: unknown }).requestId);
    expect(sent).toHaveLength(1);
    // 同主域名走弹窗路径，不该顺带委托提示
    expect(noticeMessages()).toHaveLength(0);
  });
});
