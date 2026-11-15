/** @vitest-environment jsdom */
/**
 * 钥匙图标对眼睛切换按钮的避让判定（揭示态回归）
 *
 * 缺陷背景：眼睛按钮的可见性取决于「字段有没有值」，而钥匙图标的避让守卫却看「当前 type」。
 * 点眼睛后 type 被切为 text（揭示态），眼睛按钮仍然可见，但守卫以 `type !== 'password'`
 * 误判「没有眼睛」，钥匙图标避让偏移落到 6px，直接压在眼睛占据的右缘 28px 区上；
 * 眼睛点击回调自身还会 `input.focus()`，因此每次点眼睛立即触发重叠。
 *
 * 本文件钉住调用点契约：聚焦登录字段时传给 `showTriggerFor` 的 `hasEyeToggle`
 * 必须以「该字段是否为被托管的密码字段」为准（稳定标记 data-aph-password），
 * 而不是以会被揭示动作改写的当前 type 为准。字段是否算登录框的判定由既有用例覆盖，
 * 这里固定 shouldShowSidePanel 为 true，只断言避让参数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';

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

/** 安装密闭的 chrome 全局桩（loadConfig / loadSiteRule / 眼睛开关初始化都走 storage.local.get） */
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

/** 让 loadConfig / initPasswordVisibilityToggle 的异步续体落地 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('钥匙图标对眼睛按钮的避让判定', () => {
  let detector: FormDetector;

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

  /**
   * 布页面 → 装配置 → 构造实例 → 聚焦目标字段，截获 showTriggerFor 的避让参数。
   * shouldShowSidePanel 固定 true 以隔离被测守卫；身份提示短路避免异步副作用。
   */
  const focusAndCapture = async (
    config: Record<string, unknown>,
    pick: (fields: { user: HTMLInputElement; pwd: HTMLInputElement }) => HTMLInputElement,
    mutate?: (input: HTMLInputElement) => void,
  ): Promise<{ input: HTMLInputElement; hasEyeToggle: boolean | undefined; calls: number }> => {
    const fields = buildLoginDom();
    installChromeMock(config);
    const instance = new FormDetector();
    detector = instance;
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    vi.spyOn(instance as any, 'handleIdentityHintOnFocus').mockImplementation(() => {});
    vi.spyOn(instance as any, 'shouldShowSidePanel').mockReturnValue(true);
    const showTriggerFor = vi.spyOn((instance as any).inlineDropdown, 'showTriggerFor').mockImplementation(() => {});
    await settle();

    const input = pick(fields);
    mutate?.(input);
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    await settle();

    const last = showTriggerFor.mock.calls[showTriggerFor.mock.calls.length - 1];
    return {
      input,
      hasEyeToggle: (last?.[1] as { hasEyeToggle?: boolean } | undefined)?.hasEyeToggle,
      calls: showTriggerFor.mock.calls.length,
    };
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

  it('揭示态（type 已切为 text）密码框聚焦：仍为眼睛预留避让', async () => {
    const { input, hasEyeToggle, calls } = await focusAndCapture(
      makeConfig({ passwordVisibilityToggle: true }),
      f => f.pwd,
      pwd => {
        // 复刻点眼睛后的揭示态：值仍在、type 已被切换为 text
        pwd.value = 'secret';
        pwd.type = 'text';
      },
    );
    // 前置：眼睛功能确已托管该字段（否则断言会因注入失败而空洞通过）
    expect(input.dataset.aphPassword).toBe('true');
    expect(calls).toBe(1);
    expect(hasEyeToggle).toBe(true);
  });

  it('密文态密码框聚焦：为眼睛预留避让（既有行为回归守卫）', async () => {
    const { hasEyeToggle, calls } = await focusAndCapture(makeConfig({ passwordVisibilityToggle: true }), f => f.pwd);
    expect(calls).toBe(1);
    expect(hasEyeToggle).toBe(true);
  });

  it('账号框聚焦：不预留避让', async () => {
    const { hasEyeToggle, calls } = await focusAndCapture(makeConfig({ passwordVisibilityToggle: true }), f => f.user);
    expect(calls).toBe(1);
    expect(hasEyeToggle).toBe(false);
  });

  it('眼睛功能关闭时密码框聚焦：不预留避让', async () => {
    const { hasEyeToggle, calls } = await focusAndCapture(makeConfig({ passwordVisibilityToggle: false }), f => f.pwd);
    expect(calls).toBe(1);
    expect(hasEyeToggle).toBe(false);
  });
});
