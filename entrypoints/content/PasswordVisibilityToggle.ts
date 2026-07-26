import { eyeOpenIcon, eyeClosedIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { ToggleEntry } from '@/entrypoints/content/types';
import { applyThemeTokensToHost, DEFAULT_THEME, type ThemeName } from '@/utils/theme';
import { isElementVisible } from './domUtils';
import { tl } from '@/utils/i18n-lite';

/**
 * 注入到页面中的 CSS 样式
 *
 * 零侵入方案：按钮作为 input 兄弟节点，position: absolute 定位。
 * 垂直居中由 CSS 处理，水平位置由 JS 计算。
 * 不包裹 input，不修改 input 样式，仅父元素临时设为 position: relative。
 */
const INJECTED_STYLES = `
.aph-pwd-toggle-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--aph-primary);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease, color 0.15s ease;
  z-index: 200;
  border-radius: 4px;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  line-height: 0;
  font-size: 0;
  pointer-events: auto;
}

.aph-pwd-toggle-btn.aph-pwd-toggle-visible {
  opacity: 1;
  visibility: visible;
}

.aph-pwd-toggle-btn:hover {
  color: var(--aph-primary-hover);
  background: rgb(var(--aph-primary-rgb) / 10%);
}

.aph-pwd-toggle-btn:active {
  color: var(--aph-primary);
  background: rgb(var(--aph-primary-rgb) / 18%);
}

.aph-pwd-toggle-btn svg {
  width: 16px;
  height: 16px;
  pointer-events: none;
  flex-shrink: 0;
}
`;

/** STYLE 元素 ID */
const STYLE_ELEMENT_ID = 'aph-pwd-toggle-styles';

/** 按钮左边缘距 input 右边缘的距离 = 按钮宽度(24) + 间距(4) */
const BUTTON_LEFT_OFFSET = 28;

/**
 * 密码输入框显示/隐藏切换管理器
 *
 * 零侵入方案：
 * - 不对 input 做 DOM 包裹或样式修改
 * - 按钮作为 input 兄弟节点插入（同一父元素）
 * - 父元素设为 position: relative（无偏移量，视觉零影响）
 * - 按钮 position: absolute，CSS 垂直居中 + JS 水平定位
 */
export class PasswordVisibilityToggle {
  /** 所有已注入的条目（WeakMap 防止内存泄漏） */
  private entries = new WeakMap<HTMLInputElement, ToggleEntry>();

  /** 已处理过的输入框集合（用于去重） */
  private processedInputs = new WeakSet<HTMLInputElement>();

  /** DOM 变化观察器 */
  private observer: MutationObserver | null = null;

  /** 功能开关状态 */
  private enabled = true;

  /** 样式元素引用 */
  private styleElement: HTMLStyleElement | null = null;

  /** 当前主题（用于注入按钮的令牌换肤） */
  private currentTheme: ThemeName = DEFAULT_THEME;

  /**
   * 初始化
   */
  init(): void {
    this.injectStyles();
    this.scanAndInject();
    this.startObserver();
    window.addEventListener('resize', this.onWindowResize, { passive: true });
  }

  /**
   * 动态启用/禁用
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    if (enabled) {
      this.injectStyles();
      this.scanAndInject();
      this.startObserver();
      window.addEventListener('resize', this.onWindowResize, { passive: true });
    } else {
      this.removeAll();
    }
  }

  /**
   * 更新主题：刷新当前主题并对已注入按钮重写令牌，实现实时换肤
   * @param theme 主题名
   */
  setTheme(theme: ThemeName): void {
    this.currentTheme = theme;
    const buttons = document.querySelectorAll<HTMLButtonElement>('.aph-pwd-toggle-btn');
    buttons.forEach(button => applyThemeTokensToHost(button, theme));
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.removeAll();
    this.observer?.disconnect();
    this.observer = null;
    this.styleElement?.remove();
    this.styleElement = null;
    window.removeEventListener('resize', this.onWindowResize);
  }

  /**
   * 注入全局样式（只注入一次）
   */
  private injectStyles(): void {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = INJECTED_STYLES;
    document.head.appendChild(style);
    this.styleElement = style;
  }

  /**
   * 扫描所有密码输入框并注入按钮
   */
  private scanAndInject(): void {
    if (!this.enabled) return;
    const passwordInputs = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
    passwordInputs.forEach(input => this.injectToggle(input));
  }

  /**
   * 为单个密码输入框注入切换按钮
   *
   * 使用双帧 requestAnimationFrame 延迟初始定位，
   * 确保弹窗动画/布局完成后再计算位置。
   */
  private injectToggle(input: HTMLInputElement): void {
    if (this.processedInputs.has(input)) return;
    if (!isElementVisible(input)) return;

    const parent = input.parentElement;
    if (!parent) return;

    this.processedInputs.add(input);
    // 标记为密码字段，确保 LoginAutoSave 在 type 被切换为 text 后仍能通过选择器定位
    input.dataset.aphPassword = 'true';

    // 父元素设为 position: relative（无偏移量 = 视觉零影响）
    const computedPosition = window.getComputedStyle(parent).position;
    const originalParentPosition = parent.style.position || '';
    if (computedPosition === 'static') {
      parent.style.position = 'relative';
    }

    // 创建按钮
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aph-pwd-toggle-btn';
    button.setAttribute('tabindex', '-1');
    button.setAttribute('aria-label', tl('cs.pv.show'));
    // 状态语义：密文状态显示闭眼图标（表示"密码不可见"）
    button.innerHTML = eyeClosedIcon;

    // 写入当前主题令牌到按钮元素（light DOM，仅作用于自身及其伪类，零侵入页面）
    applyThemeTokensToHost(button, this.currentTheme);

    // 按钮作为兄弟节点插入到 input 之后
    parent.insertBefore(button, input.nextSibling);

    // 根据当前是否有值控制按钮可见性
    if (input.value.length > 0) {
      button.classList.add('aph-pwd-toggle-visible');
    }

    // input 事件：有值时显示按钮
    const onInput = () => {
      button.classList.toggle('aph-pwd-toggle-visible', input.value.length > 0);
    };
    input.addEventListener('input', onInput);

    // click 事件：切换密码可见性
    let isRevealed = false;
    const onClick = () => {
      isRevealed = !isRevealed;
      input.type = isRevealed ? 'text' : 'password';
      // 状态语义：明文显示睁眼（表示"密码可见"），密文显示闭眼（表示"密码不可见"）
      button.innerHTML = isRevealed ? eyeOpenIcon : eyeClosedIcon;
      button.setAttribute('aria-label', isRevealed ? tl('cs.pv.hide') : tl('cs.pv.show'));

      // 保持焦点在输入框上，不影响用户操作
      input.focus();

      // 切换 type 后重定位（尺寸可能有细微差异）
      this.positionButton(input, button);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    button.addEventListener('click', onClick);

    // 双帧 rAF 延迟初始定位，确保弹窗布局完成（修复弹窗错位问题）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.positionButton(input, button);
      });
    });

    // 记录条目
    this.entries.set(input, {
      input,
      parent,
      button,
      onInput,
      onClick,
      originalParentPosition,
    });
  }

  /**
   * MutationObserver：监听动态新增的密码输入框
   */
  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(mutations => {
      if (!this.enabled) return;

      let shouldScan = false;
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (
            el.querySelector?.('input[type="password"]') ||
            (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password')
          ) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        // 延迟扫描，等待 DOM 渲染完成
        setTimeout(() => this.scanAndInject(), 100);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * 移除所有注入的切换按钮，恢复原始 DOM 结构
   */
  private removeAll(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.aph-pwd-toggle-btn');
    buttons.forEach(button => {
      const input = this.findInputForButton(button);
      if (!input) return;

      const entry = this.entries.get(input);
      if (!entry) return;

      // 解绑事件
      input.removeEventListener('input', entry.onInput);
      button.removeEventListener('click', entry.onClick);

      // 恢复原始 type
      input.type = 'password';

      // 移除按钮
      button.remove();

      // 恢复父元素 position
      if (entry.originalParentPosition) {
        entry.parent.style.position = entry.originalParentPosition;
      } else if (window.getComputedStyle(entry.parent).position === 'relative') {
        entry.parent.style.position = '';
      }

      this.entries.delete(input);
      this.processedInputs.delete(input);
    });

    // 移除样式
    this.styleElement?.remove();
    this.styleElement = null;

    // 停止观察器
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * 查找按钮关联的 input（按钮紧跟在 input 之后作为兄弟节点）
   */
  private findInputForButton(button: HTMLButtonElement): HTMLInputElement | null {
    let sibling = button.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === 'INPUT' && this.entries.has(sibling as HTMLInputElement)) {
        return sibling as HTMLInputElement;
      }
      sibling = sibling.previousElementSibling;
    }
    return null;
  }

  /**
   * 计算按钮水平位置（垂直方向由 CSS top:50% + translateY(-50%) 处理）
   *
   * 通过 getBoundingClientRect 差值计算按钮在父元素内的绝对 left 坐标。
   */
  private positionButton(input: HTMLInputElement, button: HTMLButtonElement): void {
    const parent = input.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();

    // 按钮定位在 input 右侧内部 4px 处
    const left = inputRect.right - parentRect.left - BUTTON_LEFT_OFFSET;
    button.style.left = `${left}px`;
  }

  /**
   * window resize 回调：遍历所有已注入按钮并重新定位
   * （响应式布局下 input 宽度可能变化）
   */
  private onWindowResize = (): void => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.aph-pwd-toggle-btn');
    buttons.forEach(button => {
      const input = this.findInputForButton(button);
      if (input) {
        this.positionButton(input, button);
      }
    });
  };
}
