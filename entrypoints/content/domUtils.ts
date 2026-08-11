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

/**
 * 复制文本到剪贴板：Async Clipboard API 优先，降级隐藏 textarea + execCommand
 * （与侧边栏 useSidepanelFill.copyTotp 的降级策略一致）
 *
 * @param text - 待复制文本
 * @returns 是否复制成功
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position: fixed; top: -9999px; left: -9999px; opacity: 0;';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
