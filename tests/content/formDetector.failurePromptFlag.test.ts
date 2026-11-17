/** @vitest-environment jsdom */
/**
 * no_form 失败的就地引导标记（FillResult.failurePromptShown）
 *
 * 内联面板选账号后面板即收起，失败反馈由 background 的 FILL_BY_ID 提示条补齐
 * （fillByIdFailureFeedback.test.ts）。唯一不补发的场景是内容脚本已经弹出
 * 就地引导气泡（FillFailurePrompt）——同一失败不叠加两条反馈。本文件钉住
 * 这个标记与气泡门控严格同步：
 *
 * 1. 穿透开关开启且本页首次 no_form：标记为 true，气泡确实被触发；
 * 2. 同一实例第二次 no_form：气泡不再弹，标记缺省（提示条必须接管反馈）；
 * 3. 穿透开关关闭：气泡不弹，标记缺省。
 *
 * 反向验证——移除 FormDetector 中 `result.failurePromptShown = true` 一行，
 * 用例 1 必然失败；把赋值挪到门控之外，用例 2/3 必然失败。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';
import { showFillFailurePrompt } from '@/entrypoints/content/FillFailurePrompt';

// 气泡本体的渲染与键盘行为由 promptKeyboardExit.test.ts 覆盖，这里只取「是否被触发」
vi.mock('@/entrypoints/content/FillFailurePrompt', () => ({
  showFillFailurePrompt: vi.fn(),
  hideFillFailurePrompt: vi.fn(),
}));

const mockedShowPrompt = vi.mocked(showFillFailurePrompt);

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

/** 安装密闭的 chrome 全局桩（loadConfig / loadSiteRule 按 key 分支返回） */
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

describe('no_form 失败的 failurePromptShown 标记', () => {
  let detector: FormDetector;

  /** 构造实例并短路掉与判定无关的下游动作 */
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

  /** 跑一次必然 no_form 的填充（页面只有一个孤立 tel 框，就绪门刻意不认） */
  const fillOnce = async () => {
    const pending = (detector as any).fillPasswordWithResult({ username: '13800000000' });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await pending;
    // 气泡经 setTimeout(0) + 动态 import 触发，再推一轮定时器让续体落地
    await vi.advanceTimersByTimeAsync(0);
    return result;
  };

  beforeEach(() => {
    mockedShowPrompt.mockClear();
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

  it('穿透开启且首次 no_form：标记为 true，气泡被触发', async () => {
    installChromeMock(makeConfig());
    detector = await createDetector();

    const result = await fillOnce();

    expect(result.reason).toBe('no_form');
    expect(result.failurePromptShown).toBe(true);
    expect(mockedShowPrompt).toHaveBeenCalledTimes(1);
  }, 20000);

  it('同一实例第二次 no_form：气泡不再弹，标记缺省（提示条接管反馈）', async () => {
    installChromeMock(makeConfig());
    detector = await createDetector();

    await fillOnce();
    const second = await fillOnce();

    expect(second.reason).toBe('no_form');
    expect(second.failurePromptShown).toBeUndefined();
    expect(mockedShowPrompt).toHaveBeenCalledTimes(1);
  }, 20000);

  it('穿透关闭：气泡不弹，标记缺省', async () => {
    installChromeMock(makeConfig({ penetrateShadow: false }));
    detector = await createDetector();

    const result = await fillOnce();

    expect(result.reason).toBe('no_form');
    expect(result.failurePromptShown).toBeUndefined();
    expect(mockedShowPrompt).not.toHaveBeenCalled();
  }, 20000);
});
