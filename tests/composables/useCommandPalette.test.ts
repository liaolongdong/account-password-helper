import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import { useCommandPalette } from '@/composables/useCommandPalette';
import type { CommandAction } from '@/utils/commandPalette';

/** 事件工厂：构造 handleKeydown 所需的最小鸭子类型事件 */
function keyEvent(
  init: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    isComposing: boolean;
  }>,
) {
  const preventDefault = vi.fn();
  return {
    key: init.key ?? '',
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    isComposing: init.isComposing ?? false,
    preventDefault,
  };
}

/** 固定动作列表（同一对象引用，便于断言 run 被调用） */
function makeActions(): CommandAction[] {
  return [
    { id: 'add', group: 'entry', label: '添加密码', keywords: ['add', 'new'], run: vi.fn() },
    { id: 'export', group: 'data', label: '导出数据', keywords: ['export', 'csv'], run: vi.fn() },
    { id: 'trash', group: 'data', label: '回收站', keywords: ['trash'], run: vi.fn() },
  ];
}

let scope: EffectScope;
afterEach(() => scope.stop());

describe('useCommandPalette', () => {
  let actions: CommandAction[];

  beforeEach(() => {
    actions = makeActions();
    scope = effectScope();
  });

  /** 在作用域内实例化控制器 */
  function build(options?: { canOpen?: () => boolean }) {
    return scope.run(() => useCommandPalette({ getActions: () => actions, ...options }))!;
  }

  it('open/close/toggle 切换可见性并清空关键词', () => {
    const c = build();
    c.open();
    expect(c.visible.value).toBe(true);

    c.keyword.value = 'abc';
    c.close();
    expect(c.visible.value).toBe(false);
    expect(c.keyword.value).toBe('');

    c.toggle();
    expect(c.visible.value).toBe(true);
    c.toggle();
    expect(c.visible.value).toBe(false);
  });

  it('open 重置关键词与活动索引', () => {
    const c = build();
    c.open();
    c.keyword.value = 'export';
    c.activeIndex.value = 2;
    c.close();
    c.open();
    expect(c.keyword.value).toBe('');
    expect(c.activeIndex.value).toBe(0);
  });

  it('canOpen 为假时 open 与快捷键均不生效', () => {
    const c = build({ canOpen: () => false });
    c.open();
    expect(c.visible.value).toBe(false);

    const ev = keyEvent({ key: 'k', ctrlKey: true });
    c.handleKeydown(ev);
    expect(c.visible.value).toBe(false);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('filtered 随关键词变化，且关键词变化后活动索引回到 0', async () => {
    const c = build();
    c.open();
    expect(c.filtered.value).toHaveLength(3);

    c.activeIndex.value = 2;
    c.keyword.value = 'export';
    await nextTick();
    expect(c.filtered.value.map(a => a.id)).toEqual(['export']);
    expect(c.activeIndex.value).toBe(0);
  });

  it('move 在过滤结果内循环', () => {
    const c = build();
    c.open();
    c.move(1);
    expect(c.activeIndex.value).toBe(1);
    c.move(1);
    expect(c.activeIndex.value).toBe(2);
    c.move(1);
    expect(c.activeIndex.value).toBe(0);
    c.move(-1);
    expect(c.activeIndex.value).toBe(2);
  });

  it('不可见时 move 不改变索引', () => {
    const c = build();
    c.activeIndex.value = 1;
    c.move(1);
    expect(c.activeIndex.value).toBe(1);
  });

  it('过滤结果变短时活动索引收敛回有效范围', async () => {
    const c = build();
    c.open();
    c.keyword.value = '';
    c.activeIndex.value = 2;
    c.keyword.value = 'export';
    await nextTick();
    expect(c.filtered.value).toHaveLength(1);
    expect(c.activeIndex.value).toBe(0);
  });

  it('runAt 执行对应动作并关闭面板', () => {
    const c = build();
    c.open();
    c.runAt(1);
    expect(actions[1].run).toHaveBeenCalledTimes(1);
    expect(c.visible.value).toBe(false);
  });

  it('runAt 越界索引为无操作', () => {
    const c = build();
    c.open();
    c.runAt(99);
    expect(actions.every(a => !(a.run as ReturnType<typeof vi.fn>).mock.calls.length)).toBe(true);
  });

  it('select 执行当前活动项', () => {
    const c = build();
    c.open();
    c.activeIndex.value = 1;
    c.select();
    expect(actions[1].run).toHaveBeenCalledTimes(1);
  });

  describe('handleKeydown', () => {
    it('Ctrl+K / Cmd+K 切换面板', () => {
      const c = build();
      c.handleKeydown(keyEvent({ key: 'k', ctrlKey: true }));
      expect(c.visible.value).toBe(true);
      c.handleKeydown(keyEvent({ key: 'k', metaKey: true }));
      expect(c.visible.value).toBe(false);
    });

    it('带修饰符 Shift+Alt+K 不触发', () => {
      const c = build();
      c.handleKeydown(keyEvent({ key: 'k', ctrlKey: true, shiftKey: true }));
      expect(c.visible.value).toBe(false);
    });

    it('大写 K 仍识别为快捷键', () => {
      const c = build();
      c.handleKeydown(keyEvent({ key: 'K', metaKey: true }));
      expect(c.visible.value).toBe(true);
    });

    it('方向键导航、Enter 执行、Esc 关闭', () => {
      const c = build();
      c.open();
      c.handleKeydown(keyEvent({ key: 'ArrowDown' }));
      expect(c.activeIndex.value).toBe(1);
      c.handleKeydown(keyEvent({ key: 'ArrowUp' }));
      expect(c.activeIndex.value).toBe(0);
      c.handleKeydown(keyEvent({ key: 'Enter' }));
      expect(actions[0].run).toHaveBeenCalledTimes(1);
      expect(c.visible.value).toBe(false);

      c.open();
      c.handleKeydown(keyEvent({ key: 'Escape' }));
      expect(c.visible.value).toBe(false);
    });

    it('面板关闭时非快捷键不触发导航', () => {
      const c = build();
      c.handleKeydown(keyEvent({ key: 'ArrowDown' }));
      expect(c.activeIndex.value).toBe(0);
    });
  });
});
