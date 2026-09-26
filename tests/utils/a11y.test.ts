/**
 * 无障碍工具测试
 *
 * 覆盖：
 * - activateOnKeydown：Enter / Space 激活与其余按键不拦截；
 * - isEditableEventTarget：可编辑目标判定，供容器级快捷键在劫持原生行为前让路
 *  （侧边栏搜索框内 Ctrl+C 被全局键盘处理吃掉的缺陷即由此函数防护）；
 * - prefersReducedMotion / scrollBehavior：命令式滚动的减弱动效判据（媒体查询管不到 JS）。
 *
 * 测试环境为 node（无 jsdom），DOM 构造器全局不存在，故用普通对象模拟事件目标；
 * `isEditableEventTarget` 采用鸭子类型判定，在两个环境下行为一致。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { activateOnKeydown, isEditableEventTarget, prefersReducedMotion, scrollBehavior } from '@/utils/a11y';

function keyEvent(key: string): KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe('activateOnKeydown', () => {
  it('Enter 与 Space 触发回调并阻止默认行为', () => {
    for (const key of ['Enter', ' ']) {
      const action = vi.fn();
      const event = keyEvent(key);
      activateOnKeydown(event, action);
      expect(action).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('其他按键不触发回调且不拦截默认行为', () => {
    for (const key of ['Tab', 'a', 'Escape', 'ArrowDown']) {
      const action = vi.fn();
      const event = keyEvent(key);
      activateOnKeydown(event, action);
      expect(action).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe('isEditableEventTarget', () => {
  /** 将普通对象作为事件目标传入（避开 node 环境下不存在的 DOM 构造器） */
  const target = (shape: unknown): EventTarget => shape as EventTarget;

  it('input 与 textarea 视为可编辑', () => {
    expect(isEditableEventTarget(target({ tagName: 'INPUT' }))).toBe(true);
    expect(isEditableEventTarget(target({ tagName: 'TEXTAREA' }))).toBe(true);
  });

  it('标签名大小写不敏感（兼容小写 tagName 的环境）', () => {
    expect(isEditableEventTarget(target({ tagName: 'input' }))).toBe(true);
    expect(isEditableEventTarget(target({ tagName: 'textarea' }))).toBe(true);
  });

  it('contenteditable 宿主元素视为可编辑（即使标签名不是表单元素）', () => {
    expect(isEditableEventTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    expect(isEditableEventTarget(target({ isContentEditable: true }))).toBe(true);
  });

  it('非可编辑元素返回 false（容器级快捷键仍应生效）', () => {
    for (const tagName of ['DIV', 'SPAN', 'BUTTON', 'A', 'LI', 'UL']) {
      expect(isEditableEventTarget(target({ tagName })), tagName).toBe(false);
    }
    expect(isEditableEventTarget(target({ tagName: 'DIV', isContentEditable: false }))).toBe(false);
  });

  it('null、undefined 与无 tagName 的非元素目标返回 false', () => {
    expect(isEditableEventTarget(null)).toBe(false);
    expect(isEditableEventTarget(target(undefined))).toBe(false);
    expect(isEditableEventTarget(target({}))).toBe(false);
    expect(isEditableEventTarget(target({ tagName: 42 }))).toBe(false);
  });
});

/** 打桩 `window.matchMedia`，返回按调用顺序记录下来的查询串 */
function stubMatchMedia(resolver: (query: string) => boolean): string[] {
  const queries: string[] = [];
  vi.stubGlobal('window', {
    matchMedia: (query: string) => {
      queries.push(query);
      return { matches: resolver(query) };
    },
  });
  return queries;
}

describe('prefersReducedMotion / scrollBehavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('问的是减弱动效媒体查询，且结果每次现取、不缓存', () => {
    let reduced = false;
    const queries = stubMatchMedia(() => reduced);

    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');

    // 系统设置里打开「减弱动态效果」后，已打开的页面要在下一次滚动就跟上；
    // 若实现把首次结果存进模块变量，这两句会当场变红
    reduced = true;
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');

    expect([...new Set(queries)]).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('只认 matches 为真，其他值一律不算减弱', () => {
    for (const matches of [undefined, null, 0, 'true', false]) {
      stubMatchMedia(() => matches as boolean);
      expect(prefersReducedMotion(), `matches=${String(matches)}`).toBe(matches === true);
    }
  });

  it('非 DOM 上下文与缺 matchMedia 的环境按「不减弱」处理', () => {
    // node 环境本就没有 window
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');

    // 有 window 但无 matchMedia
    vi.stubGlobal('window', {});
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });
});
