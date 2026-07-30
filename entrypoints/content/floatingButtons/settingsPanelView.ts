/**
 * 悬浮按钮设置弹窗 - 共用视图模块
 *
 * 共用目标：
 * 1. 悬浮按钮（content script Shadow DOM）通过 SettingsPanel.ts 使用
 * 2. 侧边栏（sidepanel App.vue）也复用同一份 HTML/CSS/事件逻辑
 *
 * 因此以纯函数 + 命令式 API 形式导出，避免引入 Vue 到 content script。
 */

import { closeIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { FloatingButtonConfig } from '@/utils/types';
import { THEME_OPTIONS, type ThemeName } from '@/utils/theme';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { getStoredLocale, isLiteLocale, type LiteLocale } from '@/utils/i18n-lite';
import type { SettingsPanelViewOptions, SettingsPanelViewHandle } from '@/entrypoints/content/floatingButtons/types';

// 重新导出供外部使用
export type { SettingsPanelViewOptions, SettingsPanelViewHandle } from '@/entrypoints/content/floatingButtons/types';

/**
 * 面板语言类型（复用 i18n-lite 的 LiteLocale；
 * 本模块被 content script 复用，为避免打包引入 Vue 与全量语言包，独立维护面板双语 map）
 */
export type PanelLocale = LiteLocale;

/**
 * 读取用户语言偏好（复用 i18n-lite 的 storage 读取，供 content script 等无 Vue 环境使用）
 */
export const getStoredPanelLocale = getStoredLocale;

/** 面板文案 key 类型 */
type PanelMessageKey =
  | 'title'
  | 'close'
  | 'theme'
  | 'visible'
  | 'fillMode'
  | 'fillSidebar'
  | 'fillInline'
  | 'fillManual'
  | 'autoTriggerLogin'
  | 'autoTriggerTip'
  | 'passwordVisibility'
  | 'passwordVisibilityTip'
  | 'opacity';

/** 面板内建双语文案（tip 类文案含 highlight-tip 高亮标记，需以 innerHTML 渲染） */
const PANEL_MESSAGES: Record<PanelLocale, Record<PanelMessageKey, string>> = {
  'zh-CN': {
    title: '偏好设置',
    close: '关闭',
    theme: '主题风格',
    visible: '显示悬浮按钮',
    fillMode: '快速填充方式',
    fillSidebar: '侧边栏',
    fillInline: '页面内联',
    fillManual: '仅手动',
    autoTriggerLogin: '自动触发登录',
    autoTriggerTip:
      '开启后，在侧边栏或页面内联快速填充密码成功后将自动点击登录按钮<span class="highlight-tip">（仅账号密码场景）</span>',
    passwordVisibility: '密码显示切换',
    passwordVisibilityTip:
      '开启后，密码输入框内将显示眼睛图标按钮，点击可切换密码明文/密文<span class="highlight-tip">（注：页面如有自带的眼睛图标会重叠显示）</span>',
    opacity: '按钮透明度',
  },
  en: {
    title: 'Preferences',
    close: 'Close',
    theme: 'Theme',
    visible: 'Show floating button',
    fillMode: 'Quick fill mode',
    fillSidebar: 'Sidebar',
    fillInline: 'Inline',
    fillManual: 'Manual',
    autoTriggerLogin: 'Auto-submit login',
    autoTriggerTip:
      'When enabled, the login button is clicked automatically after a successful quick fill from the sidebar or inline panel<span class="highlight-tip"> (username &amp; password forms only)</span>',
    passwordVisibility: 'Password visibility toggle',
    passwordVisibilityTip:
      'When enabled, an eye icon appears inside password fields to toggle between plain and masked text<span class="highlight-tip"> (note: it may overlap the site&#39;s own eye icon)</span>',
    opacity: 'Button opacity',
  },
};

/**
 * 判断任意值是否为合法面板语言
 * @param value 待校验值
 * @returns 是否为 PanelLocale
 */
const isPanelLocale = isLiteLocale;

/**
 * 主色（主题令牌，在 Shadow DOM 由 host 提供，在扩展页由 tokens.css 的 :root 提供）
 */
const THEME_COLOR = 'var(--aph-primary)';

/**
 * 警告提醒颜色
 */
const WARNING_COLOR = '#E6A23C';

/**
 * 危险警告颜色：#F56C6C（预留备用，暂未使用；如需启用取消下方注释即可）
 */
// const DANGER_COLOR = '#F56C6C';
/**
 * 设置弹窗共用样式
 * 注入到：悬浮按钮的 Shadow DOM（由 SettingsPanel 使用）/ 侧边栏的 document head
 */
export const settingsPanelViewStyles = `
/* 设置面板遮罩 */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 2147483646;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}

.settings-overlay.visible {
  opacity: 1;
  visibility: visible;
}

/* 设置面板 */
.settings-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.9);
  display: flex;
  flex-direction: column;
  /* 400px 宽度让中文 tip 基本单行展示，降低整体高度，常规小屏下无需滚动；
     窄视口（如侧边栏内）由 max-width 自动收窄 */
  width: 400px;
  max-width: 90vw;
  /* 小屏/长文案（如英文 tip）下限制整体高度，内容区滚动，避免面板占满甚至溢出视口 */
  max-height: min(600px, 90vh);
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  z-index: 2147483647;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  box-sizing: border-box;
}

.settings-panel.visible {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, -50%) scale(1);
}

.settings-panel *,
.settings-panel *::before,
.settings-panel *::after {
  box-sizing: border-box;
}

/* 设置面板头部 */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 14px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.settings-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #999;
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-close:hover {
  background: #f5f5f5;
  color: #666;
}

/* 设置面板内容（面板超高时作为唯一滚动区，header 保持固定） */
.settings-content {
  flex: 1 1 auto;
  padding: 16px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-content::-webkit-scrollbar {
  width: 4px;
}

.settings-content::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 4px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}

/* 设置项 */
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 14px;
  color: #333;
}

/* 开关样式 */
.switch {
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 24px;
  background: #dcdfe6;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.3s ease;
}

.switch.active {
  background: ${THEME_COLOR};
}

.switch-handle {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.switch.active .switch-handle {
  transform: translateX(20px);
}

/* 滑块样式 */
.slider-container {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
}

.slider {
  width: 140px;
  height: 4px;
  background: #e4e7ed;
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.slider-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: ${THEME_COLOR};
  border-radius: 2px;
  transition: width 0.1s ease;
}

.slider-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  background: #fff;
  border: 2px solid ${THEME_COLOR};
  border-radius: 50%;
  cursor: grab;
  transition: transform 0.1s ease;
}

.slider-thumb:hover {
  transform: translate(-50%, -50%) scale(1.1);
}

.slider-thumb:active {
  cursor: grabbing;
}

.slider-value {
  font-size: 13px;
  color: #666;
  min-width: 36px;
  text-align: right;
}

/* 设置分组 */
.setting-group {
  margin-bottom: 16px;
}

.setting-group-title {
  font-size: 13px;
  font-weight: 500;
  color: #666;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}

/* 设置提示文字 */
.setting-tip {
  font-size: 12px;
  color: #999;
  padding: 4px 0 10px;
  line-height: 1.4;
  border-bottom: 1px solid #f0f0f0;
}

/* 括号内说明文字高亮提醒 */
.setting-tip .highlight-tip {
  color: ${WARNING_COLOR};
  font-weight: 500;
}

/* 快速填充方式 - 三选一分段控件 */
.setting-item.setting-item-stack {
  flex-direction: column;
  align-items: stretch;
  border-bottom: none;
}

.fill-mode-group {
  display: flex;
  gap: 4px;
  margin-top: 10px;
  padding: 3px;
  background: #f0f2f5;
  border-radius: 10px;
}

.fill-mode-option {
  flex: 1;
  padding: 7px 0;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: #4b5563;
  text-align: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease;
}

.fill-mode-option:hover {
  color: #333;
}

.fill-mode-option.active {
  color: #fff;
  background: ${THEME_COLOR};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

/* 主题色块选择器 */
.theme-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  max-width: 210px;
}

.theme-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  background: var(--swatch);
  border: 2px solid #fff;
  border-radius: 50%;
  outline: 1px solid #dcdfe6;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    outline-color 0.15s ease;
}

.theme-swatch:hover {
  transform: scale(1.12);
}

.theme-swatch.active {
  outline: 2px solid var(--swatch);
  outline-offset: 1px;
}

/* 语言切换 - 二选一分段控件（复用 fill-mode 胶囊样式，行内右对齐） */
.locale-group {
  flex: 0 0 auto;
  width: 156px;
  margin-top: 0;
}

/* 分段胶囊通用选中标识：✓ 作为不依赖颜色的第二信号，浅色主题下也可辨识 */
.fill-mode-option.active::before {
  content: '✓ ';
}
`;

/** 快速填充入口（3 选 1，由 autoShowSidepanel + fillMode 两字段派生） */
type FillEntry = 'sidepanel' | 'inline' | 'manual';

/** 各填充入口的说明文案（随选择与语言动态切换） */
const FILL_ENTRY_TIPS: Record<PanelLocale, Record<FillEntry, string>> = {
  'zh-CN': {
    sidepanel: '聚焦登录框时自动弹出侧边栏，账号信息展示最全',
    inline: '登录框内显示钥匙图标，点击展开页面内填充面板，轻量不占屏',
    manual: '聚焦时不自动弹出；点击悬浮按钮或浏览器工具栏图标再打开侧边栏',
  },
  en: {
    sidepanel: 'Automatically opens the sidebar when a login field is focused, showing the most complete account info',
    inline: 'Shows a key icon inside the login field; click it to open a lightweight in-page fill panel',
    manual: 'No auto popup on focus; open the sidebar via the floating button or the toolbar icon',
  },
};

/**
 * 由配置派生当前填充入口
 *
 * 三态互斥，消除“内联开启 + 侧边栏自动”这种自相矛盾的组合：
 * - fillMode 为 'inline' 时优先判定为内联（此时 autoShowSidepanel 不生效）
 * - 否则按 autoShowSidepanel 区分“侧边栏自动”与“仅手动”
 * @param config 悬浮按钮配置
 * @returns 当前填充入口
 */
function getFillEntry(config: FloatingButtonConfig): FillEntry {
  if (config.fillMode === 'inline') return 'inline';
  return config.autoShowSidepanel ? 'sidepanel' : 'manual';
}

/**
 * 将填充入口映射回存储字段
 *
 * 每次选择都同时写入 fillMode 与 autoShowSidepanel，保证存储始终为规范态、
 * 不残留旧的矛盾组合。
 * @param entry 目标填充入口
 * @returns 需增量保存的配置补丁
 */
function fillEntryToPatch(entry: FillEntry): Partial<FloatingButtonConfig> {
  switch (entry) {
    case 'inline':
      return { fillMode: 'inline', autoShowSidepanel: false };
    case 'manual':
      return { fillMode: 'sidepanel', autoShowSidepanel: false };
    case 'sidepanel':
    default:
      return { fillMode: 'sidepanel', autoShowSidepanel: true };
  }
}

/**
 * 获取主题选项在指定语言下的展示标签
 * @param option 主题选项
 * @param locale 面板语言
 * @returns 主题标签
 */
function getThemeLabel(option: (typeof THEME_OPTIONS)[number], locale: PanelLocale): string {
  return locale === 'en' ? option.labelEn : option.label;
}

/**
 * 生成设置面板内部 HTML（不含外层 .settings-panel 容器本身，由调用方提供容器）
 * @param config 悬浮按钮配置
 * @param locale 面板语言（扩展页传 currentLocale，content script 经 getStoredPanelLocale 获取）
 */
export function getSettingsPanelHTML(config: FloatingButtonConfig, locale: PanelLocale = 'zh-CN'): string {
  const msg = PANEL_MESSAGES[locale];
  const opacityPct = Math.round(config.opacity * 100);
  const fillEntry = getFillEntry(config);
  const themeSwatches = THEME_OPTIONS.map(
    option =>
      `<button class="theme-swatch ${config.theme === option.name ? 'active' : ''}" data-theme="${option.name}" title="${getThemeLabel(option, locale)}" style="--swatch: ${option.swatch}"></button>`,
  ).join('');
  return `
    <div class="settings-header">
      <h3 class="settings-title" data-i18n="title">${msg.title}</h3>
      <button class="settings-close" data-action="close" title="${msg.close}">
        ${closeIcon}
      </button>
    </div>
    <div class="settings-content">
      <div class="setting-item">
        <span class="setting-label" data-i18n="theme">${msg.theme}</span>
        <div class="theme-swatches" data-setting="theme">${themeSwatches}</div>
      </div>

      <div class="setting-item">
        <span class="setting-label">语言 / Language</span>
        <div class="fill-mode-group locale-group" data-setting="locale">
          <button class="fill-mode-option ${locale === 'zh-CN' ? 'active' : ''}" data-value="zh-CN">中文</button>
          <button class="fill-mode-option ${locale === 'en' ? 'active' : ''}" data-value="en">English</button>
        </div>
      </div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="visible">${msg.visible}</span>
        <div class="switch ${config.visible ? 'active' : ''}" data-setting="visible">
          <div class="switch-handle"></div>
        </div>
      </div>

      <div class="setting-item setting-item-stack">
        <span class="setting-label" data-i18n="fillMode">${msg.fillMode}</span>
        <div class="fill-mode-group" data-setting="fillEntry">
          <button class="fill-mode-option ${fillEntry === 'sidepanel' ? 'active' : ''}" data-value="sidepanel" data-i18n="fillSidebar">${msg.fillSidebar}</button>
          <button class="fill-mode-option ${fillEntry === 'inline' ? 'active' : ''}" data-value="inline" data-i18n="fillInline">${msg.fillInline}</button>
          <button class="fill-mode-option ${fillEntry === 'manual' ? 'active' : ''}" data-value="manual" data-i18n="fillManual">${msg.fillManual}</button>
        </div>
      </div>
      <div class="setting-tip" data-fill-tip>${FILL_ENTRY_TIPS[locale][fillEntry]}</div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="autoTriggerLogin">${msg.autoTriggerLogin}</span>
        <div class="switch ${config.autoTriggerLogin ? 'active' : ''}" data-setting="autoTriggerLogin">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip" data-i18n="autoTriggerTip">${msg.autoTriggerTip}</div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="passwordVisibility">${msg.passwordVisibility}</span>
        <div class="switch ${config.passwordVisibilityToggle ? 'active' : ''}" data-setting="passwordVisibilityToggle">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip" data-i18n="passwordVisibilityTip">${msg.passwordVisibilityTip}</div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="opacity">${msg.opacity}</span>
        <div class="slider-container">
          <div class="slider" data-setting="opacity">
            <div class="slider-fill" style="width: ${opacityPct}%"></div>
            <div class="slider-thumb" style="left: ${opacityPct}%"></div>
          </div>
          <span class="slider-value">${opacityPct}%</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * 将指定语言的文案应用到面板 DOM（含 data-i18n 文案、填充提示、主题色块 title、语言选中态）
 *
 * @param panelRoot 面板根元素
 * @param locale 目标语言
 * @param config 当前配置（用于计算填充提示文案）
 */
function applyPanelLocale(panelRoot: HTMLElement, locale: PanelLocale, config: FloatingButtonConfig): void {
  const msg = PANEL_MESSAGES[locale];

  // data-i18n 标记的文案（tip 类含高亮 span，统一以 innerHTML 渲染静态内建文案）
  panelRoot.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n') as PanelMessageKey | null;
    if (key && msg[key]) el.innerHTML = msg[key];
  });

  // 关闭按钮 title
  const closeBtn = panelRoot.querySelector('[data-action="close"]');
  closeBtn?.setAttribute('title', msg.close);

  // 填充方式说明文案
  const fillTip = panelRoot.querySelector('[data-fill-tip]');
  if (fillTip) fillTip.textContent = FILL_ENTRY_TIPS[locale][getFillEntry(config)];

  // 主题色块 tooltip
  panelRoot.querySelectorAll<HTMLElement>('.theme-swatch').forEach(swatch => {
    const name = swatch.getAttribute('data-theme');
    const option = THEME_OPTIONS.find(item => item.name === name);
    if (option) swatch.setAttribute('title', getThemeLabel(option, locale));
  });

  // 语言分段控件选中态
  panelRoot.querySelectorAll<HTMLElement>('[data-setting="locale"] .fill-mode-option').forEach(optionEl => {
    optionEl.classList.toggle('active', optionEl.getAttribute('data-value') === locale);
  });
}

/**
 * 绑定事件：close、overlay 点击、switch、slider 拖拽、语言切换
 *
 * @param panelRoot 面板根元素（.settings-panel）
 * @param overlayEl 遮罩元素（.settings-overlay），可为 null
 * @param initialConfig 初始配置（内部维护一份副本用于事件处理）
 * @param options 回调集合
 * @param initialLocale 初始面板语言（需与 getSettingsPanelHTML 的 locale 一致）
 */
export function bindSettingsPanelView(
  panelRoot: HTMLElement,
  overlayEl: HTMLElement | null,
  initialConfig: FloatingButtonConfig,
  options: SettingsPanelViewOptions,
  initialLocale: PanelLocale = 'zh-CN',
): SettingsPanelViewHandle {
  const config: FloatingButtonConfig = { ...initialConfig };
  let locale: PanelLocale = initialLocale;
  const cleanups: Array<() => void> = [];

  // 关闭按钮
  const closeBtn = panelRoot.querySelector('[data-action="close"]') as HTMLElement | null;
  const onCloseClick = (e: Event) => {
    e.stopPropagation();
    options.onClose?.();
  };
  closeBtn?.addEventListener('click', onCloseClick);
  cleanups.push(() => closeBtn?.removeEventListener('click', onCloseClick));

  // overlay 点击关闭
  const onOverlayClick = () => options.onClose?.();
  overlayEl?.addEventListener('click', onOverlayClick);
  cleanups.push(() => overlayEl?.removeEventListener('click', onOverlayClick));

  // 阻止面板点击事件冒泡到 overlay
  const onPanelClick = (e: Event) => e.stopPropagation();
  panelRoot.addEventListener('click', onPanelClick);
  cleanups.push(() => panelRoot.removeEventListener('click', onPanelClick));

  // 布尔 switch
  const switchKeys: Array<'visible' | 'autoTriggerLogin' | 'passwordVisibilityToggle'> = [
    'visible',
    'autoTriggerLogin',
    'passwordVisibilityToggle',
  ];
  switchKeys.forEach(key => {
    const el = panelRoot.querySelector(`[data-setting="${key}"]`) as HTMLElement | null;
    if (!el) return;
    const onClick = () => {
      const next = !config[key];
      config[key] = next;
      el.classList.toggle('active', next);
      options.onConfigChange({ [key]: next } as Partial<FloatingButtonConfig>);
    };
    el.addEventListener('click', onClick);
    cleanups.push(() => el.removeEventListener('click', onClick));
  });

  // 快速填充方式（3 选 1 分段控件，写回 fillMode + autoShowSidepanel 两字段）
  const fillGroup = panelRoot.querySelector('[data-setting="fillEntry"]') as HTMLElement | null;
  const fillTipEl = panelRoot.querySelector('[data-fill-tip]') as HTMLElement | null;
  if (fillGroup) {
    const optionEls = Array.from(fillGroup.querySelectorAll<HTMLButtonElement>('.fill-mode-option'));
    optionEls.forEach(optionEl => {
      const onOptionClick = () => {
        const entry = optionEl.getAttribute('data-value') as FillEntry | null;
        if (!entry || getFillEntry(config) === entry) return;
        const patch = fillEntryToPatch(entry);
        Object.assign(config, patch);
        optionEls.forEach(item => item.classList.toggle('active', item === optionEl));
        if (fillTipEl) fillTipEl.textContent = FILL_ENTRY_TIPS[locale][entry];
        options.onConfigChange(patch);
      };
      optionEl.addEventListener('click', onOptionClick);
      cleanups.push(() => optionEl.removeEventListener('click', onOptionClick));
    });
  }

  // 语言切换（2 选 1 分段控件，直接写 storage 的 LOCALE 键，扩展页经 storage 监听自动同步）
  const setPanelLocale = (next: PanelLocale) => {
    if (locale === next) return;
    locale = next;
    applyPanelLocale(panelRoot, next, config);
  };
  const localeGroup = panelRoot.querySelector('[data-setting="locale"]') as HTMLElement | null;
  if (localeGroup) {
    const localeOptionEls = Array.from(localeGroup.querySelectorAll<HTMLButtonElement>('.fill-mode-option'));
    localeOptionEls.forEach(optionEl => {
      const onLocaleClick = () => {
        const next = optionEl.getAttribute('data-value');
        if (!isPanelLocale(next) || locale === next) return;
        setPanelLocale(next);
        void chrome.storage.local.set({ [STORAGE_KEYS.LOCALE]: next });
      };
      optionEl.addEventListener('click', onLocaleClick);
      cleanups.push(() => optionEl.removeEventListener('click', onLocaleClick));
    });

    // 其它入口切换语言时，本面板文案同步刷新
    if (chrome?.storage?.onChanged) {
      const onLocaleStorageChange = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: chrome.storage.AreaName,
      ) => {
        if (area !== 'local' || !changes[STORAGE_KEYS.LOCALE]) return;
        const next = changes[STORAGE_KEYS.LOCALE].newValue;
        if (isPanelLocale(next)) setPanelLocale(next);
      };
      chrome.storage.onChanged.addListener(onLocaleStorageChange);
      cleanups.push(() => chrome.storage.onChanged.removeListener(onLocaleStorageChange));
    }
  }

  // 主题色块选择
  const themeContainer = panelRoot.querySelector('[data-setting="theme"]') as HTMLElement | null;
  if (themeContainer) {
    const swatches = Array.from(themeContainer.querySelectorAll<HTMLElement>('.theme-swatch'));
    swatches.forEach(swatch => {
      const onSwatchClick = () => {
        const name = swatch.getAttribute('data-theme') as ThemeName | null;
        if (!name || config.theme === name) return;
        config.theme = name;
        swatches.forEach(item => item.classList.toggle('active', item === swatch));
        options.onConfigChange({ theme: name });
      };
      swatch.addEventListener('click', onSwatchClick);
      cleanups.push(() => swatch.removeEventListener('click', onSwatchClick));
    });
  }

  // 透明度滑块
  const opacitySlider = panelRoot.querySelector('[data-setting="opacity"]') as HTMLElement | null;
  if (opacitySlider) {
    const fill = opacitySlider.querySelector('.slider-fill') as HTMLElement | null;
    const thumb = opacitySlider.querySelector('.slider-thumb') as HTMLElement | null;
    const valueDisplay = opacitySlider.parentElement?.querySelector('.slider-value') as HTMLElement | null;

    let isDragging = false;

    const updateSlider = (clientX: number) => {
      const rect = opacitySlider.getBoundingClientRect();
      let percentage = (clientX - rect.left) / rect.width;
      percentage = Math.max(0.1, Math.min(1, percentage));

      if (fill) fill.style.width = `${percentage * 100}%`;
      if (thumb) thumb.style.left = `${percentage * 100}%`;
      if (valueDisplay) valueDisplay.textContent = `${Math.round(percentage * 100)}%`;

      config.opacity = percentage;
      options.onConfigChange({ opacity: percentage });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      updateSlider(e.clientX);
    };
    const handleMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      updateSlider(e.clientX);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
    opacitySlider.addEventListener('mousedown', onMouseDown);
    cleanups.push(() => {
      opacitySlider.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    });

    // 触摸事件
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      e.preventDefault();
      updateSlider(e.touches[0].clientX);
    };
    const handleTouchEnd = () => {
      isDragging = false;
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      isDragging = true;
      updateSlider(e.touches[0].clientX);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
    };
    opacitySlider.addEventListener('touchstart', onTouchStart, { passive: false });
    cleanups.push(() => {
      opacitySlider.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    });
  }

  const updateConfig = (newConfig: FloatingButtonConfig) => {
    Object.assign(config, newConfig);

    // 更新布尔 switch
    switchKeys.forEach(key => {
      const el = panelRoot.querySelector(`[data-setting="${key}"]`);
      el?.classList.toggle('active', !!config[key]);
    });

    // 更新快速填充方式分段控件与说明文案（限定 fillEntry 分组，避免误改语言分段控件）
    const currentEntry = getFillEntry(config);
    panelRoot.querySelectorAll<HTMLElement>('[data-setting="fillEntry"] .fill-mode-option').forEach(optionEl => {
      optionEl.classList.toggle('active', optionEl.getAttribute('data-value') === currentEntry);
    });
    const fillTip = panelRoot.querySelector('[data-fill-tip]');
    if (fillTip) fillTip.textContent = FILL_ENTRY_TIPS[locale][currentEntry];

    // 更新主题色块选中态
    panelRoot.querySelectorAll<HTMLElement>('.theme-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.getAttribute('data-theme') === config.theme);
    });

    // 更新滑块
    const slider = panelRoot.querySelector('[data-setting="opacity"]');
    if (slider) {
      const fill = slider.querySelector('.slider-fill') as HTMLElement | null;
      const thumb = slider.querySelector('.slider-thumb') as HTMLElement | null;
      const valueDisplay = slider.parentElement?.querySelector('.slider-value') as HTMLElement | null;
      const pct = Math.round(config.opacity * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;
      if (valueDisplay) valueDisplay.textContent = `${pct}%`;
    }
  };

  const destroy = () => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  };

  return { updateConfig, setLocale: setPanelLocale, destroy };
}
