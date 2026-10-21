/** @vitest-environment jsdom */

/**
 * FormDetector 消费站点级填充规则（F1）的回归测试
 *
 * 背景：站点规则在本次改动前是「只写不读」的，本次是第一个真实消费端，因此以下边界必须钉住：
 * 1. 规则读取是异步的——首轮检测若抢在读取完成前跑完，自定义选择器会被静默跳过，
 *    且 storage 监听只在值变化时触发，本次页面生命周期内再无补救机会；
 * 2. 全局「影子 DOM 穿透」是用户的总闸，站点规则只可在其开启时进一步关闭，不能反向打开；
 * 3. 自定义选择器既是「权威覆盖」，被替换掉的启发式字段就不能再被当成登录框
 *    （getFieldType 优先读类型缓存，只换数组不换缓存等于覆盖只生效一半）；
 * 4. 规则内容来自 storage，属不可信输入：语法非法、字段缺失都不得打断本轮检测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';
import type { SiteRule } from '@/utils/storage/siteRules';

/** 内容脚本用 `document.domain || location.hostname` 取域，测试按同一形态布键 */
const DOMAIN = document.domain || window.location.hostname || '';

/** 与既有 FormDetector 测试一致的默认配置 */
const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  visible: true,
  position: 'right',
  offsetY: 0,
  opacity: 0.9,
  autoShowSidepanel: false,
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
 * `loadConfig` 与 `loadSiteRule` 都走 `chrome.storage.local.get`，但请求的键不同，
 * 因此按 key 分支返回，避免站点规则读取拿到配置对象。
 */
const installChromeMock = (
  config: Record<string, unknown>,
  rules: Record<string, SiteRule>,
  ruleDelay?: () => Promise<void>,
) => {
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
          if (key === STORAGE_KEYS.SITE_RULES) {
            if (ruleDelay) await ruleDelay();
            return { [STORAGE_KEYS.SITE_RULES]: rules };
          }
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

describe('FormDetector 站点规则消费', () => {
  let detector: FormDetector;

  const buildLoginDom = (): Record<string, HTMLInputElement> => {
    document.body.innerHTML = `
      <form id="login">
        <input id="h-user" type="text" name="username">
        <input id="h-pwd" type="password" name="password">
        <input id="a-user" type="text" name="account">
        <input id="a-pwd" type="password" name="secret">
      </form>
    `;
    return {
      hUser: document.getElementById('h-user') as HTMLInputElement,
      hPwd: document.getElementById('h-pwd') as HTMLInputElement,
      aUser: document.getElementById('a-user') as HTMLInputElement,
      aPwd: document.getElementById('a-pwd') as HTMLInputElement,
    };
  };

  /** 创建实例并把会被 jsdom 无关路径干扰的下游动作短路掉，聚焦本模块行为 */
  const createDetector = async (): Promise<FormDetector> => {
    const instance = new FormDetector();
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    await settle();
    return instance;
  };

  beforeEach(() => {
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
    vi.spyOn(domUtils, 'isDetectableCheckbox').mockImplementation(() => true);
  });

  afterEach(() => {
    detector?.destroy();
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('自定义选择器的权威覆盖', () => {
    it('命中时替换账号/密码字段，并把被替换字段的类型缓存降级', async () => {
      const fields = buildLoginDom();
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#a-user', password: '#a-pwd' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      const view = detector as any;

      expect(view.usernameFields).toEqual([fields.aUser]);
      expect(view.passwordFields).toEqual([fields.aPwd]);
      expect(view.getFieldType(fields.aUser)).toBe('username');
      expect(view.getFieldType(fields.aPwd)).toBe('password');
      // 关键：被用户判定为「不是登录框」的启发式字段不能再被识别为登录框
      expect(view.getFieldType(fields.hUser)).toBeNull();
      expect(view.getFieldType(fields.hPwd)).toBeNull();
      expect(view.usernameFieldsSet.has(fields.hUser)).toBe(false);
      expect(view.passwordFieldsSet.has(fields.hPwd)).toBe(false);
    });

    it('规则域名与当前页面不一致时完全不改写检测结果', async () => {
      buildLoginDom();
      installChromeMock(makeConfig(), {
        'other.example': { domain: 'other.example', customSelectors: { username: '#a-user', password: '#a-pwd' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      const view = detector as any;

      expect(view.passwordFields).toHaveLength(2);
      expect(view.getFieldType(view.passwordFields[0])).toBe('password');
    });

    it('只配置账号选择器时保留密码字段的启发式结果', async () => {
      const fields = buildLoginDom();
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#a-user', password: '' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      const view = detector as any;

      expect(view.usernameFields).toEqual([fields.aUser]);
      expect(view.getFieldType(fields.hUser)).toBeNull();
      expect(view.passwordFields).toHaveLength(2);
      // 未配置的一侧不得被顺手清空：密码字段仍是密码字段
      expect(view.getFieldType(view.passwordFields[0])).toBe('password');
    });

    it('选择器语法非法或字段缺失时安全跳过，不打断本轮检测', async () => {
      buildLoginDom();
      installChromeMock(makeConfig(), {
        [DOMAIN]: {
          domain: DOMAIN,
          customSelectors: { username: 'input[[', password: undefined as unknown as string },
        },
      });
      detector = await createDetector();

      expect(() => (detector as any).detectForms()).not.toThrow();
      const view = detector as any;
      expect(view.passwordFields).toHaveLength(2);
      expect(view.usernameFields).toHaveLength(2);
    });

    it('同一轮检测只遍历一次 shadow 根（两条选择器复用查询根）', async () => {
      buildLoginDom();
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#a-user', password: '#a-pwd' } },
      });
      detector = await createDetector();
      const rootsSpy = vi.spyOn(detector as any, 'collectShadowQueryRoots');

      (detector as any).detectForms();

      expect(rootsSpy).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * 规则覆盖是权威路径，绕过全部启发式判据，所以落点必须自己守住边界。
   *
   * 实测事故：短信码登录页没有密码框，而 Options 曾要求选择器成对填写，用户为了钉住账号框
   * 只能把「密码框」随手指到验证码框上 —— 密码因此被写进短信码输入框，回执还报「已填充」。
   * 三道门都只做「不覆盖，交回自动检测」，不新增拒填路径。
   */
  describe('规则落点的安全门', () => {
    /** 短信码登录页形状：账号框与验证码框，没有任何密码框 */
    const buildSmsDom = (): Record<string, HTMLInputElement> => {
      document.body.innerHTML = `
        <div><input id="phone" type="tel" placeholder="请输入手机号"></div>
        <div><input id="code" type="tel" placeholder="请输入验证码" autocomplete="one-time-code" maxlength="6"></div>
      `;
      return {
        phone: document.getElementById('phone') as HTMLInputElement,
        code: document.getElementById('code') as HTMLInputElement,
      };
    };

    it('密码选择器指向验证码框时该侧回退自动检测，账号侧照常生效', async () => {
      const fields = buildSmsDom();
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#phone', password: '#code' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      const view = detector as any;

      expect(view.usernameFields).toEqual([fields.phone]);
      // 关键：密码桶没被规则劫持成验证码框，条目里的密码因此无处可写
      expect(view.passwordFields).toEqual([]);
      expect(view.getFieldType(fields.code)).not.toBe('password');
    });

    it('规则把密码框钉在掩码口令框上时照用（有意配置不被启发式挪走）', async () => {
      document.body.innerHTML = `
        <form>
          <input id="user" type="text" name="username">
          <input id="pwd" type="password" name="password">
          <input id="otp" type="password" name="otp" placeholder="动态口令">
        </form>
      `;
      const otp = document.getElementById('otp') as HTMLInputElement;
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#user', password: '#otp' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      // 银行口令卡、券商动态密码就是「用户要把存的那串值打进这个掩码框」；
      // 拒绝只会把凭证从用户指定的框挪到启发式另选的框，那是更坏的结果
      expect((detector as any).passwordFields).toEqual([otp]);
    });

    it('宽选择器命中多个密码框时让位给不像一次性口令的那个', async () => {
      document.body.innerHTML = `
        <form>
          <input id="user" type="text" name="username">
          <input id="otp" type="password" name="otp" placeholder="动态口令">
          <input id="pwd" type="password" name="password" placeholder="登录密码">
        </form>
      `;
      const passwordFields = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
      installChromeMock(makeConfig(), {
        [DOMAIN]: {
          domain: DOMAIN,
          customSelectors: { username: '#user', password: 'input[type="password"]' },
        },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      // 旧逻辑取文档顺序首个，会把静态密码写进口令框
      expect((detector as any).passwordFields).toEqual([passwordFields[1]]);
    });

    it('账号与密码选择器命中同一个框时两条覆盖都跳过，不出现后写盖前写', async () => {
      buildLoginDom();
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#a-pwd', password: '#a-pwd' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      const view = detector as any;

      expect(view.usernameFields).toHaveLength(2);
      expect(view.passwordFields).toHaveLength(2);
      // 一个框不可能同时是账号框和密码框：整对覆盖作废，启发式结论与类型缓存都保持原样
      expect(view.getFieldType(view.usernameFields[0])).toBe('username');
      expect(view.getFieldType(view.passwordFields[0])).toBe('password');
    });

    it('账号选择器唯一候选是 name="code" 的框时仍照钉（学号/工号登录不被砍掉）', async () => {
      document.body.innerHTML = `
        <form>
          <input id="sid" type="text" name="code">
          <input id="pwd" type="password" name="password">
        </form>
      `;
      const sid = document.getElementById('sid') as HTMLInputElement;
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#sid', password: '#pwd' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      // 口令语义只约束密码落点：账号侧这种写法是站点的真实命名，拒了就是把可用站点判死
      expect((detector as any).usernameFields).toEqual([sid]);
    });

    it('宽选择器命中多个但都不像一次性口令时仍取文档顺序首个（存量规则不变）', async () => {
      document.body.innerHTML = `
        <form>
          <input id="user" type="text" name="username">
          <input id="old" type="password" name="oldPassword">
          <input id="new" type="password" name="newPassword">
        </form>
      `;
      const old = document.getElementById('old') as HTMLInputElement;
      installChromeMock(makeConfig(), {
        [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '#user', password: 'input[type="password"]' } },
      });
      detector = await createDetector();

      (detector as any).detectForms();
      expect((detector as any).passwordFields).toEqual([old]);
    });
  });

  describe('影子 DOM 穿透开关的判定与适用边界', () => {
    /** 按给定全局配置与站点规则创建实例，读出穿透判定后销毁 */
    const resolvePenetration = async (
      config: Record<string, unknown>,
      rule: Partial<SiteRule> | null,
    ): Promise<boolean> => {
      buildLoginDom();
      installChromeMock(config, rule ? { [DOMAIN]: { domain: DOMAIN, ...rule } } : {});
      const instance = await createDetector();
      const enabled = (instance as any).penetrateShadowEnabled as boolean;
      instance.destroy();
      return enabled;
    };

    it('全局关闭穿透时，站点规则不得把它重新打开', async () => {
      expect(await resolvePenetration(makeConfig({ penetrateShadow: false }), { penetrateShadow: true })).toBe(false);
    });

    it('全局开启时，站点规则可针对单站点关闭', async () => {
      expect(await resolvePenetration(makeConfig({ penetrateShadow: true }), { penetrateShadow: false })).toBe(false);
    });

    it('全局开启且无规则/规则未声明该项时保持开启（与改动前一致）', async () => {
      expect(await resolvePenetration(makeConfig({ penetrateShadow: true }), null)).toBe(true);
      expect(await resolvePenetration(makeConfig({ penetrateShadow: true }), {})).toBe(true);
    });

    it('关闭穿透时，规则选择器在主树内依然生效', async () => {
      const fields = buildLoginDom();
      installChromeMock(makeConfig({ penetrateShadow: false }), {
        [DOMAIN]: {
          domain: DOMAIN,
          penetrateShadow: false,
          customSelectors: { username: '#a-user', password: '#a-pwd' },
        },
      });
      detector = await createDetector();
      expect((detector as any).penetrateShadowEnabled).toBe(false);

      (detector as any).detectForms();

      // 选择器是用户逐站点显式写下的确定性指令，本用例只证明它在主树内不被穿透开关作废；
      // 跨 shadow 边界的查询根行为由 formDetector.shadow.test.ts 覆盖，二者不重复断言。
      // 关掉开关会让「去指定字段」的失败引导气泡一并消失（该耦合是否合理已在 JSDoc 标为待评审）
      expect((detector as any).usernameFields).toEqual([fields.aUser]);
      expect((detector as any).passwordFields).toEqual([fields.aPwd]);
    });
  });

  describe('站点档位覆盖快速填充入口（C6）', () => {
    /** 按给定全局配置与站点规则创建实例，读出生效档位后销毁 */
    const resolveEntry = async (config: Record<string, unknown>, rule: Partial<SiteRule> | null): Promise<string> => {
      buildLoginDom();
      installChromeMock(config, rule ? { [DOMAIN]: { domain: DOMAIN, ...rule } } : {});
      const instance = await createDetector();
      const entry = (instance as any).effectiveFillEntry as string;
      instance.destroy();
      return entry;
    };

    it('站点显式设档时替换全局（含全局「仅手动」而该站点要自动弹侧边栏）', async () => {
      expect(
        await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }), { fillEntry: 'sidepanel' }),
      ).toBe('sidepanel');
      expect(
        await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: true }), { fillEntry: 'manual' }),
      ).toBe('manual');
      expect(
        await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: true }), { fillEntry: 'inline' }),
      ).toBe('inline');
    });

    it('规则未声明档位即跟随全局：只配选择器/只关穿透的规则不得顺手改填充入口', async () => {
      expect(await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }), {})).toBe('manual');
      expect(
        await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: true }), { penetrateShadow: false }),
      ).toBe('sidepanel');
      expect(await resolveEntry(makeConfig(), null)).toBe('inline');
    });

    it('档位是替换而非取更保守的一档：两向都能覆盖', async () => {
      // penetrateShadow 那条总闸只能收窄，档位没有全序，两向都必须生效
      expect(await resolveEntry(makeConfig({ fillMode: 'inline' }), { fillEntry: 'sidepanel' })).toBe('sidepanel');
      expect(
        await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: true }), { fillEntry: 'inline' }),
      ).toBe('inline');
    });

    it('规则里是非法档位时回落到全局，坏值不得悄悄打开侧边栏', async () => {
      for (const junk of ['sidepanel-auto', 'Sidepanel', true, 1, '', undefined]) {
        expect(
          await resolveEntry(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }), {
            fillEntry: junk as any,
          }),
        ).toBe('manual');
      }
    });

    /**
     * 档位真的决定「点/聚焦登录框时发生什么」，所以交互层单独钉一组。
     * 字段是否算登录框（shouldShowSidePanel）的判定由既有用例覆盖，这里固定为 true，
     * 只断言入口分派，避免与字段检测的用例重复。
     */
    const dispatchTo = async (
      type: 'click' | 'focusin',
      config: Record<string, unknown>,
      rule: Partial<SiteRule> | null,
    ): Promise<{ sidePanelCalls: number; triggerCalls: number }> => {
      const fields = buildLoginDom();
      installChromeMock(config, rule ? { [DOMAIN]: { domain: DOMAIN, ...rule } } : {});
      const instance = await createDetector();
      vi.spyOn(instance as any, 'shouldShowSidePanel').mockReturnValue(true);
      const showSidePanel = vi.spyOn(instance as any, 'showSidePanel').mockResolvedValue(undefined);
      const showTriggerFor = vi.spyOn((instance as any).inlineDropdown, 'showTriggerFor').mockImplementation(() => {});

      fields.aPwd.dispatchEvent(new Event(type, { bubbles: true }));
      await settle();

      const result = {
        sidePanelCalls: showSidePanel.mock.calls.length,
        triggerCalls: showTriggerFor.mock.calls.length,
      };
      instance.destroy();
      return result;
    };

    it('全局「仅手动」时点击登录框不自动开侧边栏、也不显示内联图标', async () => {
      expect(await dispatchTo('click', makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }), null)).toEqual({
        sidePanelCalls: 0,
        triggerCalls: 0,
      });
    });

    it('站点把自动弹出关掉：全局是侧边栏自动，该站点仍不弹', async () => {
      const config = makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: true });
      expect(await dispatchTo('click', config, null)).toEqual({ sidePanelCalls: 1, triggerCalls: 0 });
      expect(await dispatchTo('click', config, { fillEntry: 'manual' })).toEqual({
        sidePanelCalls: 0,
        triggerCalls: 0,
      });
    });

    it('站点改成内联：点击改为显示钥匙图标，不再弹侧边栏', async () => {
      const config = makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: true });
      expect(await dispatchTo('click', config, { fillEntry: 'inline' })).toEqual({
        sidePanelCalls: 0,
        triggerCalls: 1,
      });
    });

    it('站点改成侧边栏自动：全局是内联时点击改回开侧边栏', async () => {
      expect(await dispatchTo('click', makeConfig(), { fillEntry: 'sidepanel' })).toEqual({
        sidePanelCalls: 1,
        triggerCalls: 0,
      });
    });

    it('聚焦只在生效内联档时显示图标：全局内联 + 站点 manual 也不显示', async () => {
      expect(await dispatchTo('focusin', makeConfig(), null)).toEqual({ sidePanelCalls: 0, triggerCalls: 1 });
      expect(await dispatchTo('focusin', makeConfig(), { fillEntry: 'manual' })).toEqual({
        sidePanelCalls: 0,
        triggerCalls: 0,
      });
      expect(
        await dispatchTo('focusin', makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }), {
          fillEntry: 'inline',
        }),
      ).toEqual({
        sidePanelCalls: 0,
        triggerCalls: 1,
      });
    });
  });

  describe('首轮检测与规则读取的时序', () => {
    it('规则读取晚于首轮定时任务时，选择器依然生效', async () => {
      const fields = buildLoginDom();
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      installChromeMock(
        makeConfig(),
        { [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '', password: '#a-pwd' } } },
        () => gate,
      );

      detector = new FormDetector();
      vi.spyOn(detector as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
      vi.spyOn(detector as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});

      (detector as any).detectFormsAfterSiteRule();
      await settle();
      // 规则还在途中：首轮检测不得抢跑（否则选择器被静默跳过且无补救机会）
      expect((detector as any).passwordFields).toHaveLength(0);

      release();
      await vi.waitFor(() => expect((detector as any).passwordFields).toEqual([fields.aPwd]));
    });
  });

  describe('规则变更监听', () => {
    /** 取出 FormDetector 注册到 chrome.storage.onChanged 上的监听器 */
    const captureSiteRuleListener = async (): Promise<(changes: Record<string, unknown>, area: string) => void> => {
      buildLoginDom();
      installChromeMock(makeConfig(), {});
      detector = await createDetector();
      const addListener = (globalThis as any).chrome.storage.onChanged.addListener;
      expect(addListener.mock.calls.length).toBeGreaterThan(0);
      return addListener.mock.calls[addListener.mock.calls.length - 1][0];
    };

    it('site_rules 在 local 区变更时重检测；无关变更与其它存储区不重检测', async () => {
      const listener = await captureSiteRuleListener();
      const detectSpy = vi.spyOn(detector as any, 'detectForms');

      listener({ [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: { newValue: {} } }, 'local');
      expect(detectSpy).not.toHaveBeenCalled();

      listener({ [STORAGE_KEYS.SITE_RULES]: { newValue: {} } }, 'session');
      expect(detectSpy).not.toHaveBeenCalled();

      listener({ [STORAGE_KEYS.SITE_RULES]: { newValue: {} } }, 'local');
      // 变更处理是异步的：先重读规则再重检测
      await vi.waitFor(() => expect(detectSpy).toHaveBeenCalledTimes(1));
    });

    it('destroy 精确移除站点规则监听器', async () => {
      await captureSiteRuleListener();
      const removeListener = (globalThis as any).chrome.storage.onChanged.removeListener;
      const addListener = (globalThis as any).chrome.storage.onChanged.addListener;
      const registered = addListener.mock.calls[addListener.mock.calls.length - 1][0];

      detector.destroy();

      expect(removeListener).toHaveBeenCalledWith(registered);
    });

    it('destroy 后迟到的规则变更不再触发检测', async () => {
      const listener = await captureSiteRuleListener();
      detector.destroy();
      const detectSpy = vi.spyOn(detector as any, 'detectForms');

      listener({ [STORAGE_KEYS.SITE_RULES]: { newValue: {} } }, 'local');
      await settle();

      expect(detectSpy).not.toHaveBeenCalled();
    });
  });
});
