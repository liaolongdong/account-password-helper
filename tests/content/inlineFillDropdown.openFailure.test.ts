/** @vitest-environment jsdom */

/**
 * 内联面板取数失败后的图标回滚回归测试
 *
 * 回归背景：`openPanel` 一进入就 `hideIcon()`（解绑 blur 监听、移除 visible），
 * 随后 `GET_MATCHING_ACCOUNTS` 的三条失败早退路径（sendMessage 抛错、应答为空、
 * `success:false`）只把 `panelOpen` 置回 false 就 return，图标不回滚。
 * 用户视角就是「点了钥匙图标，图标闪一下就没了，面板没出现，再点也没反应」——
 * 必须失焦登录框再获焦才能重新唤起，而取数失败（会话失效、SW 冷启动、缓存未命中）
 * 恰是这条路径最常见的触发场景。
 *
 * 修复后失败早退按 `showTriggerFor` 的展示序列回滚图标，且只在结果仍归属本次请求时收尾——
 * 旧请求的失败不得改写 `panelOpen`，否则会把同期在途的新请求一起判死。
 *
 * 面板宿主是 closed Shadow DOM（刻意不暴露给宿主页面），故经 `attachShadow` 桩取回 root 做查询；
 * jsdom 无布局，`getBoundingClientRect` 桩成视口内的非零 rect，否则定位逻辑会按「锚点滚出视口」隐藏 UI。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import type { MatchingAccountMeta } from '@/utils/types';

/** 视口内的输入框矩形桩 */
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

/** 滚出视口的输入框矩形桩 */
const offViewport = (): DOMRect =>
  ({
    x: 10,
    y: 9999,
    left: 10,
    top: 9999,
    right: 210,
    bottom: 10019,
    width: 200,
    height: 20,
    toJSON: () => ({}),
  }) as DOMRect;

const account = (): MatchingAccountMeta => ({
  id: 'ok-1',
  title: 'alice',
  username: 'alice',
  tag: '工作',
  remark: '',
  url: 'example.com',
  favorite: false,
  hasTotp: false,
  favicon: '',
});

/** 可控结算的 sendMessage 应答 */
const deferred = (): { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('InlineFillDropdown 取数失败后回滚触发图标', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  const trigger = (): HTMLElement | null => root?.querySelector('.aph-trigger') ?? null;
  const iconShown = (): boolean => !!trigger()?.classList.contains('visible');
  const panelShown = (): boolean => !!root?.querySelector('.aph-panel')?.classList.contains('visible');

  /** 等 openPanel 的 await 链跑完（sendMessage 的微任务 + 后续同步渲染） */
  const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  /** 走真实用户路径：获焦展示图标 → 点击图标展开面板 */
  const clickTrigger = async (): Promise<void> => {
    trigger()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    root = null;

    const originalAttachShadow = Element.prototype.attachShadow;
    attachShadowSpy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      const created = originalAttachShadow.call(this, init);
      root = created;
      return created;
    });

    rectSpy = vi.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockImplementation(inViewport);

    input = document.createElement('input');
    document.body.appendChild(input);
    dropdown = new InlineFillDropdown();
    dropdown.showTriggerFor(input);
  });

  afterEach(() => {
    dropdown.destroy();
    attachShadowSpy.mockRestore();
    rectSpy.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('sendMessage 抛错：面板未出现，但图标回到可见态', async () => {
    const sendMessage = vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(new Error('context invalidated'));
    expect(iconShown()).toBe(true);

    await clickTrigger();

    expect(panelShown()).toBe(false);
    expect(iconShown()).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('应答 success:false：同样回滚图标', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({ success: false } as never);

    await clickTrigger();

    expect(panelShown()).toBe(false);
    expect(iconShown()).toBe(true);
  });

  it('应答为空（消息通道被断开）：同样回滚图标', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    await clickTrigger();

    expect(panelShown()).toBe(false);
    expect(iconShown()).toBe(true);
  });

  it('回滚后再次点击图标可以重新发起取数', async () => {
    const sendMessage = vi
      .spyOn(chrome.runtime, 'sendMessage')
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ success: true, data: { locked: false, accounts: [account()] } } as never);

    await clickTrigger();
    expect(panelShown()).toBe(false);

    await clickTrigger();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(panelShown()).toBe(true);
    expect(iconShown()).toBe(false);
  });

  it('失败期间输入框已滚出视口时不强显图标', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(new Error('context invalidated'));

    rectSpy.mockImplementation(offViewport);
    await clickTrigger();

    expect(iconShown()).toBe(false);
  });

  it('快捷键/引导路径（本就没有图标）失败时不会凭空造出图标', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(new Error('context invalidated'));
    dropdown.hide();
    expect(iconShown()).toBe(false);

    expect(await dropdown.openPanelFor(input)).toBe(false);

    expect(panelShown()).toBe(false);
    expect(iconShown()).toBe(false);
  });

  it('被新请求取代的旧请求失败，既不回滚图标也不关掉新请求的面板', async () => {
    const first = deferred();
    const second = deferred();
    vi.spyOn(chrome.runtime, 'sendMessage')
      .mockImplementationOnce(() => first.promise as never)
      .mockImplementationOnce(() => second.promise as never);

    const secondInput = document.createElement('input');
    document.body.appendChild(secondInput);

    trigger()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    // 旧请求仍挂起时切到第二个输入框：seq 递增，终态由新请求决定
    void dropdown.openPanelFor(secondInput);
    await flush();

    first.reject(new Error('旧请求失败'));
    await flush();

    expect(iconShown()).toBe(false);
    second.resolve({ success: true, data: { locked: false, accounts: [account()] } });
    await flush();
    expect(panelShown()).toBe(true);
  });
});
