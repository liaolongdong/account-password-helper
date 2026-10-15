/** @vitest-environment jsdom */
/**
 * 手机号登录页的就绪门与账号回退（F-1）
 *
 * 检测侧早就把 `input[type="tel"]` 收进了 `mobileFields`，但填充入口的「表单就绪」判定只认
 * 账号框与密码框，于是国内主流的「手机号 + 短信验证码」登录页被整页判成没有登录表单。
 * 本文件钉住放宽后的两半，缺一不可：
 *
 * 1. 就绪门认 `mobile + verifyCode` 这一组合，但**刻意不认 mobile 单独存在**——搜索框、
 *    注册表单、收货地址页全都命中 `input[type="tel"]`，单字段成立等于把这些页面判成登录页。
 * 2. 条目里的 `username` 在纯短信登录页回退写进手机号框（不改存储结构，手机号本就存
 *    `username`）；页面存在密码框时不回退——那是账号密码表单，页面上另一个 tel 框通常是
 *    「绑定手机号 / 短信找回」，把账号写进去是错的。
 *
 * 两半必须同时落地：只开门不加回退，填充会从「有明确提示的失败」变成静默的「填充未完成」，
 * 因为就地引导只在 `reason === 'no_form'` 时出现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import type { InputFiller } from '@/entrypoints/content/InputFiller';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';

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

describe('手机号登录页的就绪门与账号回退', () => {
  let detector: FormDetector;

  /**
   * 按真实选择器布出各种页面形状，交给 `detectForms()` 分类
   *
   * 刻意只写 HTML：本文件的结论依赖「tel 框落在哪个桶」这一分类结果，
   * 手工赋值字段数组会让判据和被测行为混在夹具里。
   */
  const buildDom = (html: string): void => {
    document.body.innerHTML = `<form>${html}</form>`;
  };

  /** 标准短信登录页：tel 手机号框 + 文本验证码框 */
  const SMS_LOGIN = `
    <input id="tel" type="tel" name="mobile">
    <input id="code" type="text" name="smsCode">
  `;

  /** 各桶的字段数，用作判定表的读数 */
  const bucketSizes = (): Record<'username' | 'password' | 'mobile' | 'verifyCode', number> => ({
    username: (detector as any).usernameFields.length,
    password: (detector as any).passwordFields.length,
    mobile: (detector as any).mobileFields.length,
    verifyCode: (detector as any).verifyCodeFields.length,
  });

  /** 构造实例并短路掉与判定无关的下游动作 */
  const createDetector = async (): Promise<FormDetector> => {
    const instance = new FormDetector();
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    vi.spyOn(instance as any, 'hideSidePanel').mockResolvedValue(undefined);
    vi.spyOn(instance as any, 'triggerLogin').mockImplementation(() => {});
    await settle();
    // 实例化后的首轮检测排在延时定时器上（真实页面要等 DOMContentLoaded），
    // 而本文件读的是「检测完成后门怎么判」。填充路径自己在入口同步重检测，
    // 所以只有直接判定门的用例需要补这一步，检测时序本身不在这里的口径内。
    (instance as any).detectForms();
    return instance;
  };

  /**
   * 记录每次字段写入的目标与值
   *
   * 「账号有没有跑到手机号框里」「密码有没有被写进 tel 框」只能从写入调用本身取证。
   */
  const spyWrites = (): void => {
    const filler = (detector as unknown as { inputFiller: InputFiller }).inputFiller;
    vi.spyOn(filler, 'setInputValueWithStrategies').mockImplementation(async (input, value) => {
      writes.push({ id: input.id, value });
      return { filled: true, verified: true, strategy: 'native' };
    });
  };

  let writes: Array<{ id: string; value: string }>;

  beforeEach(() => {
    writes = [];
    (document as any).execCommand = vi.fn(() => true);
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
    vi.spyOn(domUtils, 'isDetectableCheckbox').mockImplementation(() => true);
  });

  afterEach(() => {
    detector?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('就绪门判定表', () => {
    const ready = (): boolean => (detector as any).hasFillableLoginForm;

    it('手机号 + 验证码：组合成立即视为就绪', async () => {
      buildDom(SMS_LOGIN);
      installChromeMock(makeConfig());
      detector = await createDetector();

      expect(bucketSizes()).toEqual({ username: 0, password: 0, mobile: 1, verifyCode: 1 });
      expect(ready()).toBe(true);
    });

    it('只有手机号框：不就绪，搜索框与收货地址页不该被当成登录页', async () => {
      buildDom(`<input id="tel" type="tel" name="mobile">`);
      installChromeMock(makeConfig());
      detector = await createDetector();

      expect(bucketSizes()).toEqual({ username: 0, password: 0, mobile: 1, verifyCode: 0 });
      expect(ready()).toBe(false);
    });

    it('名字里含 tel 子串的酒店名框不算手机号字段', async () => {
      // 手机号语义判据曾按子串匹配 `tel`，于是 `name="hotel"` 在点击时会被读成手机号输入框，
      // 而「手机号 + 登录按钮」那一档自动弹出判定正是从 getFieldType 起步的
      buildDom(`<input id="hotel" type="text" name="hotel">`);
      installChromeMock(makeConfig());
      detector = await createDetector();

      expect(bucketSizes()).toEqual({ username: 0, password: 0, mobile: 0, verifyCode: 0 });
      const hotel = document.getElementById('hotel') as HTMLInputElement;
      expect((detector as any).getFieldType(hotel)).toBeNull();
    });

    it('只有验证码框：不就绪，该场景由两步接力胶囊负责', async () => {
      buildDom(`<input id="code" type="text" name="smsCode">`);
      installChromeMock(makeConfig());
      detector = await createDetector();

      expect(bucketSizes()).toEqual({ username: 0, password: 0, mobile: 0, verifyCode: 1 });
      expect(ready()).toBe(false);
    });

    it('文本型手机号框落在账号桶，沿用原有就绪判定', async () => {
      buildDom(`<input id="textMobile" type="text" name="mobile"><input id="code" type="text" name="smsCode">`);
      installChromeMock(makeConfig());
      detector = await createDetector();

      // USERNAME_SELECTORS 先命中，mobile 桶按分类互斥规则被排除
      expect(bucketSizes()).toEqual({ username: 1, password: 0, mobile: 0, verifyCode: 1 });
      expect(ready()).toBe(true);
    });

    it('账号密码页的判定不变', async () => {
      buildDom(`<input id="user" type="text" name="username"><input id="pwd" type="password" name="password">`);
      installChromeMock(makeConfig());
      detector = await createDetector();

      expect(ready()).toBe(true);
    });
  });

  describe('账号回退到手机号框', () => {
    it('短信登录页把条目里的账号写进手机号框，且只写账号', async () => {
      buildDom(SMS_LOGIN);
      installChromeMock(makeConfig());
      detector = await createDetector();
      spyWrites();
      // 就绪门已认这一组合，填充入口应直接开工：走进指数退避重试意味着多跑一轮全量检测
      const detect = vi.spyOn(detector as any, 'detectForms');

      const result = await (detector as any).fillPasswordWithResult({
        username: '13800000000',
        password: 'p-word',
      });

      expect(detect).toHaveBeenCalledTimes(1);
      // 页面上没有密码框，条目里的密码无处可去——写入的只有账号，绝不把密码塞进 tel 框
      expect(writes).toEqual([{ id: 'tel', value: '13800000000' }]);
      expect(result.success).toBe(true);
      expect(result.reason).toBeUndefined();
      // 密码这一项没落地，所以档位是「请核对」而不是「已填充」
      expect(result.outcome).toBe('unverified');
    });

    it('存在密码框时不回退：那是绑定手机号，不是登录账号', async () => {
      buildDom(`
        <input id="pwd" type="password" name="password">
        <input id="tel" type="tel" name="mobile">
      `);
      installChromeMock(makeConfig());
      detector = await createDetector();
      spyWrites();

      await (detector as any).fillPasswordWithResult({ username: 'u-name', password: 'p-word' });

      expect(writes).toEqual([{ id: 'pwd', value: 'p-word' }]);
    });

    it('有账号框时优先账号框，回退不介入', async () => {
      buildDom(`
        <input id="user" type="text" name="username">
        <input id="tel" type="tel" name="mobile">
      `);
      installChromeMock(makeConfig());
      detector = await createDetector();
      spyWrites();

      await (detector as any).fillPasswordWithResult({ username: 'u-name' });

      expect(writes).toEqual([{ id: 'user', value: 'u-name' }]);
    });

    it('拆号页把账号写进完整手机号框，而非排在前面的国家码 / 区号子框', async () => {
      // 国家码子框 autocomplete=tel-country-code 会被 MOBILE_SELECTORS 收进 mobileFields，
      // 且排在完整手机号框前面——旧逻辑取首个可见 tel 会把整串号塞进 3 位的国家码框并谎报成功
      buildDom(`
        <input id="cc" type="tel" autocomplete="tel-country-code" name="countryCode">
        <input id="tel" type="tel" autocomplete="tel-national" name="mobile">
        <input id="code" type="text" name="smsCode">
      `);
      installChromeMock(makeConfig());
      detector = await createDetector();
      spyWrites();

      const result = await (detector as any).fillPasswordWithResult({ username: '13800000000' });

      expect(writes).toEqual([{ id: 'tel', value: '13800000000' }]);
      expect(result.success).toBe(true);
    });

    it('只剩号码子框时不回退填充，宁可提示也不写进明显错误的短框', async () => {
      // 页面里唯一的 tel 是国家码子框：就绪门仍成立（mobile + 验证码并存），但回退找不到
      // 可承载完整手机号的目标，必须返回未填充失败，而不是把整串号塞进 3 位子框报成功
      buildDom(`
        <input id="cc" type="tel" autocomplete="tel-country-code" name="countryCode">
        <input id="code" type="text" name="smsCode">
      `);
      installChromeMock(makeConfig());
      detector = await createDetector();
      spyWrites();

      const result = await (detector as any).fillPasswordWithResult({ username: '13800000000' });

      expect(writes).toEqual([]);
      expect(result.success).toBe(false);
    });

    it('纯验证码页的失败仍带回 no_form，就地引导的前提不变', async () => {
      buildDom(`<input id="tel" type="tel" name="mobile">`);
      // 关掉穿透总闸，避免失败分支去动态加载引导气泡——本用例只钉判定与失败原因
      installChromeMock(makeConfig({ penetrateShadow: false }));
      detector = await createDetector();
      spyWrites();

      vi.useFakeTimers();
      const pending = (detector as any).fillPasswordWithResult({ username: '13800000000' });
      await vi.advanceTimersByTimeAsync(10000);
      const result = await pending;

      expect(writes).toEqual([]);
      expect(result.reason).toBe('no_form');
    }, 20000);
  });
});
