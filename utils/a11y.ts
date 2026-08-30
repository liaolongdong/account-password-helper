/**
 * 无障碍键盘激活工具
 *
 * 为以 `role="button"` + `tabindex="0"` 形式实现的可点击图标/元素
 * 提供与原生按钮一致的 Enter / Space 键激活行为，
 * 供 keydown 监听器直接绑定使用。
 */

/**
 * 当按键为 Enter 或 Space 时阻止默认行为（防止 Space 滚动页面）并执行回调
 *
 * @param event 键盘事件
 * @param action 激活时执行的操作
 */
export function activateOnKeydown(event: KeyboardEvent, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}
