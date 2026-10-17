/** @vitest-environment jsdom */
/**
 * 聚焦识别 → 身份提示的接线回归测试（FormDetector 侧）
 *
 * 气泡本身的呈现与收起由 `identityHint.test.ts` 负责，本文件只钉「什么时候该调用它」，
 * 因为这几点是这个功能的安全边界与体验边界：
 *
 * 1. **总闸**。`identityHintEnabled === false` 时整条识别链不启动，页面不注入任何扩展 UI；
 *    判据写成「显式 false」而不是 falsy，是为了让老配置（存储里没有这个键）默认开——
 *    与 `penetrateShadow` 同一口径，也才配得上设置面板上那句「关闭即完全不出现」。
 * 2. **登录字段归快速填充**。判据是「快速填充是否真的认领了这个框」（`shouldShowSidePanel`），
 *    不是「字段长得像账号字段」——注册页的手机号框进了 mobile 桶却进不了登录表单，
 *    用桶归属让位会让它钥匙和提示两头落空。让位还要求这一档是钥匙**取得出值**的（手机号 / 邮箱）：
 *    证件号框会被旧分桶的「号码」子串误读成手机号框，钥匙挂得上却填不出身份库的值，这类由提示顶上。
 * 3. **档位无关**。接线点必须早于内联模式的 early return，否则「仅手动/侧边栏填充」档位下，
 *    注册页的姓名、证件号就彻底没有说明。
 * 4. **只出顶层 frame**。`allFrames` 注入让每个 iframe 各跑一份内容脚本，广告/统计 iframe
 *    里的悬浮气泡既不在用户的注视点上，也给页面脚本多一个可反复触发的扩展 UI。
 *
 * 外加「无身份语义的字段要收起上一枚气泡」（Tab 走过一串无关框不能留残影）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 气泡模块整体打桩：本文件读的是调用方的决策，不是气泡内部渲染 */
const identityHint = vi.hoisted(() => ({
  showIdentityHint: vi.fn(),
  hideIdentityHint: vi.fn(),
  destroyIdentityHint: vi.fn(),
}));
vi.mock('@/entrypoints/content/IdentityHint', () => identityHint);

import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';

/** 默认悬浮按钮配置（与既有 FormDetector 测试同口径） */
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

/** 按 key 分支返回配置的 chrome.storage 桩 */
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

/** 让 loadConfig / loadSiteRule 的异步续体落地，配置才真正生效 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('聚焦识别到身份提示的接线', () => {
  let detector: FormDetector;

  /** 装配置并构造实例（`focusin` 委托在构造函数里已注册），再布页面 */
  const mount = async (html: string, config: Record<string, unknown>): Promise<void> => {
    installChromeMock(config);
    detector = new FormDetector();
    // 内联下拉与登录自动填充都与本文件无关，短路掉，避免判定路径去碰页面几何
    vi.spyOn((detector as any).inlineDropdown, 'showTriggerFor').mockImplementation(() => {});
    await settle();
    document.body.innerHTML = html;
  };

  /**
   * 补一轮表单检测
   *
   * 实例化后的首轮检测排在延时定时器上（真实页面要等 DOMContentLoaded），而「这个框归不归
   * 快速填充认领」只看检测完的桶。不补这一步，让位守卫会因为桶恒空而恒不触发，用例假绿。
   */
  const scan = (): void => {
    (detector as any).detectForms();
  };

  /** 取页面里的第 n 个表单控件 */
  const control = (index = 0): HTMLElement => {
    const el = document.body.querySelectorAll('input, textarea, select')[index];
    if (!el) throw new Error('夹具里没有表单控件');
    return el as HTMLElement;
  };

  /** 走真实的委托路径：`focusin` 从控件冒泡到 document */
  const focus = (el: HTMLElement): void => {
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
  };

  /** 已展示气泡的角色序列，用作各用例的读数 */
  const shown = (): unknown[] => identityHint.showIdentityHint.mock.calls.map(call => call[1]);
  /** 最近一次展示的全部入参（字段、角色、核对档） */
  const lastShownArgs = (): unknown[] | undefined => {
    const { calls } = identityHint.showIdentityHint.mock;
    return calls[calls.length - 1];
  };

  beforeEach(() => {
    (document as any).execCommand = vi.fn(() => true);
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
  });

  afterEach(() => {
    detector?.destroy();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
  });

  it('个人信息字段聚焦即出提示，角色与核对档一起带过去', async () => {
    await mount('<label>证件号码<input name="idNumber"></label>', makeConfig());

    focus(control());

    // 证件号属于「需核对」档：气泡要额外提示用户核对后再取用
    expect(lastShownArgs()).toEqual([control(), 'idNumber', true]);
    expect(identityHint.hideIdentityHint).not.toHaveBeenCalled();
  });

  it('textarea 与 select 也是个人信息的载体，同样识别', async () => {
    await mount(
      `
      <label>详细地址<textarea name="address"></textarea></label>
      <label>性别<select name="gender"><option>男</option></select></label>
    `,
      makeConfig(),
    );

    focus(control(0));
    focus(control(1));

    expect(shown()).toEqual(['address', 'gender']);
  });

  /**
   * 提示的唯一动作是「把这格填上」，所以它只该跟随**能打字**的框。
   *
   * 2026-10-17 用户实测：一家社保登记表里那一片灰底框照样出气泡。组件库把日期选择器、
   * 下拉、级联都渲染成 `<input readonly>`（焦点可进、键盘打不进），页面自己回写的框
   * （「户籍=深圳户籍」）同样是 readonly——对它们说一句「从身份库选择」是一句做不到的承诺。
   *
   * 判据刻意只看 `readOnly`：`disabled` 的控件（含 `<fieldset disabled>` 整段禁用）在浏览器里
   * 根本拿不到焦点，`focusin` 不会为它们派发，写那条分支就是给不可能发生的场景加守卫。
   */
  it('readonly 的输入框不出提示：只读代理框与页面回写的灰底框都不接受输入', async () => {
    await mount(
      `
      <label>出生日期<input name="birthday" readonly></label>
      <label>户籍<input name="region" readonly value="深圳户籍"></label>
      <label>详细地址<textarea name="address" readonly></textarea></label>
    `,
      makeConfig(),
    );

    focus(control(0));
    focus(control(1));
    focus(control(2));

    expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
  });

  it('同一个框去掉 readonly 就照常出提示：判据是「能不能输入」，不是「像不像个人信息」', async () => {
    await mount('<label>出生日期<input name="birthday"></label>', makeConfig());

    focus(control());

    expect(shown()).toEqual(['birthday']);
  });

  it('select 没有 readOnly 概念：可以选择的下拉框照常出提示', async () => {
    await mount('<label>性别<select name="gender"><option>男</option></select></label>', makeConfig());

    focus(control());

    expect(shown()).toEqual(['gender']);
  });

  it('聚焦到非控件元素上不出提示，也不误收（失焦收起由 focusout 负责）', async () => {
    await mount('<label>姓名<input name="realname"></label>', makeConfig());

    focus(document.body.querySelector('label') as HTMLElement);

    expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
    expect(identityHint.hideIdentityHint).not.toHaveBeenCalled();
  });

  it('总闸显式关闭时整条链不启动：不展示也不收起', async () => {
    await mount('<label>姓名<input name="realname"></label>', makeConfig({ identityHintEnabled: false }));

    focus(control());

    expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
    expect(identityHint.hideIdentityHint).not.toHaveBeenCalled();
  });

  it('存储里没写过这个键的老配置默认开（口径同 penetrateShadow 的「未写即开」）', async () => {
    const legacy = makeConfig();
    delete (legacy as Record<string, unknown>).identityHintEnabled;
    await mount('<label>姓名<input name="realname"></label>', legacy);

    focus(control());

    expect(shown()).toEqual(['name']);
  });

  it('账号与密码框归快速填充，不再叠一层身份提示', async () => {
    await mount(
      '<form><input name="username"><input type="password" name="password"><button type="submit">登录</button></form>',
      makeConfig(),
    );
    scan();

    focus(control(0));
    focus(control(1));

    expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
  });

  /**
   * 让位的判据必须是「快速填充真的认领了这个框」，不是「这个框长得像账号字段」。
   *
   * `getFieldType` 只看桶归属，而侧边栏/钥匙的触发条件另有 `isInLoginFormOrPopup`。
   * 注册页的手机号框按前者被判成 mobile，却永远走不进快速填充，结果是钥匙和提示双双没有
   * ——一个手机号框在注册场景里恰恰是最该提示「可以从身份库取」的字段。
   */
  it('非登录形态里的手机号框不再被让位挡掉：账号链没认领它，提示要顶上', async () => {
    await mount('<label>手机号码<input name="mobile" type="tel"></label>', makeConfig());
    scan();

    focus(control());

    expect(shown()).toEqual(['phone']);
  });

  it('手机号 + 验证码的短信登录页仍让位给快速填充', async () => {
    await mount(
      '<form><label>手机号码<input name="mobile" type="tel"></label><input name="smsCode" type="text"></form>',
      makeConfig(),
    );
    scan();

    focus(control());

    expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
  });

  /**
   * 让位要再问一句「钥匙取得出这个值吗」。
   *
   * `MOBILE_KEYWORDS` 把「号码」当子串，于是「证件号码 / 身份证号码」这类框在旧分桶里就是手机号框，
   * 钥匙会在它上面出现——但钥匙的面板只有账号、手机号、邮箱，取不出身份库里的证件号。用户实测
   * 「红框那一行没识别到」正是这条：让位之后两头落空，框上只有一枚点开是账号列表的钥匙。
   *
   * 所以让位的判据收窄成两条同时成立：钥匙真的认领了这一框，**且**这一框的角色是钥匙取得出值的
   * 那一档（手机号 / 邮箱）。证件号、姓名、地址、卡号照旧出提示，哪怕框上同时挂着钥匙。
   */
  it('钥匙认领但取不出值的证件号框不再让位：提示补上钥匙填不了的那一格', async () => {
    await mount(
      '<form><label>证件号码<input placeholder="请输入证件号码"></label><input type="password" name="password"><button type="submit">登录</button></form>',
      makeConfig(),
    );
    scan();

    // 前提自证：这一框确实被快速填充认领了，否则用例只是在测「它没进登录表单」
    expect((detector as any).shouldShowSidePanel(control(0))).toBe(true);

    focus(control(0));

    expect(shown()).toEqual(['idNumber']);
  });

  it('邮箱框被钥匙认领时照旧让位：那是钥匙取得出值的角色', async () => {
    await mount(
      '<form><input type="text" name="email" placeholder="邮箱"><input type="password" name="password"><button type="submit">登录</button></form>',
      makeConfig(),
    );
    scan();

    expect((detector as any).shouldShowSidePanel(control(0))).toBe(true);

    focus(control(0));

    expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
  });

  it('无语义角色的字段收起上一枚气泡，Tab 走过一串无关框不留残影', async () => {
    await mount('<label>姓名<input name="realname"></label><input id="weight" name="weight">', makeConfig());

    focus(control(0));
    expect(shown()).toEqual(['name']);

    focus(control(1));

    expect(shown()).toHaveLength(1);
    expect(identityHint.hideIdentityHint).toHaveBeenCalledTimes(1);
  });

  it.each(['sidepanel', 'manual'] as const)('%s 档位照样出提示：接线点在内联 early return 之前', async fillMode => {
    await mount('<label>姓名<input name="realname"></label>', makeConfig({ fillMode }));

    focus(control());

    expect(shown()).toEqual(['name']);
  });

  it('子 frame 里不出提示，只在顶层 frame 展示', async () => {
    await mount('<label>姓名<input name="realname"></label>', makeConfig());
    // jsdom 里 window.top 是 Window 实例上的自有访问器：必须按原描述符还原，
    // 直接 delete 会让后续用例的 `window !== window.top` 恒真，整节静默失去牙齿
    const originalTop = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { configurable: true, value: {} });

    try {
      focus(control());
      expect(identityHint.showIdentityHint).not.toHaveBeenCalled();
    } finally {
      if (originalTop) Object.defineProperty(window, 'top', originalTop);
      else Reflect.deleteProperty(window, 'top');
    }
  });

  it('destroy 时拆掉气泡宿主', async () => {
    await mount('<label>姓名<input name="realname"></label>', makeConfig());

    detector.destroy();

    expect(identityHint.destroyIdentityHint).toHaveBeenCalledTimes(1);
  });
});
