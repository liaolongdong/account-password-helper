/** @vitest-environment jsdom */

/**
 * role="checkbox" 模拟复选框的自动勾选回归测试（CheckboxHandler）
 *
 * 背景：豆包等现代组件库（Radix/shadcn 形态）的登录弹窗协议勾选不是原生 input，
 * 而是 `<button role="checkbox" aria-checked="false">`——页内没有任何
 * input[type=checkbox]，旧检测与勾选链路完全够不到它，填充后协议不会自动勾选。
 * 且手机号+验证码登录页既无密码框也无账号框（手机号被归类为 mobile 字段），
 * 旧参照链（password → username）在此类页面直接早退。
 *
 * 修复后：勾选态经 aria-checked 判定（true/mixed 均视为已勾选、不再点击），
 * 勾选动作只发一次真实程序化点击（受控组件自行翻转 aria-checked；盲发第二次
 * 点击会把已勾上的翻回去，故失败只告警不重试），参照链补 mobile 兜底。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckboxHandler } from '@/entrypoints/content/CheckboxHandler';

describe('CheckboxHandler 对 role="checkbox" 模拟复选框的勾选', () => {
  let handler: CheckboxHandler;

  /**
   * 构造受控形态的模拟复选框：页面 JS 响应真实点击翻转 aria-checked（Radix 行为的最小模拟）
   * @param checked 初始 aria-checked 值
   */
  const makeAriaCheckbox = (checked = 'false'): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'checkbox');
    btn.setAttribute('aria-checked', checked);
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-checked', btn.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });
    document.body.appendChild(btn);
    return btn;
  };

  /** 统计程序化点击次数的非响应型模拟复选框（页面未挂监听，点击不改变 aria-checked） */
  const makeInertAriaCheckbox = (): { el: HTMLButtonElement; clicks: () => number } => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'checkbox');
    btn.setAttribute('aria-checked', 'false');
    let count = 0;
    btn.addEventListener('click', () => {
      count++;
    });
    document.body.appendChild(btn);
    return { el: btn, clicks: () => count };
  };

  const makePasswordField = (): HTMLInputElement => {
    const pwd = document.createElement('input');
    pwd.type = 'password';
    document.body.appendChild(pwd);
    return pwd;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    // checkAriaCheckbox 的 150ms 复检走假定时器，测试只断言同步 click 与定时器耗尽后的状态
    vi.useFakeTimers();
    handler = new CheckboxHandler();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('未勾选的模拟复选框经一次程序化点击完成勾选（受控逻辑响应 click）', () => {
    const btn = makeAriaCheckbox();
    handler.autoCheckNearestCheckbox([btn], [makePasswordField()], []);
    vi.runAllTimers();
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('aria-checked=true 已勾选时不再点击（避免把勾选态又翻回未勾选）', () => {
    const { el, clicks } = makeInertAriaCheckbox();
    el.setAttribute('aria-checked', 'true');
    handler.autoCheckNearestCheckbox([el], [makePasswordField()], []);
    vi.runAllTimers();
    expect(clicks()).toBe(0);
  });

  it('aria-checked=mixed 不确定态不点击（单击会翻到对侧而非期望的勾选）', () => {
    const { el, clicks } = makeInertAriaCheckbox();
    el.setAttribute('aria-checked', 'mixed');
    handler.autoCheckNearestCheckbox([el], [makePasswordField()], []);
    vi.runAllTimers();
    expect(clicks()).toBe(0);
  });

  it('页面未响应程序化点击时只发一次点击、不盲目重试', () => {
    const { el, clicks } = makeInertAriaCheckbox();
    handler.autoCheckNearestCheckbox([el], [makePasswordField()], []);
    vi.runAllTimers();
    expect(clicks()).toBe(1);
    expect(el.getAttribute('aria-checked')).toBe('false');
  });

  it('页面回写落地前的连续两次调用只点一次（避免双点击把刚勾上的状态翻回未勾选）', () => {
    // 用非响应型载体模拟「点击后 aria-checked 仍未翻转」的回写窗口：
    // 若没有 pending 去重，第二次调用会读到陈旧 false 并再点一次
    const { el, clicks } = makeInertAriaCheckbox();
    const pwd = makePasswordField();
    handler.autoCheckNearestCheckbox([el], [pwd], []);
    // 假定时器未走、复检尚未落地：第二次调用不得再点
    handler.autoCheckNearestCheckbox([el], [pwd], []);
    vi.runAllTimers();
    expect(clicks()).toBe(1);
  });

  it('已脱离文档的陈旧节点不点击（SPA 重渲染后空操作与误报都不发生）', () => {
    const { el, clicks } = makeInertAriaCheckbox();
    el.remove();
    handler.autoCheckNearestCheckbox([el], [makePasswordField()], []);
    vi.runAllTimers();
    expect(clicks()).toBe(0);
  });

  it('手机号+验证码登录页：账号密码字段均缺失时以手机号字段为参照兜底勾选', () => {
    const btn = makeAriaCheckbox();
    const mobile = document.createElement('input');
    mobile.type = 'tel';
    document.body.appendChild(mobile);
    handler.autoCheckNearestCheckbox([btn], [], [], [mobile]);
    vi.runAllTimers();
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('未传 mobileFields 时旧参照链行为不变：无密码无账号字段仍不勾选', () => {
    const { el, clicks } = makeInertAriaCheckbox();
    handler.autoCheckNearestCheckbox([el], [], []);
    vi.runAllTimers();
    expect(clicks()).toBe(0);
  });

  it('原生 input 复选框既有行为保持：未勾选走同步 click 勾选', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);
    handler.autoCheckNearestCheckbox([cb], [makePasswordField()], []);
    expect(cb.checked).toBe(true);
  });
});
