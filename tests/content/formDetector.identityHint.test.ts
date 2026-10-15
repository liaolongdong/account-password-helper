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
 * 2. **登录字段归快速填充**。已进账号/密码桶的字段由 `getFieldType` 挡下，不再叠一层提示。
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
    await mount('<input name="username"><input type="password" name="password">', makeConfig());

    focus(control(0));
    focus(control(1));

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
