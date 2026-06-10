import { Message, MessageType, FloatingButtonConfig, FillPasswordData, FillResult, PingResponse } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import {
  USERNAME_SELECTORS,
  MOBILE_SELECTORS,
  VERIFY_CODE_SELECTORS,
  LOGIN_BUTTON_KEYWORDS,
  LOGIN_BUTTON_SELECTORS,
  MUTATION_LOGIN_KEYWORDS,
  MOBILE_KEYWORDS,
  normalizeButtonText,
  shouldExcludeButton,
} from '@/entrypoints/content/formSelectors';
import { InputFiller } from '@/entrypoints/content/InputFiller';
import { CheckboxHandler } from '@/entrypoints/content/CheckboxHandler';
import { LoginFormAnalyzer } from '@/entrypoints/content/LoginFormAnalyzer';
import type { FormFieldSets } from '@/entrypoints/content/types';
import { showNoLoginFormMessage } from '@/entrypoints/content/NativeNotification';
import { PasswordVisibilityToggle } from '@/entrypoints/content/PasswordVisibilityToggle';

/**
 * 表单检测器
 * 负责检测页面中的登录表单字段，自动显示侧边栏，以及填充密码。
 * 作为主编排器，组合 InputFiller、CheckboxHandler、LoginFormAnalyzer 等模块。
 */
export class FormDetector {
  /** 检测到的密码输入框列表 */
  private passwordFields: HTMLInputElement[] = [];
  /** 检测到的用户名输入框列表 */
  private usernameFields: HTMLInputElement[] = [];
  /** 检测到的手机号输入框列表 */
  private mobileFields: HTMLInputElement[] = [];
  /** 检测到的验证码输入框列表 */
  private verifyCodeFields: HTMLInputElement[] = [];
  /** 检测到的复选框列表 */
  private checkboxFields: HTMLInputElement[] = [];
  /** 检测到的登录按钮列表 */
  private loginButtons: HTMLElement[] = [];
  /** DOM 变化观察器 */
  private observer: MutationObserver;
  /** 长延迟时间（毫秒） */
  private longDelayTime = 3000;
  /** 短延迟时间（毫秒） */
  private shortDelayTime = 500;
  /** 字段类型缓存，使用 WeakMap 避免内存泄漏 */
  private fieldTypeCache = new WeakMap<HTMLInputElement, 'password' | 'username' | 'mobile' | 'verifyCode' | null>();
  /** 字段集合，使用 WeakSet 提高查找效率 */
  private passwordFieldsSet = new WeakSet<HTMLInputElement>();
  private usernameFieldsSet = new WeakSet<HTMLInputElement>();
  private mobileFieldsSet = new WeakSet<HTMLInputElement>();
  private verifyCodeFieldsSet = new WeakSet<HTMLInputElement>();
  /** 悬浮按钮配置 */
  private floatingButtonConfig: FloatingButtonConfig;
  /** 存储变化监听器 */
  private storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;

  /** 输入填充器 */
  private inputFiller = new InputFiller();
  /** 复选框处理器 */
  private checkboxHandler = new CheckboxHandler();
  /** 登录表单分析器 */
  private loginFormAnalyzer = new LoginFormAnalyzer();
  /** 密码显示/隐藏切换管理器 */
  private passwordVisibilityToggle = new PasswordVisibilityToggle();

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
    // 初始化密码显示/隐藏切换功能
    this.initPasswordVisibilityToggle();
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
   * 初始化密码显示/隐藏切换功能
   * 根据配置决定是否启用
   */
  private async initPasswordVisibilityToggle(): Promise<void> {
    try {
      const config = await StorageUtils.getFloatingButtonConfig();
      if (config.passwordVisibilityToggle) {
        this.passwordVisibilityToggle.init();
      }
    } catch (error) {
      logger.error('FormDetector: 初始化密码切换功能失败:', error);
    }
  }

  /**
   * 设置存储变化监听器，当配置变更时自动更新
   */
  private setupStorageListener(): void {
    this.storageListener = changes => {
      if (changes.floating_button_config) {
        const newConfig = changes.floating_button_config.newValue as FloatingButtonConfig;
        if (newConfig) {
          this.floatingButtonConfig = newConfig;
          // 同步密码切换功能开关
          this.passwordVisibilityToggle.setEnabled(newConfig.passwordVisibilityToggle);
        }
      }
    };
    chrome.storage.onChanged.addListener(this.storageListener);
  }

  /**
   * 初始化表单检测和消息监听
   */
  private init(): void {
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
      const handled = this.handleMessage(message, sender, sendResponse);
      return handled; // 仅对已处理的消息保持通道开放，未处理的消息传递给 background
    });
  }

  /**
   * 创建 MutationObserver 监听 DOM 变化，检测动态加载的登录表单
   * @returns MutationObserver 实例
   */
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
                  const buttonText = button.innerText || button.textContent || '';
                  const normalizedText = normalizeButtonText(buttonText);
                  if (MUTATION_LOGIN_KEYWORDS.some(keyword => normalizedText.includes(normalizeButtonText(keyword)))) {
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

  /**
   * 检测页面中的所有表单字段（密码、用户名、手机号、验证码、复选框、登录按钮）
   */
  private detectForms(): void {
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
    this.loginFormAnalyzer.clearCache();

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

    // 回退策略：密码字段存在但未检测到账号/手机号字段时，
    // 取密码字段前方最近的可见 input 作为账号字段
    if (this.passwordFields.length > 0 && this.usernameFields.length === 0 && this.mobileFields.length === 0) {
      this.detectUsernameByProximity();
    }

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
   * 回退检测：当标准选择器未匹配到账号字段时，
   * 在密码字段前方查找最近的可见文本输入框作为账号字段。
   * 查找策略：先在同一 form/容器中查找，未找到则向上扩展父容器（最多 6 层）。
   */
  private detectUsernameByProximity(): void {
    /** 需要排除的非文本输入类型 */
    const EXCLUDED_TYPES = new Set([
      'password',
      'hidden',
      'submit',
      'button',
      'checkbox',
      'radio',
      'file',
      'image',
      'reset',
      'range',
      'color',
      'date',
      'time',
      'datetime-local',
      'month',
      'week',
    ]);

    for (const passwordField of this.passwordFields) {
      // 优先取密码字段所在的 form，否则取父元素作为起始容器
      let container: HTMLElement | null = passwordField.closest('form') ?? passwordField.parentElement;
      let maxExpand = 6;

      while (container && maxExpand > 0) {
        const candidate = this.findNearestUsernameBefore(container, passwordField, EXCLUDED_TYPES);
        if (candidate) {
          this.usernameFields.push(candidate);
          this.usernameFieldsSet.add(candidate);
          this.fieldTypeCache.set(candidate, 'username');
          logger.info('FormDetector: 通过位置回退检测到账号字段:', candidate);
          return;
        }

        // 向上扩展一层父容器
        container = container.parentElement;
        maxExpand--;
      }
    }
  }

  /**
   * 在指定容器中查找位于 passwordField 之前、距离最近的可见文本输入框
   * @param container - 搜索容器
   * @param passwordField - 密码字段参照点
   * @param excludedTypes - 需排除的 input type 集合
   * @returns 符合条件的账号输入框，未找到返回 null
   */
  private findNearestUsernameBefore(
    container: HTMLElement,
    passwordField: HTMLInputElement,
    excludedTypes: Set<string>,
  ): HTMLInputElement | null {
    const allInputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    let nearestCandidate: HTMLInputElement | null = null;

    for (const input of allInputs) {
      // 遇到密码字段本身即停止（DOM 顺序中在它之前的才有效）
      if (input === passwordField) {
        break;
      }

      const type = (input.type || 'text').toLowerCase();
      if (excludedTypes.has(type)) {
        continue;
      }

      if (!this.isVisible(input)) {
        continue;
      }

      // 排除已被其他分类占用的字段
      if (
        this.passwordFieldsSet.has(input) ||
        this.mobileFieldsSet.has(input) ||
        this.verifyCodeFieldsSet.has(input) ||
        this.usernameFieldsSet.has(input)
      ) {
        continue;
      }

      // 持续更新，最终保留距离密码字段最近的（即最后一个符合条件的）
      nearestCandidate = input;
    }

    return nearestCandidate;
  }

  /**
   * 判断元素是否可见
   * @param element - 要检查的 HTML 元素
   * @returns 元素是否可见
   */
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

  /**
   * 设置全局点击事件委托，监听输入框点击
   */
  private setupEventDelegation(): void {
    document.addEventListener('click', this.handleDelegatedClick, { capture: true });
  }

  /**
   * 处理委托的点击事件，判断是否需要显示侧边栏
   */
  private handleDelegatedClick = (event: MouseEvent): void => {
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

  /**
   * 获取输入框的字段类型（带缓存）
   * @param field - 输入框元素
   * @returns 字段类型或 null
   */
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

  /**
   * 判断是否应该显示侧边栏
   * 根据字段组合判断：账号+密码、手机号+验证码等
   * @param input - 当前点击的输入框
   * @returns 是否应显示侧边栏
   */
  private shouldShowSidePanel(input: HTMLInputElement): boolean {
    const fieldType = this.getFieldType(input);
    if (!fieldType) {
      return false;
    }

    if (!this.loginFormAnalyzer.isInLoginFormOrPopup(input, this.getFormFieldSets())) {
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

  /**
   * 判断输入框是否可能是手机号输入框
   * @param input - 输入框元素
   * @returns 是否可能是手机号输入
   */
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

  /**
   * 获取当前表单字段集合，供 LoginFormAnalyzer 使用
   * @returns 表单字段集合
   */
  private getFormFieldSets(): FormFieldSets {
    return {
      passwordFields: this.passwordFields,
      usernameFields: this.usernameFields,
      mobileFields: this.mobileFields,
      verifyCodeFields: this.verifyCodeFields,
      loginButtons: this.loginButtons,
    };
  }

  /**
   * 发送消息显示侧边栏
   */
  private async showSidePanel(): Promise<void> {
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

  /**
   * 发送消息隐藏侧边栏
   */
  private async hideSidePanel(): Promise<void> {
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

  /**
   * 判断是否检测到登录表单字段
   * @returns 是否存在用户名+密码或手机号+验证码组合
   */
  public hasLoginFormFields(): boolean {
    return (
      (this.usernameFields.length > 0 && this.passwordFields.length > 0) ||
      (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0)
    );
  }

  /**
   * 检测页面中的登录按钮
   */
  private detectLoginButtons(): void {
    this.loginButtons = [];

    LOGIN_BUTTON_SELECTORS.forEach(selector => {
      const buttons = document.querySelectorAll(selector);
      buttons.forEach(button => {
        if (button instanceof HTMLElement) {
          const buttonText = button.innerText || button.textContent || (button as HTMLInputElement).value || '';
          const normalizedText = normalizeButtonText(buttonText);

          const ariaLabel = normalizeButtonText(button.getAttribute('aria-label') || '');
          const title = normalizeButtonText(button.getAttribute('title') || '');
          const value = normalizeButtonText(button.getAttribute('value') || '');

          // 先检查是否应该排除（纯注册按钮）
          if (
            shouldExcludeButton(normalizedText) &&
            !shouldExcludeButton(ariaLabel) &&
            !shouldExcludeButton(title) &&
            !shouldExcludeButton(value)
          ) {
            return;
          }

          const hasLoginKeyword = LOGIN_BUTTON_KEYWORDS.some(keyword => {
            const normalizedKeyword = normalizeButtonText(keyword);
            return (
              normalizedText.includes(normalizedKeyword) ||
              ariaLabel.includes(normalizedKeyword) ||
              title.includes(normalizedKeyword) ||
              value.includes(normalizedKeyword)
            );
          });

          if (hasLoginKeyword && this.isVisible(button)) {
            if (!this.loginButtons.includes(button)) {
              this.loginButtons.push(button);
            }
          }
        }
      });
    });
  }

  /**
   * 判断是否检测到登录按钮
   * @returns 是否存在登录按钮
   */
  public hasLoginButtons(): boolean {
    return this.loginButtons.length > 0;
  }

  /**
   * 监听页面可见性变化，页面隐藏时自动关闭侧边栏
   */
  private addPageVisibilityListener(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hideSidePanel();
      }
    });
  }

  /**
   * 监听页面导航事件（beforeunload、URL 变化、popstate）
   */
  private addPageNavigationListener(): void {
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

  /**
   * 通知 background 页面 URL 发生了变化
   */
  private async notifyUrlChange(): Promise<void> {
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

  /**
   * 处理来自扩展其他部分的消息
   * @param message - 消息对象
   * @param _sender - 发送者信息
   * @param sendResponse - 响应回调
   */
  private handleMessage(
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean {
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
        return true;
      }
      case MessageType.FILL_PASSWORD:
        this.fillPasswordWithResult(message.data as FillPasswordData).then(result => {
          sendResponse(result);
        });
        return true;
      case MessageType.FILL_MOBILE_CODE:
        this.fillMobileCode(message.data as { mobile: string; code: string });
        sendResponse({ success: true, message: '填充完成' });
        return true;
      case MessageType.SHOW_SIDEPANEL:
        if (!this.hasLoginFormFields()) {
          showNoLoginFormMessage();
          sendResponse({ success: false, message: '当前页面未匹配到登录表单' });
        } else {
          this.showSidePanel();
          sendResponse({ success: true, message: '侧边栏显示请求已处理' });
        }
        return true;
      case MessageType.HIDE_SIDEPANEL:
        this.hideSidePanel();
        sendResponse({ success: true, message: '侧边栏隐藏请求已处理' });
        return true;
      default:
        return false; // 不响应，让消息传递给 background 处理
    }
  }

  /**
   * 等待表单字段被检测到（带指数退避重试）
   * @param maxRetries - 最大重试次数，默认 10
   * @returns 是否成功检测到字段
   */
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

  /**
   * 填充密码并返回详细结果
   * @param data - 填充数据（用户名和密码）
   * @returns 填充结果
   */
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
          const fillResult = await this.inputFiller.setInputValueWithStrategies(usernameField, data.username);
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
          const fillResult = await this.inputFiller.setInputValueWithStrategies(passwordField, data.password);
          result.details.passwordField.filled = fillResult.filled;
          result.details.passwordField.verified = fillResult.verified;
          if (fillResult.strategy !== 'native') {
            result.details.strategy = fillResult.strategy;
          }
        }
      }

      this.checkboxHandler.autoCheckNearestCheckbox(this.checkboxFields, this.passwordFields, this.usernameFields);

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

      // 按配置自动触发登录（仅账号密码场景，且密码字段已实际填充）
      if (result.success && result.details.passwordField.filled && this.floatingButtonConfig.autoTriggerLogin) {
        setTimeout(() => {
          this.triggerLogin();
        }, 150);
      }

      // 仅在填充成功时自动关闭侧边栏；失败场景保留侧边栏以便用户查看提示
      if (result.success) {
        setTimeout(() => {
          this.hideSidePanel();
        }, 300);
      }
    } catch (error) {
      logger.error('填充密码失败:', error);
      result.message = '填充过程中发生错误';
    }

    return result;
  }

  /**
   * 按策略触发登录：优先点击已识别的登录按钮，失败则回退到 form 表单提交
   * - 策略 A：点击 `loginButtons` 中第一个可见按钮
   * - 策略 B：找到密码字段所在的 `<form>`，优先 `requestSubmit()`，回退 `submit()`
   * 两种策略均失败时仅记录日志，不抛出，以免影响填充结果
   */
  private triggerLogin(): void {
    try {
      // 策略 A：点击已识别的登录按钮
      const candidateButton = this.loginButtons.find(btn => this.isVisible(btn));
      if (candidateButton) {
        try {
          candidateButton.click();
          return;
        } catch (clickError) {
          logger.warn('FormDetector: 点击登录按钮失败，尝试提交表单:', clickError);
        }
      }

      // 策略 B：提交密码字段所在的 form
      const passwordField = this.passwordFields[0];
      const form = passwordField?.closest('form') as HTMLFormElement | null;
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.submit();
          }
          return;
        } catch (submitError) {
          logger.warn('FormDetector: 提交表单失败:', submitError);
        }
      }

      logger.warn('FormDetector: 未找到可用的登录按钮或表单，跳过自动触发登录');
    } catch (error) {
      logger.warn('FormDetector: 自动触发登录异常:', error);
    }
  }

  /**
   * 填充手机号（验证码需用户手动获取）
   * @param data - 包含手机号和验证码的数据
   */
  private fillMobileCode(data: { mobile: string; code: string }): void {
    try {
      if (data.mobile && this.mobileFields.length > 0) {
        this.inputFiller.setInputValueNative(this.mobileFields[0], data.mobile);
      }

      if (data.mobile && this.mobileFields.length === 0 && this.usernameFields.length > 0) {
        this.inputFiller.setInputValueNative(this.usernameFields[0], data.mobile);
      }

      this.checkboxHandler.autoCheckNearestCheckbox(this.checkboxFields, this.passwordFields, this.usernameFields);

      setTimeout(() => {
        this.hideSidePanel();
      }, 300);
    } catch (error) {
      logger.error('填充手机号+验证码失败:', error);
    }
  }

  /**
   * 销毁实例，清理所有监听器
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    document.removeEventListener('click', this.handleDelegatedClick, { capture: true });
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }
    this.passwordVisibilityToggle.destroy();
  }
}
