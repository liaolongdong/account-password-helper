/** @vitest-environment jsdom */

/**
 * 站点规则选择器拾取器：选择器生成与覆盖层生命周期
 *
 * 这里只测纯 DOM 行为；跨标签页编排由 background handler 单测与真机 e2e 覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUniqueSelector,
  isSelectorUnique,
  startSelectorPick,
  stopSelectorPick,
} from '@/entrypoints/content/selectorPicker';
import { MessageType } from '@/utils/types';

describe('buildUniqueSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    stopSelectorPick();
    vi.restoreAllMocks();
  });

  it('优先使用唯一的 id', () => {
    document.body.innerHTML = '<form><input id="user"></form>';
    const input = document.getElementById('user')!;
    expect(buildUniqueSelector(input)).toBe('#user');
    expect(isSelectorUnique('#user', document)).toBe(true);
  });

  it('没有 id 时使用唯一的 name', () => {
    document.body.innerHTML = '<form><input name="username"><input type="password"></form>';
    const input = document.querySelector<HTMLInputElement>('input[name="username"]')!;
    expect(buildUniqueSelector(input)).toBe('input[name="username"]');
  });

  it('id / name 都不唯一时生成可唯一定位的路径', () => {
    document.body.innerHTML = `
      <form id="login">
        <div><input name="account"></div>
        <div><input name="account"></div>
      </form>
    `;
    const second = document.querySelectorAll<HTMLInputElement>('input[name="account"]')[1]!;
    const selector = buildUniqueSelector(second);
    expect(isSelectorUnique(selector, document)).toBe(true);
    expect(document.querySelector(selector)).toBe(second);
  });

  it('特殊字符 id 会被正确转义', () => {
    document.body.innerHTML = '<input id="a:b">';
    const input = document.getElementById('a:b')!;
    const selector = buildUniqueSelector(input);
    expect(document.querySelector(selector)).toBe(input);
  });

  it('shadow root 内的选择器相对该 root 生成，不污染主文档', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="shadow-user"><input type="password">';
    document.body.appendChild(host);
    const shadowInput = shadow.querySelector<HTMLInputElement>('#shadow-user')!;

    const selector = buildUniqueSelector(shadowInput, shadow);
    expect(selector).toBe('#shadow-user');
    expect(isSelectorUnique(selector, shadow)).toBe(true);
    expect(document.querySelector(selector)).toBeNull();
  });

  it('shadow root 内同 tag 无 id 时用 nth-of-type 在 root 内定位', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input><input>';
    document.body.appendChild(host);
    const second = shadow.querySelectorAll<HTMLInputElement>('input')[1]!;

    const selector = buildUniqueSelector(second, shadow);
    expect(isSelectorUnique(selector, shadow)).toBe(true);
    expect(shadow.querySelector(selector)).toBe(second);
  });
});

describe('拾取覆盖层生命周期', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    stopSelectorPick();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('启动后挂载一个封闭 Shadow DOM 宿主，停止后移除', () => {
    startSelectorPick({ domain: 'example.com', field: 'username', requestId: 'req-1' });
    const host = document.querySelector('[data-aph-selector-picker]');
    expect(host).not.toBeNull();
    expect(host?.getAttribute('role')).toBe('status');
    expect(host?.shadowRoot).toBeNull();

    stopSelectorPick();
    expect(document.querySelector('[data-aph-selector-picker]')).toBeNull();
  });

  it('重复启动不会叠加覆盖层', () => {
    startSelectorPick({ domain: 'example.com', field: 'username', requestId: 'req-1' });
    startSelectorPick({ domain: 'example.com', field: 'password', requestId: 'req-2' });
    expect(document.querySelectorAll('[data-aph-selector-picker]')).toHaveLength(1);
  });

  it('带 requestId 的取消只停止匹配实例，不误停新请求', () => {
    startSelectorPick({ domain: 'example.com', field: 'username', requestId: 'req-1' });
    stopSelectorPick('req-2');
    expect(document.querySelector('[data-aph-selector-picker]')).not.toBeNull();
    stopSelectorPick('req-1');
    expect(document.querySelector('[data-aph-selector-picker]')).toBeNull();
  });

  it('内容侧 TTL 到点自动收起覆盖层并回传取消', () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockResolvedValue({});
    (globalThis as any).chrome = { runtime: { sendMessage } };

    startSelectorPick({ domain: 'example.com', field: 'password', requestId: 'req-ttl' });
    expect(document.querySelector('[data-aph-selector-picker]')).not.toBeNull();

    vi.advanceTimersByTime(120_000);

    expect(document.querySelector('[data-aph-selector-picker]')).toBeNull();
    expect(sendMessage).toHaveBeenCalledWith({
      type: MessageType.SELECTOR_PICK_CANCELLED,
      data: { requestId: 'req-ttl' },
    });

    delete (globalThis as any).chrome;
    vi.useRealTimers();
  });
});
