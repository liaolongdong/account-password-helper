import { LOGIN_CONTAINER_KEYWORDS, POPUP_KEYWORDS } from '@/entrypoints/content/formSelectors';

/**
 * 表单字段集合，用于登录表单分析
 */
export interface FormFieldSets {
  /** 密码输入框列表 */
  passwordFields: HTMLInputElement[];
  /** 用户名输入框列表 */
  usernameFields: HTMLInputElement[];
  /** 手机号输入框列表 */
  mobileFields: HTMLInputElement[];
  /** 验证码输入框列表 */
  verifyCodeFields: HTMLInputElement[];
  /** 登录按钮列表 */
  loginButtons: HTMLElement[];
}

/**
 * 登录表单分析器
 * 负责判断输入框是否位于登录表单或登录弹窗中
 */
export class LoginFormAnalyzer {
  /** 缓存 isInLoginFormOrPopup 的检查结果，使用 WeakMap 避免内存泄漏 */
  private loginFormCheckCache = new WeakMap<HTMLInputElement, boolean>();

  /**
   * 清除缓存（在重新检测表单时调用）
   */
  clearCache(): void {
    this.loginFormCheckCache = new WeakMap();
  }

  /**
   * 判断输入框是否位于登录表单或登录弹窗中
   * 通过多种启发式规则进行检测：表单元素、容器关键词、弹窗角色、定位方式等
   * @param input - 待检查的输入框
   * @param fields - 当前检测到的表单字段集合
   * @returns 是否在登录表单中
   */
  isInLoginFormOrPopup(input: HTMLInputElement, fields: FormFieldSets): boolean {
    const cachedResult = this.loginFormCheckCache.get(input);
    if (cachedResult !== undefined) {
      return cachedResult;
    }

    const hasLoginFields =
      (fields.passwordFields.length > 0 && fields.usernameFields.length > 0) ||
      (fields.mobileFields.length > 0 && fields.verifyCodeFields.length > 0);

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

        const hasLoginButton = this.hasLoginButtonInForm(parent, fields.loginButtons);

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
        if (this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent, fields.loginButtons)) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }
      }

      const style = window.getComputedStyle(parent);
      if (style.position === 'fixed' || style.position === 'absolute') {
        if (
          hasPopupKeyword ||
          this.hasLoginFieldsNearby(parent) ||
          this.hasLoginButtonNearby(parent, fields.loginButtons)
        ) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }
      }

      if (role === 'dialog' || role === 'alertdialog') {
        if (this.hasLoginFieldsNearby(parent) || this.hasLoginButtonNearby(parent, fields.loginButtons)) {
          this.loginFormCheckCache.set(input, true);
          return true;
        }
      }

      parent = parent.parentElement;
    }

    if (hasLoginFields || fields.loginButtons.length > 0) {
      this.loginFormCheckCache.set(input, true);
      return true;
    }

    this.loginFormCheckCache.set(input, false);
    return false;
  }

  /**
   * 检查元素附近是否存在登录相关的表单字段
   * @param element - 要检查的容器元素
   * @returns 是否存在登录字段
   */
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

  /**
   * 检查表单中是否包含已检测到的登录按钮
   * @param form - 表单元素
   * @param loginButtons - 已检测到的登录按钮列表
   * @returns 表单中是否包含登录按钮
   */
  private hasLoginButtonInForm(form: Element, loginButtons: HTMLElement[]): boolean {
    for (const button of loginButtons) {
      if (form.contains(button)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查元素附近是否存在登录按钮
   * @param element - 要检查的容器元素
   * @param loginButtons - 已检测到的登录按钮列表
   * @returns 是否存在登录按钮
   */
  private hasLoginButtonNearby(element: HTMLElement, loginButtons: HTMLElement[]): boolean {
    for (const button of loginButtons) {
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
}
