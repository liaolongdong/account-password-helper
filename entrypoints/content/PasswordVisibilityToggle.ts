import { eyeOpenIcon, eyeClosedIcon } from '@/entrypoints/content/floatingButtons/icons';

/**
 * 注入到页面中的 CSS 样式
 * 使用 `.aph-pwd-toggle-` 前缀避免与宿主页面样式冲突
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
  color: #6b7280;
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
  color: #374151;
  background: rgba(0, 0, 0, 0.06);
}

.aph-pwd-toggle-btn:active {
  color: #1f2937;
  background: rgba(0, 0, 0, 0.1);
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
 * 检测已有切换按钮的关键词集合
 * 用于判断页面是否已自带密码显示/隐藏功能，避免重复注入
 */
const EXISTING_TOGGLE_KEYWORDS = {
  /** aria-label / title 关键词 */
  ariaTitle: ['eye', 'view', 'show', 'hide', 'password', '显示', '隐藏', '密码', '可见', 'visible', 'reveal', 'conceal'],
  /** class / id 关键词 */
  classId: [
    'eye',
    'view',
    'password-toggle',
    'show-password',
    'visible',
    'visibility',
    'pwd-toggle',
    'reveal',
    'toggle-password',
    'pass-toggle',
    'pwd-visibility',
    'password-eye',
    'show-pwd',
    'hide-pwd',
  ],
  /** data-* 属性名/值关键词 */
  dataAttr: ['eye','view', 'toggle', 'password', 'visible', 'visibility', 'reveal', 'pwd-toggle', 'show-password'],
};

/**
 * 每个被托管的密码输入框的状态记录
 */
interface ToggleEntry {
  /** 原始密码输入框 */
  input: HTMLInputElement;
  /** 包裹容器 */
  wrapper: HTMLElement;
  /** 切换按钮 */
  button: HTMLButtonElement;
  /** input 事件监听器引用（用于解绑） */
  onInput: () => void;
  /** click 事件监听器引用（用于解绑） */
  onClick: () => void;
  /** 是否已被切换为明文 */
  isRevealed: boolean;
  /** 输入框原始 padding-right 值 */
  originalPaddingRight: string;
}

/**
 * 密码输入框显示/隐藏切换管理器
 *
 * 负责：
 * - 扫描页面中所有 `input[type="password"]`，注入切换按钮
 * - 通过 MutationObserver 监听动态新增的密码输入框
 * - 智能检测页面自带的切换按钮并跳过注入
 * - 支持动态启用/禁用，不干扰现有账号密码填充功能
 */
export class PasswordVisibilityToggle {
  /** 所有已注入的条目（WeakMap 防止内存泄漏） */
  private entries = new WeakMap<HTMLInputElement, ToggleEntry>();

  /** 已处理过的输入框集合（用于去重） */
  private processedInputs = new WeakSet<HTMLInputElement>();

  /** 已检测为"页面自带切换按钮"的输入框（跳过注入） */
  private skippedInputs = new WeakSet<HTMLInputElement>();

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
   * @param input - 目标密码输入框
   */
  private injectToggle(input: HTMLInputElement): void {
    // 跳过已处理或不可见的输入框
    if (this.processedInputs.has(input) || this.skippedInputs.has(input)) return;
    if (!this.isElementVisible(input)) return;

    // 检测页面是否已自带切换按钮
    if (this.hasExistingToggle(input)) {
      this.skippedInputs.add(input);
      return;
    }

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
    button.innerHTML = eyeClosedIcon;
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
      button.innerHTML = isRevealed ? eyeOpenIcon : eyeClosedIcon;
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
      isRevealed: false,
      originalPaddingRight,
    };
    this.entries.set(input, entry);
  }

  /**
   * 检测密码输入框附近是否已存在切换按钮
   * @param input - 密码输入框
   * @returns 是否已存在
   */
  private hasExistingToggle(input: HTMLInputElement): boolean {
    let ancestor: HTMLElement | null = input.parentElement;
    let depth = 0;
    const maxDepth = 3;

    while (ancestor && depth < maxDepth) {
      depth++;

      // 检查祖先的所有子元素（排除 input 自身和我们注入的元素）
      const children = ancestor.querySelectorAll<HTMLElement>('button, [role="button"], span, div, a, i, svg');
      for (const child of Array.from(children)) {
        // 跳过我们自己注入的元素
        if (child.classList.contains('aph-pwd-toggle-btn') || child.classList.contains('aph-pwd-toggle-wrapper')) {
          continue;
        }
        // 跳过密码输入框自身
        if (child === input) continue;

        if (this.isToggleElement(child)) return true;
      }

      ancestor = ancestor.parentElement;
    }

    return false;
  }

  /**
   * 判断单个元素是否是密码切换按钮
   * @param el - 待检查的元素
   * @returns 是否为切换按钮
   */
  private isToggleElement(el: HTMLElement): boolean {
    // 规则 1: aria-label / title 包含关键词
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const textToCheck = `${ariaLabel} ${title}`;
    if (EXISTING_TOGGLE_KEYWORDS.ariaTitle.some(kw => textToCheck.includes(kw))) {
      return true;
    }

    // 规则 2: class / id 包含关键词
    const className = (el.className?.toString?.() || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const classIdText = `${className} ${id}`;
    if (EXISTING_TOGGLE_KEYWORDS.classId.some(kw => classIdText.includes(kw))) {
      return true;
    }

    // 规则 3: data-* 属性名或值包含关键词
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('data-')) continue;
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.toLowerCase();
      const attrText = `${attrName} ${attrValue}`;
      if (EXISTING_TOGGLE_KEYWORDS.dataAttr.some(kw => attrText.includes(kw))) {
        return true;
      }
    }

    // 规则 4: role="button" 且内含眼睛 SVG
    if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON') {
      const svg = el.querySelector('svg');
      if (svg) {
        const paths = svg.querySelectorAll('path');
        for (const path of Array.from(paths)) {
          const d = path.getAttribute('d') || '';
          // 眼睛图标 SVG path 特征检测（包含典型的圆弧和曲线）
          if (
            (d.includes('12s4') && d.includes('circle')) ||
            (d.includes('M1 12') && d.includes('11 8')) ||
            d.includes('17.94') ||
            d.includes('M9.9')
          ) {
            return true;
          }
        }
        // 检查是否有 circle（眼睛瞳孔）
        if (svg.querySelector('circle')) {
          return true;
        }
      }
    }

    return false;
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
    // 遍历所有已记录的条目，恢复原始 DOM
    // 由于 WeakMap 不可遍历，改为查询所有注入的 wrapper
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
