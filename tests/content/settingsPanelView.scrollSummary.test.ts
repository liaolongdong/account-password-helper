/** @vitest-environment jsdom */

/**
 * 偏好设置面板底栏滚动摘要与底缘淡出的回归测试
 *
 * 面板九行高度各不相同，折叠线几乎必然压在文字中间；而 macOS 默认设置下滚动条不占位、
 * 只在滚动时浮现，「下面还有」这个信号平时根本不存在。收法是两条一起上：
 * 底栏把「卡片被切坏」改读成「滚动区到此为止」并说破下方还有几项，底缘 mask 把「半行字」
 * 改读成「还能滚」，且滚到底必须自动摘掉——否则等于在另一端复刻同一个 bug。
 *
 * 判据分四层：
 * 1. 结构：底栏是面板的最后一个子节点、排在滚动区之外（进 `.settings-content` 就会被一起淡掉），
 *    且是 `aria-hidden` 的纯视觉装饰——它随滚动逐字变化，挂 live 区域会念到用户烦；
 * 2. 读数：`rest` 取「底边仍在折叠线以下的行数」，不是滚动百分比；到底收口成「已全部显示」；
 * 3. 不滚：内容本就装得下时底栏必须**清空**（CSS 的 `:empty` 让整条底栏消失），
 *    与「到底」是两种状态——前者不该有一条谎报的边界；
 * 4. 生命周期：换语言、换填充档位（说明文案长度变 → 内容高度变）、外部回灌、`refresh()`
 *    四条写路径都要重算；`destroy()` 之后滚动不再更新。
 *
 * 刻意不钉的：淡出与底栏的实际渲染高度（jsdom 不排版，样式层只断言规则字符串存在），
 * 以及 `rest` 的具体数字随视口宽度而变的绝对值——只钉「行数单调」这一条关系。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindSettingsPanelView,
  getSettingsPanelHTML,
  settingsPanelViewStyles,
} from '@/entrypoints/content/floatingButtons/settingsPanelView';
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

/** 九个 `.setting-item` 在内容坐标系里的底边（400px 宽、中文态的量级，只为造出单调序列） */
const ROW_BOTTOMS = [43, 103, 148, 249, 294, 339, 384, 429, 469];

/** jsdom 不排版：把滚动区尺寸与各行底边按给定数字桩出来 */
const stubLayout = (
  root: HTMLElement,
  { scrollHeight, clientHeight, fold }: { scrollHeight: number; clientHeight: number; fold: number },
) => {
  const content = root.querySelector<HTMLElement>('.settings-content')!;
  Object.defineProperty(content, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(content, 'clientHeight', { value: clientHeight, configurable: true });
  content.getBoundingClientRect = () => ({ bottom: fold }) as DOMRect;
  [...content.querySelectorAll<HTMLElement>('.setting-item')].forEach((row, i) => {
    row.getBoundingClientRect = () => ({ bottom: ROW_BOTTOMS[i] }) as DOMRect;
  });
};

/**
 * 挂面板并绑定
 *
 * 布局桩必须排在 `bindSettingsPanelView` 之前：绑定时那一次初算是产品行为的一部分
 * （侧边栏与管理页都在元素已经可见、已排版之后才绑定），先绑后桩会把这一次读成零尺寸。
 */
const mount = (
  config: FloatingButtonConfig = makeConfig(),
  locale: 'zh-CN' | 'en' = 'zh-CN',
  layout = { scrollHeight: 827, clientHeight: 504, fold: 320 },
) => {
  const root = document.createElement('div');
  root.className = 'settings-panel visible';
  root.innerHTML = getSettingsPanelHTML(config, locale);
  document.body.appendChild(root);
  stubLayout(root, layout);
  const instance = bindSettingsPanelView(root, null, config, { onConfigChange: vi.fn(), onClose: vi.fn() }, locale);
  const footer = root.querySelector<HTMLElement>('[data-role="scroll-summary"]')!;
  const content = root.querySelector<HTMLElement>('.settings-content')!;
  /** 挪动折叠线并滚一格：真实滚动会同时改变行底边与视口的相对位置，这里按内容坐标平移 */
  const scroll = (delta: number) => {
    stubLayout(root, {
      scrollHeight: 827,
      clientHeight: 504,
      fold: content.getBoundingClientRect().bottom + delta,
    });
    content.dispatchEvent(new Event('scroll'));
  };
  return { root, instance, footer, content, scroll };
};

const segmentOf = (root: HTMLElement, group: string, value: string) =>
  root.querySelector<HTMLElement>(`[data-setting="${group}"] [data-value="${value}"]`)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('偏好设置面板底栏结构', () => {
  it('底栏是面板最后一个节点、排在滚动区之外，且对读屏隐藏', () => {
    const root = document.createElement('div');
    root.className = 'settings-panel visible';
    root.innerHTML = getSettingsPanelHTML(makeConfig());
    document.body.appendChild(root);

    const children = [...root.children];
    const contentIndex = children.findIndex(el => el.classList.contains('settings-content'));

    expect(contentIndex).toBeGreaterThan(-1);
    expect(children[children.length - 1]).toBe(root.querySelector('[data-role="scroll-summary"]'));
    expect(root.querySelector('.settings-content [data-role="scroll-summary"]')).toBeNull();
    expect(root.querySelector('[data-role="scroll-summary"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('样式层备齐淡出、到底摘除、空底栏收起三条规则', () => {
    expect(settingsPanelViewStyles).toMatch(/\.settings-content\s*\{[^}]*mask-image:[^;]*linear-gradient/);
    expect(settingsPanelViewStyles).toMatch(
      /\.settings-panel\.is-at-bottom \.settings-content\s*\{[^}]*mask-image:\s*none/,
    );
    expect(settingsPanelViewStyles).toMatch(/\.settings-footer:empty\s*\{[^}]*display:\s*none/);
  });
});

describe('底栏滚动摘要', () => {
  it('绑定即读数：下方还有 4 项', () => {
    const { footer, root } = mount();

    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 4 项');
    expect(root.classList.contains('is-at-bottom')).toBe(false);
  });

  it('往下滚摘要逐项递减，且不会越过 0', () => {
    const { footer, scroll, root } = mount();

    const seen: number[] = [];
    [40, 45, 45, 45, 60, 60, 60, 60, 60].forEach(delta => {
      scroll(delta);
      const matched = /下方还有 (\d+) 项/.exec(footer.textContent ?? '');
      if (matched) seen.push(Number(matched[1]));
    });

    expect(seen).toEqual([3, 2, 1]);
    expect(footer.textContent).toBe('已全部显示');
    expect(root.classList.contains('is-at-bottom')).toBe(true);
  });

  it('从「还能滚」变成「装得下」时底栏清空，而不是谎报「已全部显示」', () => {
    const { root, footer, instance } = mount();
    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 4 项');

    stubLayout(root, { scrollHeight: 504, clientHeight: 504, fold: 504 });
    instance.refresh();

    expect(footer.textContent).toBe('');
    expect(root.classList.contains('is-at-bottom')).toBe(true);
  });

  it('英文态走英文模板', () => {
    const { footer } = mount(makeConfig(), 'en');

    expect(footer.textContent).toBe('9 settings · 4 below');
  });

  it('换语言后摘要跟着换语言（否则底栏会一直念着旧语言）', () => {
    const { footer, instance } = mount();

    instance.setLocale('en');

    expect(footer.textContent).toBe('9 settings · 4 below');
  });

  it('换填充档位会改说明文案长度，摘要必须重算而不是留在旧数', () => {
    const { root, footer, content } = mount();
    // 档位点击在 jsdom 里不改布局，所以先把折叠线挪到「还有 2 项」并滚一格坐实初值，
    // 再只改折叠线、不发滚动事件去点档位：摘要若跟着变成「还有 4 项」，说明点击路径重算过
    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 384 });
    content.dispatchEvent(new Event('scroll'));
    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 2 项');

    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 294 });
    segmentOf(root, 'fillEntry', 'inline').click();
    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 4 项');
  });

  it('外部回灌配置与站点覆盖提示都各重算一次', () => {
    const { root, footer, instance } = mount();

    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 429 });
    instance.updateConfig(makeConfig({ fillMode: 'inline' }));
    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 1 项');

    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 200 });
    instance.setSiteFillOverride('inline');
    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 6 项');
  });

  it('refresh() 供悬浮按钮在 show() 时补算（构造期零尺寸只能读出「不用滚」）', () => {
    const { root, footer, instance } = mount(makeConfig(), 'zh-CN', { scrollHeight: 0, clientHeight: 0, fold: 0 });
    expect(footer.textContent).toBe('');

    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 320 });
    instance.refresh();

    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 4 项');
  });

  it('视口改尺寸（把侧边栏拖宽拖高）后摘要重算，不必等到下一次滚动', () => {
    const { root, footer } = mount();
    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 4 项');

    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 429 });
    window.dispatchEvent(new Event('resize'));

    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 1 项');
  });

  it('destroy() 之后滚动与改尺寸都不再更新（监听器必须跟着面板一起摘掉）', () => {
    const { root, footer, scroll, instance } = mount();

    instance.destroy();
    scroll(40);
    stubLayout(root, { scrollHeight: 827, clientHeight: 504, fold: 429 });
    window.dispatchEvent(new Event('resize'));

    expect(footer.textContent).toBe('共 9 项设置 · 下方还有 4 项');
  });
});
