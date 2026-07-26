/**
 * 国际化（i18n）核心模块
 *
 * 提供 Vue 运行时语言切换能力，无需刷新页面。
 * - 语言检测优先级：localStorage 同步镜像 > storage 持久化 > chrome.i18n.getUILanguage() fallback
 * - t() 对未注册 key 返回 key 本身（渐进式覆盖，不影响未翻译组件）
 * - 语言包按命名空间拆分（utils/i18n/locales/{locale}/{namespace}.json），
 *   各入口经 bundles/ 下的注册模块按需静态内置自身所需命名空间：
 *   消除「全量语言包打入每个入口」的死重（拆分前 gzip ~52KB 全量进入
 *   sidepanel 首屏关键路径，其中 options 命名空间占 40% 且完全用不到），
 *   且保证任何语言下首帧不出现原始 key
 * - 语言偏好经 localStorage 同步镜像加速：initI18n 命中镜像时同步返回，
 *   消除 Vue 挂载前唯一的串行 storage IPC（Windows 冷环境 ~40-80ms）
 *
 * @module utils/i18n
 */

import { ref, type Ref } from 'vue';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/** 支持的语言类型 */
export type Locale = 'zh-CN' | 'en';

/** 语言包消息类型（扁平 key-value） */
export type Messages = Record<string, string>;

/** 当前激活语言（响应式，跨组件共享） */
export const currentLocale: Ref<Locale> = ref('zh-CN');

/** 语言包集合（由各入口的 bundle 注册模块按需填充，注册后同步就绪） */
const messagesCache: Record<Locale, Messages> = {
  'zh-CN': {},
  en: {},
};

/**
 * 注册命名空间语言包（供 utils/i18n/bundles/ 下的入口注册模块调用）
 *
 * 各入口在模块加载期（main.ts 顶部静态 import bundle）完成注册，
 * 早于任何组件渲染，保证首帧文案完整；懒加载组件（如 HelpDialog）
 * 可在自身 chunk 中追加注册专属命名空间，不占用首屏体积。
 *
 * @param locale 目标语言
 * @param packs 一个或多个命名空间语言包（后注册的同名 key 覆盖先注册的）
 */
export function registerMessages(locale: Locale, ...packs: Messages[]): void {
  Object.assign(messagesCache[locale], ...packs);
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
 * 校验任意值是否为合法语言标识
 */
function isValidLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}

/**
 * 读取 localStorage 语言镜像（同步、零 IPC）
 *
 * 扩展页面（options/popup/sidepanel）同源共享 localStorage，任一入口
 * setLocale 后镜像即对所有入口生效。SW 等无 localStorage 环境安全返回 null。
 */
function readLocaleMirror(): Locale | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEYS.LOCALE);
    return isValidLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 写入 localStorage 语言镜像（静默容错）
 */
function writeLocaleMirror(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEYS.LOCALE, locale);
  } catch {
    // 镜像仅为加速手段，写入失败不影响 storage 持久化主路径
  }
}

/**
 * 移除 localStorage 语言镜像（静默容错）
 *
 * 用于「清空所有数据」后 storage 已无显式偏好但镜像残留的对账场景，
 * 使下一次冷启动回到完整的浏览器语言检测路径。
 */
function removeLocaleMirror(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEYS.LOCALE);
  } catch {
    // 静默忽略
  }
}

/**
 * 切换语言并持久化到 storage（同时更新 localStorage 同步镜像）
 *
 * @param locale 目标语言
 */
export async function setLocale(locale: Locale): Promise<void> {
  // 语言包已静态内置，切换同步生效
  currentLocale.value = locale;
  writeLocaleMirror(locale);

  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.LOCALE]: locale });
  } catch (error) {
    logger.error('i18n: 持久化语言设置失败:', error);
  }
}

/**
 * 初始化 i18n：优先命中 localStorage 同步镜像，否则从 storage 读取用户语言偏好，
 * 仍无则跟随浏览器语言
 *
 * 镜像命中时同步完成初始化（消除 Vue 挂载前的串行 storage IPC），
 * 并在后台与 storage 持久化值对账（不一致时以 storage 为准并纠正镜像，
 * 覆盖镜像被清理/其它设备残留等边缘场景）。
 * 同时注册 storage 变更监听，实现 popup/options/sidepanel 多页面语言实时同步。
 * 应在应用入口（main.ts）中调用一次。
 */
export async function initI18n(): Promise<void> {
  const mirrored = readLocaleMirror();
  if (mirrored) {
    currentLocale.value = mirrored;
    initLocaleSync();
    // 后台对账（fire-and-forget）：storage 为持久化事实源，镜像漂移时纠正
    void reconcileLocaleFromStorage(mirrored);
    return;
  }

  await loadLocaleFromStorage();
  initLocaleSync();
}

/**
 * 从 storage 读取语言偏好并应用（无镜像时的完整初始化路径）
 */
async function loadLocaleFromStorage(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOCALE);
    const storedLocale = result[STORAGE_KEYS.LOCALE];

    let targetLocale: Locale;
    if (isValidLocale(storedLocale)) {
      targetLocale = storedLocale;
      // 仅显式用户偏好才写镜像：浏览器语言 fallback 推导值不落镜像，
      // 保证「跟随浏览器语言」的用户在切换 Chrome UI 语言后下次启动能重新检测
      writeLocaleMirror(targetLocale);
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
}

/**
 * 镜像命中后的后台对账：storage 持久化值与镜像不一致时以 storage 为准
 *
 * storage 已无合法值（如「清空所有数据」后镜像残留）时：移除镜像并
 * 重新按浏览器语言检测应用，避免已重置的语言偏好经镜像「复活」。
 *
 * @param mirrored 已应用的镜像语言
 */
async function reconcileLocaleFromStorage(mirrored: Locale): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOCALE);
    const storedLocale = result[STORAGE_KEYS.LOCALE];
    if (isValidLocale(storedLocale)) {
      if (storedLocale !== mirrored) {
        currentLocale.value = storedLocale;
        writeLocaleMirror(storedLocale);
      }
      return;
    }
    // storage 无显式偏好：镜像属残留，移除并回退到浏览器语言检测
    removeLocaleMirror();
    const uiLang = chrome?.i18n?.getUILanguage?.() ?? 'zh-CN';
    const detected: Locale = uiLang.startsWith('zh') ? 'zh-CN' : 'en';
    if (detected !== currentLocale.value) {
      currentLocale.value = detected;
    }
  } catch (error) {
    logger.debug('i18n: 语言镜像对账失败（忽略，以镜像值继续）:', error);
  }
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
    const newLocale = changes[STORAGE_KEYS.LOCALE].newValue;
    if (isValidLocale(newLocale) && newLocale !== currentLocale.value) {
      // 语言包已静态内置，同步切换即可（同时刷新镜像供下次冷启动命中）
      currentLocale.value = newLocale;
      writeLocaleMirror(newLocale);
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
