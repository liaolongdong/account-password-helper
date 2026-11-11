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
import type { SavePromptData, SavePromptEditedData } from '@/entrypoints/content/types';

/**
 * 弹窗渲染入口的调用记录（返回真实形状的控制接口，供 `setupFieldSync` 的字段同步回调用）
 *
 * 第二个形参按真实签名声明为 `onSave`：保存出口那个用例要取的就是这份回调，
 * 少声明一个参数会让 `calls[0][1]` 在 typecheck 里不存在（vitest 不查类型，只有 tsc 看得见）。
 */
const promptSpy = vi.hoisted(() =>
  vi.fn<(data: SavePromptData, onSave: (editedData: SavePromptEditedData) => void) => Record<string, unknown>>(() => ({
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

/**
 * 保存出口载荷的不变量：`mobileLogin` 是「允许空口令写入」的授权位，它必须与口令同源。
 *
 * 捕获门（`readCredentials`）只在密码框为空时才置 `mobileLogin: true`，且此时 `passwordField`
 * 为 null，弹窗展示的是「验证码不保存」——用户据此点的保存。授权位为真而口令非空，
 * 就会绕过存储层两道以 `!data.password` 为键的闸门（空字段拒写、空口令不许覆盖已有真口令），
 * 让页面可控的值覆写用户已存的真实口令。所以出口这一支必须在授权位为真时把口令钉成空串，
 * 与「重读能取到什么」无关；重读自身的可信来源另由下面那个 describe 钉住。
 */
/**
 * 保存出口用的夹具：账号框是 `type="text"` + 手机号 placeholder。
 *
 * 不能复用上面的 `MOBILE_CODE_FORM`（`type="tel"`）：`findUsernameInPage` 只认
 * `USERNAME_SELECTORS`，而 `type="tel"` 不在其中，兜底重读会在「取不到账号」那一步提前
 * return null，于是整条不同源链路根本走不到。`type="text"][name*="mobile"]` 与
 * `[placeholder*="手机号"]` 都命中该集合，是国内登录页最常见的标记。
 */
const MOBILE_CODE_FORM_TEXT = `
  <form id="f">
    <input type="text" name="mobile" placeholder="请输入手机号" value="13800000000" />
    <input type="text" name="smsCode" placeholder="请输入验证码" value="246813" />
    <button type="submit">登录</button>
  </form>`;

/** 点弹窗的「保存」，取出本次真正发往 background 的那份载荷 */
const savedPayload = async (): Promise<Record<string, unknown>> => {
  const sendSpy = vi.spyOn(chrome.runtime, 'sendMessage');
  // beforeEach 只换实现不清记录， spy 的调用会跨用例累积；不清就会读到上一个用例的载荷
  sendSpy.mockClear();
  const onSave = promptSpy.mock.calls[0][1];
  onSave({ tag: '', remark: '', tagEdited: false, remarkEdited: false });
  await flush();

  const calls = sendSpy.mock.calls.filter(
    ([message]) => (message as { type?: MessageType })?.type === MessageType.AUTO_SAVE_PASSWORD,
  );
  expect(calls.length, '保存出口必须真的发出 AUTO_SAVE_PASSWORD').toBeGreaterThan(0);
  // sendMessage 的重载把首参推成联合类型，只能经 unknown 收成载荷形状
  const sent = calls[calls.length - 1]?.[0] as unknown as { data?: Record<string, unknown> };
  expect(sent.data, 'AUTO_SAVE_PASSWORD 必须带上 data 载荷').toBeDefined();
  return sent.data as Record<string, unknown>;
};

describe('手机号登录的保存出口载荷：授权位与口令必须同源', () => {
  it('弹窗期间页面别处出现非空口令框：授权位为真时口令仍必须是空串', async () => {
    mount(MOBILE_CODE_FORM_TEXT);
    await submitForm();
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0].mobileLogin).toBe(true);

    // 捕获时页面上没有密码框，弹窗打开后才出现（SPA 切视图 / 站点把 OTP 做成掩码框）
    const stray = document.createElement('input');
    stray.type = 'password';
    stray.value = 'PAGE-CONTROLLED-VALUE';
    document.body.appendChild(stray);

    const data = await savedPayload();
    expect(data.mobileLogin).toBe(true);
    expect(data.password).toBe('');
  });

  it('页面自设 data-aph-password 的框同样不许把值带进授权为空的载荷', async () => {
    mount(MOBILE_CODE_FORM_TEXT);
    await submitForm();

    const stray = document.createElement('input');
    stray.type = 'text';
    stray.setAttribute('data-aph-password', '');
    stray.value = 'PAGE-SET-ATTRIBUTE';
    document.body.appendChild(stray);

    const data = await savedPayload();
    expect(data.password).toBe('');
  });

  it('页面没有口令框时照常保存空口令（授权位的合法形态不被收口误伤）', async () => {
    mount(MOBILE_CODE_FORM_TEXT);
    await submitForm();

    const data = await savedPayload();
    expect(data).toMatchObject({ username: '13800000000', password: '', mobileLogin: true });
  });

  it('普通账号密码路径不受影响：口令仍取实时重读的值', async () => {
    mount(`
      <form id="f">
        <input type="text" name="username" value="alice" />
        <input type="password" value="S3cr3t!Passw0rd" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    const passwordField = document.querySelector('input[type="password"]') as HTMLInputElement;
    passwordField.value = 'Retyped!Passw0rd';

    const data = await savedPayload();
    expect(data.password).toBe('Retyped!Passw0rd');
    expect(data.mobileLogin).toBeFalsy();
  });
});

/**
 * 口令形态的保存兜底：字段引用失效时存「弹窗展示的那份口令」，不存页面重读值
 *
 * `captureCurrentCredentials` 在 `lastCapturedPasswordField` 脱离文档后退到**全文档**
 * `input[type="password"], input[data-aph-password]`。这个兜底比捕获门的 form 作用域宽，
 * 且 `data-aph-password` 可由页面自设：SPA 重渲染换掉原密码框、或页面在弹窗开着的几十秒里
 * 另插一个带值的框，重读就会取到页面可控的值。此时授权位为假，存储层两道以 `!password`
 * 为键的闸门（空字段拒写、空口令不许覆盖已有真口令）全部失效，页面可控的非空口令于是覆写
 * 库里已存的真实口令——而用户点「保存」时看到的是弹窗里那份口令。
 *
 * 口径：口令只认「仍连在文档上的原引用」或「捕获时那份展示值」；账号仍走实时重读
 * （用户可能在弹窗期间改过账号），所以兜底不能整支返回 null。
 */
const PASSWORD_FORM = `
  <form id="f">
    <input type="text" name="username" value="alice" />
    <input type="password" value="S3cr3t!Passw0rd" />
    <button type="submit">登录</button>
  </form>`;

/** 摘掉原密码框（SPA 重渲染），再插一个页面可控的带值框 */
const replaceCapturedPasswordField = (stray: HTMLInputElement): void => {
  (document.querySelector('input[type="password"]') as HTMLInputElement).remove();
  document.body.appendChild(stray);
};

describe('口令形态的保存兜底：引用失效时存弹窗展示值', () => {
  it('页面自设 data-aph-password 框：存弹窗展示的口令，不存页面可控值', async () => {
    mount(PASSWORD_FORM);
    await submitForm();
    expect(promptSpy).toHaveBeenCalledTimes(1);
    const displayed = promptSpy.mock.calls[0][0].password;
    expect(displayed).toBe('S3cr3t!Passw0rd');

    const stray = document.createElement('input');
    stray.type = 'text';
    stray.setAttribute('data-aph-password', '');
    stray.value = 'PAGE-CONTROLLED-VALUE';
    replaceCapturedPasswordField(stray);

    const data = await savedPayload();
    expect(data.password).toBe(displayed);
    expect(data.mobileLogin).toBeFalsy();
  });

  it('页面另插 type=password 框：同样只存弹窗展示的口令', async () => {
    mount(PASSWORD_FORM);
    await submitForm();
    const displayed = promptSpy.mock.calls[0][0].password;

    const stray = document.createElement('input');
    stray.type = 'password';
    stray.value = 'PAGE-CONTROLLED-VALUE';
    replaceCapturedPasswordField(stray);

    const data = await savedPayload();
    expect(data.password).toBe(displayed);
  });

  it('账号仍取实时重读值：兜底只换口令来源，不许整支失效', async () => {
    mount(PASSWORD_FORM);
    await submitForm();

    const stray = document.createElement('input');
    stray.type = 'password';
    stray.value = 'PAGE-CONTROLLED-VALUE';
    replaceCapturedPasswordField(stray);
    (document.querySelector('input[name="username"]') as HTMLInputElement).value = 'alice-renamed';

    const data = await savedPayload();
    expect(data.username).toBe('alice-renamed');
  });
});

/**
 * 语义标注齐全、写法不同的登录页（形态矩阵第 3 行）
 *
 * 判据此前只读字段自己的四个属性（`name` / `id` / `placeholder` / `aria-label`），
 * 而 `<label for>` 与 `aria-labelledby` 是**同样明确、且无障碍上更规范**的写法。
 * 结果很反直觉：越是按规范标注的页面越不被识别，作者把 label 换成 aria-label 才「修好」。
 *
 * 收口口径是等效标注，不是放宽：可及名只喂给各桶**已有**的 aria 关键词集（从
 * `input[aria-label*="X"]` 条目里推导，不新增词），所以「用 label 标了手机号」与
 * 「写了 aria-label=手机号」的判定必须完全一致——包括一起被邮编排除挡在外面。
 */
const LABELLED_MOBILE_CODE_FORM = `
  <form id="f">
    <label for="m">手机号</label><input id="m" type="text" value="13800000000" />
    <label for="c">验证码</label><input id="c" type="text" value="246813" />
    <button type="submit">登录</button>
  </form>`;

/** 收货地址页：手机号框与邮编框都按规范标注，任何时候都不该被读成短信码登录 */
const LABELLED_ADDRESS_FORM = `
  <form id="f">
    <label for="m">手机号</label><input id="m" type="text" value="13800000000" />
    <label for="z">邮政编码</label><input id="z" type="text" value="200000" />
    <button type="submit">保存地址</button>
  </form>`;

/** 账号用 aria-labelledby、密码用包裹式 label 标注的常规登录页 */
const LABELLED_PASSWORD_FORM = `
  <form id="f">
    <span id="lbl">登录账号</span><input type="text" aria-labelledby="lbl" value="alice@example.com" />
    <label for="pw">登录密码</label><input id="pw" type="password" value="Synthetic!Label1" />
    <button type="submit">登录</button>
  </form>`;

describe('按规范标注的登录页：可及名与 aria-label 同权', () => {
  it('label 标注的手机号 + 验证码：弹窗，账号取手机号、授权位为真', async () => {
    mount(LABELLED_MOBILE_CODE_FORM);
    await submitForm();

    expect(promptSpy, '两个框都按规范标注，捕获门却没认出短信码登录').toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('13800000000');
    expect(data.password).toBe('');
    expect(data.mobileLogin).toBe(true);
  });

  it('label 标注的手机号 + 邮政编码：仍不弹（可及名进排除判据，放宽不越界）', async () => {
    mount(LABELLED_ADDRESS_FORM);
    await submitForm();

    expect(promptSpy, '邮编框按规范标注后必须和写 aria-label 时一样被摘出去').not.toHaveBeenCalled();
  });

  it('label 标注的手机号 + 真密码框：走常规路径，授权位不得为真', async () => {
    mount(`
      <form id="f">
        <label for="m">手机号</label><input id="m" type="text" value="13800000000" />
        <label for="pw">登录密码</label><input id="pw" type="password" value="Synthetic!Label1" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('13800000000');
    expect(data.password).toBe('Synthetic!Label1');
    expect(data.mobileLogin).toBeFalsy();
  });

  it('aria-labelledby 标注账号：账号值取得到，不再因为找不到账号整条放弃', async () => {
    mount(LABELLED_PASSWORD_FORM);
    await submitForm();

    expect(promptSpy, '口令框有值但账号取不到时，readCredentials 会整条返回 null').toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('alice@example.com');
    expect(data.password).toBe('Synthetic!Label1');
    expect(data.mobileLogin).toBeFalsy();
  });
});

/**
 * 邮箱 + 验证码登录（形态矩阵第 8 行）
 *
 * 判据的账号侧此前只认手机号证据，于是「邮箱 + 邮件验证码」这类同样没有密码框的登录整条漏掉。
 * 收口口径与手机号完全对称：账号候选扩成「手机号证据 **或** 邮箱证据」，仍要求同 scope 内
 * 存在合格的一次性码框；邮箱证据走捕获尺子（`hasEmailEvidence`），填充链的 `looksLikeEmailField`
 * 一字不动——否则又会重演让位回归。
 *
 * 负例必须一直为负：码框还空着（点「获取验证码」那一下）、邮编框（`name="postcode"` 会命中
 * `input[type="text"][name*="code"]`，靠 `looksLikePostalCode` 摘出去）、以及只有邮箱框的订阅页。
 */
const EMAIL_CODE_FORM = `
  <form id="f">
    <input type="email" name="email" value="alice@example.com" />
    <input type="text" name="mailCode" placeholder="请输入验证码" value="246813" />
    <button type="submit">登录</button>
  </form>`;

describe('邮箱 + 验证码登录：与手机号同一条捕获门', () => {
  it('type=email + 验证码框都有值：弹窗，账号取邮箱、授权位为真', async () => {
    mount(EMAIL_CODE_FORM);
    await submitForm();

    expect(promptSpy, '邮箱 + 验证码同样是没有密码框的登录，捕获门必须认得').toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('alice@example.com');
    expect(data.password).toBe('');
    expect(data.mobileLogin).toBe(true);
  });

  it('label 标注的邮箱 + 验证码：等效标注同样成立', async () => {
    mount(`
      <form id="f">
        <label for="e">电子邮箱</label><input id="e" type="text" value="alice@example.com" />
        <label for="c">验证码</label><input id="c" type="text" value="246813" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    expect(promptSpy, '按规范标注的邮箱登录页不该比写 aria-label 的更难识别').toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0].username).toBe('alice@example.com');
    expect(promptSpy.mock.calls[0][0].mobileLogin).toBe(true);
  });

  it('验证码框还空着（点的是「获取验证码」）：不弹窗', async () => {
    mount(`
      <form id="f">
        <input type="email" name="email" value="alice@example.com" />
        <input type="text" name="mailCode" placeholder="请输入验证码" value="" />
        <button type="submit">获取验证码</button>
      </form>`);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('邮箱 + 邮编框：不弹窗（邮编命中验证码选择器，靠排除判据摘出去）', async () => {
    mount(`
      <form id="f">
        <input type="email" name="email" value="alice@example.com" />
        <input type="text" name="postcode" placeholder="邮政编码" value="200000" />
        <button type="submit">保存地址</button>
      </form>`);
    await submitForm();

    expect(promptSpy, '收货地址页不是登录页').not.toHaveBeenCalled();
  });

  it('只有邮箱框、没有码框（订阅页）：不弹窗', async () => {
    mount(`
      <form id="f">
        <input type="email" name="email" value="alice@example.com" />
        <button type="submit">订阅</button>
      </form>`);
    await submitForm();

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('邮箱 + 真密码框：仍走常规路径，授权位不得为真', async () => {
    mount(`
      <form id="f">
        <input type="email" name="email" value="alice@example.com" />
        <input type="password" value="Synthetic!Mail1" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    const data = promptSpy.mock.calls[0][0];
    expect(data.username).toBe('alice@example.com');
    expect(data.password).toBe('Synthetic!Mail1');
    expect(data.mobileLogin).toBeFalsy();
  });
});

/**
 * 账号候选不得取到验证码框本身
 *
 * 可及名进了捕获证据之后，「验证码」证据与「账号」证据可能落在**同一个框**上：
 * `<label>手机验证码</label><input value="246813">` 既构成码证据（label 命中验证码），
 * 又因为 label 里的「手机」构成账号证据。而账号候选的排除项此前只查 `matchesVerifyCodeSelectors`
 * （四个属性），这个框没有 name/id/placeholder/aria-label，于是排除不掉——它会被 `.find`
 * 当成账号，一次性验证码就以 username 落库，而库里真正的账号一个字段都没存。
 *
 * 这违反「验证码不进任何字段」这条对外承诺；按 `hasVerifyCodeEvidence` 排除即与码证据同尺子，
 * 也正好只多排除「可及名命中验证码语义」这一种情形。
 */
describe('账号候选不得取到验证码框本身', () => {
  it('验证码框排在账号框之前：账号必须取手机号，不能取验证码', async () => {
    mount(`
      <form id="f">
        <label for="c">手机验证码</label><input id="c" type="text" value="246813" />
        <label for="m">手机号</label><input id="m" type="text" value="13800000000" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0].username, '一次性验证码被当成了账号').toBe('13800000000');
  });

  it('只有一个「邮箱验证码」框：没有账号可取，不许把验证码存成账号', async () => {
    mount(`
      <form id="f">
        <label for="c">邮箱验证码</label><input id="c" type="text" value="AB12CD" />
        <button type="submit">登录</button>
      </form>`);
    await submitForm();

    expect(promptSpy, '页面上没有任何账号，只有验证码').not.toHaveBeenCalled();
  });
});
