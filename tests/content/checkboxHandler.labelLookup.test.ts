/** @vitest-environment jsdom */

/**
 * 「记住我」复选框关联 label 的查找回归测试（CheckboxHandler）
 *
 * 回归背景：`getCheckboxLabel` / `findCheckboxLabel` 用裸插值拼选择器
 * `label[for="${checkbox.id}"]`。id 来自宿主页面、属不可信输入，含双引号时该选择器
 * 本身就是非法的，`document.querySelector` 直接抛 DOMException——它沿
 * `calculateCheckboxScore → findBestCheckbox → autoCheckNearestCheckbox` 冒到调用方
 * （检测路径上层吞异常），表现为「记住我」判定莫名失效且无任何提示。
 *
 * 修复后统一走 `CSS.escape`，因此断言的是可观察结果：带引号 id 的复选框仍能通过
 * `for` 关联到 label 文本、命中「记住」关键词而被勾选，且不会被同批次的无 label
 * 复选框抢走（打分只允许选中一个目标）。普通 id 的既有行为保持不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckboxHandler } from '@/entrypoints/content/CheckboxHandler';

describe('CheckboxHandler 按 for 查找关联 label', () => {
  let handler: CheckboxHandler;

  /** 造一个复选框（id 走属性赋值，避免 HTML 解析层就要处理引号转义） */
  const makeCheckbox = (id: string): HTMLInputElement => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    document.body.appendChild(cb);
    return cb;
  };

  const makeLabel = (forId: string, text: string): HTMLElement => {
    const label = document.createElement('label');
    label.htmlFor = forId;
    label.textContent = text;
    document.body.appendChild(label);
    return label;
  };

  const makePasswordField = (): HTMLInputElement => {
    const pwd = document.createElement('input');
    pwd.type = 'password';
    document.body.appendChild(pwd);
    return pwd;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    // checkCheckbox 的兜底链路全是 setTimeout，测试只断言同步 click 的结果
    vi.useFakeTimers();
    handler = new CheckboxHandler();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('id 含双引号时仍能经 for 关联 label 并命中关键词', () => {
    const nasty = makeCheckbox('remember"me');
    makeLabel('remember"me', '记住我');
    const plain = makeCheckbox('agree');

    handler.autoCheckNearestCheckbox([nasty, plain], [makePasswordField()], []);

    expect(nasty.checked).toBe(true);
    expect(plain.checked).toBe(false);
  });

  it('普通 id 的既有查找行为不变', () => {
    const cb = makeCheckbox('remember');
    makeLabel('remember', '记住我');

    handler.autoCheckNearestCheckbox([cb], [makePasswordField()], []);

    expect(cb.checked).toBe(true);
  });

  it('id 含双引号且无关联 label 时不抛错，退回到其他文本来源继续判定', () => {
    const cb = makeCheckbox('login"box');
    // 无 for 关联：包一层 label 作为兜底文本来源
    const wrapper = document.createElement('label');
    wrapper.textContent = '记住我';
    document.body.appendChild(wrapper);
    wrapper.appendChild(cb);

    expect(() => handler.autoCheckNearestCheckbox([cb], [makePasswordField()], [])).not.toThrow();
    expect(cb.checked).toBe(true);
  });
});
