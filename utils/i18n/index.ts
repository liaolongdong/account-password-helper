/**
 * 国际化（i18n）核心模块
 *
 * 提供 Vue 运行时语言切换能力，无需刷新页面。
 * - 语言检测优先级：storage 持久化 > chrome.i18n.getUILanguage() fallback
 * - t() 对未注册 key 返回 key 本身（渐进式覆盖，不影响未翻译组件）
 * - 语言包按需 import，避免初始包体积膨胀
 *
 * @module utils/i18n
 */

import { ref, type Ref } from 'vue';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import zhCN from '@/utils/i18n/locales/zh-CN.json';

/** 支持的语言类型 */
export type Locale = 'zh-CN' | 'en';

/** 语言包消息类型（支持嵌套） */
type Messages = Record<string, string>;

/** 当前激活语言（响应式，跨组件共享） */
export const currentLocale: Ref<Locale> = ref('zh-CN');

/** 已加载的语言包缓存（中文包静态内置作为兜底，确保首帧渲染不出现原始 key） */
const messagesCache: Record<Locale, Messages | null> = {
  'zh-CN': zhCN as Messages,
  en: null,
};

/** 加载中的语言包 Promise（防止并发重复加载） */
const loadingPromises: Record<Locale, Promise<Messages> | null> = {
  'zh-CN': null,
  en: null,
};

/**
 * 加载指定语言包（懒加载，带缓存）
 */
async function loadMessages(locale: Locale): Promise<Messages> {
  if (messagesCache[locale]) return messagesCache[locale]!;

  if (!loadingPromises[locale]) {
    loadingPromises[locale] = (async () => {
      try {
        // zh-CN 已在模块初始化时静态内置，此处仅处理 en 的懒加载
        const module = await import('@/utils/i18n/locales/en.json');
        const messages = (module.default ?? module) as Messages;
        messagesCache[locale] = messages;
        return messages;
      } catch (error) {
        logger.error(`i18n: 加载语言包 [${locale}] 失败:`, error);
        // 不缓存失败结果（{} 为 truthy 会永久阻断重试），下次调用可重新加载
        return {};
      } finally {
        loadingPromises[locale] = null;
      }
    })();
  }

  return loadingPromises[locale]!;
}

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
  let result = messages?.[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      // 转义参数名中的正则特殊字符，防御性避免 $ . 等字符导致匹配异常
      const escapedKey = paramKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), String(paramValue));
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
  await loadMessages(locale);
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

    await loadMessages(targetLocale);
    currentLocale.value = targetLocale;
  } catch (error) {
    logger.error('i18n: 初始化失败:', error);
    // 失败时默认中文（中文包已静态内置，无需再加载）
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
      loadMessages(newLocale)
        .then(() => {
          currentLocale.value = newLocale;
        })
        .catch(error => {
          logger.error('i18n: 同步语言变更失败:', error);
        });
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
