/** @vitest-environment jsdom */
/**
 * 账号桶内的取值顺序：条目的值形状决定它该进哪个框（P0）
 *
 * `USERNAME_SELECTORS` 把 `[name*="email"]`、`[name*="mobile"]`、`[name*="user"]` 收进同一个桶，
 * 于是「手机号 / 邮箱二选一」这类两个框都渲染的登录页，旧逻辑按文档顺序取首个可见项——
 * 条目里存的是邮箱却可能写进手机号框（反之亦然），用户看到的是「填了但登不上」。
 *
 * 本文件钉住修复后的取值口径与它的三条边界：
 * 1. 只在**多个候选**且**值形状明确**时才改次序（单候选、值形状不明确一律维持文档顺序首个）；
 * 2. 只调次序、**不淘汰候选**（唯一候选就算语义不吻合也照写，不能退化成「填不了」）；
 * 3. 号码形状判定刻意保守：国内手机号与带 `+` 的国际格式算号码，纯数字登录名（学号 / 工号 /
 *    QQ 号）不算，否则这类值会被推进页面的手机号框。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import type { InputFiller } from '@/entrypoints/content/InputFiller';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';
import {
  classifyAccountField,
  isEmailLikeValue,
  isPhoneLikeValue,
  looksLikeCodeField,
  looksLikePhoneField,
} from '@/entrypoints/content/formSelectors';

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

/** 安装密闭的 chrome 全局桩：`loadConfig` / `loadSiteRule` 都读 storage.local */
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

/** 建一个未挂到文档的输入框，供纯判据函数单测用 */
const makeInput = (attrs: Record<string, string>): HTMLInputElement => {
  const input = document.createElement('input');
  Object.entries(attrs).forEach(([name, value]) => input.setAttribute(name, value));
  return input;
};

describe('账号桶内的取值顺序', () => {
  let detector: FormDetector;
  let writes: Array<{ id: string; value: string }>;

  /** 只写 HTML：结论依赖分类结果，手工赋值字段数组会把判据和夹具混在一起 */
  const buildDom = (html: string): void => {
    document.body.innerHTML = `<form>${html}</form>`;
  };

  /** 构造实例并短路掉与取值无关的下游动作 */
  const createDetector = async (configOverrides: Record<string, unknown> = {}): Promise<FormDetector> => {
    const instance = new FormDetector();
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    vi.spyOn(instance as any, 'hideSidePanel').mockResolvedValue(undefined);
    vi.spyOn(instance as any, 'triggerLogin').mockImplementation(() => {});
    installChromeMock(makeConfig(configOverrides));
    await settle();
    (instance as any).detectForms();
    return instance;
  };

  /** 记录每次字段写入的目标与值——「账号跑进了哪个框」只能从写入调用本身取证 */
  const spyWrites = (): void => {
    const filler = (detector as unknown as { inputFiller: InputFiller }).inputFiller;
    vi.spyOn(filler, 'setInputValueWithStrategies').mockImplementation(async (input, value) => {
      writes.push({ id: input.id, value });
      return { filled: true, verified: true, strategy: 'native' };
    });
  };

  /** 走一遍真实填充入口，返回写入记录 */
  const fill = async (username: string, password?: string, autoLogin = false) => {
    await (detector as any).fillPasswordWithResult({ username, password, autoLogin });
    return writes;
  };

  beforeEach(() => {
    writes = [];
    (document as any).execCommand = vi.fn(() => true);
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
    vi.spyOn(domUtils, 'isDetectableCheckbox').mockImplementation(() => true);
  });

  afterEach(() => {
    detector?.destroy();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('二选一登录页的取值', () => {
    it('值是邮箱时写进邮箱框，哪怕手机号框排在前面', async () => {
      buildDom(`
        <input id="mobile" type="text" name="mobile" placeholder="手机号">
        <input id="email" type="text" name="email" placeholder="邮箱">
        <input id="pwd" type="password" name="password">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('someone@example.com', 'p-word')).toEqual([
        { id: 'email', value: 'someone@example.com' },
        { id: 'pwd', value: 'p-word' },
      ]);
    });

    it('值是国内手机号时写进手机号框，哪怕邮箱框排在前面', async () => {
      buildDom(`
        <input id="email" type="text" name="email" placeholder="邮箱">
        <input id="mobile" type="text" name="mobile" placeholder="手机号">
        <input id="pwd" type="password" name="password">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('13800000000', 'p-word')).toEqual([
        { id: 'mobile', value: '13800000000' },
        { id: 'pwd', value: 'p-word' },
      ]);
    });

    it('值是普通用户名时不改次序，仍是文档顺序首个', async () => {
      buildDom(`
        <input id="mobile" type="text" name="mobile" placeholder="手机号">
        <input id="email" type="text" name="email" placeholder="邮箱">
        <input id="pwd" type="password" name="password">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('plain-name')).toEqual([{ id: 'mobile', value: 'plain-name' }]);
    });

    it('值是纯数字登录名（QQ 号形状）时不被当成手机号', async () => {
      // 手机号框排在前面：若把 9 位纯数字误判成号码，次序不变、结果同序，
      // 因此这里把手机号框放到后面——一旦误判就会从 mobile 变成 user
      buildDom(`
        <input id="user" type="text" name="username" placeholder="账号">
        <input id="mobile" type="text" name="mobile" placeholder="手机号">
        <input id="pwd" type="password" name="password">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('123456789')).toEqual([{ id: 'user', value: '123456789' }]);
    });
  });

  describe('次序调整不许变成能力倒退', () => {
    it('唯一候选即使语义不吻合也照写，不能退化成填不了', async () => {
      // 短信登录页的手机号框是通用的 `name="username"`：值是手机号但没有号码语义框，
      // 旧逻辑写进这个框是对的，排序必须原样保留这一结果
      buildDom(`
        <input id="user" type="text" name="username">
        <input id="code" type="text" name="smsCode">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('13800000000')).toEqual([{ id: 'user', value: '13800000000' }]);
    });

    it('页面只有手机号框且值形状不明确时照写', async () => {
      buildDom(`
        <input id="mobile" type="text" name="mobile" placeholder="手机号">
        <input id="code" type="text" name="smsCode">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('plain-name')).toEqual([{ id: 'mobile', value: 'plain-name' }]);
    });

    it('账号候选全不可见时不写任何账号框（与旧逻辑同为未填充）', async () => {
      buildDom(`
        <input id="email" type="text" name="email" placeholder="邮箱">
        <input id="mobile" type="text" name="mobile" placeholder="手机号">
        <input id="pwd" type="password" name="password">
      `);
      detector = await createDetector();
      spyWrites();
      // 只让账号候选消失，密码框留着——否则就绪门会先把整页判成「没有登录表单」，
      // 量到的就不是「多候选里有几个真的能写」这件事
      vi.mocked(domUtils.isElementVisible).mockImplementation(input => (input as HTMLElement).id === 'pwd');

      const result = await (detector as any).fillPasswordWithResult({ username: 'someone@example.com' });

      expect(writes).toEqual([]);
      expect(result.details.usernameField.found).toBe(false);
      expect(result.reason).toBe('nothing_filled');
    });
  });

  describe('掩码口令框与登录密码框的次序', () => {
    it('同页既有登录密码框又有掩码口令框时，静态密码进登录密码框', async () => {
      // `input[name*="otp"]` 这类验证码选择器不带 type 限定，而 `input[type="password"]`
      // 无条件收进密码桶，于是两个框同进密码桶；旧逻辑取文档顺序首个，把条目的密码写进了口令框
      buildDom(`
        <input id="user" type="text" name="username">
        <input id="otp" type="password" name="otp" placeholder="动态口令">
        <input id="pwd" type="password" name="password" placeholder="登录密码">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('plain-name', 'p-word')).toEqual([
        { id: 'user', value: 'plain-name' },
        { id: 'pwd', value: 'p-word' },
      ]);
    });

    it('页面只有掩码口令框时照写，排序不砍掉这条能力', async () => {
      buildDom(`
        <input id="user" type="text" name="username">
        <input id="otp" type="password" name="otp" placeholder="动态口令">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('plain-name', 'p-word')).toEqual([
        { id: 'user', value: 'plain-name' },
        { id: 'otp', value: 'p-word' },
      ]);
    });

    it('两个都不像口令时保持文档顺序首个（旧密码 / 新密码页不受影响）', async () => {
      buildDom(`
        <input id="user" type="text" name="username">
        <input id="old" type="password" name="oldPassword">
        <input id="new" type="password" name="newPassword">
      `);
      detector = await createDetector();
      spyWrites();

      expect(await fill('plain-name', 'p-word')).toEqual([
        { id: 'user', value: 'plain-name' },
        { id: 'old', value: 'p-word' },
      ]);
    });

    it('动态码优先写可见的框，检测后被隐藏的框不再冒充成功', async () => {
      buildDom(`
        <input id="hidden" type="text" name="otp">
        <input id="shown" type="text" name="smsCode">
      `);
      detector = await createDetector();
      spyWrites();
      // 检测完成后站点把第一个框收起来（六格验证码组件的常见做法是反过来：
      // 可见格子 + 隐藏真实输入，那种形状由下一条用例守）
      vi.mocked(domUtils.isElementVisible).mockImplementation(input => (input as HTMLElement).id === 'shown');

      await (detector as any).fillTotpCode('123456');

      expect(writes).toEqual([{ id: 'shown', value: '123456' }]);
    });

    it('一个验证码框都不可见时仍写首个，保住「可见格子 + 隐藏输入」那类组件', async () => {
      buildDom(`
        <input id="hidden" type="text" name="otp">
        <input id="hidden2" type="text" name="smsCode">
      `);
      detector = await createDetector();
      spyWrites();
      vi.mocked(domUtils.isElementVisible).mockImplementation(() => false);

      const result = await (detector as any).fillTotpCode('123456');

      expect(writes).toEqual([{ id: 'hidden', value: '123456' }]);
      expect(result.success).toBe(true);
    });

    it('口令语义判定认掩码口令、动态码、校验码与 one-time-code', () => {
      expect(looksLikeCodeField(makeInput({ type: 'password', name: 'otp' }))).toBe(true);
      expect(looksLikeCodeField(makeInput({ type: 'password', placeholder: '动态口令' }))).toBe(true);
      expect(looksLikeCodeField(makeInput({ type: 'text', autocomplete: 'one-time-code' }))).toBe(true);
      expect(looksLikeCodeField(makeInput({ type: 'password', name: 'password', placeholder: '登录密码' }))).toBe(
        false,
      );
      expect(looksLikeCodeField(makeInput({ type: 'password', name: 'oldPassword' }))).toBe(false);
    });
  });

  describe('纯判据函数', () => {
    it('值是邮箱形状才判为邮箱', () => {
      expect(isEmailLikeValue('someone@example.com')).toBe(true);
      expect(isEmailLikeValue(' someone@example.com ')).toBe(true);
      expect(isEmailLikeValue('name@host')).toBe(false);
      expect(isEmailLikeValue('a@b.c')).toBe(false);
      expect(isEmailLikeValue('plain-name')).toBe(false);
      expect(isEmailLikeValue('')).toBe(false);
    });

    it('号码判定只认国内手机号与带 + 的国际格式', () => {
      expect(isPhoneLikeValue('13800000000')).toBe(true);
      expect(isPhoneLikeValue('138 0000 0000')).toBe(true);
      expect(isPhoneLikeValue('+1 415 555 2671')).toBe(true);
      expect(isPhoneLikeValue('123456789')).toBe(false);
      expect(isPhoneLikeValue('23800000000')).toBe(false);
      expect(isPhoneLikeValue('user.name')).toBe(false);
      expect(isPhoneLikeValue('')).toBe(false);
    });

    it('字段语义按属性声明判定，双语义框归通用', () => {
      expect(classifyAccountField(makeInput({ type: 'text', name: 'email' }))).toBe('email');
      expect(classifyAccountField(makeInput({ type: 'email' }))).toBe('email');
      expect(classifyAccountField(makeInput({ type: 'text', name: 'mobile' }))).toBe('phone');
      expect(classifyAccountField(makeInput({ type: 'tel' }))).toBe('phone');
      expect(classifyAccountField(makeInput({ type: 'text', name: 'username', placeholder: '账号' }))).toBe('generic');
      expect(classifyAccountField(makeInput({ type: 'text', name: 'email_mobile' }))).toBe('generic');
    });

    it('手机号语义判定对拆号子框与常见标记都成立', () => {
      expect(
        looksLikePhoneField(makeInput({ type: 'tel', name: 'countryCode', autocomplete: 'tel-country-code' })),
      ).toBe(true);
      expect(looksLikePhoneField(makeInput({ type: 'text', placeholder: '请输入手机号' }))).toBe(true);
      expect(looksLikePhoneField(makeInput({ type: 'text', name: 'username' }))).toBe(false);
    });
  });
});
