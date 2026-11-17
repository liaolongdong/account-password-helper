/** @vitest-environment jsdom */
/**
 * 回归：FillFailurePrompt chunk 加载失败时不得回执 failurePromptShown
 *
 * 扩展更新后旧内容脚本引用的 chunk URL 会失效，动态 import 必然拒绝。
 * 若标记在渲染前置位，background 的 FILL_BY_ID 提示条会据标记抑制补发，
 * 而气泡又没弹出来——首次 no_form 失败用户零反馈（「点了没反应」）。
 * 契约：气泡没真正落地 ⇒ 标记缺省，提示条接管反馈。
 *
 * 反向验证——把 `result.failurePromptShown = true` 挪回 import 之前，本用例必红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';

// 工厂直接抛错 = 动态 import 拒绝（chunk 加载失败）；FormDetector 仅动态引用该模块
vi.mock('@/entrypoints/content/FillFailurePrompt', () => {
  throw new Error('chunk load failed');
});

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

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('气泡 chunk 加载失败时的 failurePromptShown 契约', () => {
  let detector: FormDetector;

  const createDetector = async (): Promise<FormDetector> => {
    const instance = new FormDetector();
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    vi.spyOn(instance as any, 'hideSidePanel').mockResolvedValue(undefined);
    vi.spyOn(instance as any, 'triggerLogin').mockImplementation(() => {});
    await settle();
    (instance as any).detectForms();
    return instance;
  };

  const fillOnce = async () => {
    const pending = (detector as any).fillPasswordWithResult({ username: '13800000000' });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await pending;
    await vi.advanceTimersByTimeAsync(0);
    return result;
  };

  beforeEach(() => {
    document.body.innerHTML = '<form><input id="tel" type="tel" name="mobile"></form>';
    (document as any).execCommand = vi.fn(() => true);
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
    vi.spyOn(domUtils, 'isDetectableCheckbox').mockImplementation(() => true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    detector?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('首次 no_form 且 import 拒绝：标记缺省，提示条必须接管反馈', async () => {
    installChromeMock(makeConfig());
    detector = await createDetector();

    const result = await fillOnce();

    expect(result.reason).toBe('no_form');
    expect(result.failurePromptShown).toBeUndefined();
  }, 20000);
});
