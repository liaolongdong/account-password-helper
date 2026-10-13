/** @vitest-environment jsdom */

/**
 * 设置面板「站点覆盖归因提示」（C6）的回归测试
 *
 * 背景：同一个设置面板被三处复用（悬浮按钮 / 侧边栏 / Options），只有悬浮按钮那份是
 * 「当前站点」语境。用户在站点里改了全局档位却看不到效果、又不知道为什么，是本次唯一
 * 新增的可观察行为，因此必须钉住：
 * 1. 提示只在「确有覆盖 **且** 覆盖与全局不同档」时出现——同档时说这句话是误导；
 * 2. 另两处复用（不传第三参、也不调 setSiteFillOverride）必须恒为隐藏，存量外观零变化；
 * 3. 面板 HTML 先渲染、站点规则之后异步读到，所以提示要能被后续点亮与收回；
 * 4. 语言切换、全局档位改到与覆盖同档、storage 里出现脏档位值三条路径都得跟着重算，
 *    任何一条只更新一半都会留下「提示说被覆盖为 A，面板已选 A」的自相矛盾状态。
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

/** 挂一份面板 DOM，返回 [data-fill-override] 与其容器 */
const mountPanel = (html: string): { root: HTMLElement; note: HTMLElement } => {
  const root = document.createElement('div');
  root.className = 'settings-panel';
  root.innerHTML = html;
  document.body.appendChild(root);
  const note = root.querySelector<HTMLElement>('[data-fill-override]')!;
  return { root, note };
};

describe('getSettingsPanelHTML 的覆盖提示初始态', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('不传第三参（侧边栏 / Options 复用）时提示存在但隐藏，存量外观不变', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig()));

    expect(note).not.toBeNull();
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('覆盖与全局不同档时初始即带文案，且文案里带上覆盖到的档位名', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig(), 'zh-CN', 'manual'));

    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('仅手动');
  });

  it('覆盖与全局同档时不写这句话（此时改面板就会生效，提示是误导）', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig(), 'zh-CN', 'sidepanel'));

    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('英文面板出英文文案', () => {
    const { note } = mountPanel(getSettingsPanelHTML(makeConfig(), 'en', 'inline'));

    expect(note.textContent).toContain('Inline');
    expect(note.textContent).not.toContain('页面内联');
  });
});

describe('bindSettingsPanelView 的覆盖提示重算', () => {
  let handle: ReturnType<typeof bindSettingsPanelView> | undefined;

  const bind = (config: FloatingButtonConfig, locale: 'zh-CN' | 'en' = 'zh-CN') => {
    const { root, note } = mountPanel(getSettingsPanelHTML(config, locale));
    const instance = bindSettingsPanelView(root, null, config, { onConfigChange: vi.fn() }, locale);
    handle = instance;
    return { root, note, instance };
  };

  const clickSegment = (root: HTMLElement, value: string) => {
    root.querySelector<HTMLElement>(`[data-setting="fillEntry"] [data-value="${value}"]`)!.click();
  };

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    document.body.innerHTML = '';
  });

  it('异步读到站点规则后点亮，规则被删（传 null）后收回', () => {
    const { note, instance } = bind(makeConfig());

    instance.setSiteFillOverride('manual');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('仅手动');

    instance.setSiteFillOverride(null);
    expect(note.hidden).toBe(true);
  });

  it('脏档位值按「无覆盖」处理，不把 storage 里的字符串画进面板', () => {
    const { note, instance } = bind(makeConfig());

    instance.setSiteFillOverride('sidepanel-auto' as never);
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('全局档位改到与覆盖同档时提示自动收回（面板显示与提示不得互相打脸）', () => {
    const { root, note, instance } = bind(makeConfig());
    instance.setSiteFillOverride('manual');
    expect(note.hidden).toBe(false);

    clickSegment(root, 'manual');
    expect(note.hidden).toBe(true);
  });

  it('全局档位换到第三档时提示仍在，且说的还是那个覆盖档位', () => {
    const { root, note, instance } = bind(makeConfig());
    instance.setSiteFillOverride('manual');
    expect(note.textContent).toContain('仅手动');

    clickSegment(root, 'inline');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('仅手动');
  });

  it('updateConfig（storage 监听回灌全局配置）同样重算提示', () => {
    const { note, instance } = bind(makeConfig());
    instance.setSiteFillOverride('manual');

    instance.updateConfig(makeConfig({ fillMode: 'sidepanel', autoShowSidepanel: false }));
    expect(note.hidden).toBe(true);
  });

  it('切换面板语言时提示文案跟着换语言，不残留旧语言句子', () => {
    const { note, instance } = bind(makeConfig());
    instance.setSiteFillOverride('manual');

    instance.setLocale('en');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('Manual');
    expect(note.textContent).not.toContain('仅手动');
  });
});
