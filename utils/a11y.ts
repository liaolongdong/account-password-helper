/**
 * 无障碍工具
 *
 * - {@link activateOnKeydown}：为以 `role="button"` + `tabindex="0"` 形式实现的可点击
 *   图标/元素提供与原生按钮一致的 Enter / Space 键激活行为；
 * - {@link isEditableEventTarget}：判定键盘事件目标是否为可编辑元素，供容器级
 *   快捷键处理在劫持原生行为（复制/剪切等）前让路；
 * - {@link prefersReducedMotion} / {@link scrollBehavior}：命令式滚动的减弱动效判据。
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

/** 减弱动效的媒体查询语句（全仓唯一书写处，CSS 侧的 `@media` 与之同义） */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * 当前环境是否要求减弱动效
 *
 * CSS 动画由各组件的 `@media (prefers-reduced-motion: reduce)` 承担，但命令式滚动
 * （`scrollTo` / `scrollIntoView` 的 `behavior`）写在 JS 里，媒体查询管不到，
 * 于是每个调用点都得问一次。漏问的代价不体现为报错，而是「系统已开启减弱动效，
 * 这一处仍在平滑滚动」——所以判据收在这里，调用点只表达「要滚动」。
 *
 * 结果不缓存：用户可在系统设置里随时切换，缓存会让已打开的页面在会话内不再跟随。
 * `matchMedia` 在非 DOM 上下文（本仓 vitest 固定 `environment: 'node'`）不存在，
 * 此时按「不减弱」处理，与媒体查询在不支持环境下不生效是同一种保守方向。
 *
 * @returns 用户开启了「减弱动态效果」时为 true
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches === true;
}

/**
 * 供 `scrollTo` / `scrollIntoView` 直接使用的滚动行为
 * @returns 要求减弱动效时为 `auto`（瞬时定位），否则为 `smooth`
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
