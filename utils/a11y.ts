/**
 * 无障碍键盘工具
 *
 * - {@link activateOnKeydown}：为以 `role="button"` + `tabindex="0"` 形式实现的可点击
 *   图标/元素提供与原生按钮一致的 Enter / Space 键激活行为；
 * - {@link isEditableEventTarget}：判定键盘事件目标是否为可编辑元素，供容器级
 *   快捷键处理在劫持原生行为（复制/剪切等）前让路。
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

/**
 * 可编辑目标的鸭子类型视图
 *
 * 只声明判定所需的两个字段，避开对 DOM 构造器全局的依赖。
 */
interface EditableTargetLike {
  /** 元素标签名（大写） */
  tagName?: string;
  /** 是否为 contenteditable 宿主元素 */
  isContentEditable?: boolean;
}

/**
 * 判定键盘事件目标是否为可编辑元素（纯函数）
 *
 * 容器级 keydown 监听会收到自子孙输入框冒泡而来的事件。若快捷键分支直接
 * `preventDefault()` 并执行剪贴板/导航类动作，就会吃掉浏览器在输入框内的原生
 * 行为（如选中文字后 Ctrl+C 复制）。调用方应先用本函数判定并在可编辑目标上让路。
 *
 * 覆盖三类可编辑目标：`input`、`textarea`、`contenteditable` 宿主元素。
 *
 * 实现采用鸭子类型而非 `instanceof HTMLInputElement`：项目 vitest 固定
 * `environment: 'node'` 且未引入 jsdom，DOM 构造器全局在测试环境不存在，
 * `instanceof` 会直接抛 ReferenceError。鸭子类型使本函数在两个环境下行为一致。
 *
 * @param target 键盘事件的 `target`（可能为 null）
 * @returns 目标是否可编辑；null 与非元素节点一律返回 false
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;

  const element = target as EditableTargetLike;
  if (element.isContentEditable) return true;

  const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA';
}
