/**
 * Caps Lock 大写锁定检测 composable 测试
 */
import { describe, expect, it } from 'vitest';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';

function keyEvent(capsLockOn: boolean): KeyboardEvent {
  return {
    getModifierState: (key: string) => key === 'CapsLock' && capsLockOn,
  } as unknown as KeyboardEvent;
}

describe('useCapsLockDetection', () => {
  it('按键事件实时反映大写锁定状态', () => {
    const { capsLockOn, handleCapsKeyEvent } = useCapsLockDetection();
    expect(capsLockOn.value).toBe(false);

    handleCapsKeyEvent(keyEvent(true));
    expect(capsLockOn.value).toBe(true);

    handleCapsKeyEvent(keyEvent(false));
    expect(capsLockOn.value).toBe(false);
  });

  it('resetCapsLockState 清除状态（失焦/弹窗重开场景）', () => {
    const { capsLockOn, handleCapsKeyEvent, resetCapsLockState } = useCapsLockDetection();
    handleCapsKeyEvent(keyEvent(true));
    expect(capsLockOn.value).toBe(true);

    resetCapsLockState();
    expect(capsLockOn.value).toBe(false);
  });

  it('事件缺少 getModifierState 时保持原状态（安全降级）', () => {
    const { capsLockOn, handleCapsKeyEvent } = useCapsLockDetection();
    handleCapsKeyEvent({} as KeyboardEvent);
    expect(capsLockOn.value).toBe(false);
  });
});
