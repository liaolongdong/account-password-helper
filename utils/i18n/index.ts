/**
 * 国际化（i18n）核心模块
 *
 * 提供 Vue 运行时语言切换能力，无需刷新页面。
 * - 语言检测优先级：storage 持久化 > chrome.i18n.getUILanguage() fallback
 * - t() 对未注册 key 返回 key 本身（渐进式覆盖，不影响未翻译组件）
 * - 语言包全部静态内置（仅两种语言、gzip 后单包 ~9KB）：消除初始化时
 *   串行 dynamic import 语言包 chunk 对首帧的阻塞（Windows 冷环境下
 *   英文包 chunk 冷读可达数百毫秒），且保证任何语言下首帧不出现原始 key
 *
 * @module utils/i18n
 */

import { ref, type Ref } from 'vue';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import zhCN from '@/utils/i18n/locales/zh-CN.json';
import en from '@/utils/i18n/locales/en.json';

/** 支持的语言类型 */
export type Locale = 'zh-CN' | 'en';

/** 语言包消息类型（支持嵌套） */
type Messages = Record<string, string>;

/** 当前激活语言（响应式，跨组件共享） */
export const currentLocale: Ref<Locale> = ref('zh-CN');

/** 语言包集合（全部静态内置，任意语言切换均同步就绪） */
const messagesCache: Record<Locale, Messages> = {
  'zh-CN': zhCN as Messages,
  en: en as Messages,
};

/**
 * 翻译函数：根据当前语言返回对应文案
 *
 * 支持简单参数替换：`t('hello', { name: 'World' })` → 'Hello, {name}' → 'Hello, World'
 * 未注册 key 直接返回 key（中文 key 即为 fallback）。
 *
 * @param key 语言包中的键名
 * @param params 可选参数替换映射
 * @returns 翻译后的文案
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const messages = messagesCache[currentLocale.value];
  let result = messages[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      // 转义参数名中的正则特殊字符，防御性避免 $ . 等字符导致匹配异常
      const escapedKey = paramKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 函数替换器：避免替换值中的 $& / $' 等序列被解释为特殊替换模式（与 i18n-lite 保持一致）
      result = result.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), () => String(paramValue));
    }
  }

  return result;
}

/**
 * 切换语言并持久化到 storage
 *
 * @param locale 目标语言
 */
export async function setLocale(locale: Locale): Promise<void> {
  // 语言包已静态内置，切换同步生效
  currentLocale.value = locale;

  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.LOCALE]: locale });
  } catch (error) {
    logger.error('i18n: 持久化语言设置失败:', error);
  }
}

/**
 * 初始化 i18n：从 storage 读取用户语言偏好，否则跟随浏览器语言
 *
 * 先加载目标语言包再切换 currentLocale，避免模板短暂渲染出原始 key。
 * 同时注册 storage 变更监听，实现 popup/options/sidepanel 多页面语言实时同步。
 * 应在应用入口（main.ts）中调用一次。
 */
export async function initI18n(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOCALE);
    const storedLocale = result[STORAGE_KEYS.LOCALE] as Locale | undefined;

    let targetLocale: Locale;
    if (storedLocale === 'zh-CN' || storedLocale === 'en') {
      targetLocale = storedLocale;
    } else {
      // 跟随浏览器/扩展 UI 语言
      const uiLang = chrome?.i18n?.getUILanguage?.() ?? 'zh-CN';
      targetLocale = uiLang.startsWith('zh') ? 'zh-CN' : 'en';
    }

    // 语言包已静态内置，直接切换即可（无需等待异步加载）
    currentLocale.value = targetLocale;
  } catch (error) {
    logger.error('i18n: 初始化失败:', error);
    // 失败时默认中文
    currentLocale.value = 'zh-CN';
  }

  initLocaleSync();
}

/** storage 语言变更监听是否已注册（模块级防重入） */
let localeSyncInitialized = false;

/**
 * 监听 storage 中语言偏好变更，跨页面实时同步语言
 *
 * 在任一入口（如 options 设置菜单）切换语言后，
 * 其他已打开页面（popup/sidepanel）无需刷新即可同步更新文案。
 */
function initLocaleSync(): void {
  if (localeSyncInitialized || !chrome?.storage?.onChanged) return;
  localeSyncInitialized = true;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.LOCALE]) return;
    const newLocale = changes[STORAGE_KEYS.LOCALE].newValue as Locale | undefined;
    if ((newLocale === 'zh-CN' || newLocale === 'en') && newLocale !== currentLocale.value) {
      // 语言包已静态内置，同步切换即可
      currentLocale.value = newLocale;
    }
  });
}

/**
 * Vue Composable：在组件中使用 i18n
 *
 * @returns { t, currentLocale, setLocale } 翻译函数和语言操作
 */
export function useI18n() {
  return { t, currentLocale, setLocale };
}
