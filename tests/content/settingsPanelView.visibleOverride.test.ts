/** @vitest-environment jsdom */

/**
 * 设置面板「悬浮按钮显隐被站点规则覆盖」归因提示（B1）的回归测试
 *
 * 与 C6 的填充档位提示同构，但显隐轴有两个自己的坑：
 * 1. 显式 true 也是有效覆盖（全局默认显示可被用户改成隐藏），不能把「覆盖为显示」
 *    当成默认值丢掉——提示必须在覆盖与全局**不同值**时出现，同值时收回；
 * 2. 面板里改的是全局开关：站点覆盖为隐藏时用户把全局开关拨到「显示」，按钮在本站
 *    依然不出现，没有这句提示就会被报成「开关坏了」。
 * 另两处复用（侧边栏 / Options）不传第四参、也不调 setSiteVisibleOverride，必须恒为隐藏。
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

/** 挂一份面板 DOM，返回 [data-visible-override] 提示元素 */
const mountPanel = (html: string): { root: HTMLElement; note: HTMLElement } => {
  const root = document.createElement('div');
  root.className = 'settings-panel';
  root.innerHTML = html;
  document.body.appendChild(root);
  const note = root.querySelector<HTMLElement>('[data-visible-override]')!;
  return { root, note };
};

describe('getSettingsPanelHTML 的显隐覆盖提示初始态', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('不传第四参（侧边栏 / Options 复用）时提示存在但隐藏，存量外观不变', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig()));

    expect(note).not.toBeNull();
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('覆盖为隐藏而全局显示时初始即带文案，点名覆盖到的状态', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig(), 'zh-CN', null, false));

    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('隐藏');
  });

  it('覆盖为显示而全局隐藏时同样有提示（显式 true 不是可丢弃的默认值）', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig({ visible: false }), 'zh-CN', null, true));

    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('显示');
  });

  it('覆盖与全局同值时不写这句话（此时改面板就会生效，提示是误导）', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig(), 'zh-CN', null, true));

    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('英文面板出英文文案', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig(), 'en', null, false));

    expect(note.textContent).toContain('hidden');
    expect(note.textContent).not.toContain('隐藏');
  });
});

describe('bindSettingsPanelView 的显隐覆盖提示重算', () => {
  let handle: ReturnType<typeof bindSettingsPanelView> | undefined;

  const bind = (config: FloatingButtonConfig, locale: 'zh-CN' | 'en' = 'zh-CN') => {
    const { root, note } = mountPanel(getSettingsPanelHTML(config, locale));
    const instance = bindSettingsPanelView(root, null, config, { onConfigChange: vi.fn() }, locale);
    handle = instance;
    return { root, note, instance };
  };

  const toggleVisible = (root: HTMLElement) => {
    root.querySelector<HTMLElement>('[data-setting="visible"]')!.click();
  };

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    document.body.innerHTML = '';
  });

  it('异步读到站点规则后点亮，规则被删（传 null）后收回', () => {
    const { note, instance } = bind(makeConfig());

    instance.setSiteVisibleOverride(false);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('隐藏');

    instance.setSiteVisibleOverride(null);
    expect(note.hidden).toBe(true);
  });

  it('脏值按「无覆盖」处理，不把 storage 里的字符串画进面板', () => {
    const { note, instance } = bind(makeConfig());

    instance.setSiteVisibleOverride('false' as never);
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('全局开关拨到与覆盖同值时提示自动收回（面板显示与提示不得互相打脸）', () => {
    const { root, note, instance } = bind(makeConfig());
    instance.setSiteVisibleOverride(false);
    expect(note.hidden).toBe(false);

    toggleVisible(root);
    expect(note.hidden).toBe(true);
  });

  it('全局开关拨回不同值时提示重新出现，说的还是那个覆盖状态', () => {
    const { root, note, instance } = bind(makeConfig({ visible: false }));
    instance.setSiteVisibleOverride(false);
    expect(note.hidden).toBe(true);

    toggleVisible(root);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('隐藏');
  });

  it('updateConfig（storage 监听回灌全局配置）同样重算提示', () => {
    const { note, instance } = bind(makeConfig());
    instance.setSiteVisibleOverride(false);

    instance.updateConfig(makeConfig({ visible: false }));
    expect(note.hidden).toBe(true);
  });

  it('切换面板语言时提示文案跟着换语言，不残留旧语言句子', () => {
    const { note, instance } = bind(makeConfig());
    instance.setSiteVisibleOverride(false);

    instance.setLocale('en');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('hidden');
    expect(note.textContent).not.toContain('隐藏');
  });

  it('两条覆盖提示互相独立：填充档位提示的点亮与收回不影响显隐提示', () => {
    const { root, note, instance } = bind(makeConfig());
    instance.setSiteVisibleOverride(false);

    instance.setSiteFillOverride('manual');
    expect(note.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-fill-override]')!.hidden).toBe(false);

    instance.setSiteFillOverride(null);
    expect(note.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-fill-override]')!.hidden).toBe(true);
  });
});
