/**
 * 密码输入框 Caps Lock 大写锁定检测
 *
 * 通过 KeyboardEvent.getModifierState('CapsLock') 在按键事件中读取大写锁定状态，
 * 供主密码等敏感输入框在用户误开大写锁定时即时提示，避免「密码错误」式困惑。
 *
 * 使用方式：将返回的 handleCapsKeyEvent 绑定到输入框的 keydown/keyup，
 * resetCapsLockState 绑定到 blur（焦点离开后清除状态，避免残留提示）。
 */
import { ref } from 'vue';

export function useCapsLockDetection() {
  /** 大写锁定是否开启（按键事件实时更新） */
  const capsLockOn = ref(false);

  /** 从键盘事件读取大写锁定状态（无 getModifierState 的环境静默忽略） */
  const handleCapsKeyEvent = (event: KeyboardEvent): void => {
    if (typeof event.getModifierState === 'function') {
      capsLockOn.value = event.getModifierState('CapsLock');
    }
  };

  /** 失焦时重置，防止焦点离开后提示残留 */
  const resetCapsLockState = (): void => {
    capsLockOn.value = false;
  };

  return { capsLockOn, handleCapsKeyEvent, resetCapsLockState };
}
