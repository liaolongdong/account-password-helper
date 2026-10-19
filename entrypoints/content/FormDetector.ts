import {
  type RuntimeMessage,
  MessageType,
  FloatingButtonConfig,
  type FillEntry,
  FillPasswordData,
  FillResult,
  type FillOutcome,
  PingResponse,
  PendingTotpData,
} from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { resetSessionMemoryState, SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { logger } from '@/utils/logger';
import {
  USERNAME_SELECTORS,
  MOBILE_SELECTORS,
  VERIFY_CODE_SELECTORS,
  isPhoneExtensionField,
  LOGIN_BUTTON_KEYWORDS,
  LOGIN_BUTTON_SELECTORS,
  MUTATION_LOGIN_KEYWORDS,
  classifyAccountField,
  isEmailLikeValue,
  isPhoneLikeValue,
  looksLikeCodeField,
  looksLikePhoneField,
  normalizeButtonText,
  shouldExcludeButton,
} from './formSelectors';
import type { AccountFieldKind } from './formSelectors';
import { InputFiller } from './InputFiller';
import { CheckboxHandler } from './CheckboxHandler';
import { LoginFormAnalyzer } from './LoginFormAnalyzer';
import type { FormFieldSets } from './types';
import { PasswordVisibilityToggle } from './PasswordVisibilityToggle';
import { isDetectableAriaCheckbox, isDetectableCheckbox, isElementVisible } from './domUtils';
import { fillContextMenuTarget, resolveContextMenuInputTarget } from './contextMenuTarget';
import { isNotificationType, NOTICE_MAX_LENGTH, showNativeNotification } from './NativeNotification';
import { tl } from '@/utils/i18n-lite';
import {
  getInlineFillDropdown,
  destroyInlineFillDropdown,
} from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import {
  getTotpHandoffCapsule,
  destroyTotpHandoffCapsule,
} from '@/entrypoints/content/inlineDropdown/TotpHandoffCapsule';
import { getFillAckChip, destroyFillAckChip } from './FillAckChip';
import { destroyIdentityHint, hideIdentityHint, setIdentityHintTheme, showIdentityHint } from './IdentityHint';
import { resolvePiiField } from './piiClassifier';
import { normalizeIdentityHintRole, type IdentityHintRole } from '@/utils/identity/hintRoles';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import {
  getSiteRules,
  isValidCssSelector,
  resolveShadowScopedSelector,
  resolveSiteRuleForHosts,
  SHADOW_SELECTOR_SEPARATOR,
  type SiteRule,
} from '@/utils/storage/siteRules';
import { resolveFillEntry } from '@/utils/fillEntry';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/** 收集 open shadow DOM 查询根时的节点预算，防止极端页面把主线程吃满 */
const SHADOW_ROOT_SCAN_BUDGET = 6000;

/**
 * 快速填充那把钥匙「取得出值」的角色
 *
 * 钥匙的面板只有账号、手机号、邮箱三类值，所以让位只对这几档成立。旧分桶把带「号码」的框
 * （证件号码、订单号码）也读成手机号框，钥匙会在它们上面出现，却填不出身份库里的证件号——
 * 跟着让位就是提示与钥匙双双落空，正是用户实测「身份证号码那一行没识别到」的成因之一。
 */
const SIDE_PANEL_FILLABLE_ROLES: ReadonlySet<IdentityHintRole> = new Set<IdentityHintRole>(['phone', 'email']);

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
  private checkboxFields: HTMLElement[] = [];
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
  /** 当前页面域名（用于站点规则匹配） */
  private domain = '';
  /** 存储变化监听器 */
  private storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;
  /** 填充失败提示是否已显示（单页签仅展示一次） */
  private fillFailurePromptShown = false;
  /** 当前站点的填充规则（自定义选择器 / 影子穿透覆盖），null 表示未配置 */
  private siteRule: SiteRule | null = null;
  /** 站点规则读取Promise（首轮检测依赖，避免规则尚未读到就检测导致选择器被静默跳过） */
  private siteRuleReady: Promise<void> = Promise.resolve();
  /** 站点规则存储监听器（destroy 时移除） */
  private siteRuleListener:
    ((changes: { [key: string]: chrome.storage.StorageChange }, area: chrome.storage.AreaName) => void) | null = null;
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
  /**
   * 实例是否已销毁（B11 门）
   *
   * destroy() 由扩展上下文失效 / beforeunload 触发。置真后，detectForms 及
   * 填充流程中的 await 续体据此提前退出，避免导航后向已卸载文档写值或调用
   * 已失效的 chrome API。
   */
  private disposed = false;

  /**
   * 页面导航与可见性回调
   *
   * 必须持有固定引用（而非注册时的匿名闭包），否则 destroy() 无法解绑：
   * 扩展重载/更新后孤儿实例会继续响应页面事件并调用 chrome API，
   * 触发 "Extension context invalidated"（与 content.ts 的清理目标相悖）。
   */
  private handleDomReady = (): void => {
    setTimeout(() => this.detectFormsAfterSiteRule(), this.longDelayTime);
  };
  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.hideSidePanel();
    }
  };
  private handlePageUnload = (): void => {
    this.hideSidePanel();
  };
  private handlePopState = (): void => {
    this.notifyUrlChange();
  };

  /** 输入填充器（依赖注入，便于测试） */
  private inputFiller: InputFiller;
  /** 复选框处理器（依赖注入，便于测试） */
  private checkboxHandler: CheckboxHandler;
  /** 登录表单分析器（依赖注入，便于测试） */
  private loginFormAnalyzer: LoginFormAnalyzer;
  /** 密码显示/隐藏切换管理器 */
  private passwordVisibilityToggle = new PasswordVisibilityToggle();
  /** 内联填充下拉（fillMode==='inline' 时使用） */
  private inlineDropdown = getInlineFillDropdown();

  /**
   * FormDetector 构造函数
   *
   * @param inputFiller 输入填充器实例（依赖注入，便于测试）
   * @param checkboxHandler 复选框处理器实例（依赖注入，便于测试）
   * @param loginFormAnalyzer 登录表单分析器实例（依赖注入，便于测试）
   * @param configOverride 配置覆盖（测试用，生产环境自动从 storage 读取）
   */
  constructor(
    inputFiller?: InputFiller,
    checkboxHandler?: CheckboxHandler,
    loginFormAnalyzer?: LoginFormAnalyzer,
    configOverride?: FloatingButtonConfig,
  ) {
    // 依赖注入：测试提供实例则使用，否则创建新实例
    this.inputFiller = inputFiller ?? new InputFiller();
    this.checkboxHandler = checkboxHandler ?? new CheckboxHandler();
    this.loginFormAnalyzer = loginFormAnalyzer ?? new LoginFormAnalyzer();

    // 初始化默认配置
    this.floatingButtonConfig = configOverride ?? StorageUtils.getDefaultFloatingButtonConfig();
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
      /*
       * 会话键变化必须让本上下文的内存镜像失效。
       *
       * `isSessionValid()` 在镜像已填好时会跳过 storage 回读：手动锁定 / 到期清除发生在
       * 另一个上下文时，这里会继续用陈旧 expiry 返回 true。后台只重置它自己的镜像，
       * 内容脚本此前没有对应清理，于是「解锁 → 锁定 → 再聚焦」仍会出身份提示。
       * 会话创建 / 换钥时同样重置，下一次检查自然会用新的键重建镜像。
       */
      const sessionKeysChanged = [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY, SESSION_STORAGE_KEYS.PASSWORD_EXPIRY].some(
        key => key in changes,
      );
      if (sessionKeysChanged) {
        const sessionRemoved = [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY, SESSION_STORAGE_KEYS.PASSWORD_EXPIRY].some(
          key => changes[key]?.newValue === undefined,
        );
        resetSessionMemoryState();
        if (sessionRemoved) hideIdentityHint();
      }

      if (changes.floating_button_config) {
        const rawConfig = changes.floating_button_config.newValue as Partial<FloatingButtonConfig> | undefined;
        if (rawConfig) {
          const penetratedBefore = this.penetrateShadowEnabled;
          const hintedBefore = this.identityHintEnabled;
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
          // 同步身份提示气泡主题：影子宿主常驻复用，令牌只在 ensureHost 那次内联写入，
          // 不在这里重放就会让已显示的气泡停在旧主色直到页面刷新（与接力胶囊同口径）
          setIdentityHintTheme(newConfig.theme);
          // 穿透总闸翻转后重检测，口径同站点规则那条监听：否则关闸要刷新页面才见效。
          // 只在翻转时做——位置/透明度每次拖动都会写这份配置，全量重检测代价太大。
          if (penetratedBefore !== this.penetrateShadowEnabled) this.detectForms();
          // 身份提示总闸翻到「关」时把屏上那枚一起收起：聚焦那一刻的门管不到已经可见的气泡，
          // 而管理页与侧边栏的偏好设置弹窗都在另一个上下文里写这份配置。只在翻转为关时做，
          // 开闸不需要动 UI——下一条该出的气泡自然会出现。
          if (hintedBefore && !this.identityHintEnabled) hideIdentityHint();
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
    // 设置当前域名（从 document.domain 或 location.hostname 获取）
    this.domain = document.domain || window.location.hostname || '';

    // F1: 读取当前站点规则并监听其变化（编辑规则后无需刷新即生效）
    this.siteRuleReady = this.loadSiteRule();
    this.setupSiteRuleListener();

    // 页面加载完成后检测表单（延时不变，仅把首轮检测排在站点规则读取之后）
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', this.handleDomReady);
    } else {
      setTimeout(() => this.detectFormsAfterSiteRule(), this.shortDelayTime);
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
        // SPA 路由切换可能直接移除焦点字段，浏览器不保证派发 focusout；
        // 不主动收起会让身份气泡以最高 z-index 悬空留在新页面上。
        hideIdentityHint();
        this.notifyUrlChange();
      }

      let shouldRedetect = false;

      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          const element = mutation.target as HTMLElement;
          // `innerText` 只作兜底：它会对整棵子树强制布局，因此排在 `textContent` 之后短路，
          // 实际只有「文本全靠 CSS 生成内容（::before content）呈现」的元素会走到这一步——
          // 这类 SPA 标签页在主树里确实取不到任何文本，去掉兜底会丢掉重检测触发。
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
   * F1: 首轮表单检测——等站点规则读取完成后再执行
   *
   * 规则读取是异步的：若在它落地前跑完首轮 detectForms，自定义选择器与穿透覆盖会被静默跳过，
   * 而 storage 监听只在「值发生变化」时触发，本次页面生命周期内再无补救机会。
   * 其余检测入口（消息、观察器、规则变更）无需等待，仍直接调用 detectForms。
   * loadSiteRule 自身已消化异常，这里不会引入未处理拒绝。
   */
  private detectFormsAfterSiteRule(): void {
    void this.siteRuleReady.then(() => this.detectForms());
  }

  /**
   * 检测页面中的所有表单字段（密码、用户名、手机号、验证码、复选框、登录按钮）
   */
  private detectForms(): void {
    // B11：destroy 后仍可能有未纳入生命周期的定时器（如 DOMContentLoaded 延时）
    // 触发重检测，此时文档可能已卸载，直接跳过。
    if (this.disposed) return;
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

    // 检测复选框：原生 input（含 input 被隐藏但存在可见关联 label 的自定义样式载体）+
    // role="checkbox" 按钮模拟复选框（现代组件库载体，如豆包登录弹窗的协议勾选）
    const checkboxInputs = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    const ariaCheckboxes = document.querySelectorAll('[role="checkbox"]') as NodeListOf<HTMLElement>;
    this.checkboxFields = [
      ...Array.from(checkboxInputs).filter(input => isDetectableCheckbox(input)),
      ...Array.from(ariaCheckboxes).filter(el => isDetectableAriaCheckbox(el)),
    ];

    // F1: 站点规则自定义选择器——命中则作为权威字段覆盖启发式结果（确定性控制）
    this.applySiteRuleSelectors();

    // 内联触发图标补偿：弥补检测完成前获焦导致委托错过展示的缺口
    this.syncInlineTriggerWithActiveElement();

    // 两步接力：纯验证码页查询待接力标记并锚定活码胶囊
    this.maybeTriggerTotpHandoff();
  }

  /**
   * 检测完成后为当前聚焦的登录字段补偿内联触发图标
   *
   * tab 切换/异步渲染场景下，输入框可能在本轮检测完成前获焦（含切换即自动聚焦）：
   * 彼时字段尚未归类，focusin/click 委托判定为非登录字段而错过展示；
   * 检测完成后又不再有新的聚焦事件，旧逻辑需用户失焦再聚焦才能看到图标。
   * 此处若焦点仍停留在登录字段则补偿一次展示（showTriggerFor 对同一字段幂等）。
   */
  private syncInlineTriggerWithActiveElement(): void {
    if (this.effectiveFillEntry !== 'inline') return;
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return;
    if (!this.shouldShowSidePanel(active)) return;
    this.inlineDropdown.showTriggerFor(active, {
      hasEyeToggle: this.isEyeToggleAtInputRight(active),
    });
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
      // await 之后必须先重新确认生命周期再动 UI：`destroy()` 已跑过时这一次 `show` 会重建
      // 胶囊单例，而销毁路径早已走完，此后没有任何清理入口（与本文件 detectForms、
      // fillPassword 各续体的 disposed 门同口径，也符合「await 续体不得在销毁后动作」的既有约定）。
      if (this.disposed || !field.isConnected) return;
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
   * F1: 影子 DOM 穿透开关是否启用
   *
   * 全局开关是总闸（用户可整体关闭扫描以换取性能与隐私边界），站点规则只能在其开启时
   * 针对单个站点进一步关闭，不能反向打开——否则新增一条规则会静默推翻用户的全局偏好。
   *
   * 两个消费方，语义一致：关闭时 `collectShadowQueryRoots` 只在文档主树上跑站点规则选择器，
   * 填充失败引导气泡也不再出现（此时跨边界的补救手段本就不可用，留着气泡只会误导）。
   */
  private get penetrateShadowEnabled(): boolean {
    return this.floatingButtonConfig.penetrateShadow !== false && this.siteRule?.penetrateShadow !== false;
  }

  /**
   * 个人信息字段提示总闸是否启用
   *
   * 判据取「显式 false 才关」：存量配置里没有这个键，未写即开，口径与设置面板的
   * `isSwitchOn` 一致（两处各写一份时，老配置下面板的显示态与实际门会错位）。
   */
  private get identityHintEnabled(): boolean {
    return this.floatingButtonConfig.identityHintEnabled !== false;
  }

  /**
   * F1: 当前站点生效的快速填充入口
   *
   * 站点规则优先于全局配置，未设档位即跟随全局（见 `resolveFillEntry`）。这是填充
   * 入口判定的唯一出口：内联图标的展示与侧边栏的自动展开都从这里取值，避免两处
   * 各读各的 `fillMode` / `autoShowSidepanel` 而让覆盖只生效一半。
   */
  private get effectiveFillEntry(): FillEntry {
    return resolveFillEntry(this.floatingButtonConfig, this.siteRule);
  }

  /**
   * F1: 读取当前域名的站点填充规则
   *
   * 内容脚本可读 chrome.storage.local（SiteRule 为明文非敏感元数据）。读取失败降级为无规则，
   * 不影响默认检测路径。
   */
  private async loadSiteRule(): Promise<void> {
    if (!this.domain) return;
    try {
      // 先按 host（含非默认端口）取精确规则，再回退 hostname：与拾取器选标签页的口径一致，
      // 既保留「example.com 规则覆盖所有端口」的既有行为，也让 localhost:3000 这类端口规则可用。
      const rules = await getSiteRules();
      this.siteRule =
        resolveSiteRuleForHosts(rules, window.location.host, window.location.hostname) ??
        // 兼容页面显式设置 document.domain 的旧场景：this.domain 是既有读取口径
        rules[this.domain.toLowerCase()] ??
        null;
    } catch (error) {
      logger.debug('FormDetector: 读取站点规则失败:', error);
      this.siteRule = null;
    }
  }

  /**
   * F1: 监听站点规则变化，编辑后无需刷新页面即重检测生效
   */
  private setupSiteRuleListener(): void {
    this.siteRuleListener = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.SITE_RULES]) return;
      void this.loadSiteRule().then(() => {
        if (!this.disposed) this.detectForms();
      });
    };
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.siteRuleListener);
    }
  }

  /**
   * F1: 收集跨 shadow 边界的选择器查询根（document 主树 + 所有 open shadowRoot）
   *
   * document.querySelectorAll 不跨越 shadow 边界，故先 BFS 收集 open shadowRoot 作为额外查询根。
   * 一次遍历供账号/密码两条选择器复用，避免整树 BFS 在每轮检测里重复执行。
   * BFS 设节点预算防极端页面；超预算时留下可辨识日志，否则用户只会看到「规则莫名不生效」。
   *
   * 关闭穿透时只返回文档主树：开关的语义就是「别替我伸进 Shadow DOM」，站点规则选择器
   * 也遵守它（仍在 light DOM 上生效），否则标签承诺与实现不符。
   */
  private collectShadowQueryRoots(): ParentNode[] {
    if (!this.penetrateShadowEnabled) return [document];

    const roots: ParentNode[] = [document];
    const visited = new WeakSet<Node>();
    const queue: Node[] = [document.documentElement];
    let budget = SHADOW_ROOT_SCAN_BUDGET;
    let truncated = false;

    while (queue.length > 0) {
      if (budget-- <= 0) {
        truncated = true;
        break;
      }
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      if (!(node instanceof Element)) continue;

      const sr = node.shadowRoot;
      if (sr?.mode === 'open') {
        roots.push(sr);
        for (const child of Array.from(sr.children)) queue.push(child);
      }
      for (const child of Array.from(node.children)) queue.push(child);
    }

    if (truncated) {
      logger.debug(`FormDetector: shadow 根遍历超出 ${SHADOW_ROOT_SCAN_BUDGET} 节点预算，深层字段可能被漏匹配`);
    }
    return roots;
  }

  /**
   * F1: 在给定查询根上执行选择器查询并去重
   *
   * 选择器来自 storage，按不可信输入处理：语法非法或超出长度预算时安全返回空数组，
   * 绝不抛异常打断本轮检测。
   */
  private queryInRoots<T extends Element>(roots: ParentNode[], selector: unknown): T[] {
    if (!isValidCssSelector(selector)) {
      if (typeof selector === 'string' && selector.trim()) {
        logger.debug('FormDetector: 站点规则选择器非法或超出长度预算，已跳过');
      }
      return [];
    }
    const trimmed = (selector as string).trim();

    // 作用域选择器显式编码了宿主链，必须从 document 起逐级进入其声明的 open shadowRoot。
    // 不能再把它丢进「document + 所有 shadowRoot」的平铺查询：裸选择器在 document
    // 与影子树里都可能命中，document 优先会把凭证写进主文档同 tag 的搜索框。
    if (trimmed.includes(SHADOW_SELECTOR_SEPARATOR)) {
      if (!this.penetrateShadowEnabled) {
        logger.debug('FormDetector: 影子 DOM 穿透已关闭，跳过作用域选择器');
        return [];
      }
      return resolveShadowScopedSelector<T>(trimmed, document);
    }

    const results: T[] = [];
    const seen = new WeakSet<Element>();
    for (const root of roots) {
      let matched: NodeListOf<T>;
      try {
        matched = root.querySelectorAll<T>(trimmed);
      } catch {
        continue;
      }
      for (const el of Array.from(matched)) {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      }
    }
    return results;
  }

  /**
   * F1: 应用站点规则的自定义选择器
   *
   * 命中即作为权威账号/密码字段覆盖启发式结果（确定性控制），未命中的字段保留启发式结果。
   * 被替换掉的启发式字段必须同步降级类型缓存：`getFieldType` 优先读缓存，只换数组不换缓存
   * 会让侧边栏/内联图标继续在被判定为「非登录框」的元素上弹出，覆盖只生效一半。
   */
  private applySiteRuleSelectors(): void {
    const sel = this.siteRule?.customSelectors;
    if (!sel) return;

    const roots = this.collectShadowQueryRoots();
    /**
     * 作用域选择器要求唯一：宿主链 + 内层选择器若命中多个可见字段，说明规则已过期或
     * 页面结构变化，宁可不覆盖启发式结果，也不能任选第一个写凭证。
     * 普通选择器保留既有的「首个可见命中」语义，避免改变存量规则行为。
     */
    const pick = (selector: string | undefined): HTMLInputElement | undefined => {
      if (!selector) return undefined;
      const matches = this.queryInRoots<HTMLInputElement>(roots, selector).filter(el => isElementVisible(el));
      if (selector.includes(SHADOW_SELECTOR_SEPARATOR)) {
        if (matches.length > 1) {
          logger.debug('FormDetector: 作用域选择器命中多个可见字段，已跳过');
          return undefined;
        }
        return matches[0];
      }

      // 存量/手写的裸选择器也做一次跨根歧义检查：同一 selector 在 document 与影子树
      // 都有可见命中时，无法判断用户指的是哪个根，宁可不覆盖启发式结果。
      if (this.penetrateShadowEnabled && roots.length > 1) {
        let matchedRoots = 0;
        for (const root of roots) {
          try {
            if (Array.from(root.querySelectorAll<HTMLElement>(selector)).some(el => isElementVisible(el))) {
              matchedRoots += 1;
            }
          } catch {
            // 语法已由 queryInRoots 校验，这里只防御动态选择器实现差异
          }
          if (matchedRoots > 1) {
            logger.debug('FormDetector: 裸选择器跨 shadow 根命中多个可见字段，已跳过');
            return undefined;
          }
        }
      }
      return matches[0];
    };
    const username = pick(sel.username);
    const password = pick(sel.password);
    if (!username && !password) return;

    // 只降级「本轮被替换掉的那一类」字段：未配置的选择器保留启发式结果，
    // 但被对侧选中的元素不能误伤（它仍是权威字段）。
    if (username) {
      for (const el of this.usernameFields) {
        if (el !== username && el !== password) this.fieldTypeCache.set(el, null);
      }
      this.usernameFields = [username];
      this.usernameFieldsSet = new WeakSet([username]);
      this.fieldTypeCache.set(username, 'username');
    }
    if (password) {
      for (const el of this.passwordFields) {
        if (el !== password && el !== username) this.fieldTypeCache.set(el, null);
      }
      this.passwordFields = [password];
      this.passwordFieldsSet = new WeakSet([password]);
      this.fieldTypeCache.set(password, 'password');
    }
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
   * 密码可见性按钮是否锚定在 input 右内缘（钥匙图标需为其预留避让偏移）
   *
   * 按钮锚定父元素（可视字段盒）右缘时与 input 右缘不再相邻，钥匙图标无需预留偏移。
   * @param input 当前获焦/点击的输入框
   */
  private isEyeToggleAtInputRight(input: HTMLInputElement): boolean {
    if (input.type !== 'password' || !this.floatingButtonConfig.passwordVisibilityToggle) return false;
    return this.passwordVisibilityToggle.anchorsToInputRight(input);
  }

  /**
   * 处理委托的聚焦事件：内联模式下为登录字段显示钥匙触发图标
   */
  private handleDelegatedFocusIn = (event: FocusEvent): void => {
    const focusTarget = event.target;
    if (!(focusTarget instanceof HTMLElement)) return;
    // 身份提示与填充入口档位无关：仅手动/侧边栏模式下，注册页里的姓名、证件号同样需要
    // 「这个框要的是什么」的说明，因此判定必须早于下面那条内联模式的 early return。
    this.handleIdentityHintOnFocus(focusTarget);
    if (this.effectiveFillEntry !== 'inline') return;
    const input = focusTarget instanceof HTMLInputElement ? focusTarget : focusTarget.closest('input');
    if (!input) return;
    if (this.shouldShowSidePanel(input)) {
      this.inlineDropdown.showTriggerFor(input, {
        hasEyeToggle: this.isEyeToggleAtInputRight(input),
      });
    }
  };

  /**
   * 聚焦字段上的身份库召唤提示（形态一：识别 + 提示 + 深链，零明文跨界）
   *
   * 判据全部来自 {@link resolvePiiField} 的单字段语义分类，只读取 name/id/label/placeholder
   * 等**结构信号**与该字段当前值（值仅用于形状收口，不进入任何出口）；结论经
   * `normalizeIdentityHintRole` 收到闭集枚举后才交给气泡，卡类口令在这一步之前就被挡掉；
   * 登录语义的让位判据要读角色，因此排在收窄之后。
   *
   * 六道守卫的必要性：
   * - 总闸关闭时整条链不启动，页面不注入任何扩展 UI（对齐「关闭即完全不出现」的标签承诺）；
   * - 会话必须有效：身份库密文只在解锁会话内可读，锁定态出提示会把用户引向空库；
   * - `allFrames` 注入让内容脚本在每个 iframe 各跑一份，而广告/统计 iframe 里的悬浮气泡
   *   既不在用户的注视点上，也给页面脚本多一个可反复触发的扩展 UI，只在顶层 frame 出提示；
   * - 焦点目标必须是 `input` / `textarea` / `select` 三类控件之一，包裹元素上挂气泡没有意义；
   * - 只读的框不参与（`readOnly`）：气泡唯一的动作是「把这格填上」，而组件库的日期选择器与
   *   下拉代理框、页面自己回写的灰底框都写成只读，提示挂在它们下面是一句做不到的承诺；
   * - 快速填充真正认领的字段由钥匙图标负责，不再叠一层提示。让位的判据取
   *    {@link shouldShowSidePanel} 而非 `getFieldType`：后者只看桶归属，前者才是触发条件。
   *    用桶归属会把注册页的手机号框一并挡掉——它进了 mobile 桶，却因不在登录表单里
   *    永远拿不到钥匙，结果是钥匙与提示双双落空。让位还要求这一档是钥匙取得出值的
   *    （{@link SIDE_PANEL_FILLABLE_ROLES}）：证件号这类框会被旧分桶误读成手机号框而挂上钥匙，
   *    但钥匙填不出身份库的值，跟着让位同样双双落空，所以这一档由提示补上。
   *
   * @param target 当前获得焦点的元素（`focusin` 的 retargeted 目标）
   */
  private handleIdentityHintOnFocus(target: HTMLElement): void {
    if (!this.identityHintEnabled) return;
    if (window !== window.top) return;

    // 提示只跟随真正的表单控件：`<input>` / `<textarea>` / `<select>` 三类都是个人信息的载体
    // （详细地址常用 textarea，地区/性别常用 select）。聚焦目标是包裹元素时不出提示——
    // 真实的焦点转移一定以控件为目标，收起上一枚气泡由 `focusout` 负责。
    if (!target.matches('input, textarea, select')) return;
    // 只读的框没有「把这格填上」这一步：组件库把日期选择器与下拉代理成 `<input readonly>`，
    // 页面回写的灰底框同理，焦点进得去、键盘打不进，对它们说「从身份库选择」是做不到的承诺。
    // 不看 `disabled`——那类控件（含 `<fieldset disabled>` 里的）根本拿不到焦点。
    if ('readOnly' in target && (target as HTMLInputElement).readOnly) return;

    const verdict = resolvePiiField(target);
    const role = normalizeIdentityHintRole(verdict.role);
    // 让位只对钥匙取得出值的那几档成立（判据取 shouldShowSidePanel 而非桶归属，见上方注释）；
    // 证件号这类被旧分桶误读成手机号框的字段，钥匙挂得上、值却填不进来，提示必须顶上。
    if (
      role !== null &&
      SIDE_PANEL_FILLABLE_ROLES.has(role) &&
      target instanceof HTMLInputElement &&
      this.shouldShowSidePanel(target)
    ) {
      return;
    }
    if (role === null) {
      // 气泡只跟随当前聚焦字段：新字段无身份语义时必须收起上一个字段的提示
      hideIdentityHint();
      return;
    }
    void this.revealIdentityHintWhenUnlocked(target, role, verdict.needsVerify);
  }

  /**
   * 会话有效时才展示身份提示
   *
   * 身份库的密文只在已解锁会话里可读：锁定态展示气泡会把用户引向
   * 「复验主密码 → 打开空身份库」的死路（`getAllIdentity` 拿不到会话数据密钥）。
   * `isSessionValid` 自带 5 秒结果缓存，个人信息字段聚焦频率低，不构成热路径 IO。
   *
   * 检查是异步的，返回后必须复核三件事：
   * - 总闸可能在这段时间被别的上下文拨到关；
   * - 焦点可能已经移到别的字段，迟到的气泡不能画到一个不再聚焦的字段上；
   * - 字段可能已被页面卸载。
   * 锁定态只收起「焦点仍在该字段」的气泡：若用户已移到下一个字段，
   * 那枚新气泡由它自己的检查负责，不能被这条迟到的结果误收。
   */
  private async revealIdentityHintWhenUnlocked(
    target: HTMLElement,
    role: IdentityHintRole,
    needsVerify: boolean,
  ): Promise<void> {
    let unlocked = false;
    try {
      unlocked = await StorageUtils.isSessionValid();
    } catch (error) {
      logger.debug('IdentityHint: 会话状态检查失败，按未解锁处理:', error);
    }
    if (this.disposed || !this.identityHintEnabled) return;
    if (!unlocked) {
      if (document.activeElement === target) hideIdentityHint();
      return;
    }
    if (document.activeElement !== target || !target.isConnected) return;
    showIdentityHint(target, role, needsVerify);
  }

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
      const entry = this.effectiveFillEntry;
      // 内联模式：不自动打开侧边栏，改为显示钥匙触发图标（点击图标展开面板）
      if (entry === 'inline') {
        this.inlineDropdown.showTriggerFor(input, {
          hasEyeToggle: this.isEyeToggleAtInputRight(input),
        });
        return;
      }
      // 「仅手动」档（全局设为 manual，或站点规则把自动弹出关掉）：聚焦与点击都不自动开侧边栏
      if (entry === 'manual') {
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
   *
   * 判据本体在 `formSelectors.looksLikePhoneField`（与账号候选排序同一把尺子），
   * 这里保留方法名是为了不改动本文件里那几处按业务语义读判的调用点。
   * @param input - 输入框元素
   * @returns 是否可能是手机号输入
   */
  private isLikelyMobileInput(input: HTMLInputElement): boolean {
    return looksLikePhoneField(input);
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
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * 监听页面导航事件（beforeunload、popstate）
   * URL 变化检测已合并至主 MutationObserver，此处仅保留 popstate 以捕获浏览器前进/后退
   */
  private addPageNavigationListener(): void {
    window.addEventListener('beforeunload', this.handlePageUnload);
    window.addEventListener('popstate', this.handlePopState);
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
        sendResponse(this.fillMobileCode(message.data));
        return true;
      case MessageType.FILL_TOTP:
        this.fillTotpCode(message.data.code).then(result => {
          sendResponse(result);
        });
        return true;
      case MessageType.CONTEXT_MENU_FILL:
        // 右键菜单填充：目标为被右键的输入框（由 contextMenuTarget 记忆），
        // 消息由 background 经 tabs.sendMessage({ frameId }) 定向本 frame
        fillContextMenuTarget(message.data).then(result => {
          if (result.success) this.showFillAck(resolveContextMenuInputTarget(), result.outcome);
          sendResponse(result);
        });
        return true;
      // 注意：SHOW_SIDEPANEL / HIDE_SIDEPANEL 是发往 Background 的侧边栏开关指令。
      // chrome.runtime.sendMessage 会广播到所有标签页的 content script，若在此响应：
      // 1) 会把同一消息再次广播（showSidePanel/hideSidePanel），多标签页间形成无限回显循环；
      // 2) content script 的同步响应会抢先于 Background 的异步权威响应，
      //    导致 popup 等发起方收到错误结果（如误报打开失败）。
      // 因此不处理、不响应，交由 Background 消息路由统一处理。
      case MessageType.OPEN_INLINE_DROPDOWN: {
        // 面板渲染需等 GET_MATCHING_ACCOUNTS 回包，因此异步回传「是否真的展开」，
        // 让 background 的会话失效引导能在面板未出现时回退到通知/提示条
        this.openInlineDropdown(message.data?.focusedOnly === true, message.data?.useContextMenuTarget === true).then(
          handled => sendResponse({ success: handled, handled }),
        );
        return true;
      }
      case MessageType.SHOW_PAGE_NOTICE: {
        // 页面内提示条：载荷视为不可信输入，文案限长且只走 textContent 渲染（不接受 HTML），
        // type 不在白名单内时降为 warning（避免下游解构 undefined 抛错），非法文案静默丢弃
        const noticeText = typeof message.data?.message === 'string' ? message.data.message.trim() : '';
        if (noticeText && document.body) {
          const type = isNotificationType(message.data.type) ? message.data.type : 'warning';
          showNativeNotification(noticeText.slice(0, NOTICE_MAX_LENGTH), type);
        }
        sendResponse({ success: true });
        return true;
      }
      default:
        return false; // 不响应，让消息传递给 background 处理
    }
  }

  /**
   * 快捷键 / Popup / 右键菜单引导触发：定位输入框并直接展开内联下拉面板（与点击钥匙图标一致）
   *
   * 目标字段选取：优先当前聚焦的登录字段；focusedOnly 为 false 时回退到页面已检测的
   * 首个可见登录字段（用户名 → 手机号 → 密码），复用 shouldShowSidePanel 的同一套
   * 字段组合判定，保证快捷键触发范围与钥匙图标展示范围一致。
   *
   * useContextMenuTarget 为 true 时（仅右键菜单会话失效引导）优先锁定到被右键的那个框：
   * 用户当时的注意力就在那里，且该轮只呈现锁定态「解锁后填充」卡片（不列账号），
   * 故有意不要求它命中登录字段判定；目标失效时自动回落到上述常规选取。
   *
   * @param focusedOnly 是否仅允许锚定当前聚焦的登录字段（background 两轮委派的第一轮）
   * @param useContextMenuTarget 是否优先锚定「用户右键的那个输入框」
   * @returns 本 frame 是否已定位到目标并真正展开面板
   */
  private async openInlineDropdown(focusedOnly: boolean, useContextMenuTarget = false): Promise<boolean> {
    // 右键菜单优先锚定被右键的框；目标已失效（移除 / 只读 / textarea）时回落到常规选取
    const target = useContextMenuTarget
      ? (resolveContextMenuInputTarget() ?? this.resolveInlineDropdownTarget(focusedOnly))
      : this.resolveInlineDropdownTarget(focusedOnly);
    if (!target) return false;
    return this.inlineDropdown.openPanelFor(target);
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
   * 页面是否已就绪到「可以试着填充」
   *
   * 判据刻意不把 `mobile` 单独算作就绪：搜索框、注册表单、收货地址页都会命中
   * `input[type="tel"]`，放宽到单字段等于把这些页面判成登录页。手机号 + 验证码同时存在
   * 才是国内短信登录页的形状，与 `shouldShowSidePanel` 里既有的组合判据同源，不是新造规则。
   *
   * @returns 是否存在可填充的登录表单
   */
  private get hasFillableLoginForm(): boolean {
    return (
      this.usernameFields.length > 0 ||
      this.passwordFields.length > 0 ||
      (this.mobileFields.length > 0 && this.verifyCodeFields.length > 0)
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

      if (this.hasFillableLoginForm) {
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
   * 账号值该进账号桶里的哪一个框
   *
   * `USERNAME_SELECTORS` 把 `[name*="email"]`、`[name*="mobile"]`、`[name*="user"]` 收进同一个桶，
   * 于是「手机号 / 邮箱二选一」这类两个框都渲染在页面上的登录表单，旧逻辑按文档顺序取首个，
   * 条目里存的是邮箱却可能写进手机号框（反之亦然）。
   *
   * 排序只在**多个候选**且**值形状明确**时介入，且只调次序、不淘汰候选：
   * ① 值是邮箱 → 邮箱语义框优先；② 值是国内手机号或带 `+` 的国际格式 → 手机号语义框优先；
   * ③ 其余情况（单候选、值形状不明确、无匹配语义的框）结果与文档顺序首个逐字节相同。
   * 语义自相矛盾的框（同时命中两组关键词）按通用处理，不抢优先位。
   *
   * @param fields - 账号候选字段列表
   * @param value - 要写入的账号值（条目的 username）
   * @returns 目标框，无有效字段时返回 null
   */
  private pickAccountField(fields: HTMLInputElement[], value: string): HTMLInputElement | null {
    const available = fields.filter(input => input.isConnected && isElementVisible(input));
    if (available.length <= 1) return available[0] ?? null;

    const wantedKind: AccountFieldKind | null = isEmailLikeValue(value)
      ? 'email'
      : isPhoneLikeValue(value)
        ? 'phone'
        : null;
    if (!wantedKind) return available[0];

    /** 0＝语义与值形状吻合，1＝通用框（不反对这个值），2＝语义与值冲突 */
    const scoreOf = (input: HTMLInputElement): number => {
      const kind = classifyAccountField(input);
      if (kind === wantedKind) return 0;
      return kind === 'generic' ? 1 : 2;
    };

    // 严格小于：同分时保留排在前面的那个，与旧逻辑的「首个可见」结果一致
    return available.reduce((best, current) => (scoreOf(current) < scoreOf(best) ? current : best), available[0]);
  }

  /**
   * 密码值该进哪个密码框
   *
   * `VERIFY_CODE_SELECTORS` 里 `input[name*="otp"]`、`[name*="2fa"]` 这些条目不带 type 限定，
   * 而密码检测又是无条件收 `input[type="password"]`，于是「把动态口令框做成掩码输入」的站点
   * 会让同一个框同时出现在密码桶与验证码桶里。密码取首个的旧写法，在一页既有登录密码框
   * 又有掩码口令框时可能把条目的静态密码写进口令框（银行 / 券商网页登录就是这个形状）。
   *
   * 只在候选之间调次序、不新增拒填路径：单候选或全同分时结果与「取首个可见」逐字节相同。
   *
   * @returns 目标密码框，无可见字段时返回 null
   */
  private pickPasswordField(): HTMLInputElement | null {
    const available = this.passwordFields.filter(input => input.isConnected && isElementVisible(input));
    if (available.length === 0) return null;
    /** 0＝语义不像一次性口令（正是静态密码该去的地方），1＝像口令 */
    const scoreOf = (input: HTMLInputElement): number => (looksLikeCodeField(input) ? 1 : 0);
    // 严格小于：同分时保留排在前面的那个，与旧逻辑的「首个可见」结果一致
    return available.reduce((best, current) => (scoreOf(current) < scoreOf(best) ? current : best), available[0]);
  }

  /**
   * 手机号 + 短信码登录页里，账号（手机号）应该落到哪个 tel 框
   *
   * 仅在「页面确实没有密码框」时由账号回退路径调用。`mobileFields` 里混着国家码 / 区号等
   * 子字段，直接取首个可见项会把整串手机号写进 3～4 位的短框，因此这里加两道约束：
   * ① 排除 `isPhoneExtensionField` 命中的号码子字段；
   * ② 优先取与某个验证码字段同属一个 `<form>` 的 tel 框——这才是「手机号 + 短信码」的登录形状，
   *    避开另一表单里「绑定手机号 / 短信找回」用途的 tel 输入。
   * 无同表单项时退回首个非子字段 tel，兼容 tel 框未包裹在 `<form>` 内的页面；一个都不剩则返回
   * null（宁可回退到「未填充并提示」，也不写进明显错误的短框）。
   *
   * @returns 应作为账号目标的手机号框，无合适字段时返回 null
   */
  private findMobileAccountField(): HTMLInputElement | null {
    const candidates = this.mobileFields.filter(
      input => input.isConnected && isElementVisible(input) && !isPhoneExtensionField(input),
    );
    if (candidates.length === 0) return null;
    const verifyForms = new Set(this.verifyCodeFields.filter(field => field.isConnected).map(field => field.form));
    return candidates.find(input => input.form !== null && verifyForms.has(input.form)) ?? candidates[0];
  }

  /**
   * 在页面内给出「填充已落地」的回执
   *
   * 侧边栏 / popup 在填充成功后会各自关闭，快捷键与右键菜单同样没有页面内提示，
   * 回执胶囊因此锚定在刚写入的那个字段下缘，让确认动作发生在用户视线当前位置。
   * `unverified`（写入成功但站点未必登记了 input 事件）换成「请核对」文案，
   * 因为这一档真正需要用户看一眼。胶囊只渲染固定文案，不含任何填充值。
   *
   * @param field - 刚写入值的字段，无有效字段时静默跳过
   * @param outcome - 填充成功档位，来自 FillResult.outcome
   */
  private showFillAck(field: HTMLElement | null, outcome?: FillOutcome): void {
    // 填充路径含 await 复检窗口；destroy() 已执行后不得再重建胶囊/宿主与定时器
    if (!field || this.disposed) return;
    getFillAckChip().show(field, outcome === 'unverified' ? 'check' : 'filled', this.floatingButtonConfig.theme);
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
      // B11：等待期间若实例已销毁（导航/上下文失效），提前退出，不再重检测或写入
      if (this.disposed) return result;

      // 同步重检测（与 resolveInlineDropdownTarget 一致）：输入框获焦可能触发 SPA
      // 重渲染（浮动标签/受控组件重建），使缓存字段引用脱离文档，直接填充旧节点
      // 会导致可见输入框保持空白
      this.detectForms();

      if (!this.hasFillableLoginForm) {
        const detected = await this.waitForFieldsDetected();
        if (this.disposed) return result;
        if (!detected) {
          result.message = tl('cs.fd.noFormFields');
          result.reason = 'no_form';

          // F1-C: 显示填充失败就地引导（仅首次，且受影子 DOM 穿透开关门控）
          if (this.penetrateShadowEnabled && !this.fillFailurePromptShown) {
            this.fillFailurePromptShown = true;
            // 延迟渲染，避免阻塞主线程
            setTimeout(() => {
              try {
                import('./FillFailurePrompt')
                  .then(module => {
                    module.showFillFailurePrompt(this.domain);
                  })
                  .catch(err => {
                    logger.debug('加载 FillFailurePrompt 失败:', err);
                  });
              } catch (err) {
                logger.debug('显示填充失败提示失败:', err);
              }
            }, 0);
          }

          return result;
        }
      }

      // 回执锚点：记下真正写进去的那个框，密码框优先（用户最关心它有没有落进去）
      let ackField: HTMLInputElement | null = null;

      // 填充用户名（仅选取仍在文档中且可见的字段，避免写入已分离的过期节点）
      if (data.username) {
        // 手机号 + 短信码登录页既没有账号框也没有密码框，而条目里的 username 存的就是手机号。
        // 回退只在「页面上确实没有密码框」时成立：只要存在密码框，这就是账号密码表单，
        // 此时页面里另一个 tel 输入框通常是「绑定手机号/短信找回」而非登录账号，写进去是错的。
        const usernameField =
          this.pickAccountField(this.usernameFields, data.username) ??
          (this.passwordFields.length === 0 ? this.findMobileAccountField() : null);
        if (usernameField) {
          result.details.usernameField.found = true;
          const fillResult = await this.inputFiller.setInputValueWithStrategies(usernameField, data.username);
          result.details.usernameField.filled = fillResult.filled;
          result.details.usernameField.verified = fillResult.verified;
          result.details.strategy = fillResult.strategy;
          if (fillResult.filled) ackField = usernameField;
        }
      }

      // 填充密码（仅选取仍在文档中且可见的字段，避免写入已分离的过期节点）
      if (data.password) {
        const passwordField = this.pickPasswordField();
        if (passwordField) {
          result.details.passwordField.found = true;
          const fillResult = await this.inputFiller.setInputValueWithStrategies(passwordField, data.password);
          result.details.passwordField.filled = fillResult.filled;
          result.details.passwordField.verified = fillResult.verified;
          if (fillResult.filled) ackField = passwordField;
          if (fillResult.strategy !== 'native') {
            result.details.strategy = fillResult.strategy;
          }
        }
      }

      this.checkboxHandler.autoCheckNearestCheckbox(
        this.checkboxFields,
        this.passwordFields,
        this.usernameFields,
        this.mobileFields,
      );

      const usernameSuccess = !data.username || result.details.usernameField.verified;
      const passwordSuccess = !data.password || result.details.passwordField.verified;

      if (usernameSuccess && passwordSuccess) {
        result.success = true;
        result.outcome = 'verified';
        result.message = tl('cs.fd.fillSuccess');
      } else if (result.details.usernameField.filled || result.details.passwordField.filled) {
        result.success = true;
        result.outcome = 'unverified';
        result.message = tl('cs.fd.fillCheck');
      } else {
        result.reason = 'nothing_filled';
        result.message = tl('cs.fd.fillIncomplete');
      }

      // 回执只跟着「真正写进去的字段」走：失败路径必然一个字段都没写（ackField 仍为 null），
      // 此时提示语由发起方（侧边栏 / popup / 内联面板）展示且面板刻意保持打开，
      // 再叠一枚胶囊就是同一件事说两遍
      this.showFillAck(ackField, result.outcome);

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
      result.reason = 'fill_error';
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
   *
   * 回执与返回值只跟着「是否真的写进了那个可见的手机号框」走：找不到可填字段时
   * `success` 为 false，不再无条件谎报成功（与账号密码填充支路的 outcome 契约同口径）。
   * 号码本身写入即视为「已填充」（验证码由用户手动获取，不在本方法职责内）。
   * @param data - 包含手机号和验证码的数据
   * @returns 填充是否落地，以及面向发起方的提示文案
   */
  private fillMobileCode(data: { mobile: string; code: string }): { success: boolean; message: string } {
    try {
      // 回执锚点：写到「仍在文档中且可见」的框才算真的落地，与密码填充同一口径
      let ackField: HTMLInputElement | null = null;

      if (data.mobile && this.mobileFields.length > 0) {
        const field = this.findMobileAccountField();
        if (field) {
          this.inputFiller.setInputValueNative(field, data.mobile);
          ackField = field;
        }
      }

      if (data.mobile && this.mobileFields.length === 0 && this.usernameFields.length > 0) {
        const field = this.pickAccountField(this.usernameFields, data.mobile);
        if (field) {
          this.inputFiller.setInputValueNative(field, data.mobile);
          ackField = field;
        }
      }

      this.checkboxHandler.autoCheckNearestCheckbox(
        this.checkboxFields,
        this.passwordFields,
        this.usernameFields,
        this.mobileFields,
      );

      this.showFillAck(ackField);

      setTimeout(() => {
        this.hideSidePanel();
      }, 300);

      return { success: ackField !== null, message: tl(ackField ? 'cs.fd.fillDone' : 'cs.fd.fillIncomplete') };
    } catch (error) {
      logger.error('填充手机号+验证码失败:', error);
      return { success: false, message: tl('cs.fd.fillIncomplete') };
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
        result.reason = 'no_totp_input';
        result.message = tl('cs.fd.noTotpInput');
        return result;
      }

      // 优先写「仍在文档中且可见」的那个框：页面里常见一个 hidden 的 name="code" 输入
      // 排在可见框前面，取首个会把动态码写进看不见的框还回报「已填充」。
      // 一个都不可见时退回取首个（保留六格验证码组件那种「可见格子 + 隐藏真实输入」的页面形状，
      // 那类页面站点的 JS 正是从隐藏输入读值）。
      const field = this.findFillableField(this.verifyCodeFields) ?? this.verifyCodeFields[0];
      const fillResult = await this.inputFiller.setInputValueWithStrategies(field, code);
      result.success = fillResult.filled;
      result.details.strategy = fillResult.strategy;
      if (fillResult.filled) {
        // 与账号密码填充同一语义：写入成功但站点未登记 input 事件（未回读校验）时降级为「请核对」，
        // 动态码时效短、前端常受控更新，unverified 概率更高，不能一律报「已填充」误导用户。
        result.outcome = fillResult.verified ? 'verified' : 'unverified';
        result.message = tl('cs.fd.totpFillSuccess');
      } else {
        result.reason = 'nothing_filled';
        result.message = tl('cs.fd.totpFillManual');
      }

      if (result.success) {
        this.showFillAck(field, result.outcome);
        setTimeout(() => {
          this.hideSidePanel();
        }, 300);
      }
    } catch (error) {
      logger.error('填充 TOTP 验证码失败:', error);
      result.reason = 'fill_error';
      result.message = tl('cs.fd.totpFillError');
    }

    return result;
  }

  /**
   * 销毁实例，清理所有监听器
   */
  public destroy(): void {
    this.disposed = true;
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
      this.detectionTimer = null;
    }
    document.removeEventListener('click', this.handleDelegatedClick, { capture: true });
    document.removeEventListener('focusin', this.handleDelegatedFocusIn, { capture: true });
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('DOMContentLoaded', this.handleDomReady);
    window.removeEventListener('beforeunload', this.handlePageUnload);
    window.removeEventListener('popstate', this.handlePopState);
    if (this.storageListener) {
      try {
        chrome.storage.onChanged.removeListener(this.storageListener);
      } catch {
        // 上下文失效时 removeListener 可能抛错，监听器已被 Chrome 自动清理，忽略
      }
      this.storageListener = null;
    }
    if (this.siteRuleListener) {
      try {
        chrome.storage.onChanged.removeListener(this.siteRuleListener);
      } catch {
        // 同上，忽略上下文失效导致的移除异常
      }
      this.siteRuleListener = null;
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
    destroyFillAckChip();
    destroyIdentityHint();
  }
}
