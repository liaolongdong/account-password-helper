/** @vitest-environment jsdom */
/**
 * 回归：气泡渲染抛错时标记缺省，且一次性门归还（下次失败可重试气泡）
 *
 * failurePromptShown 的语义是「气泡真的落地了」，不是「尝试过渲染」。
 * 渲染抛错（Shadow DOM 构建异常等）若仍回执 true，background 提示条被抑制 ⇒ 零反馈；
 * 若一次性门不归还，本页后续失败也永远失去气泡机会。
 *
 * 反向验证——标记在 show 之前置位、或 catch 里不重置 fillFailurePromptShown，本用例必红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';
import { showFillFailurePrompt } from '@/entrypoints/content/FillFailurePrompt';

vi.mock('@/entrypoints/content/FillFailurePrompt', () => ({
  showFillFailurePrompt: vi.fn(),
  hideFillFailurePrompt: vi.fn(),
}));

const mockedShowPrompt = vi.mocked(showFillFailurePrompt);

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

describe('气泡渲染抛错时的 failurePromptShown 契约', () => {
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
    mockedShowPrompt.mockReset();
    // 首次渲染抛错，第二次正常：同时钉住「标记缺省」与「门归还后重试成功」
    mockedShowPrompt.mockImplementationOnce(() => {
      throw new Error('render failed');
    });
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

  it('首次渲染抛错标记缺省；第二次失败重试气泡成功并回执 true', async () => {
    installChromeMock(makeConfig());
    detector = await createDetector();

    const first = await fillOnce();
    expect(first.reason).toBe('no_form');
    expect(first.failurePromptShown).toBeUndefined();
    expect(mockedShowPrompt).toHaveBeenCalledTimes(1);

    const second = await fillOnce();
    expect(second.reason).toBe('no_form');
    expect(second.failurePromptShown).toBe(true);
    expect(mockedShowPrompt).toHaveBeenCalledTimes(2);
  }, 20000);
});
