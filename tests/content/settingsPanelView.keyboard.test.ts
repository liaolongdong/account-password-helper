/** @vitest-environment jsdom */

/**
 * 设置面板键盘可达性与非视觉状态（A-1）的回归测试
 *
 * 面板被三处复用（悬浮按钮 Shadow DOM / 侧边栏 / Options），里面没有一个是原生表单控件：
 * 开关与滑块是 `div`，分段选项与色块是无边框 `button`。改动前它们只有鼠标路径能操作，
 * 且「当前生效的是哪一档」全靠底色与勾表达——全属视觉通道。因此本文件钉住四层：
 * 1. 可聚焦：`role` + `tabindex="0"` 必须在 HTML 里，否则焦点轮廓是死 CSS；
 * 2. 可操作：Enter/空格切换开关，方向键/PageUp/PageDown/Home/End 调滑块，且各键的默认动作
 *    （滚动、翻页）被接管，非相关键不误伤；
 * 3. 可感知：`aria-checked` / `aria-pressed` / `aria-valuenow` 与类名同源变更，鼠标点击与
 *    `updateConfig` 外部回灌两条写入路径都要同步——只改类名会让读屏停在旧状态；
 * 4. 有出口：Esc 等价于点遮罩关闭，但悬浮按钮那份是「构造期就绑定、之后只切 visible 类」，
 *    所以隐藏时必须对 Esc 完全惰性，且合成期（输入法取消候选词）不能让面板凭空消失。
 *
 * 刻意不钉的：焦点轮廓的实际渲染（jsdom 不排版），因此样式层只断言规则字符串存在；
 * 拖拽与触摸路径未改动，不在本文件范围内。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindSettingsPanelView,
  getSettingsPanelHTML,
  settingsPanelViewStyles,
} from '@/entrypoints/content/floatingButtons/settingsPanelView';
import { floatingButtonStyles } from '@/entrypoints/content/floatingButtons/styles';
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

/** 挂面板 DOM 并绑定，返回测试要摸的几处节点 */
const mount = (
  config: FloatingButtonConfig = makeConfig(),
  locale: 'zh-CN' | 'en' = 'zh-CN',
  options: { visible?: boolean; onClose?: () => void } = {},
) => {
  const root = document.createElement('div');
  root.className = options.visible === false ? 'settings-panel' : 'settings-panel visible';
  root.innerHTML = getSettingsPanelHTML(config, locale);
  document.body.appendChild(root);
  const onConfigChange = vi.fn();
  const onClose = options.onClose ?? vi.fn();
  const instance = bindSettingsPanelView(root, null, config, { onConfigChange, onClose }, locale);
  return { root, instance, onConfigChange, onClose };
};

/**
 * 派发按键
 *
 * jsdom 的 `KeyboardEventInit` 不接受 `isComposing`，只能事后用属性定义覆盖；
 * 事件必须是 cancelable，否则 `defaultPrevented` 恒为 false，接管默认动作的断言会假绿。
 */
const key = (target: EventTarget, keyName: string, composing = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true });
  if (composing) Object.defineProperty(event, 'isComposing', { value: true });
  target.dispatchEvent(event);
  return event;
};

const switchOf = (root: HTMLElement, setting: string) =>
  root.querySelector<HTMLElement>(`[data-setting="${setting}"]`)!;
const sliderOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-setting="opacity"]')!;
const segmentOf = (root: HTMLElement, group: string, value: string) =>
  root.querySelector<HTMLElement>(`[data-setting="${group}"] [data-value="${value}"]`)!;

/** 取同一行的可见标签文本——无障碍名必须与它同值，否则读屏念的和用户看的是两句话 */
const rowLabelText = (el: HTMLElement): string | undefined =>
  el.closest('.setting-item')?.querySelector('.setting-label')?.textContent?.trim();

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('可聚焦：非原生控件必须进入 Tab 序列', () => {
  it('四个开关与滑块带 role 与 tabindex，焦点轮廓才有消费者', () => {
    const { root } = mount();

    ['visible', 'autoTriggerLogin', 'passwordVisibilityToggle', 'penetrateShadow'].forEach(setting => {
      const el = switchOf(root, setting);
      expect(el.getAttribute('role')).toBe('switch');
      expect(el.getAttribute('tabindex')).toBe('0');
    });

    const slider = sliderOf(root);
    expect(slider.getAttribute('role')).toBe('slider');
    expect(slider.getAttribute('tabindex')).toBe('0');
    expect(slider.getAttribute('aria-valuemin')).toBe('10');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
  });

  it('每个开关与滑块都有无障碍名，且与同行可见标签同值', () => {
    const { root } = mount();

    const controls = [
      switchOf(root, 'visible'),
      switchOf(root, 'autoTriggerLogin'),
      switchOf(root, 'passwordVisibilityToggle'),
      switchOf(root, 'penetrateShadow'),
      sliderOf(root),
    ];
    controls.forEach(el => {
      expect(el.getAttribute('aria-label')).toBe(rowLabelText(el));
    });
    expect(rowLabelText(sliderOf(root))).toBe('按钮透明度');
  });
});

describe('开关：键盘激活键与 aria-checked', () => {
  it('Enter 与空格都切换，且都吃掉默认动作（空格否则翻的是页面）', () => {
    const { root, onConfigChange } = mount();
    const el = switchOf(root, 'visible');

    const enter = key(el, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(el.classList.contains('active')).toBe(false);
    expect(el.getAttribute('aria-checked')).toBe('false');
    expect(onConfigChange).toHaveBeenLastCalledWith({ visible: false });

    const space = key(el, ' ');
    expect(space.defaultPrevented).toBe(true);
    expect(el.classList.contains('active')).toBe(true);
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(onConfigChange).toHaveBeenLastCalledWith({ visible: true });
  });

  it('空格的历史别名 Spacebar 同样生效', () => {
    const { root, onConfigChange } = mount();
    const el = switchOf(root, 'autoTriggerLogin');

    key(el, 'Spacebar');
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(onConfigChange).toHaveBeenCalledWith({ autoTriggerLogin: true });
  });

  it('无关按键不改变状态（方向键留给页面滚动）', () => {
    const { root, onConfigChange } = mount();
    const el = switchOf(root, 'visible');

    ['a', 'ArrowDown', 'Tab'].forEach(type => {
      const event = key(el, type);
      expect(event.defaultPrevented).toBe(false);
    });
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('鼠标点击与键盘走同一个出口，aria-checked 跟着类名一起改', () => {
    const { root, onConfigChange } = mount();
    const el = switchOf(root, 'passwordVisibilityToggle');

    el.click();
    expect(el.classList.contains('active')).toBe(true);
    expect(el.getAttribute('aria-checked')).toBe('true');
    expect(onConfigChange).toHaveBeenCalledWith({ passwordVisibilityToggle: true });
  });

  it('穿透总闸「未写过」渲染为开，关掉只写这一个字段', () => {
    // 存量用户的存储里没有这个键，`get()` 合并默认值后是 true；面板也必须按
    // 「未写 = 开」渲染，否则老用户一打开偏好设置就看到总闸写着关、行为却是开。
    const unset = mount(makeConfig({ penetrateShadow: undefined }));
    const unsetEl = switchOf(unset.root, 'penetrateShadow');
    expect(unsetEl.classList.contains('active')).toBe(true);
    expect(unsetEl.getAttribute('aria-checked')).toBe('true');

    unsetEl.click();
    expect(unsetEl.classList.contains('active')).toBe(false);
    expect(unset.onConfigChange).toHaveBeenCalledWith({ penetrateShadow: false });

    // 真关掉之后重新挂载，渲染要跟着变关；再点一次回到开
    const off = mount(makeConfig({ penetrateShadow: false }));
    const offEl = switchOf(off.root, 'penetrateShadow');
    expect(offEl.classList.contains('active')).toBe(false);
    offEl.click();
    expect(off.onConfigChange).toHaveBeenCalledWith({ penetrateShadow: true });
  });
});

describe('滑块：方向键调值与 aria-valuenow', () => {
  it('↑→ 加一档、↓← 减一档，读数/填充/把手/ARIA 四处一起动', () => {
    const { root, onConfigChange } = mount();
    const slider = sliderOf(root);

    const event = key(slider, 'ArrowUp');
    expect(event.defaultPrevented).toBe(true);
    expect(slider.getAttribute('aria-valuenow')).toBe('95');
    expect(slider.getAttribute('aria-valuetext')).toBe('95%');
    expect(slider.querySelector<HTMLElement>('.slider-fill')!.style.width).toBe('95%');
    expect(slider.querySelector<HTMLElement>('.slider-thumb')!.style.left).toBe('95%');
    expect(slider.parentElement!.querySelector('.slider-value')!.textContent).toBe('95%');
    expect(onConfigChange).toHaveBeenLastCalledWith({ opacity: expect.closeTo(0.95, 5) });

    key(slider, 'ArrowLeft');
    expect(slider.getAttribute('aria-valuenow')).toBe('90');
  });

  it('PageUp/PageDown 走大步，Home/End 到端点', () => {
    const { root } = mount();
    const slider = sliderOf(root);

    key(slider, 'PageUp');
    expect(slider.getAttribute('aria-valuenow')).toBe('100');

    key(slider, 'Home');
    expect(slider.getAttribute('aria-valuenow')).toBe('10');

    key(slider, 'End');
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
  });

  it('两端钳住，键盘不会调出 0% 或 101%', () => {
    const { root, onConfigChange } = mount();
    const slider = sliderOf(root);

    key(slider, 'Home');
    onConfigChange.mockClear();
    key(slider, 'ArrowDown');
    expect(slider.getAttribute('aria-valuenow')).toBe('10');
    expect(onConfigChange).toHaveBeenLastCalledWith({ opacity: 0.1 });

    key(slider, 'End');
    onConfigChange.mockClear();
    ['ArrowRight', 'PageUp'].forEach(type => key(slider, type));
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
    expect(onConfigChange).toHaveBeenLastCalledWith({ opacity: 1 });
  });

  it('无关按键既不写值也不 preventDefault（Esc / 字母留给页面）', () => {
    const { root, onConfigChange } = mount();
    const slider = sliderOf(root);

    ['Escape', 'a', 'Enter'].forEach(type => {
      const event = key(slider, type);
      expect(event.defaultPrevented).toBe(false);
    });
    expect(slider.getAttribute('aria-valuenow')).toBe('90');
    expect(onConfigChange).not.toHaveBeenCalled();
  });
});

describe('分段控件与色块：aria-pressed 与类名同源', () => {
  it('点击填充档位时 aria-pressed 只落在选中项，选中态不再只有颜色', () => {
    const { root, onConfigChange } = mount();
    const group = '[data-setting="fillEntry"] .fill-mode-option';

    segmentOf(root, 'fillEntry', 'inline').click();

    const pressed = [...root.querySelectorAll<HTMLElement>(group)].map(el => el.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false']);
    expect(segmentOf(root, 'fillEntry', 'inline').classList.contains('active')).toBe(true);
    expect(onConfigChange).toHaveBeenCalled();
  });

  it('主题色块点击后 aria-pressed 唯一为真', () => {
    const { root } = mount();
    const swatches = [...root.querySelectorAll<HTMLElement>('.theme-swatch')];

    const lastSwatch = swatches[swatches.length - 1]!;
    lastSwatch.click();

    expect(swatches.map(el => el.getAttribute('aria-pressed'))).toEqual(
      swatches.map((_, i) => String(i === swatches.length - 1)),
    );
  });
});

describe('updateConfig：外部回灌必须把非视觉状态一起带上', () => {
  it('另一个入口改了配置，类名与 ARIA 同时跟上', () => {
    const { root, instance } = mount();

    instance.updateConfig(makeConfig({ visible: false, autoTriggerLogin: true, opacity: 0.5, theme: 'green' }));

    expect(switchOf(root, 'visible').getAttribute('aria-checked')).toBe('false');
    expect(switchOf(root, 'autoTriggerLogin').getAttribute('aria-checked')).toBe('true');
    expect(sliderOf(root).getAttribute('aria-valuenow')).toBe('50');
    const pressedThemes = [...root.querySelectorAll<HTMLElement>('.theme-swatch')].filter(
      el => el.getAttribute('aria-pressed') === 'true',
    );
    expect(pressedThemes).toHaveLength(1);
    expect(pressedThemes[0].getAttribute('data-theme')).toBe('green');
  });

  it('档位由 autoShowSidepanel + fillMode 两字段合成，回灌后分段控件的 pressed 跟着走', () => {
    const { root, instance } = mount();

    instance.updateConfig(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }));

    expect(segmentOf(root, 'fillEntry', 'manual').getAttribute('aria-pressed')).toBe('true');
    expect(segmentOf(root, 'fillEntry', 'sidepanel').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('语言切换：无障碍名不能留在旧语言', () => {
  it('setLocale 刷新开关与滑块的 aria-label、语言分段控件的 pressed', () => {
    const { root, instance } = mount();

    instance.setLocale('en');

    const controls = [
      switchOf(root, 'visible'),
      switchOf(root, 'autoTriggerLogin'),
      switchOf(root, 'passwordVisibilityToggle'),
      switchOf(root, 'penetrateShadow'),
      sliderOf(root),
    ];
    controls.forEach(el => expect(el.getAttribute('aria-label')).toBe(rowLabelText(el)));
    expect(rowLabelText(sliderOf(root))).toBe('Button opacity');
    expect(segmentOf(root, 'locale', 'en').getAttribute('aria-pressed')).toBe('true');
    expect(segmentOf(root, 'locale', 'zh-CN').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Esc 出口', () => {
  it('面板可见时 Esc 等价于点遮罩关闭', () => {
    const { onClose } = mount();

    key(document.body, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('面板隐藏时对 Esc 完全惰性（悬浮按钮那份构造期就绑定）', () => {
    const { onClose } = mount(makeConfig(), 'zh-CN', { visible: false });

    key(document.body, 'Escape');
    expect(onClose).not.toHaveBeenCalled();

    document.querySelector('.settings-panel')!.classList.add('visible');
    key(document.body, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('输入法合成期间的 Esc 留给候选词，面板不收', () => {
    const { onClose } = mount();

    key(document.body, 'Escape', true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('不吃事件的默认动作，页面自己的 Esc 语义照常生效', () => {
    const { onClose } = mount();

    const event = key(document.body, 'Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('其它按键不关面板', () => {
    const { onClose } = mount();

    ['Enter', 'a', 'ArrowUp'].forEach(type => key(document.body, type));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('destroy 之后 Esc 不再触发回调（监听随生命周期回收）', () => {
    const { instance, onClose } = mount();

    instance.destroy();
    key(document.body, 'Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('焦点轮廓样式', () => {
  it('面板四类控件都有 :focus-visible 规则', () => {
    [
      '.switch:focus-visible',
      '.slider:focus-visible',
      '.fill-mode-option:focus-visible',
      '.settings-close:focus-visible',
      '.theme-swatch:focus-visible',
    ].forEach(selector => {
      expect(settingsPanelViewStyles).toContain(selector);
    });
    expect(settingsPanelViewStyles).toMatch(/\.theme-swatch:focus-visible\s*\{[^}]*box-shadow/);
  });

  it('悬浮按钮基态撤了 UA 焦点环，必须补回 :focus-visible', () => {
    expect(floatingButtonStyles).toContain('.btn:focus-visible');
    expect(floatingButtonStyles).toMatch(/\.btn:focus-visible\s*\{[^}]*outline:/);
  });

  it('只认 :focus-visible，不给鼠标点击画常驻方框', () => {
    // 注释里会出现「而非 :focus」这类字样，先剥掉块注释再匹配，否则判据咬到的是散文不是选择器
    [settingsPanelViewStyles, floatingButtonStyles].forEach(styles => {
      const rulesOnly = styles.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(rulesOnly).toContain(':focus-visible');
      expect(rulesOnly.match(/:focus(?![\w-])/g) ?? []).toHaveLength(0);
    });
  });
});
