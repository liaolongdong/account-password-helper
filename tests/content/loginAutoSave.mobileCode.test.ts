/** @vitest-environment jsdom */
/**
 * 纯手机号 + 短信验证码登录页的凭证捕获
 *
 * 国内站点的主流登录形态是「手机号 + 短信验证码」，页面上**根本没有密码框**。而三个捕获入口
 * （表单提交 / 按钮点击 / Enter）此前一律先要求「存在密码框且值非空」才继续
 * （`LoginAutoSave.ts:256 / :303 / :344`），于是这类登录永远不会弹「保存」——用户装了扩展、
 * 天天登录、库里一条凭据都没攒出来，下次仍然没有东西可填。
 *
 * 放宽后的判据必须比「有手机号框」更严，否则搜索框、注册表单、收货地址页全会被判成登录页：
 * **手机号框与验证码框都有值**才算这次提交是在登录。因此「获取验证码」那一下（验证码框还空着）
 * 不许弹窗。密码框照常成立的老路径必须一字不变。
 *
 * 白盒调用私有 handler（同 `loginAutoSave.tagPrefill.test.ts` 的取舍）：要看的是
 * 「弹窗收到的那份凭证长什么样」，而不是弹窗自身怎么渲染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/utils/types';
import type { SavePromptData } from '@/entrypoints/content/types';

/** 弹窗渲染入口的调用记录（返回真实形状的控制接口，供 `setupFieldSync` 的字段同步回调用） */
const promptSpy = vi.hoisted(() =>
  vi.fn<(data: SavePromptData) => Record<string, unknown>>(() => ({
    updateUsername: vi.fn(),
    updatePassword: vi.fn(),
  })),
);

vi.mock('@/entrypoints/content/SavePasswordPrompt', () => ({
  showSavePasswordPrompt: promptSpy,
  dismissSavePasswordPrompt: vi.fn(),
}));

vi.mock('@/entrypoints/content/NativeNotification', () => ({
  showNativeNotification: vi.fn(),
}));

/**
 * jsdom 里 `offsetWidth` / `offsetHeight` 恒为 0，`isElementVisible` 会把所有字段判成不可见。
 * 用 `vi.mock` 而不是 `vi.spyOn`：本文件每个用例都 `resetModules` 重新导入被测模块，
 * 命名空间对象会被换掉，spyOn 的桩活不过那次重建。其余导出保持真实实现。
 */
vi.mock('@/entrypoints/content/domUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/entrypoints/content/domUtils')>();
  return { ...actual, isElementVisible: vi.fn(() => true) };
});

vi.mock('@/utils/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    StorageUtils: {
      ...actual.StorageUtils,
      isSessionValid: vi.fn(async () => true),
      isDomainMatchForAutoSave: vi.fn(() => true),
      getAutoSaveConfig: vi.fn(async () => ({ enabled: true, domainPatterns: [], excludedDomains: [] })),
    },
  };
});

/** 被测模块的白盒视图 */
interface CaptureInternals {
  configLoaded: boolean;
  isEnabled: boolean;
  handleFormSubmit(e: Event): void;
  handleButtonClick(e: Event): void;
}

interface LoginAutoSaveModule {
  LoginAutoSave: new () => CaptureInternals;
}

/** 重新导入模块并构造一个「配置已就绪」的实例（隔离模块级密钥状态） */
const createReadyInstance = async (): Promise<CaptureInternals> => {
  vi.resetModules();
  const mod = (await import('@/entrypoints/content/LoginAutoSave')) as unknown as LoginAutoSaveModule;
  const instance = new mod.LoginAutoSave();
  instance.configLoaded = true;
  instance.isEnabled = true;
  return instance;
};

/** 冲刷捕获链上的微任务（`handleFormSubmit` 里那次 `void onCredentialsCaptured(...)`） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

const mount = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.body;
};

/** 手机号 + 短信码，无密码框 */
const MOBILE_CODE_FORM = `
  <form id="f">
    <input type="tel" name="mobile" value="13800000000" />
    <input type="text" name="smsCode" placeholder="请输入验证码" value="246813" />
    <button type="submit">登录</button>
  </form>`;

/** 同样的两个框，但验证码框还没填（用户刚点「获取验证码」） */
const MOBILE_ONLY_FORM = `
  <form id="f">
    <input type="tel" name="mobile" value="13800000000" />
    <input type="text" name="smsCode" placeholder="请输入验证码" value="" />
    <button type="submit">获取验证码</button>
  </form>`;

/** 手机号框空着、验证码框有值 */
const CODE_ONLY_FORM = `
  <form id="f">
    <input type="tel" name="mobile" value="" />
    <input type="text" name="smsCode" placeholder="请输入验证码" value="246813" />
    <button type="submit">登录</button>
  </form>`;

const submitForm = async (): Promise<void> => {
  const instance = await createReadyInstance();
  const form = document.querySelector('form') as HTMLFormElement;
  instance.handleFormSubmit({ target: form, preventDefault: vi.fn() } as unknown as Event);
  await flush();
};

beforeEach(() => {
  promptSpy.mockClear();
  sessionStorage.clear();
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message: unknown) => {
    const type = (message as { type?: MessageType })?.type;
    if (type === MessageType.CHECK_CREDENTIAL_STATUS) return Promise.resolve({ status: 'new' });
    return Promise.resolve({ key: null });
  }) as never;
});

describe('手机号 + 短信码表单的捕获门', () => {
  it('两框都有值且页面无密码框：弹窗，凭证是手机号 + 空密码', async () => {
    mount(MOBILE_CODE_FORM);
    await submitForm();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('13800000000');
    expect(data.password).toBe('');
    expect(data.mobileLogin).toBe(true);
  });

  it('验证码框还空着（点的是「获取验证码」）：不弹保存窗', async () => {
    mount(MOBILE_ONLY_FORM);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('手机号框空着、只有验证码：不弹保存窗', async () => {
    mount(CODE_ONLY_FORM);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('无 form 的 SPA 登录（按钮点击）：手机号框在页面上也要能捕获', async () => {
    mount(`
      <div>
        <input type="tel" name="mobile" value="13800000000" />
        <input type="text" name="smsCode" placeholder="请输入验证码" value="246813" />
        <button id="b">登录</button>
      </div>`);
    const instance = await createReadyInstance();
    const button = document.querySelector('#b') as HTMLElement;

    instance.handleButtonClick({ target: button, preventDefault: vi.fn() } as unknown as Event);
    await flush();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0].username).toBe('13800000000');
  });

  it('页面上有密码框时仍走原路径：密码非空、不带手机号登录标记', async () => {
    mount(`
      <form id="f">
        <input type="text" name="username" value="alice" />
        <input type="password" value="S3cr3t!Passw0rd" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('alice');
    expect(data.password).toBe('S3cr3t!Passw0rd');
    expect(data.mobileLogin).toBeFalsy();
  });

  it('只有搜索框 + 一个凑巧命中验证码选择器的框、且手机号框不存在：不误判成登录页', async () => {
    mount(`
      <form id="f">
        <input type="text" name="q" placeholder="搜索" value="iphone 15" />
        <input type="text" name="smsCode" placeholder="请输入验证码" value="abc" />
      </form>`);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('收货地址页的邮编框不许当短信码：`name="zipcode"` 也命中 [name*="code"]', async () => {
    mount(`
      <form id="f">
        <input type="tel" name="mobile" value="13800000000" />
        <input type="text" name="zipcode" value="200000" />
        <button type="submit">保存地址</button>
      </form>`);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('「验证码」框里装的是长串（邮箱校验 token / 优惠码）时不算短信码登录', async () => {
    mount(`
      <form id="f">
        <input type="tel" name="mobile" value="13800000000" />
        <input type="text" name="code" value="REFERRAL-2026-LONG-CODE" />
        <button type="submit">提交</button>
      </form>`);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('弹窗期间用户改掉手机号：展示要跟着更新，不许把旧号存进库', async () => {
    mount(MOBILE_CODE_FORM);
    const instance = await createReadyInstance();
    const form = document.querySelector('form') as HTMLFormElement;

    instance.handleFormSubmit({ target: form, preventDefault: vi.fn() } as unknown as Event);
    await flush();
    expect(promptSpy).toHaveBeenCalledTimes(1);

    // controls 是弹窗渲染入口的返回值（真实实现靠它回灌展示值），不是入参
    const controls = promptSpy.mock.results[0].value as { updateUsername: ReturnType<typeof vi.fn> };
    const mobileField = document.querySelector('input[name="mobile"]') as HTMLInputElement;
    mobileField.value = '13900000001';
    mobileField.dispatchEvent(new Event('input'));
    await flush();

    expect(controls.updateUsername).toHaveBeenCalledWith('13900000001');
  });
});
