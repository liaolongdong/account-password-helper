/**
 * DOM 工具函数
 * 提供 content script 中通用的 DOM 元素检测方法
 */

/**
 * 判断元素是否可见
 *
 * 综合检查计算样式和布局尺寸：
 * - display !== 'none'
 * - visibility !== 'hidden'
 * - opacity !== '0'
 * - offsetWidth > 0
 * - offsetHeight > 0
 *
 * @param el - 要检查的 HTML 元素
 * @returns 元素是否可见
 */
export function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    el.offsetWidth > 0 &&
    el.offsetHeight > 0
  );
}
