import {
  MessageType,
  type AutoSaveConfig,
  type CredentialStatusResponse,
  type DomainPattern,
  type PendingCipherKeyResponse,
  type RuntimeMessage,
} from '@/utils/types';
import { isSameMainDomain } from '@/utils/domain';
import type { DelegatedSavePromptResponse } from '@/utils/types';
import type {
  PendingCredentials,
  SavePromptControls,
  SavePromptData,
  SavePromptPrecheckInfo,
  NotificationType,
} from '@/entrypoints/content/types';
import { StorageUtils } from '@/utils/storage';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';
import { deriveCapturedTag } from '@/utils/capturedTag';
import { logger } from '@/utils/logger';
import { hashStringLight } from '@/utils/crypto-light';
import { decryptPendingCredential, encryptPendingCredential } from '@/utils/pendingCredentialCodec';
import {
  USERNAME_SELECTORS,
  LOGIN_BUTTON_KEYWORDS,
  normalizeButtonText,
  hasPhoneEvidence,
  hasEmailEvidence,
  hasVerifyCodeEvidence,
  isPhoneExtensionField,
  looksLikePostalCode,
  isOneTimeCodeValue,
} from '@/entrypoints/content/formSelectors';
import { showNativeNotification } from '@/entrypoints/content/NativeNotification';
import { showSavePasswordPrompt, dismissSavePasswordPrompt } from '@/entrypoints/content/SavePasswordPrompt';
import { isElementVisible } from './domUtils';
import { tl } from '@/utils/i18n-lite';

/** sessionStorage 中存储待确认凭证密文的 key */
const PENDING_SAVE_KEY = '__aph_pending_save__';

/**
 * 旧版遗留在宿主页面 sessionStorage 中的密钥 key
 *
 * 曾经「密文 + 解密密钥」同放页面可达存储，页面任意脚本一次读取即可还原明文凭据。
 * 密钥已改由 background 签发并只存 storage.session；此处仅用于一次性清除升级前残留。
 */
const LEGACY_PAGE_CIPHER_KEY = '__aph_sk__';

/** 待确认凭证最大有效期（30 秒），超过则丢弃 */
const PENDING_MAX_AGE_MS = 30_000;

/** 「暂不保存」后的冷却期（60 秒），冷却期内相同凭证不重复弹窗 */
const DISMISS_COOLDOWN_MS = 60_000;

/**
 * 密码框选择器
 *
 * `data-aph-password` 是密码可见性切换打下的稳定标记：站点把 `type` 从 password 改成 text
 * 之后，光看 type 就认不出那是密码框了。
 */
const PASSWORD_FIELD_SELECTOR = 'input[type="password"], input[data-aph-password]';

/**
 * 无用户意图信号的重读（挂载同步、保存重读）是否可采纳为确认值
 *
 * 站点常在提交处理器里把口令/账号原地改写成密文或令牌（前端 RSA/SM2 加密一类），
 * 这类程序化改写不经过 input 事件、也从未出现在弹窗里。容量内的重读值才可能是
 * 用户补敲的编辑；越限的一律保留确认值——否则用户确认的是明文、落盘的却是密文，
 * 且必然撞后台容量闸门，而弹窗里账号/密码只读，用户删标签备注也救不回来（issue #167）。
 * input 事件带用户意图，不走本判据（用户真粘贴了超长口令时应如实拒收并指明字段）。
 *
 * @param field 字段名
 * @param value 重读到的 DOM 值
 * @returns 是否采纳
 */
function isAdoptableReread(field: 'username' | 'password', value: string): boolean {
  return value.length <= PASSWORD_FIELD_LIMITS[field];
}

/** 一次登录提交采集到的凭据 */
interface CapturedCredentials {
  /** 账号值（`mobileLogin` 为真时是手机号或邮箱） */
  username: string;
  /** 密码明文；`mobileLogin` 为真时为空串 */
  password: string;
  /** 本次是否为「账号 + 验证码」形态（手机号或邮箱） */
  mobileLogin: boolean;
  /** 捕获到的密码框引用，供弹窗显示期间同步展示值；验证码登录形态下为 null */
  passwordField: HTMLInputElement | null;
}

// ── 凭据密文的密钥（由 background 签发，绝不落入宿主页面可达的存储） ──

/** 密钥申请的最大尝试次数：瞬态失败（后台冷启动、安装/更新瞬间）可重试，超预算则本文档内放弃 */
const CIPHER_KEY_MAX_ATTEMPTS = 3;

/**
 * 当前文档的凭据密钥 Promise（同一文档内复用，避免每次读写都跨进程申请）
 *
 * 刻意缓存 Promise 而非结果：所有读写路径 await 同一个 Promise，续体按注册顺序执行，
 * 因此 sessionStorage 的写入顺序与用户输入顺序一致（旧实现靠同步写入天然满足这一点）。
 * 密钥只存在于内容脚本闭包与 background 的 storage.session 中，宿主页面无法读取。
 */
let _cipherKeyPromise: Promise<string | null> | null = null;
/** 已发起的密钥申请次数（仅在未拿到密钥时递增） */
let _cipherKeyAttempts = 0;

/** 向 background 申请一次当前 tab + origin 的凭据密钥 */
async function requestCipherKey(): Promise<string | null> {
  try {
    if (!chrome.runtime?.id) return null;
    const response = (await chrome.runtime.sendMessage({
      type: MessageType.GET_PENDING_CIPHER_KEY,
    })) as PendingCipherKeyResponse | undefined;
    return typeof response?.key === 'string' && response.key ? response.key : null;
  } catch {
    return null;
  }
}

/**
 * 取得（或复用）当前 tab + origin 的凭据密钥
 *
 * 失败结果不入缓存：后台不可达多为瞬态（SW 冷启动、扩展刚重载），钉死 null 会把既有的
 * 「跳转后复现弹窗」能力整体降级。重试上限避免在后台长期不可用时退化成逐次击键的 RPC。
 *
 * @returns 64 位 hex 密钥；拿不到时返回 null，调用方据此放弃持久化（绝不退回明文存储），
 *   代价仅落在「跳转后复现弹窗」这一增强路径，当前页面的弹窗流程不受影响
 */
function getCipherKey(): Promise<string | null> {
  if (_cipherKeyPromise) return _cipherKeyPromise;
  if (_cipherKeyAttempts >= CIPHER_KEY_MAX_ATTEMPTS) return Promise.resolve(null);
  _cipherKeyAttempts++;

  const attempt = requestCipherKey();
  _cipherKeyPromise = attempt;
  void attempt.then(key => {
    // 仅当期间没有新的申请插进来时才清掉失败缓存，下一次读写可重试
    if (!key && _cipherKeyPromise === attempt) _cipherKeyPromise = null;
  });
  return attempt;
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
  /** 已屏蔽的域名列表（用户点击「不再提示」后加入） */
  private excludedDomains: string[] = [];
  /** 上次弹窗对应的凭证指纹（用于智能去重） */
  private lastPromptedFingerprint = '';
  /** 上次弹窗的时间戳 */
  private lastPromptTime = 0;
  /** 上次弹窗的凭证是否已被用户确认保存 */
  private lastPromptSaved = false;
  /** 会话是否已被外部通知过期（闲时锁定、手动清除等场景，由 SESSION_EXPIRED 广播触发） */
  private sessionExpired = false;
  /** 最近一次捕获的密码输入框 DOM 引用（用于弹窗显示期间实时同步表单值） */
  private lastCapturedPasswordField: HTMLInputElement | null = null;
  /** 最近一次捕获的表单 DOM 引用（用于查找用户名字段以实时同步） */
  private lastCapturedForm: HTMLFormElement | null = null;
  /** 弹窗当前向用户展示的账号（捕获值 + 弹窗期间被采纳的编辑）；null 表示本轮无本地弹窗（iframe 委托） */
  private confirmedUsername: string | null = null;
  /** 弹窗当前向用户展示的口令；口径同 confirmedUsername */
  private confirmedPassword: string | null = null;
  /**
   * 待保存状态的变更代数（每次写入与每次清除各自递增）
   *
   * 密钥改由 background 签发后，写入前要多等一次跨进程往返；旧同步实现天然保证
   * 「clearPending 一定落在写入之后」，这里用代数显式恢复该顺序：await 期间代数一旦变化，
   * 说明已被更新的捕获或清除取代，陈旧写入必须丢弃，否则会复活本该删除的密文容器。
   */
  private pendingToken = 0;
  /** 字段同步监听器的清理函数列表 */
  private fieldSyncCleanups: (() => void)[] = [];
  /** MutationObserver 用于监听动态新增的密码字段并自动标记 data-aph-password */
  private passwordFieldObserver: MutationObserver | null = null;

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
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.handleStorageChange);
    }
    // 监听 runtime 消息，感知会话过期广播（闲时锁定、手动清除等场景）
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);
    }

    // 清除升级前残留在宿主页面中的 XOR 密钥（密钥现由 background 签发，页面不该再持有）
    try {
      sessionStorage.removeItem(LEGACY_PAGE_CIPHER_KEY);
    } catch {
      // sessionStorage 不可用时忽略（如隐私模式）
    }

    // 标记页面上所有密码字段，确保 type 被切换为 text 后仍能通过组合选择器定位
    this.markExistingPasswordFields();
    this.observeNewPasswordFields();

    // 异步加载配置（不影响事件监听器注册）
    try {
      const config = await StorageUtils.getAutoSaveConfig();
      this.isEnabled = config.enabled;
      this.domainPatterns = config.domainPatterns;
      this.excludedDomains = config.excludedDomains;
      this.configLoaded = true;
    } catch {
      // 配置加载失败时禁用自动保存，避免空 domainPatterns 匹配所有域名
      this.isEnabled = false;
      this.configLoaded = true;
    }

    // 检查是否有跨页面导航遗留的待确认凭证（传统表单提交场景）
    void this.checkPendingCredentials();
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
        if (Array.isArray(newConfig.excludedDomains)) {
          this.excludedDomains = newConfig.excludedDomains;
        }
      } else {
        // newValue 为空（存储被清除），回退到安全状态：禁用自动保存
        this.isEnabled = false;
        this.domainPatterns = [];
        this.excludedDomains = [];
      }
    }
  };

  /**
   * 处理 runtime 消息，感知会话过期广播
   * 闲时锁定或手动清除会话时，background 会广播 SESSION_EXPIRED，
   * content script 的内存缓存不会自动清除，需通过此标记同步。
   */
  private handleRuntimeMessage = (message: RuntimeMessage): void => {
    if (message?.type === MessageType.SESSION_EXPIRED) {
      this.sessionExpired = true;
      // 立即关闭已显示的弹窗
      dismissSavePasswordPrompt();
      // 清理表单字段同步监听器
      this.teardownFieldSync();
      // 卡片被外部移除后确认值再无展示载体，留着等于把明文挂在长生命周期实例上
      this.confirmedUsername = null;
      this.confirmedPassword = null;
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
      return;
    }

    const captured = this.readCredentials(form);
    if (!captured) {
      return;
    }

    // 存储字段引用，用于弹窗显示期间实时同步表单值
    this.lastCapturedPasswordField = captured.passwordField;
    this.lastCapturedForm = form;

    void this.onCredentialsCaptured(captured.username, captured.password, captured.mobileLogin);
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
      return;
    }

    // 从按钮所在的 form 或页面中获取账号密码
    const form = button.closest('form') as HTMLFormElement | null;
    const captured = this.readCredentials(form);
    if (!captured) {
      return;
    }

    // 存储字段引用，用于弹窗显示期间实时同步表单值
    this.lastCapturedPasswordField = captured.passwordField;
    this.lastCapturedForm = form;

    void this.onCredentialsCaptured(captured.username, captured.password, captured.mobileLogin);
  };

  /**
   * 处理键盘按下事件
   * 当用户在密码输入框中按 Enter 键时，尝试捕获凭证
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    // 输入法合成期间的 Enter 是「上屏候选词」而非提交，此刻捕获会把半截拼音当成凭证，
    // 故整段放行给 IME（与其他键盘入口同口径，由 imeKeyGuard 守卫钉住位置）
    if (e.isComposing) return;

    if (!this.isEnabled || !this.configLoaded) return;
    if (e.key !== 'Enter') return;

    const target = e.target as HTMLInputElement;
    if (!target || target.tagName !== 'INPUT') return;

    // 仅在密码框或常见文本输入框中按 Enter 时触发
    const inputType = target.type?.toLowerCase() || 'text';
    if (!['password', 'text', 'email', 'tel'].includes(inputType)) return;

    const form = target.closest('form') as HTMLFormElement | null;
    const captured = this.readCredentials(form);
    if (!captured) {
      return;
    }

    // 存储字段引用，用于弹窗显示期间实时同步表单值
    this.lastCapturedPasswordField = captured.passwordField;
    this.lastCapturedForm = form;

    void this.onCredentialsCaptured(captured.username, captured.password, captured.mobileLogin);
  };

  // ── 域名匹配 ──

  /**
   * 检查当前页面域名是否匹配自动保存规则（含黑名单检查）
   *
   * 黑名单优先级最高：已屏蔽的域名直接跳过，不再弹窗。
   * 域名匹配规则为空时匹配所有非黑名单域名。
   *
   * @returns 是否匹配（且未被屏蔽）
   */
  private isDomainMatch(): boolean {
    return StorageUtils.isDomainMatchForAutoSave(location.host, {
      enabled: this.isEnabled,
      domainPatterns: this.domainPatterns,
      excludedDomains: this.excludedDomains,
    });
  }

  // ── 弹窗与保存逻辑 ──

  /**
   * 凭证捕获后的统一处理入口
   * 存入 sessionStorage 并显示确认弹窗
   * @param username 用户名（验证码登录时是手机号或邮箱）
   * @param password 密码；`mobileLogin` 为真时为空串
   * @param mobileLogin 本次是否为「账号 + 验证码」登录（手机号或邮箱，页面无可用密码框）
   */
  private async onCredentialsCaptured(username: string, password: string, mobileLogin = false): Promise<void> {
    // 配置未加载完成时跳过，防止竞态条件导致空规则匹配所有域名
    if (!this.configLoaded) {
      return;
    }

    // 会话过期快速拦截：收到 SESSION_EXPIRED 广播后直接跳过
    if (this.sessionExpired) {
      return;
    }

    // 会话有效性检查：会话过期时不弹窗（兜底，覆盖自然过期场景）
    try {
      const sessionValid = await StorageUtils.isSessionValid();
      if (!sessionValid) {
        logger.debug('[APH] 会话已过期，跳过保存弹窗');
        return;
      }
    } catch {
      // 会话检查失败时视为无效，不弹窗
      return;
    }

    // 域名匹配检查：配置的规则列表非空时，仅对匹配的域名弹窗
    if (!this.isDomainMatch()) {
      return;
    }

    // 同页防抖：基于凭证指纹 + 冷却期，吸收 submit+click+enter 三连触发
    const fingerprint = this.createCredentialFingerprint(username, password);
    if (!this.shouldShowPrompt(fingerprint)) {
      return;
    }
    // 立即记录指纹与时间作为「处理中」闩锁，避免同一次登录重复发起库级预检查
    this.lastPromptedFingerprint = fingerprint;
    this.lastPromptTime = Date.now();
    this.lastPromptSaved = false;

    // 先持久化待确认凭证（支持传统表单提交导航后在新页面恢复弹窗），再执行库级预检查
    const pending: PendingCredentials = {
      username,
      password,
      mobileLogin,
      url: location.host, // 使用 host（含端口号，如 localhost:3000、192.168.1.1:8080）
      // 只取标题里的站点名做预填：整串页面名普遍超单标签上限（编辑器里一改就被归一化丢掉），还会污染标签候选池（见 capturedTag）
      tag: deriveCapturedTag(document.title, location.hostname),
      remark: tl('cs.save.autoSaveRemark'),
      tagEdited: false,
      remarkEdited: false,
      timestamp: Date.now(),
      mode: 'save',
      // 与 url 同帧采集：跳转后恢复弹窗时，归属判定仍按登录那一页的端点算
      protocol: location.protocol,
    };
    void this.persistPending(pending);

    // 库级预检查：查询该域名+账号在密码库中的状态，决定是否/如何弹窗
    await this.evaluateAndPrompt(pending);
  }

  /**
   * 将待确认凭证加密后持久化到 sessionStorage
   *
   * 支持传统表单提交导航后，在目标页面由 checkPendingCredentials 恢复弹窗。
   * 密钥由 background 按 tab + origin 签发且只存 storage.session，页面侧只剩不可解的密文；
   * 申请不到密钥（后台不可达 / 无法归属来源）时直接放弃持久化，绝不退回明文存储，
   * 代价仅为「跳转后不再复现弹窗」，当前页面的弹窗流程不受影响。
   * sessionStorage 不可用时（如隐私模式）同样静默忽略。
   * @param pending 待确认的凭证数据
   */
  private async persistPending(pending: PendingCredentials): Promise<void> {
    const token = ++this.pendingToken;
    const key = await getCipherKey();
    if (!key || token !== this.pendingToken) return;
    try {
      sessionStorage.setItem(PENDING_SAVE_KEY, encryptPendingCredential(JSON.stringify(pending), key));
    } catch {
      // sessionStorage 不可用时忽略（如隐私模式）
    }
  }

  /**
   * 向 background 查询凭证在密码库中的状态
   *
   * 仅发送账号/密码/站点/协议，background 侧比对后返回状态枚举与非密码元数据，
   * 绝不回传已存明文密码。上下文失效或查询失败时保底返回 new，不阻断保存流程。
   *
   * 站点刻意用 `location.host` 而非 `hostname`，与写入条目时（见 `handleLogin` 构造的 pending.url）
   * 同口径：预检查与落盘若按两个不同的站点串去判重，端口隔离下会出现
   * 「弹窗说新账号、实际更新了另一条」的自相矛盾。协议只补这一位，是为了让后台能分辨
   * 页面在 443 还是 80——`location.host` 会把协议默认端口省略掉。
   *
   * @param username 用户名
   * @param password 密码
   * @param mobileLogin 本次是否为「账号 + 验证码」登录（手机号或邮箱），决定后台是否认这个空密码
   * @returns 凭证状态响应
   */
  private async resolveCredentialStatus(
    username: string,
    password: string,
    mobileLogin: boolean,
  ): Promise<CredentialStatusResponse> {
    try {
      if (!chrome.runtime?.id) {
        return { status: 'new' };
      }
      const response = (await chrome.runtime.sendMessage({
        type: MessageType.CHECK_CREDENTIAL_STATUS,
        data: { username, password, mobileLogin, url: location.host, protocol: location.protocol },
      })) as CredentialStatusResponse | undefined;
      return response?.status ? response : { status: 'new' };
    } catch {
      // 预检查失败时保底按新账号处理，不阻断保存流程
      return { status: 'new' };
    }
  }

  /**
   * 对待确认凭证执行库级预检查并据此展示弹窗
   *
   * - identical：账号密码已是最新，无需保存，完全静默并清除待确认凭证
   * - locked：会话失效，清除并跳过
   * - password_changed：以「更新」模式展示（用户未编辑时用已存标签/备注预填）
   * - new：以「保存」模式展示
   *
   * 预检查一并返回的风险提示与去向提示作为独立参数向下传递，
   * **不写入 pending 也不进 sessionStorage**：它们都是基于当次密码的派生结论，
   * 一旦持久化就可能在用户改密码后变成陈旧数据；跳页恢复路径也会重新
   * 进入本方法拿到新鲜值。
   *
   * @param pending 待确认的凭证数据
   */
  private async evaluateAndPrompt(pending: PendingCredentials): Promise<void> {
    const { status, existing, risk, targetNote } = await this.resolveCredentialStatus(
      pending.username,
      pending.password,
      pending.mobileLogin === true,
    );

    // await 期间可能收到 SESSION_EXPIRED 广播，二次确认避免过期后仍弹窗
    if (this.sessionExpired) {
      this.clearPending();
      return;
    }

    if (status === 'identical') {
      // 相同凭证无需保存：完全静默，并标记已保存以短路同页后续触发
      this.lastPromptSaved = true;
      this.clearPending();
      return;
    }

    if (status === 'locked') {
      this.clearPending();
      return;
    }

    if (status === 'password_changed') {
      pending.mode = 'update';
      // 用户尚未在弹窗中编辑时，用已存条目的标签/备注预填，保持与列表一致
      if (!pending.tagEdited && existing?.tag) pending.tag = existing.tag;
      if (!pending.remarkEdited && existing?.remark) pending.remark = existing.remark;
    } else {
      pending.mode = 'save';
    }

    // 回写带最终 mode/预填的 pending，确保传统导航后新页面恢复一致
    void this.persistPending(pending);
    this.showPrompt(pending, { risk, targetNote });
  }

  /**
   * 页面加载时检查是否有跨页面导航遗留的待确认凭证
   * 传统表单提交会导致页面跳转，弹窗需要在目标页面显示
   */
  private async checkPendingCredentials(): Promise<void> {
    // 配置未加载完成时跳过
    if (!this.configLoaded) return;

    // 会话过期快速拦截：收到 SESSION_EXPIRED 广播后直接跳过
    if (this.sessionExpired) return;

    // 会话有效性检查：会话过期时不弹窗（兜底，覆盖自然过期场景）
    try {
      const sessionValid = await StorageUtils.isSessionValid();
      if (!sessionValid) return;
    } catch {
      return;
    }

    try {
      const encrypted = sessionStorage.getItem(PENDING_SAVE_KEY);
      if (!encrypted) return;

      // 密钥来自 background（只存 storage.session，页面不可读）。申请不到时不改写页面数据：
      // 我们无权判定这条密文无效，而它本就受 30 秒 TTL 约束自然作废。
      const key = await getCipherKey();
      if (!key) return;

      const raw = decryptPendingCredential(encrypted, key);
      if (!raw) {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
        return;
      }

      const pending = JSON.parse(raw) as PendingCredentials;

      // 校验数据有效性：必须有用户名，且在有效期内。空口令只在发送方声明了 `mobileLogin` 时合法
      // （验证码登录本来就没有口令），必须是严格 true——这里读的是页面里的密文，
      // 脏值不该换来一次弹窗；少了这一位，整页跳转式验证码登录的弹窗会在恢复时被当脏数据静默删除。
      if (!pending.username || (!pending.password && pending.mobileLogin !== true)) {
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

      // 有效凭证，先经同页防抖，再交由库级预检查决定是否/如何弹窗
      const fingerprint = this.createCredentialFingerprint(pending.username, pending.password);
      if (this.shouldShowPrompt(fingerprint)) {
        this.lastPromptedFingerprint = fingerprint;
        this.lastPromptTime = Date.now();
        this.lastPromptSaved = false;
        await this.evaluateAndPrompt(pending);
      } else {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
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
   * @param pending 待确认的凭证数据（含标签和备注默认值）
   * @param precheck 预检查得出的展示信息（风险提示、保存去向提示），仅用于弹窗内联展示
   */
  private showPrompt(pending: PendingCredentials, precheck: SavePromptPrecheckInfo = {}): void {
    // 如果在 iframe 中运行，委托给顶层 frame 渲染弹窗，
    // 避免弹窗被限制在 iframe 的小视口内（而非整个页面右上角）
    if (window !== window.top) {
      this.delegatePromptToTopFrame(pending, precheck);
      return;
    }

    // 先清理上一次弹窗的字段同步监听器，防止重复弹窗时泄漏
    this.teardownFieldSync();

    try {
      // 确认值以弹窗展示值为起点：保存时 DOM 重读越限（站点提交后改写）就回落到这里
      this.confirmedUsername = pending.username;
      this.confirmedPassword = pending.password;
      const controls = showSavePasswordPrompt(
        {
          username: pending.username,
          password: pending.password,
          mobileLogin: pending.mobileLogin,
          url: pending.url,
          tag: pending.tag,
          remark: pending.remark,
          mode: pending.mode ?? 'save',
          risk: precheck.risk,
          targetNote: precheck.targetNote,
        },
        editedData =>
          this.handleSave({
            ...pending,
            tag: editedData.tag,
            remark: editedData.remark,
            tagEdited: editedData.tagEdited,
            remarkEdited: editedData.remarkEdited,
          }),
        () => this.handleDismiss(),
        () => this.handleNeverAsk(pending),
      );

      // 弹窗显示后，监听宿主页面表单字段的 input 事件实时同步展示值
      this.setupFieldSync(controls);
    } catch (err) {
      logger.warn('[APH] 弹窗显示失败:', err);
      // 弹窗显示失败时回退到通知提示
      showNativeNotification(tl('cs.notify.promptFailed'), 'warning');
    }
  }

  /**
   * 将保存确认弹窗委托给顶层 frame 渲染
   *
   * 通过 Background 认证通道将凭证定向顶层文档，宿主页面不能旁听或伪造确认。
   * Background 校验会话、两端文档与一次性请求后，沿原请求通道返回决定。
   * 当前实例保持保存/忽略/不再提示的既有行为。
   *
   * @param pending 待确认的凭证数据
   * @param precheck 预检查得出的展示信息，随 promptData 一同跨帧透传（接收方会再次校验）
   */
  private delegatePromptToTopFrame(pending: PendingCredentials, precheck: SavePromptPrecheckInfo = {}): void {
    // 安全校验：仅在顶层 frame 与当前 frame 同主域名时才委托，
    // 防止跨域 iframe 场景下明文密码通过 postMessage 泄露给第三方页面
    // 使用 location.ancestorOrigins（Chrome 专有 API）获取顶层 origin，
    // 不会因跨子域名（如 account.aliyun.com ⊂ bailian.console.aliyun.com）抛出 SecurityError
    const ancestorOrigins = location.ancestorOrigins;
    const topOrigin = ancestorOrigins[ancestorOrigins.length - 1];

    if (!topOrigin || !isSameMainDomain(topOrigin, location.origin)) {
      // 顶层 origin 解析不出（sandbox iframe 禁用 ancestorOrigins），或与之不同主域名
      // （如 attacker.com 嵌入 bank.com）：两种情况下都不能把明文凭据跨帧广播，
      // 只把这条不含凭证的提示委托出去
      this.delegateNotificationToTopFrame(tl('cs.notify.foundManualAdd', { url: pending.url }), 'warning');
      return;
    }

    const promptData: SavePromptData = {
      username: pending.username,
      password: pending.password,
      mobileLogin: pending.mobileLogin,
      url: pending.url,
      tag: pending.tag,
      remark: pending.remark,
      mode: pending.mode ?? 'save',
      risk: precheck.risk,
      targetNote: precheck.targetNote,
    };
    // 凭据与确认只经扩展通道流转。原请求通道绑定本 document，导航不会将回执交给新文档。
    this.clearPending();
    const token = this.pendingToken;
    void (async () => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: MessageType.DELEGATE_SAVE_PROMPT,
          data: promptData,
        })) as DelegatedSavePromptResponse | undefined;
        if (this.sessionExpired || token !== this.pendingToken) return;
        if (!response?.success) {
          showNativeNotification(tl('cs.notify.foundManualAdd', { url: pending.url }), 'warning');
          return;
        }
        const decision = response.decision;
        if (decision.action === 'save') {
          await this.handleSave({ ...pending, ...decision.editedData });
        } else if (decision.action === 'neverAsk') {
          await this.handleNeverAsk(pending);
        } else {
          this.handleDismiss();
        }
      } catch {
        if (!this.sessionExpired && token === this.pendingToken) {
          showNativeNotification(tl('cs.notify.foundManualAdd', { url: pending.url }), 'warning');
        }
      }
    })();
  }

  /**
   * 将通知委托给顶层 frame 渲染
   *
   * 当 iframe 中无法显示保存弹窗（跨域/沙箱限制）时，把一条不含凭证的提示委托给顶层
   * frame 渲染，确保提示出现在整个页面右上角而非被限制在 iframe 的小视口内。
   *
   * 委托走 background，不再用 `window.top.postMessage`：postMessage 的载荷类型是包内
   * 公开可得的字符串常量，宿主页面脚本一次 `postMessage({type:'APH_SHOW_NOTIFICATION'})`
   * 就能冒充扩展在页面右上角说话；而 `chrome.runtime` 消息的 `sender.id` 由浏览器盖章，
   * 页面世界无法伪造。后台据此以 `{ frameId: 0 }` 定向本标签页顶层 frame，投递目标
   * 由浏览器而非我们解析的 origin 决定，sandbox / 跨域两种场景因此共用同一条安全路径。
   * 后台不可达（扩展上下文失效）或未成功投递时回退到当前 frame 渲染——宁可位置降级。
   *
   * @param message - 通知消息内容
   * @param type - 通知类型
   */
  private delegateNotificationToTopFrame(message: string, type: NotificationType): void {
    /** 降级路径：当前 frame 渲染 */
    const renderLocally = (): void => showNativeNotification(message, type);

    try {
      chrome.runtime
        .sendMessage({ type: MessageType.DELEGATE_PAGE_NOTICE, data: { message, type } })
        .then((response: { success?: boolean } | undefined) => {
          if (!response?.success) renderLocally();
        })
        .catch(renderLocally);
    } catch {
      // 扩展上下文已失效，sendMessage 同步抛错
      renderLocally();
    }
  }

  /**
   * 重新从 DOM 中捕获当前表单中的用户名和密码
   *
   * 口令只认捕获时存下的那个精确字段引用（`lastCapturedPasswordField`）：它仍连在文档上就读实时值，
   * 脱离文档就返回 `password: null`，由 `handleSave` 回退到弹窗展示值。账号不受此限，两条路径都实时重读。
   *
   * @returns 当前账号与口令；`password` 为 null 表示「没有可信的口令来源，用弹窗展示值」
   */
  private captureCurrentCredentials(): { username: string; password: string | null } | null {
    // 优先使用捕获时存储的精确字段引用
    const storedField = this.lastCapturedPasswordField;
    if (storedField?.isConnected && storedField.value) {
      const username = this.lastCapturedForm
        ? this.findUsernameInForm(this.lastCapturedForm)
        : this.findUsernameInPage();
      // 即使 username 查找失败（SPA 清空了用户名字段），
      // 密码值从精确引用读取也是正确的，空账号由 handleSave 视为无信号并回落确认值
      return { username: username || '', password: storedField.value };
    }

    // 引用失效：这次查询只用来定位账号所在的 form，**取到的口令值一律丢弃**。
    // 全文档作用域比捕获门的 form 宽，`data-aph-password` 还可由页面自设，弹窗开着的几十秒里
    // 页面另插一个带值的框就能让页面可控的口令落盘；此时授权位为假，存储层两道以 `!password`
    // 为键的闸门（空字段拒写、空口令不许覆盖已有真口令）全都拦不住非空值，库里已存的真实口令
    // 会被覆写，而用户点保存时看到的是弹窗里那份。账号仍走重读（用户可能改过账号）。
    const passwordField = document.querySelector(
      'input[type="password"], input[data-aph-password]',
    ) as HTMLInputElement | null;
    if (!passwordField?.value) return null;

    const form = passwordField.closest('form') as HTMLFormElement | null;
    const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
    if (!username) return null;

    return { username, password: null };
  }

  /**
   * 在宿主页面表单字段上注册 input 事件监听器，实时同步弹窗展示值
   *
   * 弹窗显示期间，用户可能在宿主页面修改登录表单的账号或密码，
   * 通过监听 input 事件实时调用 controls.updateUsername / updatePassword 更新弹窗文本。
   *
   * @param controls - 弹窗更新控制接口
   */
  private setupFieldSync(controls: SavePromptControls): void {
    const passwordField = this.lastCapturedPasswordField;
    if (!passwordField) {
      // 账号 + 验证码形态没有密码框可跟（`lastCapturedPasswordField` 恒为 null），但账号那一侧
      // 同样会在弹窗期间被改：不挂监听就会把提交时的旧账号存进库。用捕获时同一把尺子找回账号框。
      const mobileField = this.findMobileCodeField(this.lastCapturedForm ?? document);
      if (!mobileField) return;
      this.syncUsernameField(controls, mobileField);
      return;
    }

    // 监听密码框 input 事件，实时更新弹窗密码展示
    const adoptPassword = (value: string) => {
      this.confirmedPassword = value;
      controls.updatePassword(value);
      // 同步更新 sessionStorage，确保页面跳转后 checkPendingCredentials 读取到最新值
      void this.syncPendingToSession(value);
    };
    const onPasswordInput = () => adoptPassword(passwordField.value);
    passwordField.addEventListener('input', onPasswordInput);
    this.fieldSyncCleanups.push(() => {
      passwordField.removeEventListener('input', onPasswordInput);
    });
    // 立即同步一次，覆盖「捕获到弹窗挂载之间用户又补敲了几键」（那段时间没有监听器）。
    // 但此刻站点提交处理器可能已把口令原地改写成密文：越限的重读不采纳，保留捕获值。
    if (isAdoptableReread('password', passwordField.value)) adoptPassword(passwordField.value);

    // 查找并监听用户名输入框
    const form = this.lastCapturedForm;
    const usernameField = form ? this.findUsernameFieldInForm(form) : this.findUsernameFieldInPage();
    if (usernameField) {
      this.syncUsernameField(controls, usernameField);
    }
  }

  /**
   * 监听一个账号框的 input 事件，实时同步弹窗展示与待确认凭证
   *
   * 口令形态与验证码形态共用这一条，差别只在框是怎么找出来的。监听器一律登记进
   * `fieldSyncCleanups`，由 `teardownFieldSync` 统一摘除——注册与清理必须成对，否则每次弹窗
   * 都会多留一个监听器。
   *
   * @param controls - 弹窗更新控制接口
   * @param field - 账号输入框
   */
  private syncUsernameField(controls: SavePromptControls, field: HTMLInputElement): void {
    const adoptUsername = (value: string) => {
      this.confirmedUsername = value;
      controls.updateUsername(value);
      // 同步更新 sessionStorage，确保页面跳转后 checkPendingCredentials 读取到最新值
      void this.syncPendingToSession(undefined, value);
    };
    const onUsernameInput = () => adoptUsername(field.value);
    field.addEventListener('input', onUsernameInput);
    this.fieldSyncCleanups.push(() => {
      field.removeEventListener('input', onUsernameInput);
    });
    // 立即同步一次（口径同口令侧：越限的程序化改写不采纳）
    if (isAdoptableReread('username', field.value)) adoptUsername(field.value);
  }

  /**
   * 将最新值同步到 sessionStorage 中的待确认凭证
   *
   * 弹窗显示期间用户修改表单字段后，需将最新值回写 sessionStorage，
   * 确保页面跳转/刷新后 checkPendingCredentials 能读取到最新值。
   *
   * @param password - 最新的密码值，undefined 表示不更新
   * @param username - 最新的用户名值，undefined 表示不更新
   */
  private async syncPendingToSession(password?: string, username?: string): Promise<void> {
    // 先读容器再申请密钥：本方法由击键触发，没有待确认凭证时不该产生跨进程往返
    let encrypted: string | null;
    try {
      encrypted = sessionStorage.getItem(PENDING_SAVE_KEY);
    } catch {
      return;
    }
    if (!encrypted) return;

    const key = await getCipherKey();
    if (!key) return;
    try {
      const raw = decryptPendingCredential(encrypted, key);
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingCredentials;
      if (password !== undefined) pending.password = password;
      if (username !== undefined) pending.username = username;
      sessionStorage.setItem(PENDING_SAVE_KEY, encryptPendingCredential(JSON.stringify(pending), key));
    } catch {
      // sessionStorage 不可用时忽略（如隐私模式）
    }
  }

  /**
   * 清理表单字段同步监听器
   *
   * 移除所有通过 setupFieldSync 注册的 input 事件监听器。
   * 注意：不清空 lastCapturedPasswordField / lastCapturedForm 引用，
   * 因为 setupFieldSync 紧接着需要读取这些引用来注册新监听器。
   */
  private teardownFieldSync(): void {
    for (const cleanup of this.fieldSyncCleanups) {
      cleanup();
    }
    this.fieldSyncCleanups = [];
  }

  /**
   * 用户确认保存：清除 sessionStorage → 发送到 background → 成功后标记已保存 → 显示通知
   *
   * 注意：lastPromptSaved 仅在保存成功后才标记为 true，
   * 避免保存失败时规则 1 永久阻止该凭证再次弹窗。
   *
   * @param pending 待保存的凭证
   */
  private async handleSave(pending: PendingCredentials): Promise<void> {
    // 在 teardown 清空引用之前先读取当前表单值
    const current = this.captureCurrentCredentials();
    this.teardownFieldSync();
    this.clearPending();

    // 重读只采纳容量内的值（那才可能是用户补敲的编辑）；越限即站点提交后的程序化改写，回落确认值。
    // 回落用 `||` 而非 `??`：站点提交后清空字段（form.reset、密文改塞隐藏域）时挂载同步会把空串
    // 采纳成确认值，`??` 只挡 null，空串便顶掉捕获值——新账号被空字段闸门拒收，改密则命中
    // 「空口令不许覆盖已有真口令」后零写入却回成功。空账号/空口令重读同样视为无信号。
    const rereadUsername = current?.username;
    const finalUsername =
      rereadUsername && isAdoptableReread('username', rereadUsername)
        ? rereadUsername
        : this.confirmedUsername || pending.username;
    // 授权位与口令同源：`mobileLogin` 为真即「这次提交没有可用密码框」，口令只能是空串——
    // 弹窗展示的是「验证码不保存」，用户据此点的保存。非空值会绕过存储层两道以 `!password`
    // 为键的闸门（空字段拒写、空口令不许覆盖已有真口令），覆写库里已存的真实口令。
    // 口令来源另由 captureCurrentCredentials 收口：只认仍连在文档上的原引用，否则用展示值。
    // 账号优先取容量内的重读值（用户可能改过号），越限改写与口令同一口径回落确认值。
    const rereadPassword = current?.password;
    const finalPassword =
      pending.mobileLogin === true
        ? ''
        : rereadPassword && isAdoptableReread('password', rereadPassword)
          ? rereadPassword
          : this.confirmedPassword || pending.password;
    // 清理字段引用（弹窗已关闭，不再需要）
    this.lastCapturedPasswordField = null;
    this.lastCapturedForm = null;
    this.confirmedUsername = null;
    this.confirmedPassword = null;

    try {
      if (!chrome.runtime?.id) {
        logger.warn('LoginAutoSave: 扩展上下文已失效，无法保存');
        showNativeNotification(tl('cs.notify.saveFailedContext'), 'error');
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: MessageType.AUTO_SAVE_PASSWORD,
        data: {
          username: finalUsername,
          password: finalPassword,
          mobileLogin: pending.mobileLogin,
          url: pending.url,
          protocol: pending.protocol,
          tag: pending.tag,
          remark: pending.remark,
          tagEdited: pending.tagEdited,
          remarkEdited: pending.remarkEdited,
        },
      });

      if (response?.success) {
        this.lastPromptSaved = true;
        // 结局由存储层判定并本地化，内容侧只呈现：三种 success（新存一条 / 更新已有 /
        // 「该账号已存有密码，本次未改动」）说的不是同一件事，最后一种一个字节都没写，
        // 写死「账号密码已保存」会对用户说谎——他据此以为验证码登录已入库，下次仍填不出东西。
        // 回执没带文案（旧版后台、异常路径）才退回通用串；跨上下文输入按 unknown 收窄。
        const outcome: unknown = response?.message;
        showNativeNotification(typeof outcome === 'string' && outcome ? outcome : tl('cs.notify.saved'), 'success');
      } else {
        showNativeNotification(
          tl('cs.notify.saveFailedMsg', { message: response?.message || tl('cs.notify.unknownReason') }),
          'warning',
        );
      }
    } catch (error) {
      const errorMsg = (error as Error).message || '';
      if (errorMsg.includes('Extension context invalidated')) {
        showNativeNotification(tl('cs.notify.saveFailedContextRefresh'), 'error');
      } else {
        showNativeNotification(tl('cs.notify.saveFailedRetry'), 'error');
      }
    }
  }

  /**
   * 用户选择暂不保存：清除 sessionStorage 和弹窗，保留冷却期记录
   */
  private handleDismiss(): void {
    this.teardownFieldSync();
    this.lastCapturedPasswordField = null;
    this.lastCapturedForm = null;
    this.confirmedUsername = null;
    this.confirmedPassword = null;
    // lastPromptSaved 保持 false，lastPromptTime 保留用于冷却期计算
    this.clearPending();
  }

  /**
   * 用户选择「不再提示」：将当前域名加入屏蔽黑名单
   *
   * 加入黑名单后，该域名下所有登录行为均不再弹窗提示保存密码。
   * 用户可在自动保存设置弹窗的「已屏蔽的域名」列表中移除域名以恢复提示。
   *
   * @param pending 当前凭证数据（用于提取域名）
   */
  private async handleNeverAsk(pending: PendingCredentials): Promise<void> {
    this.teardownFieldSync();
    this.lastCapturedPasswordField = null;
    this.lastCapturedForm = null;
    this.confirmedUsername = null;
    this.confirmedPassword = null;
    this.clearPending();
    try {
      await StorageUtils.addExcludedDomain(pending.url);
      showNativeNotification(tl('cs.notify.neverAskDone', { url: pending.url }), 'info');
    } catch {
      showNativeNotification(tl('cs.notify.operationFailed'), 'error');
    }
  }

  /**
   * 清除 sessionStorage 中的待确认凭证
   */
  private clearPending(): void {
    // 递增代数：让所有在途的异步写入作废（否则「等待密钥」期间的清除会被复活）
    this.pendingToken++;
    try {
      sessionStorage.removeItem(PENDING_SAVE_KEY);
    } catch {
      // 忽略
    }
  }

  // ── 智能防重复工具方法 ──

  /**
   * 生成凭证指纹（不存储原始密码，用「用户名 + 密码长度 + 密码内容轻量哈希」标识）
   *
   * 用于「同页防抖」：吸收同一次登录的 submit+click+enter 三连触发，
   * 避免短时间内对同一组凭证重复发起库级预检查与弹窗。跨登录的「是否已保存」
   * 判定以库级预检查（checkCredentialStatus）为准，不再依赖此内存指纹。
   *
   * 指纹拼入密码内容的 DJB2 轻量哈希（非明文、不可逆），确保用户在同一页面
   * 改用「长度相同但内容不同」的新密码登录时指纹必然变化，防抖规则不会
   * 误吞「密码已变更」场景的更新弹窗。
   *
   * @param username 用户名
   * @param password 密码
   * @returns 凭证指纹字符串
   */
  private createCredentialFingerprint(username: string, password: string): string {
    return `${username}::${password.length}::${hashStringLight(password).toString(36)}`;
  }

  /**
   * 同页防抖判断：是否应继续处理该凭证（后续仍需库级预检查决定是否弹窗）
   *
   * 仅作用于当前页面实例的内存状态，用于抑制同一次登录的重复触发：
   * 1. 本页已确认保存/已判定相同的凭证 → 不再处理
   * 2. 相同凭证 + 冷却期内 → 跳过（吸收 submit+click+enter 三连触发）
   * 3. 不同凭证 → 继续处理
   * 4. 相同凭证 + 冷却期已过 → 继续处理
   *
   * 注意：跨登录/跨页面的「是否已保存」以库级预检查为准，本方法不承担该职责。
   *
   * @param fingerprint 当前凭证指纹
   * @returns 是否应继续处理（true 后仍会经库级预检查）
   */
  private shouldShowPrompt(fingerprint: string): boolean {
    const isSameCredential = fingerprint === this.lastPromptedFingerprint;

    // 规则 1：已保存过的凭证不再弹窗
    if (isSameCredential && this.lastPromptSaved) {
      return false;
    }

    // 规则 3：不同凭证，直接允许弹窗
    if (!isSameCredential) {
      return true;
    }

    // 规则 2 & 4：相同凭证，检查冷却期
    const elapsed = Date.now() - this.lastPromptTime;
    return elapsed > DISMISS_COOLDOWN_MS;
  }

  // ── 表单字段查找工具方法 ──

  /**
   * 找出「账号 + 验证码」形态（没有密码框）里的账号框：手机号或邮箱
   *
   * 判据刻意要求**两个框都已填写**：只认「有个手机号/邮箱框」会把搜索框、注册表单、收货地址页
   * 一并判成登录页；而用户点「获取验证码」那一下账号框已填、验证码框还空，此时登录尚未
   * 发生，弹「保存」只会变成噪声。两个框都有值才是「用户正在提交验证码登录」。
   *
   * 值只看字段声明的语义，不看输入内容——否则一个填着「iphone 15」的搜索框会因为值里含
   * `phone` 被当成手机号。语义走**捕获链**那把尺子（`hasPhoneEvidence` / `hasEmailEvidence` /
   * `hasVerifyCodeEvidence`）：它接受 `<label for>` / 包裹式 label / `aria-labelledby` 这些与
   * `aria-label` 等效的规范标注，因为按规范写标注的登录页不该反而不被识别。填充落点与身份提示
   * 让位仍走窄谓词（`looksLikePhoneField` / `looksLikeEmailField`），两条链刻意不共用——
   * 捕获多认一个框只是多问一句「要不要保存」，让位多认一个框会让填报页的气泡消失而钥匙又填不出值。
   * 国家码 / 区号 / 分机这类拆号子段被排除：那 3~4 位不是任何人的登录账号。
   *
   * 方法名与授权位 `mobileLogin` 保留「mobile」字样是为了不动已落盘 / 跨入口的字段名，
   * 实际语义已是「本次登录没有口令」，手机号与邮箱两种账号同等对待。
   *
   * @param scope 提交所在的 form，或无 form 时的 document
   * @returns 账号输入框（手机号或邮箱）；不构成该形态时 null
   */
  private findMobileCodeField(scope: ParentNode): HTMLInputElement | null {
    const filled = Array.from(scope.querySelectorAll('input')).filter(
      input => !!input.value && isElementVisible(input),
    );
    const hasSmsCode = filled.some(
      input => hasVerifyCodeEvidence(input) && !looksLikePostalCode(input) && isOneTimeCodeValue(input.value),
    );
    if (!hasSmsCode) return null;

    return (
      filled.find(
        input =>
          (hasPhoneEvidence(input) || hasEmailEvidence(input)) &&
          !isPhoneExtensionField(input) &&
          // 排除「这个框本身就是码框」时也必须读可及名：账号证据与码证据共用同一把尺子，
          // 否则 `<label>手机验证码</label><input value="246813">` 会既算码证据又算账号证据，
          // 一次性验证码就以 username 落库，而真正的账号一个字段都没存。
          !hasVerifyCodeEvidence(input),
      ) ?? null
    );
  }

  /**
   * 读取「账号 + 验证码」形态下的账号值
   * @param scope 提交所在的 form，或无 form 时的 document
   * @returns 账号框（手机号或邮箱）的值；不构成该形态时空字符串
   */
  private findMobileCodeAccount(scope: ParentNode): string {
    return this.findMobileCodeField(scope)?.value ?? '';
  }

  /**
   * 采集一次登录提交的凭据（三个捕获入口共用的判据）
   *
   * 密码框有值 → 走原有的「账号 + 密码」路径，取值方式与历史完全一致（form 场景走
   * `findUsernameInForm`、无 form 的 SPA 走 `findUsernameInPage`，两者宽窄不同，不在此统一）。
   * 密码框不存在或还没填 → 只可能由「账号 + 验证码」形态成立，否则这次提交不产生凭据。
   *
   * @param form 提交所在的 form；无 form 的 SPA 场景传 null
   * @returns 采集结果；不构成可保存的凭据时返回 null
   */
  private readCredentials(form: HTMLFormElement | null): CapturedCredentials | null {
    const scope: ParentNode = form ?? document;
    const passwordField = scope.querySelector(PASSWORD_FIELD_SELECTOR) as HTMLInputElement | null;
    const password = passwordField?.value ?? '';

    if (password) {
      const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
      return username ? { username, password, mobileLogin: false, passwordField } : null;
    }

    const mobile = this.findMobileCodeAccount(scope);
    return mobile ? { username: mobile, password: '', mobileLogin: true, passwordField: null } : null;
  }

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
      if (input.value && isElementVisible(input)) {
        return input.value;
      }
    }

    return '';
  }

  /**
   * 从表单中查找用户名输入框元素
   * 与 findUsernameInForm 查找逻辑一致，但返回 DOM 元素引用而非值
   * @param form 表单元素
   * @returns 用户名输入框元素或 null
   */
  private findUsernameFieldInForm(form: HTMLFormElement): HTMLInputElement | null {
    // autocomplete="username" 是最可靠的标识，不需要值检查
    const autoCompField = form.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    if (autoCompField) return autoCompField;

    for (const selector of USERNAME_SELECTORS) {
      try {
        const field = form.querySelector(selector) as HTMLInputElement | null;
        if (field?.value) return field;
      } catch {
        // 跳过
      }
    }

    const allInputs = form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"]',
    ) as NodeListOf<HTMLInputElement>;
    for (const input of allInputs) {
      if (input.value && isElementVisible(input)) {
        return input;
      }
    }

    return null;
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
        if (field?.value && isElementVisible(field)) return field.value;
      } catch {
        // 跳过
      }
    }
    return '';
  }

  /**
   * 从页面中查找用户名输入框元素
   * 与 findUsernameInPage 查找逻辑一致，但返回 DOM 元素引用而非值
   * @returns 用户名输入框元素或 null
   */
  private findUsernameFieldInPage(): HTMLInputElement | null {
    // autocomplete="username" 是最可靠的标识，不需要值检查
    const autoCompField = document.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    if (autoCompField) return autoCompField;

    for (const selector of USERNAME_SELECTORS) {
      try {
        const field = document.querySelector(selector) as HTMLInputElement | null;
        if (field?.value && isElementVisible(field)) return field;
      } catch {
        // 跳过
      }
    }
    return null;
  }

  /**
   * 扫描并标记页面上所有现有的密码字段
   * 在 init() 阶段调用，确保 type 被切换前已打上 data-aph-password 标记
   */
  private markExistingPasswordFields(): void {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    passwordInputs.forEach(input => {
      (input as HTMLInputElement).dataset.aphPassword = 'true';
    });
  }

  /**
   * 注册 MutationObserver 监听动态新增的密码字段并自动标记
   * 覆盖 SPA 动态渲染和宿主页面自带 toggle 的场景
   */
  private observeNewPasswordFields(): void {
    if (this.passwordFieldObserver) return;
    this.passwordFieldObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          // 新增节点本身是密码输入框
          if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password') {
            (el as HTMLInputElement).dataset.aphPassword = 'true';
          }
          // 新增节点的子树中包含密码输入框
          if (el.querySelectorAll) {
            const nestedInputs = el.querySelectorAll('input[type="password"]');
            nestedInputs.forEach(input => {
              (input as HTMLInputElement).dataset.aphPassword = 'true';
            });
          }
        }
      }
    });
    // allFrames 注入时部分 iframe（about:blank / srcdoc 空文档）document.body 为 null，
    // 此时无 DOM 可观察，跳过 observe 避免抛出 TypeError
    if (document.body) {
      this.passwordFieldObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * 销毁实例，清理所有事件监听器
   */
  public destroy(): void {
    this.teardownFieldSync();
    this.lastCapturedPasswordField = null;
    this.lastCapturedForm = null;
    this.confirmedUsername = null;
    this.confirmedPassword = null;
    this.passwordFieldObserver?.disconnect();
    this.passwordFieldObserver = null;
    document.removeEventListener('submit', this.handleFormSubmit, { capture: true });
    document.removeEventListener('click', this.handleButtonClick, { capture: true });
    document.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    // 上下文失效时 removeListener 可能抛 "Extension context invalidated"，包裹兜底
    try {
      chrome.storage.onChanged.removeListener(this.handleStorageChange);
      chrome.runtime.onMessage.removeListener(this.handleRuntimeMessage);
    } catch {
      // 监听器已被 Chrome 自动清理，忽略
    }
    dismissSavePasswordPrompt();
  }
}
