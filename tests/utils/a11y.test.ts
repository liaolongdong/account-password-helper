/**
 * 无障碍键盘激活工具测试
 */
import { describe, expect, it, vi } from 'vitest';
import { activateOnKeydown } from '@/utils/a11y';

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
