import { MessageType, type AutoSaveConfig, type DomainPattern } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { USERNAME_SELECTORS, LOGIN_BUTTON_KEYWORDS, normalizeButtonText } from '@/entrypoints/content/formSelectors';
import { showNativeNotification } from '@/entrypoints/content/NativeNotification';
import { showSavePasswordPrompt, dismissSavePasswordPrompt } from '@/entrypoints/content/SavePasswordPrompt';

/** sessionStorage 中存储待确认凭证的 key */
const PENDING_SAVE_KEY = '__aph_pending_save__';

/** 待确认凭证最大有效期（30 秒），超过则丢弃 */
const PENDING_MAX_AGE_MS = 30_000;

/**
 * 存储到 sessionStorage 的待确认凭证结构
 */
interface PendingCredentials {
  username: string;
  password: string;
  url: string;
  tag: string;
  timestamp: number;
}

/**
 * 登录账号密码保存管理器（Chrome 式交互）
 *
 * 监听登录表单提交和登录按钮点击，捕获账号密码后弹出确认弹窗，
 * 由用户主动选择是否保存到密码列表。
 *
 * 交互流程：
 * 1. 捕获凭证（form submit / 登录按钮 click）
 * 2. 存入 sessionStorage（支持跨页面导航场景）
 * 3. 显示保存确认弹窗
 * 4. 用户选择「保存」→ 发送到 background 写入密码列表
 * 5. 用户选择「暂不保存」→ 清除数据，不做任何操作
 */
export class LoginAutoSave {
  /** 自动保存功能是否启用（配置加载完成前默认禁用，防止竞态条件导致所有域名均弹窗） */
  private isEnabled = false;
  /** 配置是否已加载完成（区分「用户未配置」和「配置尚未加载」两种状态） */
  private configLoaded = false;
  /** 域名匹配规则列表，为空时匹配所有域名 */
  private domainPatterns: DomainPattern[] = [];
  /** 当前页面是否已显示过弹窗（防止重复弹窗） */
  private promptShown = false;

  constructor() {
    this.init();
  }

  /**
   * 初始化：注册事件监听器（同步），然后异步加载配置
   *
   * 重要：事件监听器必须在 await 之前注册，否则在配置加载期间用户点击登录按钮
   * 会导致事件被错过，弹窗永远不会出现。
   */
  private async init(): Promise<void> {
    // 事件监听器必须在 await 之前注册（同步）
    // 事件委托：监听 form submit（capture 阶段可在表单实际提交前读取字段值）
    document.addEventListener('submit', this.handleFormSubmit, { capture: true });
    // 监听点击事件，处理非 form 表单的登录按钮场景
    document.addEventListener('click', this.handleButtonClick, { capture: true });
    // 监听键盘 Enter 键，处理在密码框按回车提交的场景
    document.addEventListener('keydown', this.handleKeyDown, { capture: true });
    // 监听 storage 变化，同步更新启用状态
    chrome.storage.onChanged.addListener(this.handleStorageChange);

    console.warn('[APH] LoginAutoSave 事件监听器已注册');

    // 异步加载配置（不影响事件监听器注册）
    try {
      const config = await StorageUtils.getAutoSaveConfig();
      this.isEnabled = config.enabled;
      this.domainPatterns = config.domainPatterns;
      this.configLoaded = true;
    } catch {
      // 配置加载失败时禁用自动保存，避免空 domainPatterns 匹配所有域名
      this.isEnabled = false;
      this.configLoaded = true;
    }
    console.warn(
      '[APH] LoginAutoSave 初始化完成, isEnabled:',
      this.isEnabled,
      'domainPatterns:',
      this.domainPatterns.length,
      'configLoaded:',
      this.configLoaded,
    );

    // 检查是否有跨页面导航遗留的待确认凭证（传统表单提交场景）
    this.checkPendingCredentials();
  }

  /**
   * 处理 storage 变化，同步自动保存配置
   */
  private handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }): void => {
    if (changes.auto_save_config) {
      const newConfig = changes.auto_save_config.newValue as Partial<AutoSaveConfig> | undefined;
      if (newConfig) {
        this.isEnabled = newConfig.enabled === true;
        if (Array.isArray(newConfig.domainPatterns)) {
          this.domainPatterns = newConfig.domainPatterns;
        }
        console.warn(
          '[APH] handleStorageChange 同步配置: isEnabled:',
          this.isEnabled,
          'domainPatterns:',
          this.domainPatterns.length,
        );
      } else {
        // newValue 为空（存储被清除），回退到安全状态：禁用自动保存
        this.isEnabled = false;
        this.domainPatterns = [];
        console.warn('[APH] handleStorageChange: 配置被清除，已禁用自动保存');
      }
    }
  };

  // ── 凭证捕获 ──

  /**
   * 处理表单提交事件
   * 在 capture 阶段读取表单内的账号和密码字段值
   */
  private handleFormSubmit = (e: Event): void => {
    if (!this.isEnabled || !this.configLoaded) return;

    const form = e.target as HTMLFormElement;
    if (!form || form.tagName !== 'FORM') {
      console.warn('[APH] form submit: 非 FORM 元素, tag=', (e.target as HTMLElement)?.tagName);
      return;
    }

    // 检查 form 内是否有密码字段
    const passwordField = form.querySelector('input[type="password"]') as HTMLInputElement | null;
    if (!passwordField || !passwordField.value) {
      console.warn('[APH] form submit: 未找到密码字段或密码为空');
      return;
    }

    const password = passwordField.value;
    const username = this.findUsernameInForm(form);
    if (!username) {
      console.warn('[APH] form submit: 未找到用户名');
      return;
    }

    console.warn('[APH] form submit 捕获凭证:', username, '***');
    this.onCredentialsCaptured(username, password);
  };

  /**
   * 处理按钮点击事件
   * 针对非 form 表单场景（如 SPA 中的 div 按钮）
   */
  private handleButtonClick = (e: MouseEvent): void => {
    if (!this.isEnabled || !this.configLoaded) return;

    const target = e.target as HTMLElement;
    if (!target) return;

    // 向上查找最近的按钮元素
    const button = target.closest(
      'button, [role="button"], input[type="submit"], input[type="button"]',
    ) as HTMLElement | null;
    if (!button) return;

    // 检查按钮文本是否包含登录关键词
    const buttonText = normalizeButtonText(
      button.innerText || button.textContent || (button as HTMLInputElement).value || '',
    );
    const isLoginButton = LOGIN_BUTTON_KEYWORDS.some(keyword => buttonText.includes(normalizeButtonText(keyword)));
    if (!isLoginButton) {
      console.warn('[APH] 按钮点击: 非登录按钮, text="' + buttonText + '"');
      return;
    }

    // 从按钮所在的 form 或页面中获取账号密码
    const form = button.closest('form') as HTMLFormElement | null;
    const passwordField = form
      ? (form.querySelector('input[type="password"]') as HTMLInputElement | null)
      : (document.querySelector('input[type="password"]') as HTMLInputElement | null);
    if (!passwordField || !passwordField.value) {
      console.warn('[APH] 按钮点击: 未找到密码字段或密码为空');
      return;
    }

    const password = passwordField.value;
    const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
    if (!username) {
      console.warn('[APH] 按钮点击: 未找到用户名');
      return;
    }

    console.warn('[APH] 按钮点击 捕获凭证:', username, '***');
    this.onCredentialsCaptured(username, password);
  };

  /**
   * 处理键盘按下事件
   * 当用户在密码输入框中按 Enter 键时，尝试捕获凭证
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.isEnabled || !this.configLoaded) return;
    if (e.key !== 'Enter') return;

    const target = e.target as HTMLInputElement;
    if (!target || target.tagName !== 'INPUT') return;

    // 仅在密码框或常见文本输入框中按 Enter 时触发
    const inputType = target.type?.toLowerCase() || 'text';
    if (!['password', 'text', 'email', 'tel'].includes(inputType)) return;

    // 查找密码字段
    const form = target.closest('form') as HTMLFormElement | null;
    const passwordField = form
      ? (form.querySelector('input[type="password"]') as HTMLInputElement | null)
      : (document.querySelector('input[type="password"]') as HTMLInputElement | null);
    if (!passwordField || !passwordField.value) return;

    const password = passwordField.value;
    const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
    if (!username) {
      console.warn('[APH] Enter 键: 未找到用户名');
      return;
    }

    console.warn('[APH] Enter 键 捕获凭证:', username, '***');
    this.onCredentialsCaptured(username, password);
  };

  // ── 域名匹配 ──

  /**
   * 检查当前页面域名是否匹配自动保存规则
   * 规则列表为空时匹配所有域名
   * @returns 是否匹配
   */
  private isDomainMatch(): boolean {
    if (this.domainPatterns.length === 0) return true;
    return StorageUtils.isDomainMatchForAutoSave(location.hostname, {
      enabled: this.isEnabled,
      domainPatterns: this.domainPatterns,
    });
  }

  // ── 弹窗与保存逻辑 ──

  /**
   * 凭证捕获后的统一处理入口
   * 存入 sessionStorage 并显示确认弹窗
   * @param username 用户名
   * @param password 密码
   */
  private onCredentialsCaptured(username: string, password: string): void {
    // 配置未加载完成时跳过，防止竞态条件导致空规则匹配所有域名
    if (!this.configLoaded) {
      console.warn('[APH] 配置尚未加载完成，跳过弹窗');
      return;
    }

    // 域名匹配检查：配置的规则列表非空时，仅对匹配的域名弹窗
    if (!this.isDomainMatch()) {
      console.warn('[APH] 域名不匹配配置规则，跳过弹窗, hostname:', location.hostname);
      return;
    }

    // 防止同一页面重复弹窗
    if (this.promptShown) {
      console.warn('[APH] 弹窗已显示，跳过重复弹窗');
      return;
    }
    this.promptShown = true;
    console.warn('[APH] 准备显示保存确认弹窗:', username);

    // 存入 sessionStorage，支持传统页面导航后在新页面恢复
    const pending: PendingCredentials = {
      username,
      password,
      url: location.hostname,
      tag: document.title,
      timestamp: Date.now(),
    };
    try {
      sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(pending));
    } catch {
      // sessionStorage 不可用时忽略（如隐私模式）
    }

    this.showPrompt(pending);
  }

  /**
   * 页面加载时检查是否有跨页面导航遗留的待确认凭证
   * 传统表单提交会导致页面跳转，弹窗需要在目标页面显示
   */
  private checkPendingCredentials(): void {
    // 配置未加载完成时跳过
    if (!this.configLoaded) return;

    try {
      const raw = sessionStorage.getItem(PENDING_SAVE_KEY);
      if (!raw) return;

      const pending = JSON.parse(raw) as PendingCredentials;

      // 校验数据有效性：必须有用户名和密码，且在有效期内
      if (!pending.username || !pending.password) {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
        return;
      }

      const age = Date.now() - pending.timestamp;
      if (age > PENDING_MAX_AGE_MS) {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
        return;
      }

      // 域名匹配检查：配置的规则列表非空时，仅对匹配的域名显示弹窗
      if (!this.isDomainMatch()) {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
        return;
      }

      // 有效凭证，显示弹窗
      if (!this.promptShown) {
        this.promptShown = true;
        this.showPrompt(pending);
      }
    } catch {
      // 解析失败，清除脏数据
      try {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
      } catch {
        // 忽略
      }
    }
  }

  /**
   * 显示保存确认弹窗
   * @param pending 待确认的凭证数据
   */
  private showPrompt(pending: PendingCredentials): void {
    try {
      showSavePasswordPrompt(
        { username: pending.username, password: pending.password, url: pending.url },
        () => this.handleSave(pending),
        () => this.handleDismiss(),
      );
      console.warn('[APH] 弹窗已显示');
    } catch (err) {
      console.warn('[APH] 弹窗显示失败:', err);
      // 弹窗显示失败时回退到通知提示
      showNativeNotification(`发现账号密码，但弹窗显示失败，请手动在密码管理页添加`, 'warning');
    }
  }

  /**
   * 用户确认保存：清除 sessionStorage → 发送到 background 保存 → 显示成功通知
   * @param pending 待保存的凭证
   */
  private async handleSave(pending: PendingCredentials): Promise<void> {
    this.clearPending();

    try {
      if (!chrome.runtime?.id) {
        logger.warn('LoginAutoSave: 扩展上下文已失效，无法保存');
        showNativeNotification('保存失败：扩展上下文已失效', 'error');
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: MessageType.AUTO_SAVE_PASSWORD,
        data: {
          username: pending.username,
          password: pending.password,
          url: pending.url,
          tag: pending.tag,
        },
      });

      if (response?.success) {
        showNativeNotification('账号密码已保存', 'success');
      } else {
        showNativeNotification(`保存失败: ${response?.message || '未知原因'}`, 'warning');
      }
    } catch (error) {
      const errorMsg = (error as Error).message || '';
      if (errorMsg.includes('Extension context invalidated')) {
        showNativeNotification('保存失败：扩展上下文已失效，请刷新页面', 'error');
      } else {
        showNativeNotification('保存失败，请重试', 'error');
      }
    }
  }

  /**
   * 用户选择暂不保存：清除 sessionStorage 和弹窗
   */
  private handleDismiss(): void {
    this.clearPending();
  }

  /**
   * 清除 sessionStorage 中的待确认凭证
   */
  private clearPending(): void {
    try {
      sessionStorage.removeItem(PENDING_SAVE_KEY);
    } catch {
      // 忽略
    }
  }

  // ── 表单字段查找工具方法 ──

  /**
   * 从表单中查找用户名输入框的值
   * @param form 表单元素
   * @returns 用户名值或空字符串
   */
  private findUsernameInForm(form: HTMLFormElement): string {
    // 优先使用 autocomplete="username"
    const autoCompField = form.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    if (autoCompField?.value) return autoCompField.value;

    // 遍历 USERNAME_SELECTORS 查找
    for (const selector of USERNAME_SELECTORS) {
      try {
        const field = form.querySelector(selector) as HTMLInputElement | null;
        if (field?.value) return field.value;
      } catch {
        // 某些选择器可能语法不合法，跳过
      }
    }

    // 回退：查找 form 中所有可见的 text/email/tel input（排除 password）
    const allInputs = form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"]',
    ) as NodeListOf<HTMLInputElement>;
    for (const input of allInputs) {
      if (input.value && this.isElementVisible(input)) {
        return input.value;
      }
    }

    return '';
  }

  /**
   * 从页面中查找用户名输入框的值（无 form 场景回退）
   * @returns 用户名值或空字符串
   */
  private findUsernameInPage(): string {
    const autoCompField = document.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    if (autoCompField?.value) return autoCompField.value;

    for (const selector of USERNAME_SELECTORS) {
      try {
        const field = document.querySelector(selector) as HTMLInputElement | null;
        if (field?.value && this.isElementVisible(field)) return field.value;
      } catch {
        // 跳过
      }
    }
    return '';
  }

  /**
   * 判断元素是否可见
   * @param el 要检查的元素
   * @returns 是否可见
   */
  private isElementVisible(el: HTMLElement): boolean {
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
   * 销毁实例，清理所有事件监听器
   */
  public destroy(): void {
    document.removeEventListener('submit', this.handleFormSubmit, { capture: true });
    document.removeEventListener('click', this.handleButtonClick, { capture: true });
    document.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    chrome.storage.onChanged.removeListener(this.handleStorageChange);
    dismissSavePasswordPrompt();
  }
}
