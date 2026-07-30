/**
 * 轻量国际化模块（i18n-lite）
 *
 * 供 content script 与 background Service Worker 等无 Vue 环境使用：
 * - 不依赖 Vue 响应式与 utils/i18n 的全量语言包，避免打包体积膨胀
 * - 内联双语消息表（cs.* 为 content script 文案，bg.* 为 background 通知文案）
 * - 语言检测优先级与 utils/i18n 的 initI18n 保持一致：storage 持久化 > 浏览器 UI 语言
 * - initLiteI18n() 注册 storage.onChanged 监听，语言切换时实时生效并通知订阅者
 *
 * 扩展页（options/popup/sidepanel）请继续使用 utils/i18n（Vue 响应式 + 全量语言包）。
 *
 * @module utils/i18n-lite
 */

import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/** 轻量 i18n 支持的语言类型（与 utils/i18n 的 Locale 保持一致） */
export type LiteLocale = 'zh-CN' | 'en';

/**
 * 判断任意值是否为合法的轻量 i18n 语言
 * @param value 待校验值
 * @returns 是否为 LiteLocale
 */
export function isLiteLocale(value: unknown): value is LiteLocale {
  return value === 'zh-CN' || value === 'en';
}

/** 内联双语消息表（体积敏感，仅收录 content/background 实际使用的 key） */
const LITE_MESSAGES: Record<LiteLocale, Record<string, string>> = {
  'zh-CN': {
    'cs.save.titleUpdate': '检测到密码有更新，是否更新？',
    'cs.save.titleSave': '自动保存账号密码到密码列表？',
    'cs.save.username': '账号',
    'cs.save.password': '密码',
    'cs.save.tag': '标签',
    'cs.save.tagPlaceholder': '输入标签，逗号分隔',
    'cs.save.remark': '备注',
    'cs.save.remarkPlaceholder': '输入备注信息',
    'cs.save.neverAsk': '不再提示',
    'cs.save.dismiss': '暂不保存',
    'cs.save.update': '更新',
    'cs.save.save': '保存',
    'cs.save.autoSaveRemark': '自动保存',
    'cs.inline.trigger': '快速填充',
    'cs.inline.lockedTitle': '解锁后填充',
    'cs.inline.lockedDesc': '点击验证主密码以使用快速填充',
    'cs.inline.searchPlaceholder': '搜索账号、标签、备注、网址...',
    'cs.inline.manage': '密码管理',
    'cs.inline.emptyNoAccounts': '当前网站暂无匹配账号',
    'cs.inline.emptyNoMatch': '未找到匹配的账号',
    'cs.inline.noUsername': '(无账号)',
    'cs.inline.remarkTitle': '备注：{remark}',
    'cs.inline.firstUseHint': '点击钥匙图标，快速选择账号一键填充',
    'cs.fab.quickFill': '快速填充',
    'cs.fab.manage': '密码管理',
    'cs.fab.settings': '设置',
    'cs.pv.show': '显示密码',
    'cs.pv.hide': '隐藏密码',
    'cs.notify.noLoginForm': '当前页面未匹配到登录表单',
    'cs.notify.promptFailed': '发现账号密码，但弹窗显示失败，请手动在密码管理页添加',
    'cs.notify.foundManualAdd': '发现 {url} 的账号密码，请在密码管理页手动添加',
    'cs.notify.saved': '账号密码已保存',
    'cs.notify.saveFailedMsg': '保存失败: {message}',
    'cs.notify.saveFailedContext': '保存失败：扩展上下文已失效',
    'cs.notify.saveFailedContextRefresh': '保存失败：扩展上下文已失效，请刷新页面',
    'cs.notify.saveFailedRetry': '保存失败，请重试',
    'cs.notify.neverAskDone': '已不再提醒 {url}，可在自动保存设置中恢复',
    'cs.notify.operationFailed': '操作失败，请重试',
    'cs.notify.unknownReason': '未知原因',
    'cs.fd.fillDone': '填充完成',
    'cs.fd.noFormFields': '未检测到登录表单字段，请刷新页面后重试',
    'cs.fd.fillSuccess': '填充成功',
    'cs.fd.fillCheck': '填充完成，请检查表单内容',
    'cs.fd.fillIncomplete': '填充可能未完成，请手动检查表单',
    'cs.fd.fillError': '填充过程中发生错误',
    'cs.fd.noTotpInput': '当前页面未检测到验证码输入框',
    'cs.fd.totpFillSuccess': '验证码填充成功',
    'cs.fd.totpFillManual': '验证码填充失败，请手动输入',
    'cs.fd.totpFillError': '填充验证码时发生错误',
    'cs.fd.sidepanelShown': '侧边栏显示请求已处理',
    'cs.fd.sidepanelHidden': '侧边栏隐藏请求已处理',
    'bg.reminder.title': '密码更换提醒',
    'bg.reminder.message': '「{username}」的密码已到您设置的提醒时间，建议立即更换。',
    'bg.update.title': '插件有新版本可用',
    'bg.update.message': '发现新版本 v{version}，点击前往下载更新。',
    'bg.backup.title': '密码备份提醒',
    'bg.backup.message':
      '您配置的自动备份时间已到，共有 {count} 条密码待备份。请在密码管理页面点击"备份到邮箱"按钮手动完成备份。',
    'bg.autoSave.savedTitle': '账号密码已保存',
    'bg.autoSave.sessionExpired': '会话已过期，跳过自动保存',
    'bg.autoSave.disabled': '自动保存已禁用',
    'bg.autoSave.domainMismatch': '域名不匹配，跳过自动保存',
    'bg.autoSave.emptyFields': '账号或密码为空，跳过保存',
    'bg.autoSave.updated': '已更新已有账号密码',
    'bg.autoSave.savedNew': '已自动保存新账号密码',
    'bg.autoSave.failed': '自动保存失败: {message}',
    'bg.autoSave.failedGeneric': '自动保存处理失败',
    'bg.quickFill.title': '一键填充',
    'bg.quickFill.sessionExpired': '会话未验证，请先验证主密码',
    'bg.quickFill.noUrl': '无法获取当前页面地址',
    'bg.quickFill.noMatch': '当前页面没有匹配的账号密码',
    'bg.quickFill.fillSuccess': '填充成功',
    'bg.quickFill.fillFailed': '填充失败，请重试或手动填充',
    'bg.quickFill.multiMatch': '已填充“{title}”（共 {count} 条匹配，可打开侧边栏切换）',
    'bg.quickFill.pageNotReady': '页面未就绪，请刷新页面后重试',
    'bg.inline.title': '内联填充',
    'bg.inline.noLoginField': '当前页面未检测到登录输入框',
    'bg.common.unknownError': '未知错误',
    'bg.cache.untitled': '未命名',
  },
  en: {
    'cs.save.titleUpdate': 'Password change detected. Update it?',
    'cs.save.titleSave': 'Save this account to your password list?',
    'cs.save.username': 'Username',
    'cs.save.password': 'Password',
    'cs.save.tag': 'Tags',
    'cs.save.tagPlaceholder': 'Enter tags, comma separated',
    'cs.save.remark': 'Notes',
    'cs.save.remarkPlaceholder': 'Enter notes',
    'cs.save.neverAsk': "Don't ask again",
    'cs.save.dismiss': 'Not now',
    'cs.save.update': 'Update',
    'cs.save.save': 'Save',
    'cs.save.autoSaveRemark': 'Auto-saved',
    'cs.inline.trigger': 'Quick fill',
    'cs.inline.lockedTitle': 'Unlock to fill',
    'cs.inline.lockedDesc': 'Click to verify the master password and use quick fill',
    'cs.inline.searchPlaceholder': 'Search account, tag, note, URL...',
    'cs.inline.manage': 'Password Manager',
    'cs.inline.emptyNoAccounts': 'No matching accounts for this site',
    'cs.inline.emptyNoMatch': 'No matching accounts found',
    'cs.inline.noUsername': '(no username)',
    'cs.inline.remarkTitle': 'Note: {remark}',
    'cs.inline.firstUseHint': 'Click the key icon to pick an account and fill instantly',
    'cs.fab.quickFill': 'Quick fill',
    'cs.fab.manage': 'Password Manager',
    'cs.fab.settings': 'Settings',
    'cs.pv.show': 'Show password',
    'cs.pv.hide': 'Hide password',
    'cs.notify.noLoginForm': 'No login form detected on this page',
    'cs.notify.promptFailed':
      'Credentials detected but the prompt failed to show; please add them manually in Password Manager',
    'cs.notify.foundManualAdd': 'Credentials detected for {url}; please add them manually in Password Manager',
    'cs.notify.saved': 'Credentials saved',
    'cs.notify.saveFailedMsg': 'Save failed: {message}',
    'cs.notify.saveFailedContext': 'Save failed: extension context invalidated',
    'cs.notify.saveFailedContextRefresh': 'Save failed: extension context invalidated, please refresh the page',
    'cs.notify.saveFailedRetry': 'Save failed, please retry',
    'cs.notify.neverAskDone': 'No more prompts for {url}; restore it in Auto-Save Settings',
    'cs.notify.operationFailed': 'Operation failed, please retry',
    'cs.notify.unknownReason': 'unknown reason',
    'cs.fd.fillDone': 'Fill complete',
    'cs.fd.noFormFields': 'No login form fields detected, please refresh and retry',
    'cs.fd.fillSuccess': 'Filled successfully',
    'cs.fd.fillCheck': 'Fill complete, please check the form',
    'cs.fd.fillIncomplete': 'Fill may be incomplete, please check the form manually',
    'cs.fd.fillError': 'An error occurred while filling',
    'cs.fd.noTotpInput': 'No 2FA code input detected on this page',
    'cs.fd.totpFillSuccess': '2FA code filled',
    'cs.fd.totpFillManual': 'Failed to fill the 2FA code, please enter it manually',
    'cs.fd.totpFillError': 'An error occurred while filling the 2FA code',
    'cs.fd.sidepanelShown': 'Sidepanel show request processed',
    'cs.fd.sidepanelHidden': 'Sidepanel hide request processed',
    'bg.reminder.title': 'Password change reminder',
    'bg.reminder.message': 'The reminder for "{username}" is due. Consider changing its password now.',
    'bg.update.title': 'New extension version available',
    'bg.update.message': 'Version v{version} is available. Click to download the update.',
    'bg.backup.title': 'Password backup reminder',
    'bg.backup.message':
      'Your scheduled backup is due: {count} passwords to back up. Open the manager page and click "Back Up to Email" to finish manually.',
    'bg.autoSave.savedTitle': 'Credentials saved',
    'bg.autoSave.sessionExpired': 'Session expired, auto-save skipped',
    'bg.autoSave.disabled': 'Auto-save is disabled',
    'bg.autoSave.domainMismatch': 'Domain does not match, auto-save skipped',
    'bg.autoSave.emptyFields': 'Username or password is empty, save skipped',
    'bg.autoSave.updated': 'Existing credentials updated',
    'bg.autoSave.savedNew': 'New credentials auto-saved',
    'bg.autoSave.failed': 'Auto-save failed: {message}',
    'bg.autoSave.failedGeneric': 'Auto-save processing failed',
    'bg.quickFill.title': 'Quick Fill',
    'bg.quickFill.sessionExpired': 'Session not verified. Please verify your master password first.',
    'bg.quickFill.noUrl': 'Unable to get the current page URL',
    'bg.quickFill.noMatch': 'No matching credentials found for this page',
    'bg.quickFill.fillSuccess': 'Credentials filled successfully',
    'bg.quickFill.fillFailed': 'Fill failed. Please retry or fill manually.',
    'bg.quickFill.multiMatch': 'Filled "{title}" ({count} matches in total; open the side panel to switch)',
    'bg.quickFill.pageNotReady': 'Page not ready. Please refresh the page and try again.',
    'bg.inline.title': 'Inline Fill',
    'bg.inline.noLoginField': 'No login field detected on this page',
    'bg.common.unknownError': 'Unknown error',
    'bg.cache.untitled': 'Untitled',
  },
};

/** 当前激活语言（模块级状态，initLiteI18n 异步初始化，默认中文兜底） */
let currentLiteLocale: LiteLocale = 'zh-CN';

/** 语言变更订阅者集合（用于常驻 DOM 的 title 等属性就地刷新） */
const localeListeners = new Set<(locale: LiteLocale) => void>();

/** 是否已完成初始化（模块级防重入） */
let liteInitialized = false;

/**
 * 获取当前轻量 i18n 语言
 * @returns 当前语言
 */
export function getLiteLocale(): LiteLocale {
  return currentLiteLocale;
}

/**
 * 读取用户语言偏好（直接读 storage.local，检测优先级与 initI18n 一致）
 * @returns 语言，读取失败时回退中文
 */
export async function getStoredLocale(): Promise<LiteLocale> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOCALE);
    const stored = result[STORAGE_KEYS.LOCALE];
    if (isLiteLocale(stored)) return stored;
    const uiLang = chrome?.i18n?.getUILanguage?.() ?? 'zh-CN';
    return uiLang.startsWith('zh') ? 'zh-CN' : 'en';
  } catch {
    return 'zh-CN';
  }
}

/**
 * 轻量翻译函数：按当前语言返回文案，支持 {param} 占位替换
 *
 * 未注册 key 直接返回 key 本身（与 utils/i18n 的 t() 行为一致）。
 * @param key 消息 key（cs.* / bg.* 命名空间）
 * @param params 可选参数替换映射
 * @returns 翻译后的文案
 */
export function tl(key: string, params?: Record<string, string | number>): string {
  let result = LITE_MESSAGES[currentLiteLocale][key] ?? key;
  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      const escapedKey = paramKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 函数替换器：避免替换值中的 $& / $' 等序列被解释为特殊替换模式
      // （multiMatch 的 {title} 取自用户可控的标签/URL，可能含 $ 字符）
      result = result.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), () => String(paramValue));
    }
  }
  return result;
}

/**
 * 订阅语言变更（含初始化异步加载完成后的首次通知）
 * @param callback 语言变更回调
 * @returns 取消订阅函数
 */
export function onLiteLocaleChanged(callback: (locale: LiteLocale) => void): () => void {
  localeListeners.add(callback);
  return () => localeListeners.delete(callback);
}

/**
 * 更新当前语言并通知订阅者
 * @param next 目标语言
 */
function applyLiteLocale(next: LiteLocale): void {
  if (currentLiteLocale === next) return;
  currentLiteLocale = next;
  localeListeners.forEach(listener => {
    try {
      listener(next);
    } catch (error) {
      logger.error('i18n-lite: 语言变更回调执行失败:', error);
    }
  });
}

/**
 * 初始化轻量 i18n：异步加载用户语言偏好并监听 storage 变更实时切换
 *
 * fire-and-forget，默认中文兜底不阻塞调用方首帧。
 * 应在 content.ts / background.ts 入口调用一次（幂等）。
 */
export function initLiteI18n(): void {
  if (liteInitialized) return;
  liteInitialized = true;

  void getStoredLocale().then(locale => applyLiteLocale(locale));

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.LOCALE]) return;
      const next = changes[STORAGE_KEYS.LOCALE].newValue;
      if (isLiteLocale(next)) applyLiteLocale(next);
    });
  }
}
