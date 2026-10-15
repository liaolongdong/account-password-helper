/** @vitest-environment jsdom */

/**
 * `updateConfig` 回灌时五个开关的显隐口径回归测试
 *
 * 面板读开关态的地方有三处：初始 HTML、点击切换、`updateConfig`（storage 监听回灌全局配置）。
 * 前两处走 `isSwitchOn`，第三处此前自己写了一遍 `!!config[key]`——`penetrateShadow` 与
 * `identityHintEnabled` 是唯二可选的布尔（存量存储里可能根本没这两个键，检测侧按「未写即开」跑），
 * 于是老配置只要触发一次回灌，面板就把开关画成关，而引擎照常按开在查 shadowRoot / 出提示。
 * 读屏还念着 `aria-checked="false"`。
 *
 * 因此钉住两件事：
 * 1. 缺键回灌必须仍是开（与初始渲染同口径，不能「先对后错」）；
 * 2. 「未写即开」只属于那两个可选开关，另外三个必填开关收到 `false` 仍要落回关。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSettingsPanelView, getSettingsPanelHTML } from '@/entrypoints/content/floatingButtons/settingsPanelView';
import type { FloatingButtonConfig } from '@/utils/types';

const makeConfig = (overrides: Partial<FloatingButtonConfig> = {}): FloatingButtonConfig => ({
  visible: true,
  position: 'right',
  offsetY: 0,
  opacity: 0.9,
  autoShowSidepanel: true,
  autoTriggerLogin: false,
  passwordVisibilityToggle: false,
  fillMode: 'sidepanel',
  theme: 'sky',
  penetrateShadow: true,
  ...overrides,
});

/** 存量配置形态：storage 里两个可选布尔键都没写过 */
const legacyConfig = (): FloatingButtonConfig => {
  const config = makeConfig();
  delete config.penetrateShadow;
  delete config.identityHintEnabled;
  return config;
};

const mount = (config: FloatingButtonConfig = makeConfig()) => {
  const root = document.createElement('div');
  root.className = 'settings-panel';
  root.innerHTML = getSettingsPanelHTML(config);
  document.body.appendChild(root);
  const onConfigChange = vi.fn();
  const instance = bindSettingsPanelView(root, null, config, { onConfigChange });
  const switchOf = (setting: string) => root.querySelector<HTMLElement>(`[data-setting="${setting}"]`)!;
  return { root, instance, switchOf, onConfigChange };
};

/** 开关的两种可读状态：视觉 class 与读屏值，二者必须同向 */
const switchState = (el: HTMLElement) => ({
  active: el.classList.contains('active'),
  ariaChecked: el.getAttribute('aria-checked'),
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('updateConfig 的开关显隐口径', () => {
  it('存量配置（无 penetrateShadow 键）初始就画成开，与检测侧「未写即开」一致', () => {
    const { switchOf } = mount(legacyConfig());

    expect(switchState(switchOf('penetrateShadow'))).toEqual({ active: true, ariaChecked: 'true' });
  });

  it('缺键配置被 storage 回灌一次后仍是开（旧口径会在这里悄悄画成关）', () => {
    const { instance, switchOf } = mount(legacyConfig());

    instance.updateConfig(legacyConfig());

    expect(switchState(switchOf('penetrateShadow'))).toEqual({ active: true, ariaChecked: 'true' });
  });

  it('回灌显式的 false 才落回关——「未写即开」不能被写成「恒为开」', () => {
    const { instance, switchOf } = mount(legacyConfig());

    instance.updateConfig(makeConfig({ penetrateShadow: false }));

    expect(switchState(switchOf('penetrateShadow'))).toEqual({ active: false, ariaChecked: 'false' });
  });

  it('另外三个必填开关不吃「未写即开」，收到 false 一律落回关', () => {
    const { instance, switchOf } = mount();

    instance.updateConfig(
      makeConfig({ visible: false, autoTriggerLogin: false, passwordVisibilityToggle: false, penetrateShadow: true }),
    );

    ['visible', 'autoTriggerLogin', 'passwordVisibilityToggle'].forEach(setting => {
      expect(switchState(switchOf(setting)), setting).toEqual({ active: false, ariaChecked: 'false' });
    });
    expect(switchState(switchOf('penetrateShadow'))).toEqual({ active: true, ariaChecked: 'true' });
  });

  it('「个人信息字段提示」同样是未写即开：缺键画成开、回灌仍是开、显式 false 才落回关', () => {
    const { instance, switchOf } = mount(legacyConfig());

    expect(switchState(switchOf('identityHintEnabled'))).toEqual({ active: true, ariaChecked: 'true' });

    instance.updateConfig(legacyConfig());
    expect(switchState(switchOf('identityHintEnabled'))).toEqual({ active: true, ariaChecked: 'true' });

    instance.updateConfig(makeConfig({ identityHintEnabled: false }));
    expect(switchState(switchOf('identityHintEnabled'))).toEqual({ active: false, ariaChecked: 'false' });
  });

  it('老配置下点一次该开关发出显式 false，不是「算了个没变化」的空点击', () => {
    const { switchOf, onConfigChange } = mount(legacyConfig());

    switchOf('identityHintEnabled').click();

    // 缺键时若按 `!config[key]` 取反，算出来仍是开 → 存储不写值、开关不动，用户看到的是死点击
    expect(onConfigChange).toHaveBeenCalledWith({ identityHintEnabled: false });
    expect(switchState(switchOf('identityHintEnabled'))).toEqual({ active: false, ariaChecked: 'false' });
  });
});
