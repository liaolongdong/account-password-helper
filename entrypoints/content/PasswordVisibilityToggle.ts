import { eyeOpenIcon, eyeClosedIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { ToggleEntry } from '@/entrypoints/content/types';

/**
 * 注入到页面中的 CSS 样式
 * 使用 `.aph-pwd-toggle-` 前缀避免与宿主页面样式冲突
 * 按钮颜色使用主题蓝 #409eff，与项目 Element Plus 主色一致
 */
const INJECTED_STYLES = `
.aph-pwd-toggle-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 100%;
}

.aph-pwd-toggle-btn {
  position: absolute;
  right: 8px;
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
  color: #409eff;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease, color 0.15s ease;
  z-index: 10000;
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
  color: #66b1ff;
  background: rgba(64, 158, 255, 0.1);
}

.aph-pwd-toggle-btn:active {
  color: #3a8ee6;
  background: rgba(64, 158, 255, 0.18);
}

.aph-pwd-toggle-btn svg {
  width: 16px;
  height: 16px;
  pointer-events: none;
  flex-shrink: 0;
}
`;

/** STYLE 元素 ID，保证只注入一次 */
const STYLE_ELEMENT_ID = 'aph-pwd-toggle-styles';

/**
 * 密码输入框显示/隐藏切换管理器
 *
 * 负责：
 * - 扫描页面中所有 `input[type="password"]`，注入主题蓝色切换按钮
 * - 通过 MutationObserver 监听动态新增的密码输入框
 * - 对所有密码输入框一律注入，不判断页面是否已有切换按钮
 * - 支持动态启用/禁用，不干扰现有账号密码填充功能
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

  /** 样式元素引用（用于 destroy 时移除） */
  private styleElement: HTMLStyleElement | null = null;

  /**
   * 初始化：注入样式、扫描现有密码输入框、启动 MutationObserver
   */
  init(): void {
    this.injectStyles();
    this.scanAndInject();
    this.startObserver();
  }

  /**
   * 动态启用或禁用功能
   * @param enabled - 是否启用
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    if (enabled) {
      this.injectStyles();
      this.scanAndInject();
      this.startObserver();
    } else {
      this.removeAll();
    }
  }

  /**
   * 销毁：移除所有注入的 DOM 元素、解绑事件、停止观察器
   */
  destroy(): void {
    this.removeAll();
    this.observer?.disconnect();
    this.observer = null;
    this.styleElement?.remove();
    this.styleElement = null;
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
   * 扫描页面中所有 `input[type="password"]` 并注入切换按钮
   */
  private scanAndInject(): void {
    if (!this.enabled) return;

    const passwordInputs = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
    passwordInputs.forEach(input => this.injectToggle(input));
  }

  /**
   * 为单个密码输入框注入切换按钮
   * 所有密码输入框一律注入，不判断页面是否已有切换按钮
   * @param input - 目标密码输入框
   */
  private injectToggle(input: HTMLInputElement): void {
    // 跳过已处理或不可见的输入框
    if (this.processedInputs.has(input)) return;
    if (!this.isElementVisible(input)) return;

    this.processedInputs.add(input);

    // 创建包裹容器
    const wrapper = document.createElement('span');
    wrapper.className = 'aph-pwd-toggle-wrapper';

    // 把输入框包进去（保持原有 DOM 位置）
    input.parentNode?.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // 增加输入框右侧内边距，避免文字与图标重叠
    const originalPaddingRight = input.style.paddingRight || '';
    const currentPaddingRight = parseInt(window.getComputedStyle(input).paddingRight, 10) || 0;
    input.style.paddingRight = `${Math.max(currentPaddingRight, 36)}px`;

    // 创建切换按钮
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aph-pwd-toggle-btn';
    button.setAttribute('tabindex', '-1');
    button.setAttribute('aria-label', '显示密码');
    // 动作语义：密文状态显示睁眼图标（提示"点击可查看密码"）
    button.innerHTML = eyeOpenIcon;
    wrapper.appendChild(button);

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
      // 动作语义：明文显示闭眼（点击将隐藏），密文显示睁眼（点击将查看）
      button.innerHTML = isRevealed ? eyeClosedIcon : eyeOpenIcon;
      button.setAttribute('aria-label', isRevealed ? '隐藏密码' : '显示密码');

      // 保持焦点在输入框上，不影响用户操作
      input.focus();

      // 触发事件，确保网站自身的表单验证正常工作
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    button.addEventListener('click', onClick);

    // 记录条目
    const entry: ToggleEntry = {
      input,
      wrapper,
      button,
      onInput,
      onClick,
      originalPaddingRight,
    };
    this.entries.set(input, entry);
  }

  /**
   * 启动 MutationObserver 监听动态新增的密码输入框
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
    // 遍历所有已注入的 wrapper，恢复原始 DOM
    const wrappers = document.querySelectorAll<HTMLElement>('.aph-pwd-toggle-wrapper');
    wrappers.forEach(wrapper => {
      const input = wrapper.querySelector<HTMLInputElement>('input[type="password"], input[type="text"]');
      if (!input) return;

      const entry = this.entries.get(input);
      if (entry) {
        // 解绑事件
        input.removeEventListener('input', entry.onInput);
        entry.button.removeEventListener('click', entry.onClick);

        // 恢复原始 type
        input.type = 'password';
        // 恢复原始 padding-right
        input.style.paddingRight = entry.originalPaddingRight;

        // 移除按钮
        entry.button.remove();

        // 解包：把 input 移回 wrapper 的父节点
        wrapper.parentNode?.insertBefore(input, wrapper);
        wrapper.remove();

        this.entries.delete(input);
        this.processedInputs.delete(input);
      }
    });

    // 移除样式
    this.styleElement?.remove();
    this.styleElement = null;

    // 停止观察器
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * 判断元素是否可见
   * @param element - 要检查的元素
   * @returns 是否可见
   */
  private isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.offsetWidth > 0 &&
      element.offsetHeight > 0
    );
  }
}
