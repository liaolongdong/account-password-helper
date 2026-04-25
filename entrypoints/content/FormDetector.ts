import {
  Message,
  MessageType,
  FloatingButtonConfig,
  FillPasswordData,
  FillResult,
  FillStrategy,
  PingResponse,
} from '../../utils/types';
import { StorageUtils } from '../../utils/storage';
import { logger } from '../../utils/logger';
import {
  USERNAME_SELECTORS,
  MOBILE_SELECTORS,
  VERIFY_CODE_SELECTORS,
  LOGIN_BUTTON_KEYWORDS,
  LOGIN_BUTTON_SELECTORS,
  LOGIN_CONTAINER_KEYWORDS,
  POPUP_KEYWORDS,
  MOBILE_KEYWORDS,
  MUTATION_LOGIN_KEYWORDS,
  CHECKBOX_POSITIVE_KEYWORDS,
  CHECKBOX_NEGATIVE_KEYWORDS,
} from './formSelectors';

/**
 * 表单检测器
 * 负责检测页面中的登录表单字段，自动显示侧边栏，以及填充密码
 */
export class FormDetector {
  private passwordFields: HTMLInputElement[] = [];
  private usernameFields: HTMLInputElement[] = [];
  private mobileFields: HTMLInputElement[] = [];
  private verifyCodeFields: HTMLInputElement[] = [];
  private checkboxFields: HTMLInputElement[] = [];
  private loginButtons: HTMLElement[] = [];
  private observer: MutationObserver;
  /** 设置长延迟时间 */
  private longDelayTime = 3000;
  /** 设置短延迟时间 */
  private shortDelayTime = 500;
  /** 字段类型缓存，使用WeakMap避免内存泄漏 */
  private fieldTypeCache = new WeakMap<HTMLInputElement, 'password' | 'username' | 'mobile' | 'verifyCode' | null>();
  /** 字段集合，使用Set提高查找效率 */
  private passwordFieldsSet = new WeakSet<HTMLInputElement>();
  private usernameFieldsSet = new WeakSet<HTMLInputElement>();
  private mobileFieldsSet = new WeakSet<HTMLInputElement>();
  private verifyCodeFieldsSet = new WeakSet<HTMLInputElement>();
  /** 缓存 isInLoginFormOrPopup 的检查结果，使用WeakMap避免内存泄漏 */
  private loginFormCheckCache = new WeakMap<HTMLInputElement, boolean>();
  /** 悬浮按钮配置 */
  private floatingButtonConfig: FloatingButtonConfig;
  /** 存储变化监听器 */
  private storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;

  constructor() {
    // 初始化默认配置
    this.floatingButtonConfig = StorageUtils.getDefaultFloatingButtonConfig();
    // 加载配置并初始化
    this.loadConfig();
    this.init();
    this.observer = this.createMutationObserver();
    this.addPageVisibilityListener();
    this.addPageNavigationListener();
    // 使用事件委托，只添加一个全局监听器
    this.setupEventDelegation();
    // 监听配置变化
    this.setupStorageListener();
  }

  /**
   * 加载悬浮按钮配置
   */
  private async loadConfig(): Promise<void> {
    try {
      this.floatingButtonConfig = await StorageUtils.getFloatingButtonConfig();
    } catch (error) {
      logger.error('FormDetector: 加载配置失败:', error);
    }
  }

  /**
   * 设置存储变化监听器
   */
  private setupStorageListener(): void {
    this.storageListener = changes => {
      if (changes.floating_button_config) {
        const newConfig = changes.floating_button_config.newValue as FloatingButtonConfig;
        if (newConfig) {
          this.floatingButtonConfig = newConfig;
        }
      }
    };
    chrome.storage.onChanged.addListener(this.storageListener);
  }

  private init() {
    // 页面加载完成后检测表单
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.detectForms(), this.longDelayTime);
      });
    } else {
      setTimeout(() => this.detectForms(), this.shortDelayTime);
    }

    // 监听消息
    chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持消息通道开放
    });
  }

  private createMutationObserver(): MutationObserver {
    const observer = new MutationObserver(mutations => {
      let shouldRedetect = false;

      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          const element = mutation.target as HTMLElement;
          const textContent = element.textContent || element.innerText || '';
          if (textContent.includes('密码登录') || textContent.includes('验证码登录') || textContent.includes('密码')) {
            shouldRedetect = true;
            return;
          }

          if (MUTATION_LOGIN_KEYWORDS.some(keyword => textContent.includes(keyword))) {
            shouldRedetect = true;
            return;
          }
        }
        // todo: 这里的检测不准确
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (
              element.querySelector &&
              (element.querySelector('input[type="password"]') ||
                element.querySelector('input[type="email"]') ||
                element.querySelector('input[type="text"]') ||
                element.querySelector('input[type="tel"]') ||
                element.querySelector('input[type="number"]'))
            ) {
              shouldRedetect = true;
            }

            const loginButtonSelectors = ['button', 'input[type="submit"]', 'input[type="button"]', '[role="button"]'];
            for (const selector of loginButtonSelectors) {
              if (element.querySelector && element.querySelector(selector)) {
                const button = element.querySelector(selector) as HTMLElement;
                if (button) {
                  const textContent = button.textContent || button.innerText || '';
                  if (MUTATION_LOGIN_KEYWORDS.some(keyword => textContent.includes(keyword))) {
                    shouldRedetect = true;
                    break;
                  }
                }
              }
            }
          }
        });
      });

      if (shouldRedetect) {
        setTimeout(() => this.detectForms(), this.shortDelayTime);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'placeholder'],
    });

    return observer;
  }

  private detectForms() {
    // 清空之前的检测结果
    this.passwordFields = [];
    this.usernameFields = [];
    this.mobileFields = [];
    this.verifyCodeFields = [];
    this.checkboxFields = [];
    this.loginButtons = [];
    this.passwordFieldsSet = new WeakSet();
    this.usernameFieldsSet = new WeakSet();
    this.mobileFieldsSet = new WeakSet();
    this.verifyCodeFieldsSet = new WeakSet();
    this.loginFormCheckCache = new WeakMap();

    // 检测登录按钮
    this.detectLoginButtons();

    // 检测密码字段
    const passwordInputs = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
    this.passwordFields = Array.from(passwordInputs).filter(input => {
      if (this.isVisible(input)) {
        this.passwordFieldsSet.add(input);
        this.fieldTypeCache.set(input, 'password');
        return true;
      }
      return false;
    });

    // 检测用户名字段
    USERNAME_SELECTORS.forEach(selector => {
      const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
      Array.from(inputs).forEach(input => {
        if (this.isVisible(input) && !this.usernameFieldsSet.has(input)) {
          this.usernameFields.push(input);
          this.usernameFieldsSet.add(input);
          this.fieldTypeCache.set(input, 'username');
        }
      });
    });

    // 检测手机号码字段
    MOBILE_SELECTORS.forEach(selector => {
      const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
      Array.from(inputs).forEach(input => {
        if (this.isVisible(input) && !this.mobileFieldsSet.has(input) && !this.usernameFieldsSet.has(input)) {
          this.mobileFields.push(input);
          this.mobileFieldsSet.add(input);
          this.fieldTypeCache.set(input, 'mobile');
        }
      });
    });

    // 检测验证码字段
    VERIFY_CODE_SELECTORS.forEach(selector => {
      const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
      Array.from(inputs).forEach(input => {
        if (
          this.isVisible(input) &&
          !this.verifyCodeFieldsSet.has(input) &&
          !this.usernameFieldsSet.has(input) &&
          !this.mobileFieldsSet.has(input)
        ) {
          this.verifyCodeFields.push(input);
          this.verifyCodeFieldsSet.add(input);
          this.fieldTypeCache.set(input, 'verifyCode');
        }
      });
    });

    // 检测复选框
    const checkboxInputs = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    this.checkboxFields = Array.from(checkboxInputs).filter(input => {
      const style = window.getComputedStyle(input);
      return (
        input.disabled === false &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        input.offsetParent !== null
      );
    });
  }

  /**
   * 显示没有检测到登录表单的提示
   */
  private showNoLoginFormMessage() {
    if ((window as any).ElementPlus && (window as any).ElementPlus.ElMessage) {
      (window as any).ElementPlus.ElMessage.warning('当前页面未匹配到登录表单');
    } else {
      this.showNativeNotification('当前页面未匹配到登录表单', 'warning');
    }
  }

  /**
   * 显示原生通知（模拟Element Plus ElMessage样式）
   */
  private showNativeNotification(message: string, type: 'success' | 'warning' | 'info' | 'error' = 'warning') {
    const existingNotification = document.querySelector('.el-message') as HTMLElement;
    if (existingNotification) {
      existingNotification.remove();
    }

    const notification = document.createElement('div');

    let bgColor = '#edf2fc';
    let borderColor = '#b3c1db';
    let textColor = '#909399';

    switch (type) {
      case 'success':
        bgColor = '#f0f9ec';
        borderColor = '#b2d3a3';
        textColor = '#67c23a';
        break;
      case 'warning':
        bgColor = '#fdf6ec';
        borderColor = '#f0c78a';
        textColor = '#e6a23c';
        break;
      case 'error':
        bgColor = '#fef0f0';
        borderColor = '#f3b4b4';
        textColor = '#f56c6c';
        break;
      case 'info':
        bgColor = '#edf2fc';
        borderColor = '#b3c1db';
        textColor = '#909399';
        break;
    }

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${bgColor};
      border: 1px solid ${borderColor};
      color: ${textColor};
      padding: 12px 16px;
      border-radius: 4px;
      box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
      z-index: 2147483647;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 300px;
      word-wrap: break-word;
      display: flex;
      align-items: center;
      min-height: 40px;
    `;

    const icon = document.createElement('span');
    icon.innerHTML = this.getMessageIcon(type);
    icon.style.marginRight = '8px';

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    notification.appendChild(icon);
    notification.appendChild(textSpan);

    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  private getMessageIcon(type: 'success' | 'warning' | 'info' | 'error'): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'warning':
        return '!';
      case 'info':
        return 'ℹ';
      case 'error':
        return '✗';
      default:
        return 'ℹ';
    }
  }

  private isVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.offsetWidth > 0 &&
      element.offsetHeight > 0
    );
  }

  private setupEventDelegation() {
    document.addEventListener('click', this.handleDelegatedClick, { capture: true });
  }

  private handleDelegatedClick = (event: MouseEvent) => {
    const target = event.target;
    if (!target || !(target instanceof HTMLElement) || target.tagName !== 'INPUT') {
      return;
    }

    const input = target as HTMLInputElement;
    if (this.shouldShowSidePanel(input)) {
      if (!this.floatingButtonConfig.autoShowSidepanel) {
        return;
      }
      this.showSidePanel();
    }
  };

  private getFieldType(field: HTMLInputElement): 'password' | 'username' | 'mobile' | 'verifyCode' | null {
    const cachedType = this.fieldTypeCache.get(field);
    if (cachedType !== undefined) {
      return cachedType;
    }

    if (this.isLikelyMobileInput(field)) {
      this.fieldTypeCache.set(field, 'mobile');
      return 'mobile';
    }

    if (this.passwordFieldsSet.has(field)) {
      this.fieldTypeCache.set(field, 'password');
      return 'password';
    }
    if (this.usernameFieldsSet.has(field)) {
      this.fieldTypeCache.set(field, 'username');
      return 'username';
    }
    if (this.mobileFieldsSet.has(field)) {
      this.fieldTypeCache.set(field, 'mobile');
      return 'mobile';
    }
    if (this.verifyCodeFieldsSet.has(field)) {
      this.fieldTypeCache.set(field, 'verifyCode');
      return 'verifyCode';
    }

    this.fieldTypeCache.set(field, null);
    return null;
  }

  private shouldShowSidePanel(input: HTMLInputElement): boolean {
    const fieldType = this.getFieldType(input);
    if (!fieldType) {
      return false;
    }

    if (!this.isInLoginFormOrPopup(input)) {
      return false;
    }

    // 情况1: 账号 + 密码组合
    if (fieldType === 'username' || fieldType === 'password') {
      const hasPasswordFields = this.passwordFields.length > 0;
      const hasUsernameFields = this.usernameFields.length > 0;

      if (hasPasswordFields && hasUsernameFields) {
        return true;
      }

      if (hasPasswordFields && fieldType === 'username') {
        return true;
      }

      if (hasUsernameFields && fieldType === 'password') {
        return true;
      }

      // 用户名字段可能是手机号（用于手机号+验证码登录场景）
      const hasVerifyCodeFields = this.verifyCodeFields.length > 0;
      const hasPasswordFieldsInUsername = this.passwordFields.length > 0;
      if (fieldType === 'username' && hasVerifyCodeFields && !hasPasswordFieldsInUsername) {
        if (this.isLikelyMobileInput(input)) {
          return true;
        }
      }
    }

    // 情况2: 手机号 + 短信验证码组合
    if (fieldType === 'mobile' || fieldType === 'verifyCode') {
      const hasMobileFields = this.mobileFields.length > 0;
      const hasVerifyCodeFields = this.verifyCodeFields.length > 0;
      const hasPasswordFields = this.passwordFields.length > 0;
      const hasUsernameFields = this.usernameFields.length > 0;

      if (hasMobileFields && hasVerifyCodeFields) {
        return true;
      }

      if (hasUsernameFields && hasVerifyCodeFields && !hasPasswordFields) {
        switch (fieldType) {
          case 'mobile':
            if (this.isLikelyMobileInput(input)) {
              return true;
            }
            break;
          case 'verifyCode':
            return true;
        }
      }

      if (hasMobileFields && fieldType === 'verifyCode') {
        return true;
      }

      if (hasVerifyCodeFields && fieldType === 'mobile') {
        return true;
      }

      if (hasUsernameFields && hasVerifyCodeFields && fieldType === 'verifyCode') {
        return true;
      }
    }

    return false;
  }

  private isLikelyMobileInput(input: HTMLInputElement): boolean {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const type = input.type.toLowerCase();
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();

    const textToCheck = `${name} ${id} ${placeholder} ${ariaLabel} ${autocomplete}`;

    if (type === 'tel') {
      return true;
    }

    if (autocomplete.includes('tel') || autocomplete.includes('phone') || autocomplete.includes('mobile')) {
      return true;
    }

    return MOBILE_KEYWORDS.some(keyword => textToCheck.includes(keyword));
  }

  private isInLoginFormOrPopup(input: HTMLInputElement): boolean {
    const cachedResult = this.loginFormCheckCache.get(input);
    if (cachedResult !== undefined) {
      return cachedResult;
    }

    const hasLoginFields =
      (this.passwordFields.length > 0 && this.usernameFields.length > 0) ||
      (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0);

    if (hasLoginFields) {
      const form = input.closest('form');
      if (form) {
        this.loginFormCheckCache.set(input, true);
        return true;
      }
    }

    let parent: HTMLElement | null = input.parentElement;
    let depth = 0;
    const maxDepth = 12;

    while (parent && depth < maxDepth) {
      depth++;

      if (parent.tagName === 'FORM') {
        const hasSubmitButton =
          parent.querySelector('button[type="submit"]') !== null ||
          parent.querySelector('input[type="submit"]') !== null;

        const hasLoginButton = this.hasLoginButtonInForm(parent);

        if (hasSubmitButton || hasLoginButton) {
          const formText = parent.textContent?.toLowerCase() || '';
          const hasLoginText =
            formText.includes('登录') ||
            formText.includes('登陆') ||
            formText.includes('sign in') ||
            formText.includes('login');

          if (hasLoginText || hasSubmitButton || hasLoginButton) {
            this.loginFormCheckCache.set(input, true);
            return true;
          }
        }
      }

      const id = parent.id?.toLowerCase() || '';
      const className = parent.className?.toLowerCase() || '';
      const role = parent.getAttribute('role')?.toLowerCase() || '';
      const ariaLabel = parent.getAttribute('aria-label')?.toLowerCase() || '';

      const hasLoginKeyword = LOGIN_CONTAINER_KEYWORDS.some(
        keyword => id.includes(keyword) || className.includes(keyword) || ariaLabel.includes(keyword),
      );
      const hasPopupKeyword = POPUP_KEYWORDS.some(
        keyword => id.includes(keyword) || className.includes(keyword) || role.includes(keyword),
      );

      if (hasLoginKeyword) {
        this.loginFormCheckCache.set(input, true);
        return true;
      }

      if (hasPopupKeyword) {
        if (this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent)) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }
      }

      const style = window.getComputedStyle(parent);
      if (style.position === 'fixed' || style.position === 'absolute') {
        if (hasPopupKeyword || this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent)) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }
      }

      if (role === 'dialog' || role === 'alertdialog') {
        if (this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent)) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }
      }

      parent = parent.parentElement;
    }

    if (hasLoginFields || this.hasLoginButtons()) {
      this.loginFormCheckCache.set(input, true);
      return true;
    }

    this.loginFormCheckCache.set(input, false);
    return false;
  }

  private hasLoginFieldsNearby(element: HTMLElement): boolean {
    const hasPassword = element.querySelector('input[type="password"]') !== null;
    const hasVerifyCode =
      element.querySelector('input[placeholder*="验证码"]') !== null ||
      element.querySelector('input[name*="code"]') !== null ||
      element.querySelector('input[id*="code"]') !== null;

    const text = element.textContent?.toLowerCase() || '';
    const hasLoginText =
      text.includes('登录') ||
      text.includes('登陆') ||
      text.includes('sign in') ||
      text.includes('login') ||
      text.includes('密码') ||
      text.includes('password') ||
      text.includes('验证码') ||
      text.includes('验证');

    return hasPassword || hasVerifyCode || hasLoginText;
  }

  private hasLoginButtonInForm(form: Element): boolean {
    for (const button of this.loginButtons) {
      if (form.contains(button)) {
        return true;
      }
    }
    return false;
  }

  private hasLoginButtonNearby(element: HTMLElement): boolean {
    for (const button of this.loginButtons) {
      if (element.contains(button)) {
        return true;
      }
    }

    const text = element.textContent?.toLowerCase() || '';
    return (
      text.includes('登录') ||
      text.includes('登陆') ||
      text.includes('sign in') ||
      text.includes('login') ||
      text.includes('密码') ||
      text.includes('password') ||
      text.includes('验证码') ||
      text.includes('验证')
    );
  }

  private async showSidePanel() {
    try {
      if (!chrome.runtime?.id) {
        logger.warn('扩展上下文已失效，无法显示侧边栏');
        return;
      }

      await chrome.runtime.sendMessage({
        type: MessageType.SHOW_SIDEPANEL,
      });
    } catch (error) {
      const errorMsg = (error as Error).message || '';
      if (errorMsg.includes('Extension context invalidated')) {
        logger.warn('扩展上下文已失效，请刷新页面');
      } else {
        logger.error('显示侧边栏失败:', error);
      }
    }
  }

  private async hideSidePanel() {
    try {
      if (!chrome.runtime?.id) {
        return;
      }

      await chrome.runtime.sendMessage({
        type: MessageType.HIDE_SIDEPANEL,
      });
    } catch (error) {
      const errorMsg = (error as Error).message || '';
      if (errorMsg.includes('Extension context invalidated')) {
        logger.warn('扩展上下文已失效，请刷新页面');
      } else {
        logger.error('隐藏侧边栏失败:', error);
      }
    }
  }

  public hasLoginFormFields(): boolean {
    return (
      (this.usernameFields.length > 0 && this.passwordFields.length > 0) ||
      (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0)
    );
  }

  private detectLoginButtons() {
    this.loginButtons = [];

    LOGIN_BUTTON_SELECTORS.forEach(selector => {
      const buttons = document.querySelectorAll(selector);
      buttons.forEach(button => {
        if (button instanceof HTMLElement) {
          const buttonText = (button.textContent || button.innerText || '').trim().toLowerCase();
          const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
          const title = (button.getAttribute('title') || '').toLowerCase();
          const value = (button.getAttribute('value') || '').toLowerCase();

          const hasLoginKeyword = LOGIN_BUTTON_KEYWORDS.some(
            keyword =>
              buttonText.includes(keyword.toLowerCase()) ||
              ariaLabel.includes(keyword.toLowerCase()) ||
              title.includes(keyword.toLowerCase()) ||
              value.includes(keyword.toLowerCase()),
          );

          if (hasLoginKeyword && this.isVisible(button)) {
            if (!this.loginButtons.includes(button)) {
              this.loginButtons.push(button);
            }
          }
        }
      });
    });
  }

  public hasLoginButtons(): boolean {
    return this.loginButtons.length > 0;
  }

  private addPageVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hideSidePanel();
      }
    });
  }

  private addPageNavigationListener() {
    window.addEventListener('beforeunload', () => {
      this.hideSidePanel();
    });

    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        this.notifyUrlChange();
        lastUrl = url;
      }
    }).observe(document, { subtree: true, childList: true });

    window.addEventListener('popstate', () => {
      this.notifyUrlChange();
    });
  }

  private async notifyUrlChange() {
    try {
      if (!chrome.runtime?.id) {
        return;
      }

      await chrome.runtime.sendMessage({
        type: MessageType.URL_CHANGED,
        data: { url: location.href },
      });
    } catch (error) {
      const errorMsg = (error as Error).message || '';
      if (errorMsg.includes('Extension context invalidated')) {
        logger.warn('扩展上下文已失效，请刷新页面');
      } else {
        logger.error('发送URL变化通知失败:', error);
      }
    }
  }

  private handleMessage(message: any, _sender: any, sendResponse: Function) {
    switch (message.type) {
      case MessageType.PING: {
        const pingResponse: PingResponse = {
          success: true,
          ready: true,
          fieldsDetected: {
            username: this.usernameFields.length,
            password: this.passwordFields.length,
            mobile: this.mobileFields.length,
            verifyCode: this.verifyCodeFields.length,
          },
        };
        sendResponse(pingResponse);
        break;
      }
      case MessageType.FILL_PASSWORD:
        this.fillPasswordWithResult(message.data).then(result => {
          sendResponse(result);
        });
        return true;
      case MessageType.FILL_MOBILE_CODE:
        this.fillMobileCode(message.data);
        sendResponse({ success: true, message: '填充完成' });
        break;
      case MessageType.SHOW_SIDEPANEL:
        if (!this.hasLoginFormFields()) {
          this.showNoLoginFormMessage();
          sendResponse({ success: false, message: '当前页面未匹配到登录表单' });
        } else {
          this.showSidePanel();
          sendResponse({ success: true, message: '侧边栏显示请求已处理' });
        }
        break;
      case MessageType.HIDE_SIDEPANEL:
        this.hideSidePanel();
        sendResponse({ success: true, message: '侧边栏隐藏请求已处理' });
        break;
      default:
        sendResponse({ success: false, message: '未知消息类型' });
        break;
    }
  }

  private async waitForFieldsDetected(maxRetries: number = 10): Promise<boolean> {
    let delay = 100;
    const maxDelay = 2000;

    for (let i = 0; i < maxRetries; i++) {
      this.detectForms();

      if (this.usernameFields.length > 0 || this.passwordFields.length > 0) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
    }

    return false;
  }

  private async fillPasswordWithResult(data: FillPasswordData): Promise<FillResult> {
    const result: FillResult = {
      success: false,
      message: '',
      details: {
        usernameField: { found: false, filled: false, verified: false },
        passwordField: { found: false, filled: false, verified: false },
        strategy: 'native',
      },
    };

    try {
      if (this.usernameFields.length === 0 && this.passwordFields.length === 0) {
        const detected = await this.waitForFieldsDetected();
        if (!detected) {
          result.message = '未检测到登录表单字段，请刷新页面后重试';
          return result;
        }
      }

      // 填充用户名
      if (data.username) {
        if (this.usernameFields.length > 0) {
          result.details.usernameField.found = true;
          const usernameField = this.usernameFields[0];
          const fillResult = await this.setInputValueWithStrategies(usernameField, data.username);
          result.details.usernameField.filled = fillResult.filled;
          result.details.usernameField.verified = fillResult.verified;
          result.details.strategy = fillResult.strategy;
        }
      }

      // 填充密码
      if (data.password) {
        if (this.passwordFields.length > 0) {
          result.details.passwordField.found = true;
          const passwordField = this.passwordFields[0];
          const fillResult = await this.setInputValueWithStrategies(passwordField, data.password);
          result.details.passwordField.filled = fillResult.filled;
          result.details.passwordField.verified = fillResult.verified;
          if (fillResult.strategy !== 'native') {
            result.details.strategy = fillResult.strategy;
          }
        }
      }

      this.autoCheckNearestCheckbox();

      const usernameSuccess = !data.username || result.details.usernameField.verified;
      const passwordSuccess = !data.password || result.details.passwordField.verified;

      if (usernameSuccess && passwordSuccess) {
        result.success = true;
        result.message = '填充成功';
      } else if (result.details.usernameField.filled || result.details.passwordField.filled) {
        result.success = true;
        result.message = '填充完成，请检查表单内容';
      } else {
        result.message = '填充可能未完成，请手动检查表单';
      }

      setTimeout(() => {
        this.hideSidePanel();
      }, 300);
    } catch (error) {
      logger.error('填充密码失败:', error);
      result.message = '填充过程中发生错误';
    }

    return result;
  }

  private async setInputValueWithStrategies(
    input: HTMLInputElement,
    value: string,
  ): Promise<{ filled: boolean; verified: boolean; strategy: FillStrategy }> {
    // 策略1: 原生setter + 完整事件序列
    this.setInputValueNative(input, value);
    await this.delay(50);
    if (input.value === value) {
      return { filled: true, verified: true, strategy: 'native' };
    }

    // 策略2: execCommand模拟用户输入
    this.setInputValueExecCommand(input, value);
    await this.delay(50);
    if (input.value === value) {
      return { filled: true, verified: true, strategy: 'execCommand' };
    }

    // 策略3: 模拟逐字符输入
    await this.setInputValueSimulate(input, value);
    await this.delay(50);
    if (input.value === value) {
      return { filled: true, verified: true, strategy: 'simulate' };
    }

    const filled = input.value.length > 0;
    return { filled, verified: input.value === value, strategy: 'native' };
  }

  private setInputValueNative(input: HTMLInputElement, value: string): void {
    try {
      input.focus();
      input.select();
      document.execCommand('selectAll');
      document.execCommand('delete');

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
      } else {
        input.value = value;
      }

      const events = [
        new Event('focus', { bubbles: true }),
        new Event('input', { bubbles: true, cancelable: true }),
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: 'insertText',
        }),
        new Event('change', { bubbles: true, cancelable: true }),
      ];

      events.forEach(event => {
        try {
          input.dispatchEvent(event);
        } catch (_e) {
          // 事件分发失败，忽略
        }
      });

      setTimeout(() => {
        try {
          input.blur();
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch (_e) {
          // blur事件失败，忽略
        }
      }, 100);
    } catch (error) {
      logger.error('原生策略填充失败:', error);
      input.value = value;
    }
  }

  private setInputValueExecCommand(input: HTMLInputElement, value: string): void {
    try {
      input.focus();
      input.select();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_error) {
      // execCommand策略失败，忽略
    }
  }

  private async setInputValueSimulate(input: HTMLInputElement, value: string): Promise<void> {
    try {
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      for (const char of value) {
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }));
        input.value += char;
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, cancelable: true, data: char, inputType: 'insertText' }),
        );
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
        await this.delay(10);
      }

      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_error) {
      // 模拟输入策略失败，忽略
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private fillMobileCode(data: { mobile: string; code: string }) {
    try {
      if (data.mobile && this.mobileFields.length > 0) {
        this.setInputValueNative(this.mobileFields[0], data.mobile);
      }

      if (data.mobile && this.mobileFields.length === 0 && this.usernameFields.length > 0) {
        this.setInputValueNative(this.usernameFields[0], data.mobile);
      }

      this.autoCheckNearestCheckbox();

      setTimeout(() => {
        this.hideSidePanel();
      }, 300);
    } catch (error) {
      logger.error('填充手机号+验证码失败:', error);
    }
  }

  private autoCheckNearestCheckbox() {
    if (this.checkboxFields.length === 0) {
      return;
    }

    const referenceField =
      this.passwordFields.length > 0
        ? this.passwordFields[0]
        : this.usernameFields.length > 0
          ? this.usernameFields[0]
          : null;

    if (!referenceField) {
      return;
    }

    const targetCheckbox = this.findBestCheckbox(referenceField);

    if (targetCheckbox && !targetCheckbox.checked) {
      this.checkCheckbox(targetCheckbox);
    }
  }

  private findBestCheckbox(referenceField: HTMLInputElement): HTMLInputElement | null {
    let bestCheckbox: HTMLInputElement | null = null;
    let bestScore = -1;

    this.checkboxFields.forEach(checkbox => {
      const score = this.calculateCheckboxScore(referenceField, checkbox);
      if (score > bestScore) {
        bestScore = score;
        bestCheckbox = checkbox;
      }
    });

    return bestCheckbox;
  }

  private calculateCheckboxScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
    let score = 0;

    const distance = this.calculateAccurateDistance(referenceField, checkbox);
    const maxDistance = 2000;
    const distanceScore = Math.max(0, (maxDistance - distance) / maxDistance) * 100;
    score += distanceScore;

    const labelText = this.getCheckboxLabel(checkbox).toLowerCase();

    let keywordScore = 0;
    CHECKBOX_POSITIVE_KEYWORDS.forEach(keyword => {
      if (labelText.includes(keyword)) {
        keywordScore += 50;
      }
    });
    CHECKBOX_NEGATIVE_KEYWORDS.forEach(keyword => {
      if (labelText.includes(keyword)) {
        keywordScore -= 30;
      }
    });
    score += keywordScore;

    score += this.calculatePositionScore(referenceField, checkbox);

    const refForm = referenceField.closest('form');
    const checkboxForm = checkbox.closest('form');
    if (refForm && checkboxForm && refForm === checkboxForm) {
      score += 30;
    }

    score += this.calculateHierarchyScore(referenceField, checkbox);

    return score;
  }

  private calculateAccurateDistance(elem1: HTMLElement, elem2: HTMLElement): number {
    const rect1 = elem1.getBoundingClientRect();
    const rect2 = elem2.getBoundingClientRect();

    let dx = 0;
    let dy = 0;

    if (rect1.right < rect2.left) {
      dx = rect2.left - rect1.right;
    } else if (rect2.right < rect1.left) {
      dx = rect1.left - rect2.right;
    }

    if (rect1.bottom < rect2.top) {
      dy = rect2.top - rect1.bottom;
    } else if (rect2.bottom < rect1.top) {
      dy = rect1.top - rect2.bottom;
    }

    return Math.sqrt(dx * dx + dy * dy);
  }

  private calculatePositionScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
    const refRect = referenceField.getBoundingClientRect();
    const checkboxRect = checkbox.getBoundingClientRect();
    let score = 0;

    if (checkboxRect.top > refRect.bottom) {
      const verticalDistance = checkboxRect.top - refRect.bottom;
      if (verticalDistance < 100) {
        score += 40;
      } else if (verticalDistance < 200) {
        score += 20;
      }
    }

    const horizontalOverlap = Math.min(refRect.right, checkboxRect.right) - Math.max(refRect.left, checkboxRect.left);
    if (horizontalOverlap > 0) {
      score += 15;
    }

    return score;
  }

  private calculateHierarchyScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
    let score = 0;
    const commonAncestor = this.findCommonAncestor(referenceField, checkbox);
    if (commonAncestor) {
      const refDepth = this.getDepthFromAncestor(referenceField, commonAncestor);
      const checkboxDepth = this.getDepthFromAncestor(checkbox, commonAncestor);
      const totalDepth = refDepth + checkboxDepth;
      if (totalDepth <= 4) {
        score += 25;
      } else if (totalDepth <= 8) {
        score += 15;
      } else if (totalDepth <= 12) {
        score += 5;
      }
    }
    return score;
  }

  private findCommonAncestor(elem1: HTMLElement, elem2: HTMLElement): HTMLElement | null {
    const ancestors1: HTMLElement[] = [];
    let current = elem1.parentElement;
    while (current) {
      ancestors1.push(current);
      current = current.parentElement;
    }

    current = elem2.parentElement;
    while (current) {
      if (ancestors1.includes(current)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  private getDepthFromAncestor(elem: HTMLElement, ancestor: HTMLElement): number {
    let depth = 0;
    let current = elem.parentElement;
    while (current && current !== ancestor) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  private getCheckboxLabel(checkbox: HTMLInputElement): string {
    if (checkbox.id) {
      const label = document.querySelector(`label[for="${checkbox.id}"]`);
      if (label) {
        return label.textContent?.trim() || '';
      }
    }

    const parentLabel = checkbox.closest('label');
    if (parentLabel) {
      return parentLabel.textContent?.trim() || '';
    }

    const nextSibling = checkbox.nextElementSibling;
    if (nextSibling) {
      const text = nextSibling.textContent?.trim();
      if (text) return text;
    }

    const prevSibling = checkbox.previousElementSibling;
    if (prevSibling) {
      const text = prevSibling.textContent?.trim();
      if (text) return text;
    }

    const parent = checkbox.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true) as HTMLElement;
      const checkboxClone = clone.querySelector('input[type="checkbox"]');
      if (checkboxClone) {
        checkboxClone.remove();
      }
      const text = clone.textContent?.trim();
      if (text) return text;
    }

    return checkbox.name || checkbox.id || checkbox.className || '未知复选框';
  }

  private checkCheckbox(checkbox: HTMLInputElement) {
    try {
      if (checkbox.disabled) {
        return;
      }

      checkbox.click();

      setTimeout(() => {
        if (!checkbox.checked) {
          checkbox.checked = true;

          const events = [
            new Event('change', { bubbles: true, cancelable: true }),
            new Event('input', { bubbles: true, cancelable: true }),
            new MouseEvent('click', { bubbles: true, cancelable: true }),
            new Event('focus', { bubbles: true }),
            new Event('blur', { bubbles: true }),
          ];

          events.forEach(event => {
            try {
              checkbox.dispatchEvent(event);
            } catch (_e) {
              // 触发事件失败，忽略
            }
          });

          setTimeout(() => {
            if (!checkbox.checked) {
              const label = this.findCheckboxLabel(checkbox);
              if (label) {
                label.click();
                setTimeout(() => {
                  if (!checkbox.checked) {
                    this.simulateUserInteraction(checkbox);
                  }
                }, 100);
              } else {
                this.simulateUserInteraction(checkbox);
              }
            }
          }, 100);
        }
      }, 100);
    } catch (error) {
      logger.error('勾选复选框失败:', error);
    }
  }

  private findCheckboxLabel(checkbox: HTMLInputElement): HTMLElement | null {
    if (checkbox.id) {
      const label = document.querySelector(`label[for="${checkbox.id}"]`);
      if (label) {
        return label as HTMLElement;
      }
    }

    const parentLabel = checkbox.closest('label');
    if (parentLabel) {
      return parentLabel;
    }

    const container = checkbox.parentElement;
    if (container) {
      const containerLabels = container.querySelectorAll('label');
      if (containerLabels.length === 1) {
        return containerLabels[0] as HTMLElement;
      }
    }

    return null;
  }

  private simulateUserInteraction(checkbox: HTMLInputElement) {
    try {
      const rect = checkbox.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const mouseEvents = [
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, button: 0 }),
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, button: 0 }),
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, button: 0 }),
      ];

      const originalValue = checkbox.checked;
      checkbox.checked = !originalValue;

      mouseEvents.forEach(event => {
        checkbox.dispatchEvent(event);
      });

      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      logger.error('模拟交互失败:', error);
    }
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    document.removeEventListener('click', this.handleDelegatedClick, { capture: true });
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }
  }
}
