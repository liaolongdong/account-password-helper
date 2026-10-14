/** @vitest-environment jsdom */
/**
 * 填充成功回执的接线（M-4）
 *
 * 回执胶囊自身的行为由 `fillAckChip.test.ts` 钉，本文件只管**调用点**：四条填充路径
 * （账号密码、手机号、动态码、右键菜单）都必须各自锚到「真正写进去的那个框」，
 * 而失败路径一律不锚——失败提示由发起方展示、面板刻意保持打开，再叠一枚胶囊就是
 * 同一件事说两遍。
 *
 * 之所以锚点必须逐条核对：填充值来自不可信页面，锚错字段等于把「已填充」这句话
 * 说给用户没看到的那个框，比没有回执更糟。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import type { InputFiller } from '@/entrypoints/content/InputFiller';
import type { InputFillResult } from '@/entrypoints/content/types';
import { MessageType } from '@/utils/types';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';
import { rememberContextMenuTarget } from '@/entrypoints/content/contextMenuTarget';

/** 与既有 FormDetector 测试一致的默认配置 */
const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  visible: true,
  position: 'right',
  offsetY: 0,
  opacity: 0.9,
  autoShowSidePanel: false,
  autoTriggerLogin: false,
  passwordVisibilityToggle: false,
  fillMode: 'inline',
  theme: 'sky',
  penetrateShadow: true,
  ...overrides,
});

/**
 * 安装密闭的 chrome 全局桩
 *
 * `loadConfig` 与 `loadSiteRule` 都走 `chrome.storage.local.get`，按 key 分支返回。
 */
const installChromeMock = (config: Record<string, unknown>) => {
  (globalThis as any).chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue({ data: null }),
      getURL: vi.fn((path: string) => `chrome-extension://test-extension/${path}`),
    },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: {
        get: vi.fn(async (key: string) => {
          if (key === STORAGE_KEYS.SITE_RULES) return { [STORAGE_KEYS.SITE_RULES]: {} };
          return { [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: config };
        }),
        set: vi.fn(async () => {}),
      },
      session: { get: vi.fn(async () => ({})) },
    },
  };
};

/** 让 loadConfig / loadSiteRule 的异步续体落地 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('填充成功回执的接线', () => {
  let detector: FormDetector;

  /** 主树里的标准登录表单 */
  const buildLoginDom = (): { user: HTMLInputElement; pwd: HTMLInputElement } => {
    document.body.innerHTML = `
      <form id="login">
        <input id="h-user" type="text" name="username">
        <input id="h-pwd" type="password" name="password">
      </form>
    `;
    return {
      user: document.getElementById('h-user') as HTMLInputElement,
      pwd: document.getElementById('h-pwd') as HTMLInputElement,
    };
  };

  /** 构造实例并短路掉与回执无关的下游动作（面板、自动登录、焦点同步） */
  const createDetector = async (): Promise<FormDetector> => {
    const instance = new FormDetector();
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    vi.spyOn(instance as any, 'hideSidePanel').mockResolvedValue(undefined);
    vi.spyOn(instance as any, 'triggerLogin').mockImplementation(() => {});
    await settle();
    return instance;
  };

  /** 截获 FormDetector 注册的消息处理器 */
  const captureMessageHandler = (): ((message: any, sender: any, sendResponse: any) => boolean) => {
    const calls = ((globalThis as any).chrome.runtime.onMessage.addListener as any).mock.calls;
    return calls[calls.length - 1][0];
  };

  /**
   * 桩掉字段写入结果
   *
   * 按 `InputFiller` 的真实签名取引用，`mockImplementation` 才能推断出被写的元素——
   * 「只有一格写进去」的锚点退化用例必须分辨写到的是哪个框。
   *
   * @param instance 被测实例
   * @param write 每次写入返回的结果；传函数时按被写的元素区分
   */
  const stubWrites = (
    instance: FormDetector,
    write: InputFillResult | ((input: HTMLElement) => InputFillResult),
  ): void => {
    const filler = (instance as unknown as { inputFiller: InputFiller }).inputFiller;
    const spy = vi.spyOn(filler, 'setInputValueWithStrategies');
    if (typeof write === 'function') {
      spy.mockImplementation(async input => write(input));
    } else {
      spy.mockResolvedValue(write);
    }
  };

  /** 写入并核验通过 / 写入但站点未登记 input 事件 / 什么都没写进去 */
  const WRITTEN: InputFillResult = { filled: true, verified: true, strategy: 'native' };
  const WRITTEN_UNVERIFIED: InputFillResult = { filled: true, verified: false, strategy: 'native' };
  const NOT_WRITTEN: InputFillResult = { filled: false, verified: false, strategy: 'native' };

  /** 回执宿主是否出现在页面上（closed 影子树，`data-aph` 是唯一外部凭据） */
  const ackHostCount = (): number => document.body.querySelectorAll('[data-aph="fill-ack-chip"]').length;

  beforeEach(() => {
    // jsdom 不实现 execCommand，缺失会让 InputFiller 走异常兜底分支（跳过事件序列并刷错误日志），
    // 桩成 no-op 后原生策略与浏览器一致
    (document as any).execCommand = vi.fn(() => true);
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
    vi.spyOn(domUtils, 'isDetectableCheckbox').mockImplementation(() => true);
  });

  afterEach(() => {
    detector?.destroy();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // 每个用例开头都会重装 chrome 桩，故不在 afterEach 里删除：填充成功后有 300ms
  // 延时收起面板的定时器，删掉全局会让它在用例结束后报一句无意义的错误日志
  afterAll(() => {
    delete (globalThis as any).chrome;
    delete (document as any).execCommand;
  });

  it('账号密码填充：回执锚在密码框，并带上成功档位', async () => {
    const { pwd } = buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const ack = vi.spyOn(detector as any, 'showFillAck').mockImplementation(() => {});

    const result = await (detector as any).fillPasswordWithResult({ username: 'u-name', password: 'p-word' });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('verified');
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0]).toEqual([pwd, 'verified']);
  });

  it('只填进账号框时锚点退化为账号框', async () => {
    const { user, pwd } = buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const ack = vi.spyOn(detector as any, 'showFillAck').mockImplementation(() => {});
    // 密码框写入失败，账号框成功：锚点必须是用户看得见的那个
    stubWrites(detector, input => (input === pwd ? NOT_WRITTEN : WRITTEN));

    await (detector as any).fillPasswordWithResult({ username: 'u-name', password: 'p-word' });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0]![0]).toBe(user);
  });

  it('写入成功但未核验时按 unverified 档回执', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const ack = vi.spyOn(detector as any, 'showFillAck').mockImplementation(() => {});
    stubWrites(detector, WRITTEN_UNVERIFIED);

    const result = await (detector as any).fillPasswordWithResult({ username: 'u-name', password: 'p-word' });

    expect(result.outcome).toBe('unverified');
    expect(ack.mock.calls[0]).toEqual([expect.anything(), 'unverified']);
  });

  it('一个字段都没写进去时不回执（失败提示归发起方）', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    stubWrites(detector, NOT_WRITTEN);

    const result = await (detector as any).fillPasswordWithResult({ username: 'u-name', password: 'p-word' });

    expect(result.success).toBe(false);
    // 不桩 showFillAck：这里要钉的是「页面上什么都没出现」，而不是某个内部方法被调过
    expect(ackHostCount()).toBe(0);
  });

  it('手机号填充：锚在真正写入的那个手机号框', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const ack = vi.spyOn(detector as any, 'showFillAck').mockImplementation(() => {});
    const mobile = document.createElement('input');
    mobile.type = 'text';
    document.body.appendChild(mobile);
    (detector as any).mobileFields = [mobile];

    (detector as any).fillMobileCode({ mobile: '13800000000', code: '' });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0]![0]).toBe(mobile);
  });

  it('手机号框已不可见时不回执，免得报出一个没落地的成功', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const mobile = document.createElement('input');
    document.body.appendChild(mobile);
    (detector as any).mobileFields = [mobile];
    vi.mocked(domUtils.isElementVisible).mockImplementation(el => el !== mobile);

    (detector as any).fillMobileCode({ mobile: '13800000000', code: '' });

    expect(ackHostCount()).toBe(0);
  });

  it('动态码填充：回执锚在验证码框', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const ack = vi.spyOn(detector as any, 'showFillAck').mockImplementation(() => {});
    const totp = document.createElement('input');
    totp.autocomplete = 'one-time-code';
    document.body.appendChild(totp);
    (detector as any).verifyCodeFields = [totp];

    const result = await (detector as any).fillTotpCode('123456');

    expect(result.success).toBe(true);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0]![0]).toBe(totp);
  });

  it('右键菜单填充成功后回执锚在被右键的那个框', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    const ack = vi.spyOn(detector as any, 'showFillAck').mockImplementation(() => {});
    const handler = captureMessageHandler();
    const target = document.getElementById('h-user') as HTMLInputElement;
    rememberContextMenuTarget(target);

    const sendResponse = vi.fn();
    handler({ type: MessageType.CONTEXT_MENU_FILL, data: { value: 'u-name' } }, {}, sendResponse);
    await vi.waitFor(() => expect(ack).toHaveBeenCalledTimes(1));

    expect(ack.mock.calls[0]![0]).toBe(target);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('destroy 后回执宿主一并移除', async () => {
    buildLoginDom();
    installChromeMock(makeConfig());
    detector = await createDetector();
    await (detector as any).fillPasswordWithResult({ username: 'u-name', password: 'p-word' });
    expect(document.body.querySelectorAll('[data-aph="fill-ack-chip"]')).toHaveLength(1);

    detector.destroy();

    expect(document.body.querySelectorAll('[data-aph="fill-ack-chip"]')).toHaveLength(0);
  });
});
