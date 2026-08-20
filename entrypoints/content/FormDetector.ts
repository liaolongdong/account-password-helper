import {
  type RuntimeMessage,
  MessageType,
  FloatingButtonConfig,
  FillPasswordData,
  FillResult,
  PingResponse,
  PendingTotpData,
} from '@/utils/types';
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
import { isElementVisible } from './domUtils';
import { tl } from '@/utils/i18n-lite';
import {
  getInlineFillDropdown,
  destroyInlineFillDropdown,
} from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import {
  getTotpHandoffCapsule,
  destroyTotpHandoffCapsule,
} from '@/entrypoints/content/inlineDropdown/TotpHandoffCapsule';
import { preWarmServiceWorker } from '@/utils/preWarmSw';

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
  /** runtime 消息监听器引用（保存以便 destroy 时精确移除，避免上下文失效后残留触发 chrome API） */
  private messageListener:
    | ((
        message: RuntimeMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean)
    | null = null;
  /** 上一次记录的页面 URL（SPA 场景下用于检测路由变化） */
  private lastUrl: string = location.href;
  /** DOM 变化检测的 debounce 计时器（可取消） */
  private detectionTimer: ReturnType<typeof setTimeout> | null = null;

  /** 输入填充器 */
  private inputFiller = new InputFiller();
  /** 复选框处理器 */
  private checkboxHandler = new CheckboxHandler();
  /** 登录表单分析器 */
  private loginFormAnalyzer = new LoginFormAnalyzer();
  /** 密码显示/隐藏切换管理器 */
  private passwordVisibilityToggle = new PasswordVisibilityToggle();
  /** 内联填充下拉（fillMode==='inline' 时使用） */
  private inlineDropdown = getInlineFillDropdown();

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
      // 预置内联下拉主题（缓存于其实例），避免其在每次获焦时读取 storage
      this.inlineDropdown.setTheme(this.floatingButtonConfig.theme);
      // 预置两步接力胶囊主题（实例创建无 DOM 副作用，Shadow 惰性构建）
      getTotpHandoffCapsule().setTheme(this.floatingButtonConfig.theme);
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
        this.passwordVisibilityToggle.setTheme(config.theme);
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
        const rawConfig = changes.floating_button_config.newValue as Partial<FloatingButtonConfig> | undefined;
        if (rawConfig) {
          // 合并默认值兜底：升级钩子 freezeLegacyFillDefaults 可能写入部分对象，
          // 直接整体替换会令 visible/theme 等未覆盖字段变为 undefined
          const newConfig: FloatingButtonConfig = {
            ...StorageUtils.getDefaultFloatingButtonConfig(),
            ...rawConfig,
          };
          this.floatingButtonConfig = newConfig;
          // 同步密码切换功能开关
          this.passwordVisibilityToggle.setEnabled(newConfig.passwordVisibilityToggle);
          // 同步主题，实现注入按钮实时换肤
          this.passwordVisibilityToggle.setTheme(newConfig.theme);
          // 同步内联下拉主题，实现图标/面板实时换肤
          this.inlineDropdown.setTheme(newConfig.theme);
          // 同步两步接力胶囊主题
          getTotpHandoffCapsule().setTheme(newConfig.theme);
        }
      }
    };
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.storageListener);
    }
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

    // 监听消息（保存监听器引用，destroy 时移除，避免上下文失效后监听器残留触发 chrome API）
    this.messageListener = (message, sender, sendResponse) => {
      // 仅对已处理的消息保持通道开放，未处理的消息传递给 background
      return this.handleMessage(message, sender, sendResponse);
    };
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.messageListener);
    }
  }

  /**
   * 创建 MutationObserver 监听 DOM 变化，检测动态加载的登录表单
   * @returns MutationObserver 实例
   */
  private createMutationObserver(): MutationObserver {
    const observer = new MutationObserver(mutations => {
      // SPA 路由变化检测：合并至主观察器，避免额外的 MutationObserver 开销
      const currentUrl = location.href;
      if (currentUrl !== this.lastUrl) {
        this.lastUrl = currentUrl;
        this.notifyUrlChange();
      }

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
        // 检测新增的登录相关输入框和按钮，触发重新检测
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (
              element.querySelector &&
              (element.querySelector('input[type="password"]') ||
                element.querySelector('input[type="email"]') ||
                element.querySelector('input[type="tel"]') ||
                element.querySelector('input[type="number"]') ||
                // 动态渲染的验证码/手机号文本输入框
                element.querySelector('input[type="text"]'))
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
        // 使用可取消的 debounce，避免连续 DOM 变化导致重复检测
        if (this.detectionTimer) clearTimeout(this.detectionTimer);
        this.detectionTimer = setTimeout(() => {
          this.detectionTimer = null;
          this.detectForms();
        }, this.shortDelayTime);
      }
    });

    // allFrames 注入时部分 iframe（about:blank / srcdoc 空文档）document.body 为 null，
    // 此时无 DOM 可观察，跳过 observe 避免抛出 TypeError
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'placeholder'],
      });
    }

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
    // 清除字段类型缓存，避免重检测时使用过期的分类结果
    this.fieldTypeCache = new WeakMap();
    this.loginFormAnalyzer.clearCache();

    // 检测登录按钮
    this.detectLoginButtons();

    // 检测密码字段
    const passwordInputs = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
    this.passwordFields = Array.from(passwordInputs).filter(input => {
      if (isElementVisible(input)) {
        this.passwordFieldsSet.add(input);
        this.fieldTypeCache.set(input, 'password');
        return true;
      }
      return false;
    });

    // 检测用户名字段（合并选择器为单次 DOM 查询，减少重排开销）
    const usernameInputs = document.querySelectorAll(USERNAME_SELECTORS.join(',')) as NodeListOf<HTMLInputElement>;
    Array.from(usernameInputs).forEach(input => {
      if (isElementVisible(input) && !this.usernameFieldsSet.has(input)) {
        this.usernameFields.push(input);
        this.usernameFieldsSet.add(input);
        this.fieldTypeCache.set(input, 'username');
      }
    });

    // 检测手机号码字段（排除已归类为用户名的字段）
    const mobileInputs = document.querySelectorAll(MOBILE_SELECTORS.join(',')) as NodeListOf<HTMLInputElement>;
    Array.from(mobileInputs).forEach(input => {
      if (isElementVisible(input) && !this.mobileFieldsSet.has(input) && !this.usernameFieldsSet.has(input)) {
        this.mobileFields.push(input);
        this.mobileFieldsSet.add(input);
        this.fieldTypeCache.set(input, 'mobile');
      }
    });

    // 检测验证码字段（排除已归类为用户名和手机号的字段）
    const verifyCodeInputs = document.querySelectorAll(VERIFY_CODE_SELECTORS.join(',')) as NodeListOf<HTMLInputElement>;
    Array.from(verifyCodeInputs).forEach(input => {
      if (
        isElementVisible(input) &&
        !this.verifyCodeFieldsSet.has(input) &&
        !this.usernameFieldsSet.has(input) &&
        !this.mobileFieldsSet.has(input)
      ) {
        this.verifyCodeFields.push(input);
        this.verifyCodeFieldsSet.add(input);
        this.fieldTypeCache.set(input, 'verifyCode');
      }
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

    // 两步接力：纯验证码页查询待接力标记并锚定活码胶囊
    this.maybeTriggerTotpHandoff();
  }

  /**
   * 两步接力触发：纯验证码页（仅有验证码输入框、无账号/密码/手机号字段）
   * 查询 SW 中的待接力标记，命中则锚定活码胶囊。
   * 覆盖 GitHub 式「账密页 → 跳转 → 验证码页」两阶段登录场景。
   */
  private async maybeTriggerTotpHandoff(): Promise<void> {
    if (this.verifyCodeFields.length === 0) {
      return;
    }
    // 页面同时存在账号/密码/手机号字段时由既有内联面板接管，避免重复打扰；
    // 仅统计在视口内的可见字段：视口外残留字段（如隐藏的自动填充蜜罐）
    // 不应阻断接力（GitHub /session 等验证码页可能存在不可见的残留输入框）
    const blockingField = [this.usernameFields, this.passwordFields, this.mobileFields]
      .flat()
      .find(f => f.isConnected && isElementVisible(f) && this.isInViewport(f));
    if (blockingField) {
      return;
    }
    const field = this.verifyCodeFields.find(f => f.isConnected && isElementVisible(f) && this.isInViewport(f));
    if (!field) {
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.GET_PENDING_TOTP });
      const entryId = (res?.data as PendingTotpData | undefined)?.entryId;
      if (!entryId) {
        logger.debug('两步接力：验证码页未命中待接力标记（未记录/已过期/域名失配）');
        return;
      }
      getTotpHandoffCapsule().show(field, entryId);
    } catch (error) {
      logger.debug('FormDetector: 两步接力查询待接力标记失败（扩展上下文可能失效）:', error);
    }
  }

  /**
   * 判定元素是否位于当前视口内（有尺寸且与视口相交）
   * @param el 目标元素
   * @returns 是否在视口内
   */
  private isInViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
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

      if (!isElementVisible(input)) {
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
   * 设置全局点击事件委托，监听输入框点击
   */
  private setupEventDelegation(): void {
    document.addEventListener('click', this.handleDelegatedClick, { capture: true });
    // 内联模式下，输入框获焦即弹出快速填充下拉
    document.addEventListener('focusin', this.handleDelegatedFocusIn, { capture: true });
  }

  /**
   * 处理委托的聚焦事件：内联模式下为登录字段显示钥匙触发图标
   */
  private handleDelegatedFocusIn = (event: FocusEvent): void => {
    if (this.floatingButtonConfig.fillMode !== 'inline') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const input = target instanceof HTMLInputElement ? target : target.closest('input');
    if (!input) return;
    if (this.shouldShowSidePanel(input)) {
      this.inlineDropdown.showTriggerFor(input, {
        hasEyeToggle: input.type === 'password' && this.floatingButtonConfig.passwordVisibilityToggle,
      });
    }
  };

  /**
   * 处理委托的点击事件，判断是否需要显示侧边栏
   */
  private handleDelegatedClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!target || !(target instanceof HTMLElement)) {
      return;
    }

    // 兜底：用户可能点击了输入框的装饰元素（图标前缀/后缀），通过 closest 查找最近的 INPUT
    const input = target instanceof HTMLInputElement ? target : target.closest('input');
    if (!input) {
      return;
    }
    if (this.shouldShowSidePanel(input)) {
      // 内联模式：不自动打开侧边栏，改为显示钥匙触发图标（点击图标展开面板）
      if (this.floatingButtonConfig.fillMode === 'inline') {
        this.inlineDropdown.showTriggerFor(input, {
          hasEyeToggle: input.type === 'password' && this.floatingButtonConfig.passwordVisibilityToggle,
        });
        return;
      }
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

    // 情况3: 单字段手机号登录（分步登录、手机号+验证码但验证码尚未渲染等场景）
    // 当手机号输入框被 isLikelyMobileInput 识别，且页面存在登录按钮时，允许触发侧边栏
    if (this.isLikelyMobileInput(input) && this.loginButtons.length > 0) {
      return true;
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

      // 点击即预热：与悬浮按钮/popup/快捷键保持一致，
      // 确保 SW 密码缓存在发送 SHOW_SIDEPANEL 前被唤醒
      preWarmServiceWorker();
      // clickTs=发起时刻，覆盖「点击 → SW 唤醒」埋点盲区
      await chrome.runtime.sendMessage({
        type: MessageType.SHOW_SIDEPANEL,
        data: { clickTs: Date.now() },
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

          if (hasLoginKeyword && isElementVisible(button)) {
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
   * 监听页面导航事件（beforeunload、popstate）
   * URL 变化检测已合并至主 MutationObserver，此处仅保留 popstate 以捕获浏览器前进/后退
   */
  private addPageNavigationListener(): void {
    window.addEventListener('beforeunload', () => {
      this.hideSidePanel();
    });

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
    message: RuntimeMessage,
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
        this.fillPasswordWithResult(message.data).then(result => {
          sendResponse(result);
        });
        return true;
      case MessageType.FILL_MOBILE_CODE:
        this.fillMobileCode(message.data);
        sendResponse({ success: true, message: tl('cs.fd.fillDone') });
        return true;
      case MessageType.FILL_TOTP:
        this.fillTotpCode(message.data.code).then(result => {
          sendResponse(result);
        });
        return true;
      case MessageType.SHOW_SIDEPANEL:
        if (!this.hasLoginFormFields()) {
          showNoLoginFormMessage();
          sendResponse({ success: false, message: tl('cs.notify.noLoginForm'), reason: 'no_form' });
        } else {
          this.showSidePanel();
          sendResponse({ success: true, message: tl('cs.fd.sidepanelShown') });
        }
        return true;
      case MessageType.HIDE_SIDEPANEL:
        this.hideSidePanel();
        sendResponse({ success: true, message: tl('cs.fd.sidepanelHidden') });
        return true;
      case MessageType.OPEN_INLINE_DROPDOWN: {
        const handled = this.openInlineDropdown(message.data?.focusedOnly === true);
        sendResponse({ success: handled, handled });
        return true;
      }
      default:
        return false; // 不响应，让消息传递给 background 处理
    }
  }

  /**
   * 快捷键 / Popup 触发：定位登录字段并直接展开内联下拉面板（与点击钥匙图标一致）
   *
   * 目标字段选取：优先当前聚焦的登录字段；focusedOnly 为 false 时回退到页面已检测的
   * 首个可见登录字段（用户名 → 手机号 → 密码），复用 shouldShowSidePanel 的同一套
   * 字段组合判定，保证快捷键触发范围与钥匙图标展示范围一致。
   *
   * @param focusedOnly 是否仅允许锚定当前聚焦的登录字段（background 两轮委派的第一轮）
   * @returns 本 frame 是否已定位到登录字段并展开面板
   */
  private openInlineDropdown(focusedOnly: boolean): boolean {
    const target = this.resolveInlineDropdownTarget(focusedOnly);
    if (!target) return false;
    this.inlineDropdown.openPanelFor(target);
    return true;
  }

  /**
   * 解析内联下拉的锚定输入框
   * @param focusedOnly 是否仅允许锚定当前聚焦的登录字段
   * @returns 目标输入框或 null
   */
  private resolveInlineDropdownTarget(focusedOnly: boolean): HTMLInputElement | null {
    // 优先：当前聚焦元素是本 frame 内的登录字段
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && this.shouldShowSidePanel(active)) {
      return active;
    }
    if (focusedOnly) return null;

    // 回退：同步重检测（覆盖 SPA 动态渲染后检测结果过期的场景）后，
    // 取首个仍在文档中且可见、并通过字段组合判定的登录字段
    this.detectForms();
    const candidates = [...this.usernameFields, ...this.mobileFields, ...this.passwordFields];
    return (
      candidates.find(input => input.isConnected && isElementVisible(input) && this.shouldShowSidePanel(input)) ?? null
    );
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
   * 失焦当前处于编辑态的输入框
   *
   * 快捷键填充时用户往往正聚焦在登录输入框上：聚焦编辑态下站点脚本可能回写/
   * 清空程序化填充的值，Chrome 原生密码下拉也会展开遮挡。填充前主动失焦可
   * 复现"失焦后填充成功"的稳定条件（填充策略内部会重新 focus 目标字段）。
   *
   * @returns 是否实际执行了失焦操作
   */
  private blurActiveInput(): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement) {
      try {
        active.blur();
        return true;
      } catch {
        // 忽略 blur 异常
      }
    }
    return false;
  }

  /**
   * 等待 DOM 进入静默期（无新增变更持续 quietMs），上限 budgetMs
   *
   * 事件驱动替代固定延时：blur 可能触发 SPA 重渲染（浮动标签/受控组件重建），
   * 重渲染落地时刻不可预测（慢机器上可能远超固定窗口），固定 sleep 会拿到
   * 即将被替换的旧节点。稳定页面仅需 quietMs 即返回，确有重渲染时按需等待。
   *
   * @param quietMs - 判定静默的无变更持续时长（毫秒），默认 50
   * @param budgetMs - 最长等待上限（毫秒），默认 300
   */
  private waitForDomStable(quietMs = 50, budgetMs = 300): Promise<void> {
    // allFrames 注入时部分 iframe（about:blank / srcdoc 空文档）document.body 为 null，
    // 无 DOM 可观察，视为已稳定，直接 resolve
    if (!document.body) return Promise.resolve();
    return new Promise(resolve => {
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (): void => {
        observer.disconnect();
        if (quietTimer) clearTimeout(quietTimer);
        clearTimeout(budgetTimer);
        resolve();
      };
      const observer = new MutationObserver(() => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });
      const budgetTimer = setTimeout(finish, budgetMs);
      observer.observe(document.body, { childList: true, subtree: true });
      // 无变更则 quietMs 后即结束（稳定页面快路径）
      quietTimer = setTimeout(finish, quietMs);
    });
  }

  /**
   * 从字段列表中选取首个仍在文档中且可见的可填充字段
   *
   * SPA 页面在输入框聚焦/失焦时可能重渲染表单节点，使缓存引用变为已分离的
   * 旧节点，与 resolveInlineDropdownTarget 的校验策略保持一致。
   *
   * @param fields - 候选字段列表
   * @returns 可填充字段，无有效字段时返回 null
   */
  private findFillableField(fields: HTMLInputElement[]): HTMLInputElement | null {
    return fields.find(input => input.isConnected && isElementVisible(input)) ?? null;
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
      // 聚焦态防护：与打开内联面板一致（InlineFillDropdown），先失焦当前编辑中的
      // 输入框——关闭 Chrome 原生密码下拉并退出站点的聚焦编辑态，避免站点脚本在
      // 聚焦态下回写/清空非可信 input 事件填充的值（快捷键填充“聚焦不生效、失焦
      // 才生效”的根因之一），并事件驱动等待失焦触发的重渲染落地后再重检测
      if (this.blurActiveInput()) {
        await this.waitForDomStable();
      }

      // 同步重检测（与 resolveInlineDropdownTarget 一致）：输入框获焦可能触发 SPA
      // 重渲染（浮动标签/受控组件重建），使缓存字段引用脱离文档，直接填充旧节点
      // 会导致可见输入框保持空白
      this.detectForms();

      if (this.usernameFields.length === 0 && this.passwordFields.length === 0) {
        const detected = await this.waitForFieldsDetected();
        if (!detected) {
          result.message = tl('cs.fd.noFormFields');
          result.reason = 'no_form';
          return result;
        }
      }

      // 填充用户名（仅选取仍在文档中且可见的字段，避免写入已分离的过期节点）
      if (data.username) {
        const usernameField = this.findFillableField(this.usernameFields);
        if (usernameField) {
          result.details.usernameField.found = true;
          const fillResult = await this.inputFiller.setInputValueWithStrategies(usernameField, data.username);
          result.details.usernameField.filled = fillResult.filled;
          result.details.usernameField.verified = fillResult.verified;
          result.details.strategy = fillResult.strategy;
        }
      }

      // 填充密码（仅选取仍在文档中且可见的字段，避免写入已分离的过期节点）
      if (data.password) {
        const passwordField = this.findFillableField(this.passwordFields);
        if (passwordField) {
          result.details.passwordField.found = true;
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
        result.message = tl('cs.fd.fillSuccess');
      } else if (result.details.usernameField.filled || result.details.passwordField.filled) {
        result.success = true;
        result.message = tl('cs.fd.fillCheck');
      } else {
        result.message = tl('cs.fd.fillIncomplete');
      }

      // 按配置自动触发登录（仅账号密码场景，且密码字段已实际填充）
      // 当 autoLogin 为 true 时强制触发登录
      if (result.success && result.details.passwordField.filled) {
        if (data.autoLogin || this.floatingButtonConfig.autoTriggerLogin) {
          setTimeout(() => {
            this.triggerLogin();
          }, 150);
        }
      }

      // 仅在填充成功时自动关闭侧边栏；失败场景保留侧边栏以便用户查看提示
      if (result.success) {
        setTimeout(() => {
          this.hideSidePanel();
        }, 300);
      }
    } catch (error) {
      logger.error('填充密码失败:', error);
      result.message = tl('cs.fd.fillError');
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
      const candidateButton = this.loginButtons.find(btn => isElementVisible(btn));
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
   * 填充 TOTP 两步验证码到页面检测到的验证码输入框
   *
   * 复用已有的 verifyCodeFields 检测（含 `input[autocomplete="one-time-code"]`），
   * 仅在用户显式触发时填入，不介入现有账号密码自动填充流程。
   * @param code 本地计算得到的动态验证码
   * @returns 填充结果
   */
  private async fillTotpCode(code: string): Promise<FillResult> {
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
      // 验证码输入框常在二步验证页面动态渲染，未检测到时先重新检测一次
      if (this.verifyCodeFields.length === 0) {
        this.detectForms();
      }
      if (this.verifyCodeFields.length === 0) {
        result.message = tl('cs.fd.noTotpInput');
        return result;
      }

      const field = this.verifyCodeFields[0];
      const fillResult = await this.inputFiller.setInputValueWithStrategies(field, code);
      result.success = fillResult.filled;
      result.details.strategy = fillResult.strategy;
      result.message = fillResult.filled ? tl('cs.fd.totpFillSuccess') : tl('cs.fd.totpFillManual');

      if (result.success) {
        setTimeout(() => {
          this.hideSidePanel();
        }, 300);
      }
    } catch (error) {
      logger.error('填充 TOTP 验证码失败:', error);
      result.message = tl('cs.fd.totpFillError');
    }

    return result;
  }

  /**
   * 销毁实例，清理所有监听器
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
      this.detectionTimer = null;
    }
    document.removeEventListener('click', this.handleDelegatedClick, { capture: true });
    document.removeEventListener('focusin', this.handleDelegatedFocusIn, { capture: true });
    if (this.storageListener) {
      try {
        chrome.storage.onChanged.removeListener(this.storageListener);
      } catch {
        // 上下文失效时 removeListener 可能抛错，监听器已被 Chrome 自动清理，忽略
      }
      this.storageListener = null;
    }
    if (this.messageListener) {
      try {
        chrome.runtime.onMessage.removeListener(this.messageListener);
      } catch {
        // 同上，忽略上下文失效导致的移除异常
      }
      this.messageListener = null;
    }
    this.passwordVisibilityToggle.destroy();
    destroyInlineFillDropdown();
    destroyTotpHandoffCapsule();
  }
}
