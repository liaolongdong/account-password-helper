import { defineContentScript } from 'wxt/sandbox';
import { Message, MessageType } from '../utils/types';
import { getFloatingButtonManager, destroyFloatingButtonManager } from './content/floatingButtons';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('Account Password Helper content script loaded');

    // 防抖工具函数
    function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      return function (this: any, ...args: Parameters<T>) {
        const context = this;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          func.apply(context, args);
        }, wait);
      };
    }

    // 表单检测器
    class FormDetector {
      private passwordFields: HTMLInputElement[] = [];
      private usernameFields: HTMLInputElement[] = [];
      private mobileFields: HTMLInputElement[] = [];
      private verifyCodeFields: HTMLInputElement[] = [];
      private checkboxFields: HTMLInputElement[] = [];
      private loginButtons: HTMLElement[] = [];
      private observer: MutationObserver;
      /** 设置长延迟时间 */
      private longDelayTime = 3000;
      /** 设置中延迟时间 */
      private middleDelayTime = 2000;
      /** 设置短延迟时间 */
      private shortDelayTime = 500;
      /** 用于跟踪侧边栏显示状态 */
      private isSidePanelVisible = false;
      /** 字段类型缓存，使用WeakMap避免内存泄漏 */
      private fieldTypeCache = new WeakMap<
        HTMLInputElement,
        'password' | 'username' | 'mobile' | 'verifyCode' | null
      >();
      /** 字段集合，使用Set提高查找效率 */
      private passwordFieldsSet = new WeakSet<HTMLInputElement>();
      private usernameFieldsSet = new WeakSet<HTMLInputElement>();
      private mobileFieldsSet = new WeakSet<HTMLInputElement>();
      private verifyCodeFieldsSet = new WeakSet<HTMLInputElement>();
      /** 防抖后的显示侧边栏函数 */
      private debouncedShowSidePanel: () => void;
      /** 缓存 isInLoginFormOrPopup 的检查结果，使用WeakMap避免内存泄漏 */
      private loginFormCheckCache = new WeakMap<HTMLInputElement, boolean>();
      /** 记录上次检测到的登录表单类型 */
      private lastDetectedFormType: 'username_password' | 'mobile_verify' | 'none' = 'none';
      /** 记录是否显示了无表单提示 */
      private showedNoFormMessage = false;

      constructor() {
        // 初始化防抖函数，优化延迟时间为150ms以提升响应速度
        this.debouncedShowSidePanel = debounce(() => {
          this.showSidePanel();
        }, 150);
        this.init();
        this.observer = this.createMutationObserver();
        this.addPageVisibilityListener();
        this.addPageNavigationListener();
        // 使用事件委托，只添加一个全局监听器
        this.setupEventDelegation();
      }

      private init() {
        // 页面加载完成后检测表单
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => this.detectForms(), this.longDelayTime); // 延迟检测确保动态内容加载
          });
        } else {
          // 页面已经加载完成
          setTimeout(() => this.detectForms(), this.shortDelayTime);
        }

        // 定时重新检测表单（针对动态加载的表单）
        // setInterval(() => {
        //   this.detectForms();
        // }, this.detectDelayTime); // 每3秒检测一次

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
            // 通过检测点击的元素是否包含密码登录或者验证码登录
            if (mutation.type === 'attributes') {
              const element = mutation.target as HTMLElement;
              const textContent = element.textContent || element.innerText || '';
              if (
                textContent.includes('密码登录') ||
                textContent.includes('验证码登录') ||
                textContent.includes('密码')
              ) {
                shouldRedetect = true;
                return;
              }

              // 检查是否是登录按钮相关的属性变化
              const loginButtonKeywords = ['登录', '登陆', 'sign in', 'login', '登录按钮', '立即登录'];
              if (loginButtonKeywords.some(keyword => textContent.includes(keyword))) {
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

                // 检查新增节点是否包含登录按钮
                const loginButtonSelectors = [
                  'button',
                  'input[type="submit"]',
                  'input[type="button"]',
                  '[role="button"]',
                ];
                for (const selector of loginButtonSelectors) {
                  if (element.querySelector && element.querySelector(selector)) {
                    const button = element.querySelector(selector) as HTMLElement;
                    if (button) {
                      const textContent = button.textContent || button.innerText || '';
                      const loginButtonKeywords = ['登录', '登陆', 'sign in', 'login', '登录按钮', '立即登录'];
                      if (loginButtonKeywords.some(keyword => textContent.includes(keyword))) {
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
        // 清空Set缓存（WeakSet会自动清理，但为了保险起见重置数组）
        this.passwordFieldsSet = new WeakSet();
        this.usernameFieldsSet = new WeakSet();
        this.mobileFieldsSet = new WeakSet();
        this.verifyCodeFieldsSet = new WeakSet();
        // 清空登录表单检查缓存，确保重新检测
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

        // 检测用户名(号)/邮箱/手机号/账号字段
        const usernameSelectors = [
          'input[type="email"]',
          'input[type="tel"]',
          'input[type="text"][name*="user"]',
          'input[type="text"][name*="email"]',
          'input[type="text"][name*="account"]',
          'input[type="text"][name*="login"]',
          'input[type="text"][name*="mobile"]',
          'input[type="text"][name*="phone"]',
          'input[type="text"][id*="email"]',
          'input[type="text"][id*="account"]',
          'input[type="text"][id*="login"]',
          'input[type="text"][id*="user"]',
          'input[type="text"][id*="mobile"]',
          'input[type="text"][id*="phone"]',
          // 新增更多选择器以提高检测准确性
          'input[placeholder*="用户"]', // 匹配用户名和用户号
          'input[placeholder*="邮箱"]',
          'input[placeholder*="手机号"]',
          'input[placeholder*="账号"]',
          'input[placeholder*="user"]', // 匹配用户名和用户号
          'input[placeholder*="email"]',
          'input[placeholder*="mobile"]',
          'input[placeholder*="phone"]',
          'input[placeholder*="account"]',
          // 增强检测规则
          'input[autocomplete="username"]',
          'input[autocomplete="email"]',
          'input[autocomplete="tel"]',
          'input[aria-label*="用户"]',
          'input[aria-label*="邮箱"]',
          'input[aria-label*="账号"]',
          'input[aria-label*="email"]',
          'input[aria-label*="user"]',
          'input[aria-label*="account"]',
          'input[name*="username"]',
          'input[name*="userName"]',
          'input[id*="username"]',
          'input[id*="userName"]',
          // 扩展更多选择器以覆盖更多场景
          'input[name*="user_name"]',
          'input[name*="userName"]',
          'input[name*="userName"]',
          'input[id*="user_name"]',
          'input[id*="userName"]',
          'input[name*="emailAddress"]',
          'input[name*="email_address"]',
          'input[id*="emailAddress"]',
          'input[id*="email_address"]',
          'input[name*="accountName"]',
          'input[name*="account_name"]',
          'input[id*="accountName"]',
          'input[id*="account_name"]',
          'input[name*="loginName"]',
          'input[name*="login_name"]',
          'input[id*="loginName"]',
          'input[id*="login_name"]',
          'input[placeholder*="用户名"]',
          'input[placeholder*="用户号"]',
          'input[placeholder*="邮箱地址"]',
          'input[placeholder*="电子邮箱"]',
          'input[placeholder*="账号名"]',
          'input[placeholder*="登录名"]',
          'input[placeholder*="登录账号"]',
          'input[placeholder*="请输入账号"]',
          'input[placeholder*="请输入用户名"]',
          'input[placeholder*="请输入邮箱"]',
          'input[aria-label*="用户名"]',
          'input[aria-label*="用户号"]',
          'input[aria-label*="邮箱地址"]',
          'input[aria-label*="电子邮箱"]',
          'input[aria-label*="账号名"]',
          'input[aria-label*="登录名"]',
          'input[aria-label*="登录账号"]',
          'input[autocomplete="username email"]',
          'input[autocomplete="email username"]',
          'input[autocomplete="off"][name*="user"]',
          'input[autocomplete="off"][name*="email"]',
          'input[autocomplete="off"][name*="account"]',
          'input[autocomplete="off"][id*="user"]',
          'input[autocomplete="off"][id*="email"]',
          'input[autocomplete="off"][id*="account"]',
        ];

        usernameSelectors.forEach(selector => {
          const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
          Array.from(inputs).forEach(input => {
            if (this.isVisible(input) && !this.usernameFieldsSet.has(input)) {
              this.usernameFields.push(input);
              this.usernameFieldsSet.add(input);
              this.fieldTypeCache.set(input, 'username');
            }
          });
        });

        // 检测手机号码字段 (用户名也包括手机号了)
        const mobileSelectors = [
          'input[type="tel"]',
          'input[type="text"][name*="phone"]',
          'input[type="text"][name*="mobile"]',
          'input[type="text"][id*="phone"]',
          'input[type="text"][id*="mobile"]',
          'input[type="number"][name*="phone"]',
          'input[type="number"][name*="mobile"]',
          // 新增更多选择器
          'input[name*="phoneNumber"]',
          'input[name*="mobilePhone"]',
          'input[id*="phoneNumber"]',
          'input[id*="mobilePhone"]',
          'input[placeholder*="mobile"]',
          'input[placeholder*="phone"]',
          'input[placeholder*="手机号"]',
          // 增强检测规则
          'input[autocomplete="tel"]',
          'input[autocomplete="mobile"]',
          'input[aria-label*="手机"]',
          'input[aria-label*="电话"]',
          'input[aria-label*="mobile"]',
          'input[aria-label*="phone"]',
          // 扩展更多选择器以覆盖更多场景
          'input[name*="phone_number"]',
          'input[name*="mobile_phone"]',
          'input[name*="cellphone"]',
          'input[name*="cell_phone"]',
          'input[id*="phone_number"]',
          'input[id*="mobile_phone"]',
          'input[id*="cellphone"]',
          'input[id*="cell_phone"]',
          'input[placeholder*="手机号码"]',
          'input[placeholder*="联系电话"]',
          'input[placeholder*="电话号码"]',
          'input[placeholder*="请输入手机号"]',
          'input[placeholder*="请输入手机号码"]',
          'input[placeholder*="请输入电话号码"]',
          'input[aria-label*="手机号码"]',
          'input[aria-label*="联系电话"]',
          'input[aria-label*="电话号码"]',
          'input[aria-label*="手机号"]',
          'input[autocomplete="tel-national"]',
          'input[autocomplete="tel-country-code"]',
          'input[autocomplete="tel-area-code"]',
          'input[autocomplete="tel-local"]',
          'input[autocomplete="off"][name*="phone"]',
          'input[autocomplete="off"][name*="mobile"]',
          'input[autocomplete="off"][id*="phone"]',
          'input[autocomplete="off"][id*="mobile"]',
        ];

        mobileSelectors.forEach(selector => {
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
        const verifyCodeSelectors = [
          'input[type="text"][name*="code"]',
          'input[type="text"][name*="captcha"]',
          'input[type="text"][name*="verify"]',
          'input[type="text"][id*="code"]',
          'input[type="text"][id*="verify"]',
          'input[type="number"][name*="code"]',
          // 新增更多选择器
          'input[name*="verifyCode"]',
          'input[name*="authCode"]',
          'input[name*="checkCode"]',
          'input[name*="smsCode"]',
          'input[id*="verifyCode"]',
          'input[id*="authCode"]',
          'input[id*="checkCode"]',
          'input[id*="smsCode"]',
          'input[placeholder*="smsCode"]',
          'input[placeholder*="verifyCode"]',
          'input[placeholder*="短信验证码"]',
          'input[placeholder*="验证码"]',
          // 增强检测规则
          'input[aria-label*="验证码"]',
          'input[aria-label*="code"]',
          'input[aria-label*="verify"]',
          'input[autocomplete="one-time-code"]',
          // 扩展更多选择器以覆盖更多场景
          'input[name*="verify_code"]',
          'input[name*="auth_code"]',
          'input[name*="check_code"]',
          'input[name*="sms_code"]',
          'input[name*="verificationCode"]',
          'input[name*="verification_code"]',
          'input[id*="verify_code"]',
          'input[id*="auth_code"]',
          'input[id*="check_code"]',
          'input[id*="sms_code"]',
          'input[id*="verificationCode"]',
          'input[id*="verification_code"]',
          'input[placeholder*="短信验证码"]',
          'input[placeholder*="请输入验证码"]',
          'input[placeholder*="请输入短信验证码"]',
          'input[placeholder*="验证码"]',
          'input[placeholder*="短信码"]',
          'input[placeholder*="动态码"]',
          'input[placeholder*="安全码"]',
          'input[aria-label*="短信验证码"]',
          'input[aria-label*="请输入验证码"]',
          'input[aria-label*="请输入短信验证码"]',
          'input[aria-label*="验证码"]',
          'input[aria-label*="短信码"]',
          'input[aria-label*="动态码"]',
          'input[aria-label*="安全码"]',
          'input[aria-label*="captcha"]',
          'input[autocomplete="one-time-code"]',
          'input[autocomplete="off"][name*="code"]',
          'input[autocomplete="off"][name*="verify"]',
          'input[autocomplete="off"][id*="code"]',
          'input[autocomplete="off"][id*="verify"]',
        ];

        verifyCodeSelectors.forEach(selector => {
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

        // 检测复选框（包括隐藏的和可见的）
        const checkboxInputs = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
        this.checkboxFields = Array.from(checkboxInputs).filter(input => {
          // 只过滤那些完全不可交互的复选框
          const style = window.getComputedStyle(input);
          const isInteractable =
            input.disabled === false &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            input.offsetParent !== null; // 检查是否在DOM中可见

          // 复选框检测信息

          return isInteractable;
        });

        // 记录本次检测到的表单类型
        let currentFormType: 'username_password' | 'mobile_verify' | 'none' = 'none';

        if (this.usernameFields.length > 0 && this.passwordFields.length > 0) {
          currentFormType = 'username_password';
          console.log('检测到账号/密码组合登录表单');
        } else if (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0) {
          currentFormType = 'mobile_verify';
          console.log('检测到手机号/验证码组合登录表单');
        } else {
          currentFormType = 'none';
          console.log('未检测到登录表单字段');
        }

        // 更新最后检测到的表单类型
        this.lastDetectedFormType = currentFormType;

        // 如果当前检测到了表单，重置无表单提示标记
        if (currentFormType !== 'none') {
          this.showedNoFormMessage = false;
        }
      }

      /**
       * 显示没有检测到登录表单的提示
       */
      private showNoLoginFormMessage() {
        // 检查是否已有ElMessage相关的库可用
        if ((window as any).ElementPlus && (window as any).ElementPlus.ElMessage) {
          (window as any).ElementPlus.ElMessage.warning('当前页面未匹配到登录表单');
        } else {
          // 如果没有ElementPlus，使用原生方式创建类似ElMessage的提示
          this.showNativeNotification('当前页面未匹配到登录表单', 'warning');
        }
      }

      /**
       * 显示原生通知（模拟Element Plus ElMessage样式）
       */
      private showNativeNotification(message: string, type: 'success' | 'warning' | 'info' | 'error' = 'warning') {
        // 避免重复显示相同的通知
        const existingNotification = document.querySelector('.el-message') as HTMLElement;
        if (existingNotification) {
          existingNotification.remove();
        }

        // 创建通知容器
        const notification = document.createElement('div');

        // 根据类型设置样式
        let bgColor = '#edf2fc'; // info 默认背景色
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

        // 添加图标
        const icon = document.createElement('span');
        icon.innerHTML = this.getMessageIcon(type);
        icon.style.marginRight = '8px';

        const textSpan = document.createElement('span');
        textSpan.textContent = message;

        notification.appendChild(icon);
        notification.appendChild(textSpan);

        document.body.appendChild(notification);

        // 3秒后自动移除提示
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 3000);
      }

      /**
       * 获取消息类型对应的图标HTML
       */
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

      /**
       * @description 判断元素是否可见
       * @param element
       * @returns
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
       * 使用事件委托设置全局监听器，替代为每个字段添加多个监听器
       * 这样可以大幅减少内存占用和提高性能
       */
      private setupEventDelegation() {
        // 使用focusin事件委托，捕获所有输入框焦点事件
        document.addEventListener('focusin', this.handleDelegatedFocus, { capture: true });
      }

      /**
       * 事件委托处理焦点事件
       */
      private handleDelegatedFocus = (event: FocusEvent) => {
        const target = event.target;
        if (!target || !(target instanceof HTMLElement) || target.tagName !== 'INPUT') {
          return;
        }

        const input = target as HTMLInputElement;
        // 检查是否是我们识别的字段类型
        if (this.shouldShowSidePanel(input)) {
          // 当满足显示条件时，使用防抖函数显示侧边栏，提升性能
          // 不依赖 isSidePanelVisible 状态，因为用户可能手动关闭了侧边栏
          // 重置状态以确保能正确显示（即使状态不同步）
          this.isSidePanelVisible = false;
          // 使用防抖函数，避免频繁触发，提升性能
          this.debouncedShowSidePanel();
        }
        // 注意：这里不再显示无表单提示，因为提示应该在点击快速填充按钮时才显示
      };

      /**
       * 获取字段类型，使用缓存提高性能
       */
      private getFieldType(field: HTMLInputElement): 'password' | 'username' | 'mobile' | 'verifyCode' | null {
        // 先从缓存中获取
        const cachedType = this.fieldTypeCache.get(field);
        if (cachedType !== undefined) {
          return cachedType;
        }

        // 如果缓存中没有，使用Set快速查找
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

        // 未识别的字段
        this.fieldTypeCache.set(field, null);
        return null;
      }

      /**
       * 判断是否应该显示侧边栏（登录表单页面或者弹窗中出现账号和密码或者手机号和短信验证码组合时，展示侧边栏密码填充功能）
       * 要求：
       * 1. 账号和密码必须同时出现在登录表单界面，账号或者密码输入框获取焦点才自动展示快速填充侧边栏，其中账号检测需要包含用户名、手机号、邮箱、账号关键字
       * 2. 手机号和短信验证码同时出现在登录表单界面，手机号和验证码输入框获取焦点才自动展示快速填充侧边栏
       * 3. 必须是在登录表单界面或者弹窗输入框获取焦点才展示侧边栏
       * 4. 采用更宽松的策略，即使没有检测到完整表单，只要在登录环境中也尝试显示
       */
      private shouldShowSidePanel(input: HTMLInputElement): boolean {
        // 使用缓存的字段类型，提高性能
        const fieldType = this.getFieldType(input);

        // 如果不是我们识别的字段类型，不显示侧边栏
        if (!fieldType) {
          return false;
        }

        // 检查是否在登录表单页面或者弹窗中
        if (!this.isInLoginFormOrPopup(input)) {
          return false;
        }

        // 情况1: 账号 + 密码组合
        // 当焦点在账号字段或密码字段时，且页面同时存在账号和密码字段
        if (fieldType === 'username' || fieldType === 'password') {
          const hasPasswordFields = this.passwordFields.length > 0;
          const hasUsernameFields = this.usernameFields.length > 0;

          if (hasPasswordFields && hasUsernameFields) {
            console.log('检测到账号/密码组合');
            return true;
          }

          // 宽松策略：如果在登录环境下，即使没有检测到完整表单也显示侧边栏
          if (hasPasswordFields && fieldType === 'username') {
            console.log('在登录环境下，账号字段获取焦点，显示侧边栏');
            return true;
          }

          if (hasUsernameFields && fieldType === 'password') {
            console.log('在登录环境下，密码字段获取焦点，显示侧边栏');
            return true;
          }
        }

        // 情况2: 手机号 + 短信验证码组合
        // 当焦点在手机号字段或验证码字段时，且页面同时存在手机号和验证码字段
        if (fieldType === 'mobile' || fieldType === 'verifyCode') {
          const hasMobileFields = this.mobileFields.length > 0;
          const hasVerifyCodeFields = this.verifyCodeFields.length > 0;
          const hasPasswordFields = this.passwordFields.length > 0;
          const hasUsernameFields = this.usernameFields.length > 0;

          // 优先检查专门的手机号字段
          if (hasMobileFields && hasVerifyCodeFields) {
            console.log('检测到手机号/验证码组合');
            return true;
          }

          // 如果用户名字段包含手机号，也支持手机号+验证码组合
          // 需要同时满足：有用户名字段、有验证码字段、没有密码字段（排除账号+密码场景）
          if (hasUsernameFields && hasVerifyCodeFields && !hasPasswordFields) {
            // 进一步检查：根据当前字段类型判断
            switch (fieldType) {
              case 'mobile':
                // 检查手机号字段的特征，判断是否可能是手机号输入
                const isLikelyMobileInput = this.isLikelyMobileInput(input);
                if (isLikelyMobileInput) {
                  console.log('检测到手机号/验证码组合（用户名字段作为手机号）');
                  return true;
                }
                break;
              case 'verifyCode':
                // 如果当前焦点在验证码字段，且页面有用户名字段和验证码字段，但没有密码字段
                // 很可能是手机号+验证码场景
                console.log('检测到手机号/验证码组合（用户名字段作为手机号）');
                return true;
            }
          }

          // 宽松策略：如果在登录环境下，即使没有检测到完整表单也显示侧边栏
          if (hasMobileFields && fieldType === 'verifyCode') {
            console.log('在登录环境下，验证码字段获取焦点，显示侧边栏');
            return true;
          }

          if (hasVerifyCodeFields && fieldType === 'mobile') {
            console.log('在登录环境下，手机号字段获取焦点，显示侧边栏');
            return true;
          }

          // 如果用户名字段作为手机号使用
          if (hasUsernameFields && hasVerifyCodeFields && fieldType === 'verifyCode') {
            console.log('在登录环境下，验证码字段获取焦点（用户名字段作为手机号），显示侧边栏');
            return true;
          }
        }

        return false;
      }

      /**
       * 判断输入框是否可能是手机号输入框
       * 通过检查输入框的特征来判断
       */
      private isLikelyMobileInput(input: HTMLInputElement): boolean {
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        const type = input.type.toLowerCase();
        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();

        // 检查是否包含手机号相关的关键词
        const mobileKeywords = ['phone', 'mobile', 'tel', 'cell', '手机', '电话', '号码'];
        const textToCheck = `${name} ${id} ${placeholder} ${ariaLabel} ${autocomplete}`;

        // 如果类型是tel，很可能是手机号
        if (type === 'tel') {
          return true;
        }

        // 如果autocomplete包含tel相关值
        if (autocomplete.includes('tel') || autocomplete.includes('phone') || autocomplete.includes('mobile')) {
          return true;
        }

        // 检查是否包含手机号关键词
        return mobileKeywords.some(keyword => textToCheck.includes(keyword));
      }

      /**
       * 检查输入框是否在登录表单页面或登录弹窗中
       * 增强检测逻辑，提高场景识别准确性，使用缓存提升性能
       */
      private isInLoginFormOrPopup(input: HTMLInputElement): boolean {
        // 先从缓存中获取结果
        const cachedResult = this.loginFormCheckCache.get(input);
        if (cachedResult !== undefined) {
          return cachedResult;
        }

        // 快速检查：如果页面有登录字段组合，直接返回true（最常见的场景）
        const hasLoginFields =
          (this.passwordFields.length > 0 && this.usernameFields.length > 0) ||
          (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0);

        if (hasLoginFields) {
          // 进一步检查输入框是否在表单中
          const form = input.closest('form');
          if (form) {
            this.loginFormCheckCache.set(input, true);
            return true;
          }
        }

        // 向上查找父元素，看是否包含登录表单特征
        let parent: HTMLElement | null = input.parentElement;
        let depth = 0;
        const maxDepth = 12; // 优化：减少最大深度，提升性能

        // 登录相关的关键词（提前定义，避免重复创建）
        const loginKeywords = ['login', 'signin', 'sign-in', 'auth', 'authentication', '登录', '登陆', '登入'];
        const popupKeywords = ['modal', 'popup', 'dialog', 'drawer', 'overlay', '弹窗', '对话框', '模态'];

        while (parent && depth < maxDepth) {
          depth++;

          // 检查是否是表单元素
          if (parent.tagName === 'FORM') {
            // 增强检查：表单内有提交按钮或登录按钮即可认为可能是登录表单
            const hasSubmitButton =
              parent.querySelector('button[type="submit"]') !== null ||
              parent.querySelector('input[type="submit"]') !== null;

            // 检查表单内是否有登录相关的按钮
            const hasLoginButton = this.hasLoginButtonInForm(parent);

            if (hasSubmitButton || hasLoginButton) {
              // 进一步检查表单文本（仅在必要时）
              const formText = parent.textContent?.toLowerCase() || '';
              const hasLoginText =
                formText.includes('登录') ||
                formText.includes('登陆') ||
                formText.includes('sign in') ||
                formText.includes('login');

              if (hasLoginText || hasSubmitButton || hasLoginButton) {
                this.loginFormCheckCache.set(input, true);
                console.log('输入框在登录表单中');
                return true;
              }
            }
          }

          // 检查是否有登录相关的类名、ID或属性
          const id = parent.id?.toLowerCase() || '';
          const className = parent.className?.toLowerCase() || '';
          const role = parent.getAttribute('role')?.toLowerCase() || '';
          const ariaLabel = parent.getAttribute('aria-label')?.toLowerCase() || '';

          const hasLoginKeyword = loginKeywords.some(
            keyword => id.includes(keyword) || className.includes(keyword) || ariaLabel.includes(keyword),
          );
          const hasPopupKeyword = popupKeywords.some(
            keyword => id.includes(keyword) || className.includes(keyword) || role.includes(keyword),
          );

          if (hasLoginKeyword) {
            this.loginFormCheckCache.set(input, true);
            console.log('输入框在登录相关容器中');
            return true;
          }

          if (hasPopupKeyword) {
            // 仅在必要时检查登录字段
            if (this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent)) {
              this.loginFormCheckCache.set(input, true);
              console.log('输入框在登录相关容器中');
              return true;
            }
          }

          // 检查是否是弹窗或模态框的常见特征
          const style = window.getComputedStyle(parent);
          if (style.position === 'fixed' || style.position === 'absolute') {
            if (hasPopupKeyword || this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent)) {
              this.loginFormCheckCache.set(input, true);
              console.log('输入框在登录弹窗中');
              return true;
            }
          }

          // 检查role属性
          if (role === 'dialog' || role === 'alertdialog') {
            if (this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent)) {
              this.loginFormCheckCache.set(input, true);
              console.log('输入框在对话框中的登录表单');
              return true;
            }
          }

          parent = parent.parentElement;
        }

        // 如果没有找到明确的表单或弹窗特征，但我们识别到了登录字段，仍然认为是在登录场景中
        // 这是一个宽松的检查，确保不会遗漏正常的登录表单(账号和密码或者手机和短信验证码组合)
        if (hasLoginFields || this.hasLoginButtons()) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }

        // 输入框不在登录表单或登录弹窗中
        this.loginFormCheckCache.set(input, false);
        return false;
      }

      /**
       * 检查元素附近是否有登录相关字段
       */
      private hasLoginFieldsNearby(element: HTMLElement): boolean {
        // 检查元素内是否有密码字段或验证码字段
        const hasPassword = element.querySelector('input[type="password"]') !== null;
        const hasVerifyCode =
          element.querySelector('input[placeholder*="验证码"]') !== null ||
          element.querySelector('input[name*="code"]') !== null ||
          element.querySelector('input[id*="code"]') !== null;

        // 检查是否有登录相关的文本
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

      /**
       * 检查表单内是否有登录按钮
       */
      private hasLoginButtonInForm(form: Element): boolean {
        // 检查表单内是否包含检测到的登录按钮
        for (const button of this.loginButtons) {
          if (form.contains(button)) {
            return true;
          }
        }
        return false;
      }

      /**
       * 检查元素附近是否有登录按钮
       */
      private hasLoginButtonNearby(element: HTMLElement): boolean {
        // 检查元素内是否有登录按钮
        for (const button of this.loginButtons) {
          if (element.contains(button)) {
            return true;
          }
        }

        // 检查是否有登录相关的文本
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

        return hasLoginText;
      }

      private async showSidePanel() {
        try {
          // 检查扩展上下文是否有效
          if (!chrome.runtime?.id) {
            console.warn('扩展上下文已失效，无法显示侧边栏');
            this.isSidePanelVisible = false;
            return;
          }

          // 总是尝试显示侧边栏，不依赖 isSidePanelVisible 状态
          // 因为用户可能手动关闭了侧边栏，导致状态不同步
          // Chrome SidePanel API 的 open 方法是幂等的，多次调用不会产生副作用
          const response = await chrome.runtime.sendMessage({
            type: MessageType.SHOW_SIDEPANEL,
          });
          // 侧边栏显示请求已发送，更新状态
          this.isSidePanelVisible = true;
        } catch (error) {
          // 检查是否是扩展上下文失效错误
          const errorMsg = (error as Error).message || '';
          if (errorMsg.includes('Extension context invalidated')) {
            console.warn('扩展上下文已失效，请刷新页面');
          } else {
            console.error('显示侧边栏失败:', error);
          }
          // 显示失败时，重置状态以便下次重试
          this.isSidePanelVisible = false;
        }
      }

      /**
       * 隐藏侧边栏
       */
      private async hideSidePanel() {
        try {
          // 检查扩展上下文是否有效
          if (!chrome.runtime?.id) {
            console.warn('扩展上下文已失效，无法隐藏侧边栏');
            this.isSidePanelVisible = false;
            return;
          }

          // 总是尝试隐藏侧边栏，不依赖 isSidePanelVisible 状态
          // 因为填充完成后需要确保侧边栏被隐藏
          // 通知background script隐藏侧边栏
          await chrome.runtime.sendMessage({
            type: MessageType.HIDE_SIDEPANEL,
          });
          // 侧边栏隐藏请求已发送
          this.isSidePanelVisible = false;
        } catch (error) {
          // 检查是否是扩展上下文失效错误
          const errorMsg = (error as Error).message || '';
          if (errorMsg.includes('Extension context invalidated')) {
            console.warn('扩展上下文已失效，请刷新页面');
          } else {
            console.error('隐藏侧边栏失败:', error);
          }
          // 隐藏失败时，重置状态以便下次重试
          this.isSidePanelVisible = false;
        }
      }

      /**
       * 检查页面中是否存在登录相关的字段组合
       */
      public hasLoginFormFields(): boolean {
        return (
          (this.usernameFields.length > 0 && this.passwordFields.length > 0) ||
          (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0)
        );
      }

      /**
       * 检测页面上的登录按钮
       */
      private detectLoginButtons() {
        // 清空之前的登录按钮检测结果
        this.loginButtons = [];

        // 定义登录相关的关键词
        const loginKeywords = [
          '登录',
          '登陆',
          'sign in',
          'signin',
          'log in',
          'login',
          '密码登录',
          '验证码登录',
          '账号登录',
          '立即登录',
          '登 录',
          '登  录', // 包含空格的情况
          'SIGN IN',
          'LOGIN',
          'LOG IN',
        ];

        // 查询可能的登录按钮
        const buttonSelectors = [
          'button',
          'input[type="button"]',
          'input[type="submit"]',
          '[role="button"]',
          '.login-btn',
          '.sign-in-btn',
          '.login-button',
          '.sign-in-button',
          '.submit-btn',
          '.submit-button',
        ];

        buttonSelectors.forEach(selector => {
          const buttons = document.querySelectorAll(selector);
          buttons.forEach(button => {
            if (button instanceof HTMLElement) {
              // 检查按钮文本
              const buttonText = (button.textContent || button.innerText || '').trim().toLowerCase();
              const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
              const title = (button.getAttribute('title') || '').toLowerCase();
              const value = (button.getAttribute('value') || '').toLowerCase();

              // 检查是否包含登录关键词
              const hasLoginKeyword = loginKeywords.some(
                keyword =>
                  buttonText.includes(keyword.toLowerCase()) ||
                  ariaLabel.includes(keyword.toLowerCase()) ||
                  title.includes(keyword.toLowerCase()) ||
                  value.includes(keyword.toLowerCase()),
              );

              if (hasLoginKeyword && this.isVisible(button)) {
                // 检查按钮是否未在我们的列表中
                if (!this.loginButtons.includes(button)) {
                  this.loginButtons.push(button);
                }
              }
            }
          });
        });

        console.log(`检测到 ${this.loginButtons.length} 个登录按钮`);
      }

      /**
       * 检查页面中是否存在登录按钮
       */
      public hasLoginButtons(): boolean {
        return this.loginButtons.length > 0;
      }

      /**
       * 添加页面可见性监听器
       */
      private addPageVisibilityListener() {
        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            // 页面变为隐藏状态，隐藏侧边栏
            this.hideSidePanel();
          }
        });

        // 监听窗口失去焦点事件
        window.addEventListener('blur', () => {
          // 窗口失去焦点，隐藏侧边栏
          this.hideSidePanel();
        });
      }

      /**
       * 添加页面导航监听器
       */
      private addPageNavigationListener() {
        // 监听页面卸载事件
        window.addEventListener('beforeunload', () => {
          // 页面即将卸载，隐藏侧边栏
          this.hideSidePanel();
        });

        // 监听页面历史记录变化（SPA应用）
        let lastUrl = location.href;
        new MutationObserver(() => {
          const url = location.href;
          if (url !== lastUrl) {
            // 检测到页面路由变化，通知侧边栏更新数据
            this.notifyUrlChange();
            lastUrl = url;
          }
        }).observe(document, { subtree: true, childList: true });

        // 监听浏览器历史记录变化
        window.addEventListener('popstate', () => {
          // 检测到浏览器历史记录变化，通知侧边栏更新数据
          this.notifyUrlChange();
        });
      }

      /**
       * 通知侧边栏URL发生变化
       */
      private async notifyUrlChange() {
        try {
          // 检查扩展上下文是否有效
          if (!chrome.runtime?.id) {
            console.warn('扩展上下文已失效，无法发送URL变化通知');
            return;
          }

          // 通知background script url发生了变化
          await chrome.runtime.sendMessage({
            type: MessageType.URL_CHANGED,
            data: {
              url: location.href,
            },
          });
          // URL变化通知已发送
        } catch (error) {
          // 检查是否是扩展上下文失效错误
          const errorMsg = (error as Error).message || '';
          if (errorMsg.includes('Extension context invalidated')) {
            console.warn('扩展上下文已失效，请刷新页面');
          } else {
            console.error('发送URL变化通知失败:', error);
          }
        }
      }

      private handleMessage(message: any, sender: any, sendResponse: Function) {
        // Content script收到消息
        switch (message.type) {
          case MessageType.PING:
            sendResponse({ success: true, message: 'content script is ready' });
            break;
          case MessageType.FILL_PASSWORD:
            this.fillPassword(message.data);
            sendResponse({ success: true, message: '填充完成' });
            break;
          case MessageType.FILL_MOBILE_CODE:
            this.fillMobileCode(message.data);
            sendResponse({ success: true, message: '填充完成' });
            break;
          case MessageType.SHOW_SIDEPANEL:
            // 检查是否检测到登录表单，如果没有则显示提示
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
            // 未知消息类型
            sendResponse({ success: false, message: '未知消息类型' });
            break;
        }
      }

      /**
       * 填充账号+密码组合
       */
      private fillPassword(data: { username: string; password: string }) {
        try {
          // 开始填充密码

          // 填充用户名
          if (data.username && this.usernameFields.length > 0) {
            const usernameField = this.usernameFields[0];
            // 填充用户名到字段
            this.setInputValue(usernameField, data.username);
          }

          // 填充密码
          if (data.password && this.passwordFields.length > 0) {
            const passwordField = this.passwordFields[0];
            // 填充密码到字段
            this.setInputValue(passwordField, data.password);
          }

          // 自动勾选最近的复选框
          this.autoCheckNearestCheckbox();

          // 密码填充完成，延迟隐藏侧边栏以确保填充操作完成
          setTimeout(() => {
            this.hideSidePanel();
          }, 300);
        } catch (error) {
          console.error('填充密码失败:', error);
        }
      }

      /**
       * 填充手机号+验证码组合（该组合只填充手机号，无需填充短信验证码）
       */
      private fillMobileCode(data: { mobile: string; code: string }) {
        try {
          // 开始填充手机号+验证码

          // 填充手机号
          if (data.mobile && this.mobileFields.length > 0) {
            const mobileField = this.mobileFields[0];
            // 填充手机号到字段
            this.setInputValue(mobileField, data.mobile);

            // 额外触发电话号码专用事件
            const telEvents = [
              new InputEvent('input', { bubbles: true, data: data.mobile, inputType: 'insertText' }),
              new Event('change', { bubbles: true }),
              new KeyboardEvent('keydown', { bubbles: true, key: data.mobile }),
              new KeyboardEvent('keyup', { bubbles: true, key: data.mobile }),
            ];

            telEvents.forEach(event => {
              try {
                mobileField.dispatchEvent(event);
              } catch (e) {
                console.warn('电话号码事件分发失败:', e);
              }
            });
          }

          // 如果用户名字段作为手机号使用，也填充到用户名字段
          if (data.mobile && this.mobileFields.length === 0 && this.usernameFields.length > 0) {
            const usernameField = this.usernameFields[0];
            // 填充手机号到用户名字段
            this.setInputValue(usernameField, data.mobile);
          }

          // 填充验证码（无需填充短信验证码）
          // if (data.code && this.verifyCodeFields.length > 0) {
          //   const codeField = this.verifyCodeFields[0];
          //   console.log('填充验证码到字段:', codeField.type, codeField.name || codeField.id);
          //   this.setInputValue(codeField, data.code);
          // }

          // 自动勾选最近的复选框
          this.autoCheckNearestCheckbox();

          // 手机号+验证码填充完成，延迟隐藏侧边栏以确保填充操作完成
          setTimeout(() => {
            this.hideSidePanel();
          }, 300);
        } catch (error) {
          console.error('填充手机号+验证码失败:', error);
        }
      }

      private setInputValue(input: HTMLInputElement, value: string) {
        // 设置输入框值

        try {
          // 先聚焦输入框
          input.focus();

          // 选中所有文本
          input.select();

          // 模拟用户删除现有内容
          document.execCommand('selectAll');
          document.execCommand('delete');

          // 使用原生方法设置值
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, value);
          } else {
            input.value = value;
          }

          // 触发全套事件序列
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
            new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
            new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }),
          ];

          events.forEach(event => {
            try {
              input.dispatchEvent(event);
            } catch (e) {
              console.warn('事件分发失败:', e);
            }
          });

          // 延迟失去焦点
          setTimeout(() => {
            try {
              input.blur();
              const blurEvent = new Event('blur', { bubbles: true });
              input.dispatchEvent(blurEvent);
            } catch (e) {
              console.warn('blur事件失败:', e);
            }
          }, 200);

          // 输入框值设置完成
        } catch (error) {
          console.error('设置输入框值失败:', error);
          // 备用方案
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      private autoCheckNearestCheckbox() {
        if (this.checkboxFields.length === 0) {
          // 没有找到复选框
          return;
        }

        // 开始自动勾选复选框

        // 获取参考元素（优先使用密码框，其次是用户名框）
        const referenceField =
          this.passwordFields.length > 0
            ? this.passwordFields[0]
            : this.usernameFields.length > 0
              ? this.usernameFields[0]
              : null;

        if (!referenceField) {
          // 没有找到参考元素
          return;
        }

        // 使用参考元素

        // 找到最合适的复选框
        const targetCheckbox = this.findBestCheckbox(referenceField);

        if (targetCheckbox && !targetCheckbox.checked) {
          // 找到目标复选框，准备勾选

          // 勾选复选框
          this.checkCheckbox(targetCheckbox);
        } else if (targetCheckbox?.checked) {
          // 目标复选框已经被勾选
        } else {
          // 没有找到合适的复选框
        }
      }

      private findBestCheckbox(referenceField: HTMLInputElement): HTMLInputElement | null {
        let bestCheckbox: HTMLInputElement | null = null;
        let bestScore = -1;

        this.checkboxFields.forEach(checkbox => {
          const score = this.calculateCheckboxScore(referenceField, checkbox);
          // 复选框评分

          if (score > bestScore) {
            bestScore = score;
            bestCheckbox = checkbox;
          }
        });

        return bestCheckbox;
      }

      private calculateCheckboxScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
        let score = 0;

        // 使用更准确的距离计算
        const distance = this.calculateAccurateDistance(referenceField, checkbox);
        const maxDistance = 2000; // 增加最大有效距离
        const distanceScore = Math.max(0, (maxDistance - distance) / maxDistance) * 100;
        score += distanceScore;

        // 复选框距离计算

        // 获取复选框的标签文本
        const labelText = this.getCheckboxLabel(checkbox).toLowerCase();

        // 标签内容分数（相关关键词加分）
        const positiveKeywords = [
          '记住',
          '记住我',
          'remember',
          'remember me',
          '同意',
          '已阅读',
          '接受',
          '确认',
          'agree',
          'accept',
          'confirm',
          'read',
          '自动登录',
          '保持登录',
          'auto',
          'stay',
          'keep',
          '服务条款',
          '隐私政策',
          '用户协议',
          'terms',
          'privacy',
          'policy',
          'agreement',
        ];

        const negativeKeywords = [
          '发送',
          '订阅',
          '推送',
          '通知',
          'send',
          'subscribe',
          'newsletter',
          'notification',
          '广告',
          '营销',
          'marketing',
          'ads',
          'promotion',
        ];

        // 正向关键词加分
        let keywordScore = 0;
        positiveKeywords.forEach(keyword => {
          if (labelText.includes(keyword)) {
            keywordScore += 50;
          }
        });

        // 负向关键词减分
        negativeKeywords.forEach(keyword => {
          if (labelText.includes(keyword)) {
            keywordScore -= 30;
          }
        });

        score += keywordScore;

        // 位置关系分数
        const positionScore = this.calculatePositionScore(referenceField, checkbox);
        score += positionScore;

        // 同一表单内的复选框加分
        const refForm = referenceField.closest('form');
        const checkboxForm = checkbox.closest('form');
        if (refForm && checkboxForm && refForm === checkboxForm) {
          score += 30;
        }

        // DOM层级关系加分
        const hierarchyScore = this.calculateHierarchyScore(referenceField, checkbox);
        score += hierarchyScore;

        // 复选框综合评分

        return score;
      }

      // 更准确的距离计算（考虑不同层级）
      private calculateAccurateDistance(elem1: HTMLElement, elem2: HTMLElement): number {
        const rect1 = elem1.getBoundingClientRect();
        const rect2 = elem2.getBoundingClientRect();

        // 使用边缘距离而不是中心距离
        const left1 = rect1.left;
        const right1 = rect1.right;
        const top1 = rect1.top;
        const bottom1 = rect1.bottom;

        const left2 = rect2.left;
        const right2 = rect2.right;
        const top2 = rect2.top;
        const bottom2 = rect2.bottom;

        // 计算最短距离
        let dx = 0;
        let dy = 0;

        if (right1 < left2) {
          dx = left2 - right1; // elem1在elem2左侧
        } else if (right2 < left1) {
          dx = left1 - right2; // elem1在elem2右侧
        }
        // 否则x轴有重叠，dx = 0

        if (bottom1 < top2) {
          dy = top2 - bottom1; // elem1在elem2上方
        } else if (bottom2 < top1) {
          dy = top1 - bottom2; // elem1在elem2下方
        }
        // 否则y轴有重叠，dy = 0

        return Math.sqrt(dx * dx + dy * dy);
      }

      // 位置关系评分
      private calculatePositionScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
        const refRect = referenceField.getBoundingClientRect();
        const checkboxRect = checkbox.getBoundingClientRect();
        let score = 0;

        // 在密码框下方的复选框加分（更符合常见布局）
        if (checkboxRect.top > refRect.bottom) {
          const verticalDistance = checkboxRect.top - refRect.bottom;
          if (verticalDistance < 100) {
            score += 40; // 非常近的下方元素
          } else if (verticalDistance < 200) {
            score += 20; // 较近的下方元素
          }
        }

        // 水平对齐加分
        const horizontalOverlap =
          Math.min(refRect.right, checkboxRect.right) - Math.max(refRect.left, checkboxRect.left);
        if (horizontalOverlap > 0) {
          score += 15; // 水平有重叠
        }

        return score;
      }

      // DOM层级关系评分
      private calculateHierarchyScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
        let score = 0;

        // 查找共同祖先元素
        const commonAncestor = this.findCommonAncestor(referenceField, checkbox);
        if (commonAncestor) {
          // 计算到共同祖先的距离
          const refDepth = this.getDepthFromAncestor(referenceField, commonAncestor);
          const checkboxDepth = this.getDepthFromAncestor(checkbox, commonAncestor);

          // 层级距离越近分数越高
          const totalDepth = refDepth + checkboxDepth;
          if (totalDepth <= 4) {
            score += 25; // 非常近的层级关系
          } else if (totalDepth <= 8) {
            score += 15; // 较近的层级关系
          } else if (totalDepth <= 12) {
            score += 5; // 较远的层级关系
          }
        }

        return score;
      }

      // 查找共同祖先元素
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

      // 计算到祖先元素的深度
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
        // 尝试多种方式获取复选框的标签文本

        // 1. 通过 label 元素
        if (checkbox.id) {
          const label = document.querySelector(`label[for="${checkbox.id}"]`);
          if (label) {
            return label.textContent?.trim() || '';
          }
        }

        // 2. 父级 label 元素
        const parentLabel = checkbox.closest('label');
        if (parentLabel) {
          return parentLabel.textContent?.trim() || '';
        }

        // 3. 相邻元素的文本
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

        // 4. 父元素的文本（排除复选框本身）
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

        // 5. 使用属性值
        return checkbox.name || checkbox.id || checkbox.className || '未知复选框';
      }

      private checkCheckbox(checkbox: HTMLInputElement) {
        try {
          // 正在勾选复选框

          // 检查是否禁用
          if (checkbox.disabled) {
            // 复选框被禁用，跳过
            return;
          }

          // 尝试多种方式勾选

          // 方式1: 直接点击复选框
          // 尝试方式1: 直接点击复选框
          checkbox.click();

          // 等待一下看是否生效
          setTimeout(() => {
            // 方式1结果

            if (!checkbox.checked) {
              // 方式2: 设置值 + 触发事件
              // 尝试方式2: 设置值 + 触发事件
              checkbox.checked = true;

              // 触发多种事件
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
                  // 触发事件
                } catch (e) {
                  console.error('触发事件失败:', event.type, e);
                }
              });

              setTimeout(() => {
                // 方式2结果

                if (!checkbox.checked) {
                  // 方式3: 通过 label 点击
                  // 尝试方式3: 通过 label 点击
                  const label = this.findCheckboxLabel(checkbox);
                  if (label) {
                    // 找到关联的 label，尝试点击
                    label.click();

                    setTimeout(() => {
                      // 方式3结果

                      if (!checkbox.checked) {
                        // 方式4: 模拟用户交互
                        // 尝试方式4: 模拟用户交互
                        this.simulateUserInteraction(checkbox);
                      } else {
                        // 复选框勾选成功（方式3）
                      }
                    }, 100);
                  } else {
                    // 未找到关联的 label
                    // 直接尝试方式4
                    this.simulateUserInteraction(checkbox);
                  }
                } else {
                  // 复选框勾选成功（方式2）
                }
              }, 100);
            } else {
              // 复选框勾选成功（方式1）
            }
          }, 100);
        } catch (error) {
          console.error('勾选复选框失败:', error);
        }
      }

      private findCheckboxLabel(checkbox: HTMLInputElement): HTMLElement | null {
        // 查找与复选框关联的 label 元素

        // 1. 通过 for 属性关联
        if (checkbox.id) {
          const label = document.querySelector(`label[for="${checkbox.id}"]`);
          if (label) {
            // 通过 for 属性找到 label
            return label as HTMLElement;
          }
        }

        // 2. 父级 label 元素
        const parentLabel = checkbox.closest('label');
        if (parentLabel) {
          // 找到父级 label
          return parentLabel;
        }

        // 3. 查找与复选框在同一容器内的 label
        const container = checkbox.parentElement;
        if (container) {
          const containerLabels = container.querySelectorAll('label');
          if (containerLabels.length === 1) {
            // 找到同一容器内的 label
            return containerLabels[0] as HTMLElement;
          }
        }

        return null;
      }

      private simulateUserInteraction(checkbox: HTMLInputElement) {
        // 模拟用户交互

        try {
          // 模拟鼠标事件序列
          const rect = checkbox.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          const mouseEvents = [
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: centerX,
              clientY: centerY,
              button: 0,
            }),
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              clientX: centerX,
              clientY: centerY,
              button: 0,
            }),
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: centerX,
              clientY: centerY,
              button: 0,
            }),
          ];

          // 设置值
          const originalValue = checkbox.checked;
          checkbox.checked = !originalValue;

          // 触发鼠标事件
          mouseEvents.forEach(event => {
            checkbox.dispatchEvent(event);
          });

          // 触发表单事件
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          checkbox.dispatchEvent(new Event('input', { bubbles: true }));

          // 模拟交互完成
        } catch (error) {
          console.error('模拟交互失败:', error);
        }
      }

      // todo: 该方法暂未使用，计算两个元素的距离
      private calculateDistance(elem1: HTMLElement, elem2: HTMLElement): number {
        const rect1 = elem1.getBoundingClientRect();
        const rect2 = elem2.getBoundingClientRect();

        const centerX1 = rect1.left + rect1.width / 2;
        const centerY1 = rect1.top + rect1.height / 2;
        const centerX2 = rect2.left + rect2.width / 2;
        const centerY2 = rect2.top + rect2.height / 2;

        return Math.sqrt(Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2));
      }

      public destroy() {
        if (this.observer) {
          this.observer.disconnect();
        }
        // 清理事件委托监听器
        document.removeEventListener('focusin', this.handleDelegatedFocus, { capture: true });
      }
    }

    // 初始化表单检测器
    const formDetector = new FormDetector();

    // 初始化悬浮按钮管理器
    const floatingButtonManager = getFloatingButtonManager();
    floatingButtonManager.init().catch(error => {
      console.error('FloatingButtonManager 初始化失败:', error);
    });

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
      formDetector.destroy();
      destroyFloatingButtonManager();
    });
  },
});
