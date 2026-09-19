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

  describe('影子 DOM 穿透优先级', () => {
    const scanCallCount = async (config: Record<string, unknown>, rule: Partial<SiteRule> | null): Promise<number> => {
      buildLoginDom();
      installChromeMock(config, rule && DOMAIN ? { [DOMAIN]: { domain: DOMAIN, ...rule } } : {});
      const instance = await createDetector();
      const spy = vi.spyOn(instance as any, 'collectFieldsFromShadowRoots');

      (instance as any).detectForms();
      instance.destroy();
      return spy.mock.calls.length;
    };

    it('全局关闭穿透时，站点规则不得把它重新打开', async () => {
      expect(await scanCallCount(makeConfig({ penetrateShadow: false }), { penetrateShadow: true })).toBe(0);
    });

    it('全局开启时，站点规则可针对单站点关闭', async () => {
      expect(await scanCallCount(makeConfig({ penetrateShadow: true }), { penetrateShadow: false })).toBe(0);
    });

    it('全局开启且无规则/规则未声明该项时保持扫描（与改动前一致）', async () => {
      expect(await scanCallCount(makeConfig({ penetrateShadow: true }), null)).toBe(1);
      expect(await scanCallCount(makeConfig({ penetrateShadow: true }), {})).toBe(1);
    });

    it('失败引导气泡与扫描共用同一判定', async () => {
      buildLoginDom();
      installChromeMock(makeConfig({ penetrateShadow: false }), {
        [DOMAIN]: { domain: DOMAIN, penetrateShadow: true },
      });
      detector = await createDetector();

      expect((detector as any).penetrateShadowEnabled).toBe(false);
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
