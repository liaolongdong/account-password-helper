/** @vitest-environment jsdom */
/**
 * FormDetector 监听器生命周期回归测试
 *
 * 背景：扩展重载/更新（ctx.onInvalidated）与页面卸载时，`entrypoints/content.ts` 的
 * cleanup 会调用 `formDetector.destroy()`，但从根源清理的前提是「所有监听器都可被移除」。
 * visibilitychange / beforeunload / popstate / DOMContentLoaded 若以匿名闭包注册，
 * destroy 就拿不到引用，孤儿实例会在扩展上下文失效后继续响应页面事件并调用
 * chrome.runtime.sendMessage —— 正是 content.ts 注释所要消除的失效后调用来源。
 *
 * 断言口径：以 addEventListener/removeEventListener 登记表验证「注册过的都要解绑」，
 * 不依赖事件在 jsdom 中能否真实触发；同时用「destroy 前事件确实会触发消息」的用例
 * 兜住反方向，避免监听器压根没注册导致的假绿。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { MessageType } from '@/utils/types';

/** 一条仍生效的监听器注册记录 */
interface LiveRegistration {
  type: string;
  handler: EventListenerOrEventListenerObject;
  capture: boolean;
}

/** 登记表句柄：存活注册集合 + 还原目标对象 */
interface Tracker {
  live: Set<LiveRegistration>;
  restore: () => void;
}

/**
 * 劫持指定 EventTarget 的 add/removeEventListener，登记尚未解绑的注册
 *
 * 原生方法取自 target 本身而非 `EventTarget.prototype`：jsdom 的 Window 带 brand check，
 * 用原型方法 call 会抛「not a valid instance of EventTarget」。
 */
function trackLiveListeners(target: EventTarget): Tracker {
  const live = new Set<LiveRegistration>();
  const nativeAdd = target.addEventListener.bind(target);
  const nativeRemove = target.removeEventListener.bind(target);
  const originalAdd = Object.getOwnPropertyDescriptor(target, 'addEventListener');
  const originalRemove = Object.getOwnPropertyDescriptor(target, 'removeEventListener');

  const toCapture = (options: boolean | AddEventListenerOptions | undefined): boolean =>
    options === true || (typeof options === 'object' && options.capture === true);

  Object.defineProperty(target, 'addEventListener', {
    configurable: true,
    value: (
      type: string,
      handler: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (handler) live.add({ type, handler, capture: toCapture(options) });
      nativeAdd(type, handler, options);
    },
  });

  Object.defineProperty(target, 'removeEventListener', {
    configurable: true,
    value: (
      type: string,
      handler: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      const capture = toCapture(options);
      for (const record of live) {
        if (record.type === type && record.handler === handler && record.capture === capture) live.delete(record);
      }
      nativeRemove(type, handler, options);
    },
  });

  /** 原本没有 own property 就删掉，否则按原描述符还原，避免污染后续用例 */
  const restoreOwn = (key: 'addEventListener' | 'removeEventListener', descriptor?: PropertyDescriptor): void => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  };

  return {
    live,
    restore: () => {
      restoreOwn('addEventListener', originalAdd);
      restoreOwn('removeEventListener', originalRemove);
    },
  };
}

/** 取登记表中的事件名列表，便于失败时直接读出泄漏的事件类型 */
const typesOf = (tracker: Tracker): string[] => [...tracker.live].map(record => record.type).sort();

describe('FormDetector.destroy 的监听器解绑', () => {
  let documentTracker: Tracker;
  let windowTracker: Tracker;
  let detector: FormDetector | null = null;
  let sendMessage: ReturnType<typeof vi.spyOn>;

  /** 在监听器登记表生效下构造实例 */
  const createDetector = (): FormDetector => {
    documentTracker = trackLiveListeners(document);
    windowTracker = trackLiveListeners(window);
    detector = new FormDetector();
    return detector;
  };

  /** 屏蔽 fakeBrowser 无监听者时的 reject，只关心「是否被调用」 */
  const spySendMessage = () => vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({ success: true } as never);

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    detector?.destroy();
    detector = null;
    documentTracker?.restore();
    windowTracker?.restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'readyState');
    Reflect.deleteProperty(document, 'hidden');
  });

  it('装置自检：构造过程确实注册了 document / window 监听器', () => {
    createDetector();

    expect(typesOf(documentTracker)).toContain('click');
    expect(typesOf(windowTracker)).toContain('popstate');
  });

  it('destroy 后 document 上不再残留本模块注册的监听器', () => {
    const instance = createDetector();

    instance.destroy();

    expect(typesOf(documentTracker)).toEqual([]);
  });

  it('destroy 后 window 上不再残留本模块注册的监听器', () => {
    const instance = createDetector();

    instance.destroy();

    expect(typesOf(windowTracker)).toEqual([]);
  });

  it('destroy 后页面导航事件不再触发失效后的 chrome API 调用', () => {
    const instance = createDetector();
    sendMessage = spySendMessage();

    instance.destroy();
    window.dispatchEvent(new Event('popstate'));
    window.dispatchEvent(new Event('beforeunload'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('回归护栏：destroy 前 popstate 确实会发出 URL_CHANGED（防止上面两用例假绿）', () => {
    createDetector();
    sendMessage = spySendMessage();

    window.dispatchEvent(new Event('popstate'));

    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.URL_CHANGED, data: { url: location.href } });
  });

  it('回归护栏：destroy 前页面隐藏确实会发出 HIDE_SIDEPANEL', () => {
    createDetector();
    sendMessage = spySendMessage();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.HIDE_SIDEPANEL });
  });

  it('destroy 后 DOMContentLoaded 监听器同样被解绑（页面仍在 loading 时被失效）', () => {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    const instance = createDetector();
    expect(typesOf(documentTracker)).toContain('DOMContentLoaded');

    instance.destroy();

    expect(typesOf(documentTracker)).toEqual([]);
  });
});
