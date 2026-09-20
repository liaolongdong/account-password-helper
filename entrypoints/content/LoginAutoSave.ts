import {
  MessageType,
  type AutoSaveConfig,
  type CredentialStatusResponse,
  type DomainPattern,
  type PendingCipherKeyResponse,
  type RuntimeMessage,
  type SaveRiskHint,
} from '@/utils/types';
import { PostMessageType, isSameMainDomain } from '@/utils/domain';
import type {
  PendingCredentials,
  SavePromptControls,
  SavePromptData,
  NotificationType,
} from '@/entrypoints/content/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { hashStringLight } from '@/utils/crypto-light';
import { decryptPendingCredential, encryptPendingCredential } from '@/utils/pendingCredentialCodec';
import { USERNAME_SELECTORS, LOGIN_BUTTON_KEYWORDS, normalizeButtonText } from '@/entrypoints/content/formSelectors';
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

    // 检查 form 内是否有密码字段
    const passwordField = form.querySelector(
      'input[type="password"], input[data-aph-password]',
    ) as HTMLInputElement | null;
    if (!passwordField || !passwordField.value) {
      return;
    }

    const password = passwordField.value;
    const username = this.findUsernameInForm(form);
    if (!username) {
      return;
    }

    // 存储字段引用，用于弹窗显示期间实时同步表单值
    this.lastCapturedPasswordField = passwordField;
    this.lastCapturedForm = form;

    void this.onCredentialsCaptured(username, password);
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
    const passwordField = form
      ? (form.querySelector('input[type="password"], input[data-aph-password]') as HTMLInputElement | null)
      : (document.querySelector('input[type="password"], input[data-aph-password]') as HTMLInputElement | null);
    if (!passwordField || !passwordField.value) {
      return;
    }

    const password = passwordField.value;
    const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
    if (!username) {
      return;
    }

    // 存储字段引用，用于弹窗显示期间实时同步表单值
    this.lastCapturedPasswordField = passwordField;
    this.lastCapturedForm = form;

    void this.onCredentialsCaptured(username, password);
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
      ? (form.querySelector('input[type="password"], input[data-aph-password]') as HTMLInputElement | null)
      : (document.querySelector('input[type="password"], input[data-aph-password]') as HTMLInputElement | null);
    if (!passwordField || !passwordField.value) return;

    const password = passwordField.value;
    const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
    if (!username) {
      return;
    }

    // 存储字段引用，用于弹窗显示期间实时同步表单值
    this.lastCapturedPasswordField = passwordField;
    this.lastCapturedForm = form;

    void this.onCredentialsCaptured(username, password);
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
   * @param username 用户名
   * @param password 密码
   */
  private async onCredentialsCaptured(username: string, password: string): Promise<void> {
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
      url: location.host, // 使用 host（含端口号，如 localhost:3000、192.168.1.1:8080）
      tag: document.title,
      remark: tl('cs.save.autoSaveRemark'),
      tagEdited: false,
      remarkEdited: false,
      timestamp: Date.now(),
      mode: 'save',
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
   * 仅发送账号/密码/域名，background 侧比对后返回状态枚举与非密码元数据，
   * 绝不回传已存明文密码。上下文失效或查询失败时保底返回 new，不阻断保存流程。
   * @param username 用户名
   * @param password 密码
   * @returns 凭证状态响应
   */
  private async resolveCredentialStatus(username: string, password: string): Promise<CredentialStatusResponse> {
    try {
      if (!chrome.runtime?.id) {
        return { status: 'new' };
      }
      const response = (await chrome.runtime.sendMessage({
        type: MessageType.CHECK_CREDENTIAL_STATUS,
        data: { username, password, url: location.hostname },
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
   * 预检查一并返回的风险提示（弱密码/复用计数）作为独立参数向下传递，
   * **不写入 pending 也不进 sessionStorage**：它是基于当次密码的派生结论，
   * 一旦持久化就可能在用户改密码后变成陈旧数据；跳页恢复路径也会重新
   * 进入本方法拿到新鲜值。
   *
   * @param pending 待确认的凭证数据
   */
  private async evaluateAndPrompt(pending: PendingCredentials): Promise<void> {
    const { status, existing, risk } = await this.resolveCredentialStatus(pending.username, pending.password);

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
    this.showPrompt(pending, risk);
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
   * @param risk 预检查得出的风险提示，缺省表示无风险，仅用于弹窗内联警示展示
   */
  private showPrompt(pending: PendingCredentials, risk?: SaveRiskHint): void {
    // 如果在 iframe 中运行，委托给顶层 frame 渲染弹窗，
    // 避免弹窗被限制在 iframe 的小视口内（而非整个页面右上角）
    if (window !== window.top) {
      this.delegatePromptToTopFrame(pending, risk);
      return;
    }

    // 先清理上一次弹窗的字段同步监听器，防止重复弹窗时泄漏
    this.teardownFieldSync();

    try {
      const controls = showSavePasswordPrompt(
        {
          username: pending.username,
          password: pending.password,
          url: pending.url,
          tag: pending.tag,
          remark: pending.remark,
          mode: pending.mode ?? 'save',
          risk,
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
   * 通过 window.top.postMessage 将凭证数据发送给顶层 frame 的 content script，
   * 由顶层 frame 调用 showSavePasswordPrompt 在页面右上角正常渲染弹窗。
   * 用户操作结果通过 postMessage 回传，由当前实例执行保存/忽略/不再提示。
   *
   * @param pending 待确认的凭证数据
   * @param risk 预检查得出的风险提示，随 promptData 一同跨帧透传（接收方会再次校验）
   */
  private delegatePromptToTopFrame(pending: PendingCredentials, risk?: SaveRiskHint): void {
    // 安全校验：仅在顶层 frame 与当前 frame 同主域名时才委托，
    // 防止跨域 iframe 场景下明文密码通过 postMessage 泄露给第三方页面
    // 使用 location.ancestorOrigins（Chrome 专有 API）获取顶层 origin，
    // 不会因跨子域名（如 account.aliyun.com ⊂ bailian.console.aliyun.com）抛出 SecurityError
    const ancestorOrigins = location.ancestorOrigins;
    const topOrigin = ancestorOrigins[ancestorOrigins.length - 1];
    if (!topOrigin) {
      // sandbox iframe 等极端情况禁止 ancestorOrigins 时回退（此时无法确定投递目标，只在当前 frame 渲染）
      this.delegateNotificationToTopFrame(tl('cs.notify.foundManualAdd', { url: pending.url }), 'warning');
      return;
    }

    if (!isSameMainDomain(topOrigin, location.origin)) {
      // 不同主域名的 iframe（如 attacker.com 嵌入 bank.com），不委托弹窗，只把提示交给顶层 frame
      this.delegateNotificationToTopFrame(tl('cs.notify.foundManualAdd', { url: pending.url }), 'warning', topOrigin);
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const promptData: SavePromptData = {
      username: pending.username,
      password: pending.password,
      url: pending.url,
      tag: pending.tag,
      remark: pending.remark,
      mode: pending.mode ?? 'save',
      risk,
    };

    /** 超时定时器 ID，用于 30s 后自动清理监听器 */
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handleResult);
      logger.warn('[LoginAutoSave] 顶层 frame 未响应委托请求，已超时清理');
    }, PENDING_MAX_AGE_MS);

    /** 接收顶层 frame 回传的用户操作结果 */
    const handleResult = (event: MessageEvent): void => {
      // 仅接受同主域名顶层 frame 的响应
      if (!isSameMainDomain(event.origin, location.origin)) return;
      if (event.data?.type !== PostMessageType.SAVE_PROMPT_RESULT || event.data?.requestId !== requestId) {
        return;
      }

      clearTimeout(timeoutId);
      window.removeEventListener('message', handleResult);

      const { action, editedData } = event.data as {
        action: 'save' | 'dismiss' | 'neverAsk';
        editedData?: { tag: string; remark: string; tagEdited: boolean; remarkEdited: boolean };
      };

      switch (action) {
        case 'save':
          this.handleSave({
            ...pending,
            tag: editedData?.tag ?? pending.tag,
            remark: editedData?.remark ?? pending.remark,
            tagEdited: editedData?.tagEdited ?? false,
            remarkEdited: editedData?.remarkEdited ?? false,
          });
          break;
        case 'dismiss':
          this.handleDismiss();
          break;
        case 'neverAsk':
          this.handleNeverAsk(pending);
          break;
      }
    };

    window.addEventListener('message', handleResult);

    try {
      window.top!.postMessage({ type: PostMessageType.SHOW_SAVE_PROMPT, requestId, data: promptData }, topOrigin);
      // postMessage 成功后立即清除 sessionStorage 中的待确认凭证，
      // 防止 iframe 导航后 checkPendingCredentials 重入触发第二次弹窗导致闪烁
      this.clearPending();
    } catch {
      // postMessage 失败（极端情况），清理监听器和超时定时器后回退到通知
      clearTimeout(timeoutId);
      window.removeEventListener('message', handleResult);
      showNativeNotification(tl('cs.notify.foundManualAdd', { url: pending.url }), 'warning');
    }
  }

  /**
   * 将通知委托给顶层 frame 渲染
   *
   * 当 iframe 中无法显示保存弹窗（跨域/沙箱限制）时，
   * 优先通过 postMessage 委托顶层 frame 渲染通知，确保通知出现在整个页面右上角。
   * postMessage 失败时回退到 iframe 内渲染。
   *
   * 投递目标锁定为顶层文档 origin：`'*'` 会在顶层文档已导航走（TOCTOU）时把
   * 「未能自动保存，请手动添加」连同当前页面 URL 发给此刻占据顶层的任意文档。
   * origin 不可解析（sandbox iframe 禁用了 `ancestorOrigins`）时不做跨帧投递，
   * 直接在当前 frame 渲染——宁可位置降级，不向未知目标广播。
   *
   * @param message - 通知消息内容
   * @param type - 通知类型
   * @param topOrigin - 顶层文档 origin，缺省表示无法解析，此时只在当前 frame 渲染
   */
  private delegateNotificationToTopFrame(message: string, type: NotificationType, topOrigin?: string): void {
    if (!topOrigin) {
      showNativeNotification(message, type);
      return;
    }
    try {
      window.top!.postMessage({ type: PostMessageType.SHOW_NOTIFICATION, data: { message, type } }, topOrigin);
    } catch {
      // postMessage 失败时回退到 iframe 内渲染
      showNativeNotification(message, type);
    }
  }

  /**
   * 重新从 DOM 中捕获当前表单中的用户名和密码
   *
   * 优先使用捕获时存储的精确字段引用（lastCapturedPasswordField），
   * 避免全局 document.querySelector 在 SPA 清空字段后返回 null 导致回退到旧值。
   * 仅在存储引用失效时回退到全局查询。
   *
   * @returns 当前表单中的用户名和密码，或 null
   */
  private captureCurrentCredentials(): { username: string; password: string } | null {
    // 优先使用捕获时存储的精确字段引用
    const storedField = this.lastCapturedPasswordField;
    if (storedField?.isConnected && storedField.value) {
      const username = this.lastCapturedForm
        ? this.findUsernameInForm(this.lastCapturedForm)
        : this.findUsernameInPage();
      // 即使 username 查找失败（SPA 清空了用户名字段），
      // 密码值从精确引用读取也是正确的，username 为空时由 handleSave 的 ?? 回退到 pending 值
      return { username: username || '', password: storedField.value };
    }

    // 引用失效时回退到全局查询
    const passwordField = document.querySelector(
      'input[type="password"], input[data-aph-password]',
    ) as HTMLInputElement | null;
    if (!passwordField?.value) return null;

    const form = passwordField.closest('form') as HTMLFormElement | null;
    const username = form ? this.findUsernameInForm(form) : this.findUsernameInPage();
    if (!username) return null;

    return { username, password: passwordField.value };
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
    if (!passwordField) return;

    // 监听密码框 input 事件，实时更新弹窗密码展示
    const onPasswordInput = () => {
      controls.updatePassword(passwordField.value);
      // 同步更新 sessionStorage，确保页面跳转后 checkPendingCredentials 读取到最新值
      void this.syncPendingToSession(passwordField.value);
    };
    passwordField.addEventListener('input', onPasswordInput);
    this.fieldSyncCleanups.push(() => {
      passwordField.removeEventListener('input', onPasswordInput);
    });
    // 立即同步当前值，避免弹窗显示时已存在延迟修改
    onPasswordInput();

    // 查找并监听用户名输入框
    const form = this.lastCapturedForm;
    const usernameField = form ? this.findUsernameFieldInForm(form) : this.findUsernameFieldInPage();
    if (usernameField) {
      const onUsernameInput = () => {
        controls.updateUsername(usernameField.value);
        // 同步更新 sessionStorage，确保页面跳转后 checkPendingCredentials 读取到最新值
        void this.syncPendingToSession(undefined, usernameField.value);
      };
      usernameField.addEventListener('input', onUsernameInput);
      this.fieldSyncCleanups.push(() => {
        usernameField.removeEventListener('input', onUsernameInput);
      });
      // 立即同步当前值
      onUsernameInput();
    }
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

    // 优先使用实时读取的当前值，读取失败时回退到弹窗出现时捕获的 pending 值
    const finalUsername = current?.username ?? pending.username;
    const finalPassword = current?.password ?? pending.password;
    // 清理字段引用（弹窗已关闭，不再需要）
    this.lastCapturedPasswordField = null;
    this.lastCapturedForm = null;

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
          url: pending.url,
          tag: pending.tag,
          remark: pending.remark,
          tagEdited: pending.tagEdited,
          remarkEdited: pending.remarkEdited,
        },
      });

      if (response?.success) {
        this.lastPromptSaved = true;
        showNativeNotification(tl('cs.notify.saved'), 'success');
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
