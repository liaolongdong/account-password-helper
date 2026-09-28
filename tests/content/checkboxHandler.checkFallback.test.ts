/** @vitest-environment jsdom */

/**
 * 「记住我」复选框兜底勾选链路的回归测试（CheckboxHandler.checkCheckbox）
 *
 * 回归背景：兜底分支先 `checkbox.checked = true` 强制置位，再派发一组「通知站点」的事件，
 * 其中包含合成 `MouseEvent('click')`。click 的默认动作本身就是翻转 checked，
 * 于是浏览器在站点监听器读到 true 之后立刻把它翻回 false——兜底恰好取消了上一步的强制勾选。
 * 触发条件是真实存在的一类站点：受控组件（React/Vue）或自定义样式复选框，
 * 第一层 `checkbox.click()` 后 `checked` 仍为 false，必然进入兜底分支。
 *
 * 修复后兜底只补派发 change/input/focus/blur，不再派发 click：
 * 断言「强制置位后仍为勾选」且「除第一次真实点击外不再产生 click 事件」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckboxHandler } from '@/entrypoints/content/CheckboxHandler';

describe('CheckboxHandler 兜底勾选不再被合成 click 翻转', () => {
  let handler: CheckboxHandler;

  /** 造一个复选框（只给 name 不给 id，避免命中 label 关联分支） */
  const makeCheckbox = (): HTMLInputElement => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'remember';
    document.body.appendChild(cb);
    return cb;
  };

  const makePasswordField = (): HTMLInputElement => {
    const pwd = document.createElement('input');
    pwd.type = 'password';
    document.body.appendChild(pwd);
    return pwd;
  };

  /**
   * 让第一层 `checkbox.click()` 成为空操作，模拟「站点接管点击、checked 不由浏览器置位」，
   * 从而稳定进入兜底分支（own property 覆盖掉原型上的分发 + 默认动作）。
   */
  const stubClick = (cb: HTMLInputElement): void => {
    cb.click = (): void => undefined;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    handler = new CheckboxHandler();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('兜底强制置位后 checked 保持 true，且不补发 click', () => {
    const cb = makeCheckbox();
    stubClick(cb);
    let clickCount = 0;
    cb.addEventListener('click', () => {
      clickCount++;
    });

    handler.autoCheckNearestCheckbox([cb], [makePasswordField()], []);
    // 第一层 click 未置位 → 100ms 后进入 `checked = true` + 事件通知的兜底分支
    vi.advanceTimersByTime(100);

    expect(cb.checked).toBe(true);
    expect(clickCount).toBe(0);
  });

  it('走到最后的 simulateUserInteraction 时同样保留强制置位结果', () => {
    const cb = makeCheckbox();
    stubClick(cb);
    // 页面上没有任何 label 来源 → findCheckboxLabel 返回 null，兜底链路可直达最后一层。
    // 站点只在第一次 change 通知里回滚（模拟「先拒绝再接受」的受控实现），
    // 使 100ms 分支的置位失效、必然走到最后一层，从而真正覆盖 simulateUserInteraction。
    let changeCount = 0;
    cb.addEventListener('change', () => {
      if (++changeCount === 1) cb.checked = false;
    });

    handler.autoCheckNearestCheckbox([cb], [makePasswordField()], []);
    vi.advanceTimersByTime(100);
    expect(cb.checked).toBe(false); // 前置条件：确实落到了最后一层之前
    vi.advanceTimersByTime(100);

    expect(cb.checked).toBe(true);
  });
});
