/** @vitest-environment jsdom */

/**
 * 内联填充 UI 的宿主级事件隔离回归测试
 *
 * 回归背景：豆包手机号登录弹窗的「点击外部关闭」检测挂在 document 上的
 * pointerdown/mousedown 监听（现代组件库为即时响应普遍不用 click 判定）。
 * 触发图标与面板的宿主挂在 body 下、位于弹窗 DOM 子树之外，内部事件以宿主为
 * retarget 目标逃逸到 document 后即被判为「外部交互」——点击钥匙图标登录弹窗
 * 连带关闭。旧防线只有元素级 click stopPropagation（mousedown 仅 preventDefault，
 * 不停传播），覆盖不到这些更早的按下型事件。
 *
 * 修复后宿主在冒泡阶段统一终结注入子树的事件传播。断言口径：
 * 1. 图标/面板内的按下与点击型事件均不出现在 document 冒泡监听上；
 * 2. 注入 UI 自身的内部处理器不受宿主拦截影响（点击图标仍能展开面板）；
 * 3. 本扩展的「外部按下关闭面板」走 document 捕获阶段，先于宿主冒泡，保持有效。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import type { MatchingAccountMeta } from '@/utils/types';

/** 视口内的输入框矩形桩（jsdom 无布局，桩成可见 rect 避免按「锚点滚出视口」隐藏 UI） */
const inViewport = (): DOMRect =>
  ({
    x: 10,
    y: 100,
    left: 10,
    top: 100,
    right: 210,
    bottom: 120,
    width: 200,
    height: 20,
    toJSON: () => ({}),
  }) as DOMRect;

const account = (): MatchingAccountMeta => ({
  id: 'ok-1',
  username: 'alice',
  tag: '工作',
  remark: '',
  url: 'example.com',
  favorite: false,
  hasTotp: false,
  favicon: '',
  tier: 0,
});

/** 弹窗外部点击检测常用的事件类型（与 eventIsolation 拦截集一致） */
const DOC_MONITORED_TYPES = [
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
];

describe('InlineFillDropdown 宿主级事件隔离', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  /** 逃逸到 document 冒泡监听的事件类型名（隔离生效时应恒为空） */
  let leaked: string[];

  const trigger = (): HTMLElement | null => root?.querySelector('.aph-trigger') ?? null;
  const panelShown = (): boolean => !!root?.querySelector('.aph-panel')?.classList.contains('visible');

  /** 等 openPanel 的 await 链跑完（sendMessage 的微任务 + 后续同步渲染） */
  const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  /**
   * 以真实用户交互的传播形态派发事件：composed: true 才允许跨出 Shadow 边界
   * @param el 派发目标（注入 UI 内部节点或页面节点）
   * @param type 事件类型
   */
  const fire = (el: Element, type: string): void => {
    el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  };

  /** 在 document 冒泡阶段挂监听，记录任何逃逸到页面根的注入 UI 事件 */
  const recordLeaks = (): void => {
    for (const type of DOC_MONITORED_TYPES) {
      document.addEventListener(type, () => leaked.push(type));
    }
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    root = null;
    leaked = [];

    // 先取回原生实现再打桩，避免 mock 内部调用到被替换后的方法形成递归
    const originalAttachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
      const created = originalAttachShadow.call(this, init);
      root = created;
      return created;
    });

    vi.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockImplementation(inViewport);

    input = document.createElement('input');
    document.body.appendChild(input);

    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
      success: true,
      data: { locked: false, accounts: [account()] },
    } as never);

    recordLeaks();

    dropdown = new InlineFillDropdown();
    dropdown.showTriggerFor(input);
  });

  afterEach(() => {
    dropdown.destroy();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('图标上的按下/点击全序列事件不逃逸到 document（弹窗外部检测不再被触发）', async () => {
    const icon = trigger();
    expect(icon).toBeTruthy();

    for (const type of DOC_MONITORED_TYPES) {
      fire(icon!, type);
    }
    await flush();

    expect(leaked).toEqual([]);
  });

  it('宿主隔离不影响内部处理器：点击图标仍正常展开面板', async () => {
    fire(trigger()!, 'click');
    await flush();

    expect(panelShown()).toBe(true);
    expect(leaked).not.toContain('click');
  });

  it('面板内部（搜索框/列表行）的事件不逃逸到 document，面板保持打开', async () => {
    fire(trigger()!, 'click');
    await flush();
    expect(panelShown()).toBe(true);

    const searchInput = root?.querySelector('.aph-search input');
    const row = root?.querySelector('.aph-row');
    expect(searchInput).toBeTruthy();
    expect(row).toBeTruthy();

    for (const type of DOC_MONITORED_TYPES) {
      fire(searchInput!, type);
      // 行上的 click 是「选中账号→填充→收起面板」的预期流程，不参与传播断言；
      // 其余按下/抬起型事件与面板保持打开的断言口径才对齐
      if (type !== 'click') {
        fire(row!, type);
      }
    }
    await flush();

    expect(leaked).toEqual([]);
    expect(panelShown()).toBe(true);
  });

  it('真实外部按下仍关闭面板：本扩展的外部检测挂在 document 捕获阶段，不受宿主冒泡拦截影响', async () => {
    fire(trigger()!, 'click');
    await flush();
    expect(panelShown()).toBe(true);

    // 页面空白处按下：document 捕获监听先于宿主冒泡终结执行，面板正常收起
    fire(document.body, 'mousedown');
    await flush();

    expect(panelShown()).toBe(false);
  });
});
