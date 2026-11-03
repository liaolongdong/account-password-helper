/** @vitest-environment jsdom */
/**
 * 悬浮按钮按压反馈（M-4b）
 *
 * 旧实现用「内联 `transform: scale(0.95)` + 100ms 后清空」模拟按压，但 `.btn` 的过渡是
 * 0.25s，100ms 时缩放才走到一半就被撤掉，读起来像一次抖动；内联样式还会盖住
 * `.btn:hover` 的放大。现在只负责加类，播放与复位都交给 `btn-press` 关键帧。
 *
 * 钉的是机制而不是结果截图：同名类连续 add 不会重播动画，重播靠的是
 * 「摘类 → 读一次布局属性强制重排 → 再挂回」这三步的**顺序**，
 * 而减弱动效档下这三步一步都不该发生（媒体查询已把动画设为 none，摘挂只是白读一次布局）。
 * 顺序信息在同一任务内完成，MutationObserver 只能看到任务结束后的终态，故这里记录操作序列。
 * 鼠标按压由 CSS `:active` 承担，`buttonClickFeedback` 只服务键盘激活。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationController } from '@/entrypoints/content/floatingButtons/AnimationController';
import { floatingButtonStyles } from '@/entrypoints/content/floatingButtons/styles';

/** 一次按压期望的操作序列 */
const PRESS_SEQUENCE = ['remove', 'layout', 'add'] as const;

/** `@media (prefers-reduced-motion: reduce)` 之后的那一段样式 */
const reduceBlockOf = (styles: string): string => {
  const start = styles.indexOf('@media (prefers-reduced-motion: reduce)');
  return start === -1 ? '' : styles.slice(start);
};

describe('悬浮按钮按压反馈', () => {
  let button: HTMLButtonElement;
  let controller: AnimationController;
  /** 按压反馈留下的操作轨迹：`remove` / `layout`（强制重排）/ `add` */
  let ops: string[];

  beforeEach(() => {
    document.body.innerHTML =
      '<div class="container"><div class="button-group"><button class="btn"></button></div></div>';
    button = document.querySelector<HTMLButtonElement>('.btn')!;
    controller = new AnimationController(
      document.querySelector('.button-group') as HTMLElement,
      document.querySelector('.container') as HTMLElement,
    );

    ops = [];
    // offsetWidth 恒为 0 且定义在原型上，改成实例上的计数 getter 才能把「重排」记进轨迹
    Object.defineProperty(button, 'offsetWidth', {
      configurable: true,
      get: () => {
        ops.push('layout');
        return 0;
      },
    });
    // jsdom 每个元素缓存同一个 DOMTokenList 实例，包在其上的方法就是被测代码实际调用的那个
    const classList = button.classList;
    for (const name of ['add', 'remove'] as const) {
      const original = classList[name].bind(classList);
      Object.defineProperty(classList, name, {
        configurable: true,
        writable: true,
        value: (token: string) => {
          ops.push(name);
          return original(token);
        },
      });
    }
  });

  afterEach(() => {
    controller.destroy();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
    document.body.innerHTML = '';
  });

  it('激活时按「摘类 → 重排 → 挂回」播放，且没有计时器把类提前摘掉', () => {
    controller.buttonClickFeedback(button);

    expect(ops).toEqual([...PRESS_SEQUENCE]);
    expect(button.classList.contains('click-feedback')).toBe(true);

    // 复位由关键帧自己完成（动画结束后元素回到当前状态）：类留在身上没有视觉后果。
    // 实现若退回旧版「定时器摘类 / 清内联样式」，这里会多出一次 remove
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    expect(ops).toEqual([...PRESS_SEQUENCE]);
    expect(button.classList.contains('click-feedback')).toBe(true);
  });

  it('连续激活每次都重排一次，第二次按压才真的重播', () => {
    controller.buttonClickFeedback(button);
    controller.buttonClickFeedback(button);

    expect(ops).toEqual([...PRESS_SEQUENCE, ...PRESS_SEQUENCE]);
  });

  it('减弱动效档不挂类，也一次布局都不读', () => {
    // 直接赋值而非 vi.spyOn：本仓 jsdom 环境里 window.matchMedia 不存在
    const queries: string[] = [];
    window.matchMedia = ((query: string) => {
      queries.push(query);
      return { matches: true, media: query };
    }) as unknown as typeof window.matchMedia;

    controller.buttonClickFeedback(button);

    expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
    expect(ops).toEqual([]);
    expect(button.classList.contains('click-feedback')).toBe(false);
  });

  it('样式侧备好 btn-press 关键帧与减弱档兜底', () => {
    expect(floatingButtonStyles).toMatch(/\.btn\.click-feedback\s*\{\s*animation:\s*btn-press\s+0\.18s/);
    // 关键帧内部是嵌套块，用非贪婪跨行匹配到那一次缩放
    expect(floatingButtonStyles).toMatch(/@keyframes\s+btn-press\s*\{[\s\S]*?40%\s*\{\s*transform:\s*scale\(0\.95\)/);
    expect(floatingButtonStyles).toMatch(/@keyframes\s+btn-press\s*\{[\s\S]*?100%\s*\{\s*transform:\s*scale\(1\)/);
    expect(reduceBlockOf(floatingButtonStyles)).toMatch(/\.btn\.click-feedback\s*\{\s*animation:\s*none/);
  });
});
