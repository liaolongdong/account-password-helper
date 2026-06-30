/**
 * 表单字段选择器常量
 * 集中管理所有用于检测登录表单的 CSS 选择器和关键词
 */

/** 用户名/邮箱/账号字段选择器 */
export const USERNAME_SELECTORS = [
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
] as const;

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

/** 手机号相关关键词 */
export const MOBILE_KEYWORDS = ['phone', 'mobile', 'tel', 'cell', '手机', '电话', '号码'] as const;

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
