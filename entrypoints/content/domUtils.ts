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
 * 判断表单控件是否存在可见的关联 label
 *
 * 自定义样式复选框（如阿里云 havana 登录的协议勾选框）常将原生 input 隐藏
 * （visibility:hidden / display:none），由 label 伪元素绘制勾选外观，
 * 此时 label 才是用户实际看到与操作的载体。
 * 关联关系经 `input.labels` 获取，覆盖 `for` 属性与 label 包裹两种形式。
 *
 * @param input - 表单输入控件
 * @returns 是否存在可见的关联 label
 */
export function hasVisibleAssociatedLabel(input: HTMLInputElement): boolean {
  const labels = input.labels;
  if (!labels || labels.length === 0) {
    return false;
  }
  return Array.from(labels).some(label => isElementVisible(label));
}

/**
 * 判断复选框是否应纳入自动勾选候选
 *
 * 原生 input 自身可见时直接纳入；input 被隐藏但存在可见关联 label 时
 * （自定义样式复选框的常见载体形式，用户经 label 感知并操作勾选态）同样纳入；
 * 两者均不可见（纯隐藏的功能开关、蜜罐字段等）时排除，避免误勾。
 *
 * @param input - 复选框元素
 * @returns 是否应纳入自动勾选候选
 */
export function isDetectableCheckbox(input: HTMLInputElement): boolean {
  if (input.disabled) {
    return false;
  }
  const style = window.getComputedStyle(input);
  const selfVisible = style.display !== 'none' && style.visibility !== 'hidden' && input.offsetParent !== null;
  return selfVisible || hasVisibleAssociatedLabel(input);
}

/** 矩形度量子集（getBoundingClientRect 的结构化子集，便于纯函数复用与单测） */
export interface RectMetrics {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** 父元素垂直方向紧贴 input 的最大额外高度：超出视为松散容器（表单行/卡片），不采用父元素右缘 */
const FIELD_WRAP_VERTICAL_TOLERANCE = 24;

/** input 右缘与父元素右缘之间视为「可安置尾随空间」的最小宽度 */
const TRAILING_SPACE_MIN = 8;

/**
 * 解析密码可见性按钮的水平锚点右缘
 *
 * 按钮默认锚定 input 右内缘；但部分页面（如阿里云 havana 嵌入式登录）的可视字段盒是
 * 比 input 更宽的父元素（input 定宽、父元素右侧留白），此时锚定 input 右缘会让按钮
 * 悬在字段中部，并与页面原生眼睛图标重叠。父元素垂直方向紧贴 input 且尾随空间未被
 * 其他兄弟元素占据时，改用父元素右缘作为锚点，使按钮落在用户感知的字段右内缘；
 * 父元素松散（含标签/多行）或尾随空间已被兄弟元素（如行内提交按钮）占据时保持
 * input 右缘，避免按钮越界到字段盒之外。
 *
 * @param inputRect - input 的边框盒矩形
 * @param parentRect - 定位父元素的边框盒矩形
 * @param siblingRects - 父元素内除 input 与按钮外其余子元素的矩形
 * @returns 水平锚点右缘（视口坐标）
 */
export function resolveToggleAnchorRight(
  inputRect: RectMetrics,
  parentRect: RectMetrics,
  siblingRects: readonly RectMetrics[],
): number {
  const trailing = parentRect.right - inputRect.right;
  const tightVertical = parentRect.height <= inputRect.height + FIELD_WRAP_VERTICAL_TOLERANCE;
  if (!tightVertical || trailing < TRAILING_SPACE_MIN) {
    return inputRect.right;
  }
  const trailingOccupied = siblingRects.some(
    rect =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > inputRect.right + 2 &&
      rect.left < parentRect.right - 2 &&
      rect.top < inputRect.bottom &&
      rect.bottom > inputRect.top,
  );
  return trailingOccupied ? inputRect.right : parentRect.right;
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
