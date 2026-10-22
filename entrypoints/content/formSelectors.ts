/**
 * 表单字段选择器常量
 * 集中管理所有用于检测登录表单的 CSS 选择器和关键词
 */

/** 用户名/邮箱/账号字段选择器 */
export const USERNAME_SELECTORS = [
  'input[type="email"]',
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
  // placeholder 匹配
  'input[placeholder*="用户"]',
  'input[placeholder*="邮箱"]',
  'input[placeholder*="手机号"]',
  'input[placeholder*="账号"]',
  'input[placeholder*="user"]',
  'input[placeholder*="email"]',
  'input[placeholder*="mobile"]',
  'input[placeholder*="phone"]',
  'input[placeholder*="account"]',
  // autocomplete/aria 增强检测
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
  // 扩展选择器
  'input[name*="user_name"]',
  'input[id*="user_name"]',
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
] as const;

/** 手机号码字段选择器 */
export const MOBILE_SELECTORS = [
  'input[type="tel"]',
  'input[type="text"][name*="phone"]',
  'input[type="text"][name*="mobile"]',
  'input[type="text"][id*="phone"]',
  'input[type="text"][id*="mobile"]',
  'input[type="number"][name*="phone"]',
  'input[type="number"][name*="mobile"]',
  'input[name*="phoneNumber"]',
  'input[name*="mobilePhone"]',
  'input[id*="phoneNumber"]',
  'input[id*="mobilePhone"]',
  'input[placeholder*="mobile"]',
  'input[placeholder*="phone"]',
  'input[placeholder*="手机号"]',
  // autocomplete/aria 增强检测
  'input[autocomplete="tel"]',
  'input[autocomplete="mobile"]',
  'input[aria-label*="手机"]',
  'input[aria-label*="电话"]',
  'input[aria-label*="mobile"]',
  'input[aria-label*="phone"]',
  // 扩展选择器
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
] as const;

/**
 * 电话号码「子字段」的 autocomplete 取值
 *
 * 这些字段会被 `MOBILE_SELECTORS` 一并收进 `mobileFields`，但它们是「整号被拆成几段」里的
 * 短段（国家码 / 区号 / 分机），把完整手机号写进 3～4 位的区号框既填不下也是错的。
 * 手机号 + 短信码登录页回退填账号时必须排除。
 */
export const PHONE_EXTENSION_AUTOCOMPLETE = ['tel-country-code', 'tel-area-code', 'tel-extension'] as const;

/**
 * 判断一个输入是否为国家码 / 区号 / 分机等电话号码子字段
 *
 * 只认显式的 `autocomplete` 取值，不做 name/id 猜测——避免把「手机号」主框误判成子字段而漏填。
 *
 * @param input - 待判定的输入框
 * @returns 是否为应被排除的号码子字段
 */
export function isPhoneExtensionField(input: HTMLInputElement): boolean {
  const autocomplete = input.getAttribute('autocomplete');
  if (!autocomplete) return false;
  return (PHONE_EXTENSION_AUTOCOMPLETE as readonly string[]).includes(autocomplete.trim().toLowerCase());
}

/** 验证码字段选择器 */
export const VERIFY_CODE_SELECTORS = [
  'input[type="text"][name*="code"]',
  'input[type="text"][name*="captcha"]',
  'input[type="text"][name*="verify"]',
  'input[type="text"][id*="code"]',
  'input[type="text"][id*="verify"]',
  'input[type="number"][name*="code"]',
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
  // autocomplete/aria 增强检测
  'input[aria-label*="验证码"]',
  'input[aria-label*="code"]',
  'input[aria-label*="verify"]',
  'input[autocomplete="one-time-code"]',
  // 扩展选择器
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
  // TOTP / 两步验证（2FA）动态口令字段（如 GitHub 的 app_otp、通用 one-time-code）
  'input[name*="otp"]',
  'input[id*="otp"]',
  'input[name*="totp"]',
  'input[id*="totp"]',
  'input[name*="2fa"]',
  'input[id*="2fa"]',
  'input[aria-label*="one-time"]',
  'input[aria-label*="authentication code"]',
  'input[placeholder*="authentication code"]',
  'input[placeholder*="身份验证器"]',
  'input[placeholder*="动态口令"]',
] as const;

/**
 * 判断输入框自身是否命中「验证码字段」选择器集合
 *
 * 与 `detectForms` 里验证码桶用的是同一份选择器，因此判定结果必然能被验证码桶收下——
 * 用它做手机号桶的排除条件才不会让字段两头都落空。`looksLikeCodeField` 是关键词宽集，
 * 只用于次序与语义调权，不能用来做「收进哪个桶」的硬判定。
 *
 * @param input - 待判定的输入框
 * @returns 是否命中验证码选择器
 */
export function matchesVerifyCodeSelectors(input: HTMLInputElement): boolean {
  try {
    return input.matches(VERIFY_CODE_SELECTORS.join(','));
  } catch {
    // 选择器集合由本文件维护，正常不会走到；语法意外时按「不是验证码框」处理，维持既有分桶
    return false;
  }
}

/** 登录按钮关键词 */
export const LOGIN_BUTTON_KEYWORDS = [
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
  '登  录',
  'SIGN IN',
  'LOGIN',
  'LOG IN',
  '登录/注册',
  '登录 / 注册',
  '登录或注册',
  'login/register',
  'sign in/up',
] as const;

/** 登录按钮 CSS 选择器 */
export const LOGIN_BUTTON_SELECTORS = [
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
] as const;

/** 登录相关的关键词（用于容器检测） */
export const LOGIN_CONTAINER_KEYWORDS = [
  'login',
  'signin',
  'sign-in',
  'auth',
  'authentication',
  '登录',
  '登陆',
  '登入',
] as const;

/** 弹窗/模态框相关关键词 */
export const POPUP_KEYWORDS = ['modal', 'popup', 'dialog', 'drawer', 'overlay', '弹窗', '对话框', '模态'] as const;

/**
 * 手机号相关关键词（子串匹配档）
 *
 * 这几个词足够独特，`hotel` / `teller` 之类不会顺带命中，因此继续用子串匹配；
 * 短歧义词 `tel` / `cell` 已移到 `MOBILE_KEYWORDS_WHOLE_WORD`。
 */
export const MOBILE_KEYWORDS = ['phone', 'mobile', '手机', '电话', '号码'] as const;

/**
 * 手机号相关关键词（整词匹配档）
 *
 * 子串匹配这两个短词会把 `name="hotel"`、`id="teller"` 判成手机号框，而
 * `MOBILE_SELECTORS` 从来没收过裸 `*=tel` / `*=cell`——判据比选择器还宽，
 * 于是「酒店名」输入框有机会进手机号语义，进而在账号候选排序里抢下手机号那条值。
 * 整词匹配 + 容忍尾随数字（`tel1` / `tel2` 是拆号页标主备电话的常见写法）后与选择器同宽：
 * `tel-national`、`cell phone`、`telCountryCode` 仍然命中，`hotel` 不再命中。
 */
export const MOBILE_KEYWORDS_WHOLE_WORD = ['tel', 'cell'] as const;

/** 邮箱语义关键词（与 `USERNAME_SELECTORS` 里那组 email 属性选择器同一词表口径） */
export const EMAIL_FIELD_KEYWORDS = ['email', 'e-mail', '邮箱', '电子邮箱', '邮件'] as const;

/**
 * 一次性口令语义关键词
 *
 * 用作**次序判据**而不是归属判据：`input[type=password]` 那条选择器不分口令语义，
 * 于是「登录密码 + 动态口令都做掩码输入」这类页面里两个框同进密码桶，取文档顺序首个
 * 就可能把静态密码写进口令框。只在多个候选之间调次序，不据此拒收任何字段。
 */
export const CODE_FIELD_KEYWORDS = [
  'otp',
  'totp',
  '2fa',
  'mfa',
  'code',
  'captcha',
  'verif',
  '验证码',
  '动态码',
  '动态口令',
  '安全码',
  '校验码',
] as const;

/**
 * 判断输入框是否声明了「一次性口令」语义
 * @param input - 待判定的输入框
 */
export function looksLikeCodeField(input: HTMLInputElement): boolean {
  if ((input.getAttribute('autocomplete') || '').toLowerCase().includes('one-time-code')) return true;
  const text = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') || ''}`.toLowerCase();
  return CODE_FIELD_KEYWORDS.some(keyword => text.includes(keyword));
}

/**
 * 判断输入框是否具备手机号语义
 *
 * 原为 `FormDetector.isLikelyMobileInput`，抽到这里是因为分类、侧边栏触发与「账号该进哪个框」
 * 三处必须用同一把尺子，否则同一字段在不同判定点会被读成两种意图。
 *
 * @param input - 待判定的输入框
 */
export function looksLikePhoneField(input: HTMLInputElement): boolean {
  if (input.type.toLowerCase() === 'tel') {
    return true;
  }

  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  if (autocomplete.includes('tel') || autocomplete.includes('phone') || autocomplete.includes('mobile')) {
    return true;
  }

  // 驼峰先切成词，否则 telCountryCode / cellPhone 里的短词没有分隔符可依，整词判据会漏。
  // autocomplete 不进这段文本：它是枚举值，上面那条分支已经按同样的三个词判过。
  const rawText = `${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${
    input.getAttribute('aria-label') || ''
  }`;
  const textToCheck = rawText.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

  if (MOBILE_KEYWORDS.some(keyword => textToCheck.includes(keyword))) {
    return true;
  }

  // 整词档容忍尾随数字：tel1 / tel2 是表单里标「主用 / 备用电话」的常见写法
  const words = textToCheck.split(/[^a-z0-9]+/);
  return MOBILE_KEYWORDS_WHOLE_WORD.some(keyword =>
    words.some(word => word === keyword || word.replace(/\d+$/, '') === keyword),
  );
}

/**
 * 判断输入框是否具备邮箱语义
 * @param input - 待判定的输入框
 */
export function looksLikeEmailField(input: HTMLInputElement): boolean {
  if (input.type.toLowerCase() === 'email') return true;
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  if (autocomplete.includes('email')) return true;
  const textToCheck =
    `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') || ''}`.toLowerCase();
  return EMAIL_FIELD_KEYWORDS.some(keyword => textToCheck.includes(keyword));
}

/**
 * 账号候选框的语义分类
 *
 * `USERNAME_SELECTORS` 是一个大杂烩桶：`[name*="user"]`、`[name*="email"]`、`[name*="mobile"]`、
 * `[placeholder*="手机号"]` 都命中它，于是「手机号 / 邮箱二选一」这类页面会把两种语义的框
 * 一起收进账号桶。分类只读字段自己声明的属性意图，不做 DOM 结构推断，也不看值。
 */
export type AccountFieldKind = 'email' | 'phone' | 'generic';

/**
 * 判断一个账号候选框声明的是邮箱、手机号，还是两者都不是
 *
 * 同时命中两组关键词（`name="email_mobile"` 这类）按 `generic` 处理：语义自相矛盾的框
 * 不足以支撑「这个值就该进这个框」的判断，宁可按文档顺序取。
 *
 * @param input - 账号候选输入框
 * @returns 字段语义分类
 */
export function classifyAccountField(input: HTMLInputElement): AccountFieldKind {
  const isEmail = looksLikeEmailField(input);
  const isPhone = looksLikePhoneField(input);

  if (isEmail && !isPhone) return 'email';
  if (isPhone && !isEmail) return 'phone';
  return 'generic';
}

/** 邮箱形态的值：必须是「本地@域.顶级域」这一段完整形状，不能只含 `@` */
const EMAIL_LIKE_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 判断条目的账号值是不是邮箱形态
 * @param value - 条目的 username
 */
export function isEmailLikeValue(value: string): boolean {
  return EMAIL_LIKE_VALUE.test(value.trim());
}

/**
 * 判断条目的账号值是不是电话号码形态
 *
 * 刻意只认两种 unmistakable 形状：国内手机号（`1` 开头 + 第二位 3~9 + 共 11 位，允许空格 /
 * 连字符 / 括号分隔）与显式带 `+` 的国际格式。纯数字登录名（学号、工号、QQ 号）一律不算——
 * 它们没有 `+`、也不符合手机号段，误判会把这类值往页面的手机号框里推。
 *
 * @param value - 条目的 username
 */
export function isPhoneLikeValue(value: string): boolean {
  const cleaned = value.trim().replace(/[\s\-()]/g, '');
  if (/^1[3-9]\d{9}$/.test(cleaned)) return true;
  return /^\+\d{7,15}$/.test(cleaned);
}

/** MutationObserver 中使用的登录文本关键词 */
export const MUTATION_LOGIN_KEYWORDS = [
  '登录',
  '登陆',
  'sign in',
  'signin',
  'login',
  '登录按钮',
  '立即登录',
  '密码登录',
  '验证码登录',
] as const;

/** 复选框正向关键词 */
export const CHECKBOX_POSITIVE_KEYWORDS = [
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
] as const;

/** 复选框负向关键词 */
export const CHECKBOX_NEGATIVE_KEYWORDS = [
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
] as const;

/**
 * 规范化登录按钮文本，用于匹配检测
 * - 去除首尾空格
 * - 去除中间所有空格（如"登 录" → "登录"，"Sign In" → "signin"）
 * - 转换为小写
 * @param text - 原始按钮文本
 * @returns 规范化后的文本
 */
export function normalizeButtonText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/**
 * 判断按钮文本是否应该被排除（纯注册按钮）
 * 排除纯注册按钮，但保留包含"登录"的组合按钮（如"登录/注册"）
 * @param normalizedText - 已规范化的按钮文本
 * @returns 是否应排除
 */
export function shouldExcludeButton(normalizedText: string): boolean {
  // 排除纯注册按钮，但保留包含"登录"的组合按钮
  const isPureRegister = /^(注册|立即注册|马上注册|免费注册|register|signup|sign-up)$/.test(normalizedText);
  const hasLogin =
    normalizedText.includes('登录') || normalizedText.includes('login') || normalizedText.includes('signin');

  return isPureRegister && !hasLogin;
}
