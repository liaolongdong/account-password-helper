/** @vitest-environment jsdom */

/**
 * 内联下拉「秒开」与快捷键收起语义的内容端回归
 *
 * 背景（2026-11-20）：
 * 1. 快捷键 / 图标点击原先要等 GET_MATCHING_ACCOUNTS 回包（SW 往返 + 缓存解密 + 排序 + 站点图标）
 *    才把面板挂上可见态，用户按下快捷键后先看到"没反应"。修复为首帧骨架：面板先可见，
 *    数据回来再覆盖为真实列表。这里锁定的正是"可见先于数据"这一时序契约。
 * 2. 快捷键第二次按下应收起已打开的面板（closePanelIfOpen），且不改变 Esc 的既有终态。
 *
 * 面板宿主是 closed Shadow DOM（刻意不暴露给宿主页面），经 `attachShadow` 桩取回 root 查询；
 * jsdom 无布局，`getBoundingClientRect` 桩成视口内非零 rect，否则 `positionPanel` 会按
 * 「锚点滚出视口」关闭面板。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import type { MatchingAccountMeta } from '@/utils/types';

const healthy = (): MatchingAccountMeta => ({
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

describe('InlineFillDropdown 首帧骨架与收起语义', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let resolveMessage: ((value: unknown) => void) | null;

  const panel = (): HTMLElement | null => root?.querySelector<HTMLElement>('.aph-panel') ?? null;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = null;
    resolveMessage = null;

    const originalAttachShadow = Element.prototype.attachShadow;
    attachShadowSpy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      const created = originalAttachShadow.call(this, init);
      root = created;
      return created;
    });

    vi.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 100,
      left: 10,
      top: 100,
      right: 210,
      bottom: 120,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    } as DOMRect);

    // 挂起的响应：用来观察「数据回来之前」的面板状态
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((() => {
      return new Promise(resolve => {
        resolveMessage = resolve;
      });
    }) as never);

    input = document.createElement('input');
    document.body.appendChild(input);
    dropdown = new InlineFillDropdown();
  });

  afterEach(() => {
    dropdown.destroy();
    attachShadowSpy.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('取数未回包时面板已可见并展示骨架，数据回来后再渲染列表', async () => {
    const opening = dropdown.openPanelFor(input);

    // 数据尚未返回：面板必须已经可见，且展示加载骨架而非空白/旧行
    expect(panel()?.classList.contains('visible')).toBe(true);
    expect(root!.querySelector('.aph-loading')).not.toBeNull();
    expect(root!.querySelectorAll('.aph-row')).toHaveLength(0);

    resolveMessage?.({ success: true, data: { locked: false, accounts: [healthy()] } });
    await expect(opening).resolves.toBe('opened');

    expect(root!.querySelector('.aph-loading')).toBeNull();
    expect(root!.querySelectorAll('.aph-row')).toHaveLength(1);
  });

  it('取数失败时骨架一并收起，不会留下可见的空面板', async () => {
    const opening = dropdown.openPanelFor(input);
    expect(panel()?.classList.contains('visible')).toBe(true);

    resolveMessage?.({ success: false });

    await expect(opening).resolves.toBe('failed');
    expect(panel()?.classList.contains('visible')).toBe(false);
  });

  it('取数期间被用户收起时报告 dismissed，慢回包不得把面板重新点亮', async () => {
    const opening = dropdown.openPanelFor(input);
    expect(panel()?.classList.contains('visible')).toBe(true);

    // 用户在骨架阶段按下快捷键收起（Esc / 外部点击等价）
    expect(dropdown.closePanelIfOpen()).toBe(true);
    expect(panel()?.classList.contains('visible')).toBe(false);

    // 迟到的取数结果不能把用户刚关掉的面板重新打开
    resolveMessage?.({ success: true, data: { locked: false, accounts: [healthy()] } });
    await expect(opening).resolves.toBe('dismissed');
    expect(panel()?.classList.contains('visible')).toBe(false);
    expect(root!.querySelectorAll('.aph-row')).toHaveLength(0);
  });

  it('closePanelIfOpen 只在面板打开时收起一次（快捷键再按一次的语义）', async () => {
    const opening = dropdown.openPanelFor(input);
    resolveMessage?.({ success: true, data: { locked: false, accounts: [healthy()] } });
    await expect(opening).resolves.toBe('opened');

    expect(dropdown.closePanelIfOpen()).toBe(true);
    expect(panel()?.classList.contains('visible')).toBe(false);
    // 已收起后再调用不再产生副作用
    expect(dropdown.closePanelIfOpen()).toBe(false);
  });
});
