/**
 * 悬浮按钮偏好设置弹窗 - 共用视图模块
 *
 * 共用目标：
 * 1. 悬浮按钮（content script Shadow DOM）通过 SettingsPanel.ts 使用
 * 2. 侧边栏（sidepanel App.vue）也复用同一份 HTML/CSS/事件逻辑
 *
 * 因此以纯函数 + 命令式 API 形式导出，避免引入 Vue 到 content script。
 */

import { closeIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { FillEntry, FloatingButtonConfig } from '@/utils/types';
import { fillEntryToPatch, getFillEntry, isFillEntry } from '@/utils/fillEntry';
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

/**
 * 三个布尔开关的设置键 → 面板文案键
 *
 * `div.switch` 不是原生控件，读屏只能靠 `aria-label` 念出它是什么；这份映射让
 * aria-label 与同行可见标签取同一个真源，切语言时由 `applyPanelLocale` 一起刷新。
 */
const SWITCH_LABEL_KEYS = {
  visible: 'visible',
  autoTriggerLogin: 'autoTriggerLogin',
  passwordVisibilityToggle: 'passwordVisibility',
} as const;

/** 开关设置键（同时也是 `FloatingButtonConfig` 上的三个布尔字段） */
type SwitchSetting = keyof typeof SWITCH_LABEL_KEYS;

/** 开关设置键列表（绑定与外部同步共用） */
const SWITCH_SETTINGS = Object.keys(SWITCH_LABEL_KEYS) as SwitchSetting[];

/**
 * 透明度滑块的键盘档位
 *
 * `aria-valuemin` 与方向键下限都取自 {@link OPACITY_MIN_PCT}，与 `updateSlider` 里
 * 「夹到 0.1」的既有硬下限同值；步长 5 个百分点，走完 10→100 需 18 次按键，
 * 与鼠标拖拽的精细度相当，又不至于一次按过头。
 */
const OPACITY_MIN_PCT = 10;
const OPACITY_STEP_PCT = 5;

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
  | 'fillOverrideNote'
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
    // 以 textContent 渲染（不进 data-i18n 的 innerHTML 通道），`{entry}` 由内建档位标签替换，不含外部数据
    fillOverrideNote: '当前站点已被站点规则覆盖为「{entry}」，此处改动的是全局设置，对该站点不生效',
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
    fillOverrideNote: 'A site rule overrides this site to "{entry}". Settings here apply globally and not to this site',
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
 * 偏好设置弹窗共用样式
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
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
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

/*
 * 站点覆盖提示：与常规 tip 同规格，只换颜色做归因标记。
 * 用告警色而非常规灰，是因为它解释的是「你在这里改了也没用」——静默混在说明文字里
 * 等于没有提示。隐藏由 hidden 属性负责（本类不设置 display，浏览器默认生效）。
 */
.setting-fill-override {
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

/*
 * 键盘焦点轮廓（WCAG 2.4.7）。面板里的可调控件是 div（开关、滑块）和无边框 button
 * （分段项、关闭键），Tab 停上去原本没有任何可见落点；这里给每一类补一圈轮廓。
 * 用 :focus-visible 而非 :focus：鼠标点击不留常驻方框，只给键盘路径画轮廓。
 * 主色走 THEME_COLOR——Shadow DOM 由 host 内联写入、扩展页由 tokens.css 的 :root 提供，因此跟随换肤。
 */
.switch:focus-visible,
.fill-mode-option:focus-visible,
.settings-close:focus-visible {
  outline: 2px solid ${THEME_COLOR};
  outline-offset: 2px;
}

/* 轨道只有 4px 高，轮廓贴边会看成一条线，多留 2px 让焦点环明显包住整根滑块 */
.slider:focus-visible {
  outline: 2px solid ${THEME_COLOR};
  outline-offset: 4px;
}

/*
 * 色块的 outline 已被选中态占用（.active 用它画同色外圈），焦点只能另起一层 box-shadow：
 * 先用一道白环把 2px 白边框与焦点环分开，再画主色环，选中态与焦点态于是能同时被看见。
 * 层级从内到外：白边框 → 灰色常驻描边 → 白环 → 主色环。
 */
.theme-swatch:focus-visible {
  box-shadow:
    0 0 0 2px #fff,
    0 0 0 4px ${THEME_COLOR};
}

/*
 * 减弱动效档：只撤悬浮时的放大，且必须保留把手的定位位移。
 * .slider-thumb 的 translate(-50%, -50%) 是用来把把手钉在轨道端点中心的定位手段，
 * 不是动效——写成 transform: none 会让把手跳出中心、看起来像控件坏了。
 */
@media (prefers-reduced-motion: reduce) {
  .slider-thumb:hover {
    transform: translate(-50%, -50%);
  }

  .theme-swatch:hover {
    transform: none;
  }
}
`;

/** 快速填充入口的类型与「两字段 ↔ 三档」映射见 `@/utils/fillEntry`，与内容脚本、站点规则共用同一份口径 */

/** 各入口在分段控件上的文案 key，供「已被站点规则覆盖」提示复用同一个词 */
const FILL_ENTRY_LABEL_KEYS: Record<FillEntry, PanelMessageKey> = {
  sidepanel: 'fillSidebar',
  inline: 'fillInline',
  manual: 'fillManual',
};

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
 * 获取主题选项在指定语言下的展示标签
 * @param option 主题选项
 * @param locale 面板语言
 * @returns 主题标签
 */
function getThemeLabel(option: (typeof THEME_OPTIONS)[number], locale: PanelLocale): string {
  return locale === 'en' ? option.labelEn : option.label;
}

/**
 * 组装「已被站点规则覆盖」提示文案
 *
 * `{entry}` 只由本模块内建的档位标签（`fillSidebar` / `fillInline` / `fillManual`）替换，
 * 不含域名或任何外部数据，渲染侧也用 textContent 而非 innerHTML。
 * @param locale 面板语言
 * @param entry 站点规则覆盖到的档位
 * @returns 提示文案
 */
function fillOverrideNote(locale: PanelLocale, entry: FillEntry): string {
  const label = PANEL_MESSAGES[locale][FILL_ENTRY_LABEL_KEYS[entry]];
  return PANEL_MESSAGES[locale].fillOverrideNote.replace('{entry}', label);
}

/**
 * 刷新「已被站点规则覆盖」提示的文案与显隐
 *
 * 判定与初始 HTML 用的是同一条（有覆盖 **且** 与全局档位不同），语言切换、配置刷新、
 * 覆盖值变化三处都走这里——各自复刻一遍迟早出现「改了全局档位提示没跟着消失」这类
 * 只更新一半的状态。元素不存在时（侧边栏 / Options 复用面板不渲染覆盖提示的可能）静默返回。
 *
 * @param panelRoot 面板根元素
 * @param locale 面板语言
 * @param config 当前配置（用于比对全局档位）
 * @param siteFillOverride 站点规则覆盖的档位，无覆盖传 null
 */
function renderFillOverride(
  panelRoot: HTMLElement,
  locale: PanelLocale,
  config: FloatingButtonConfig,
  siteFillOverride: FillEntry | null,
): void {
  const el = panelRoot.querySelector<HTMLElement>('[data-fill-override]');
  if (!el) return;
  const note =
    siteFillOverride && siteFillOverride !== getFillEntry(config) ? fillOverrideNote(locale, siteFillOverride) : '';
  el.hidden = !note;
  el.textContent = note;
}

/**
 * 把透明度写进滑块的填充条、把手、读数与 ARIA 取值
 *
 * 拖拽、触摸、键盘、外部配置同步四条路径共用同一出口，避免「视觉上动了、读屏里没动」。
 * 填充与把手保留原始的 `percentage * 100` 写法（不做整数化），只有读数与 ARIA 取整。
 *
 * @param slider 滑块根元素（`role="slider"`）
 * @param percentage 0–1 的透明度
 */
function renderOpacity(slider: HTMLElement, percentage: number): void {
  const pct = Math.round(percentage * 100);
  const fill = slider.querySelector<HTMLElement>('.slider-fill');
  const thumb = slider.querySelector<HTMLElement>('.slider-thumb');
  const valueDisplay = slider.parentElement?.querySelector<HTMLElement>('.slider-value');
  if (fill) fill.style.width = `${percentage * 100}%`;
  if (thumb) thumb.style.left = `${percentage * 100}%`;
  if (valueDisplay) valueDisplay.textContent = `${pct}%`;
  slider.setAttribute('aria-valuenow', String(pct));
  slider.setAttribute('aria-valuetext', `${pct}%`);
}

/**
 * 同步分段控件 / 主题色块的选中态
 *
 * 类名给眼睛、`aria-pressed` 给读屏，两者必须一起改：只改类名时，键盘用户 Tab 到按钮上
 * 只听到「按钮，侧边栏」，永远不知道当前生效的是哪一档——选中态在面板里是靠底色和勾表达的，
 * 全属视觉通道。
 *
 * @param items 同一分组内的全部可选项
 * @param isActive 判定某项是否选中
 */
function setPressedState(items: HTMLElement[], isActive: (item: HTMLElement) => boolean): void {
  items.forEach(item => {
    const active = isActive(item);
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
}

/**
 * 生成设置面板内部 HTML（不含外层 .settings-panel 容器本身，由调用方提供容器）
 * @param config 悬浮按钮配置
 * @param locale 面板语言（扩展页传 currentLocale，content script 经 getStoredPanelLocale 获取）
 * @param siteFillOverride 当前站点由站点规则覆盖的档位（无覆盖时传 null；侧边栏与 Options 的全局设置不传）
 */
export function getSettingsPanelHTML(
  config: FloatingButtonConfig,
  locale: PanelLocale = 'zh-CN',
  siteFillOverride?: FillEntry | null,
): string {
  const msg = PANEL_MESSAGES[locale];
  const opacityPct = Math.round(config.opacity * 100);
  const fillEntry = getFillEntry(config);
  // 覆盖提示只在「确有覆盖，且覆盖与全局不同档」时有话可说；元素常驻并以 `hidden` 控制显隐，
  // 因为悬浮按钮面板先于 storage 读取渲染，档位是之后由 setSiteFillOverride 点亮的。
  const overrideNote =
    siteFillOverride && siteFillOverride !== fillEntry ? fillOverrideNote(locale, siteFillOverride) : '';
  const themeSwatches = THEME_OPTIONS.map(
    option =>
      `<button class="theme-swatch ${config.theme === option.name ? 'active' : ''}" data-theme="${option.name}" title="${getThemeLabel(option, locale)}" aria-pressed="${config.theme === option.name}" style="--swatch: ${option.swatch}"></button>`,
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
          <button class="fill-mode-option ${locale === 'zh-CN' ? 'active' : ''}" data-value="zh-CN" aria-pressed="${locale === 'zh-CN'}">中文</button>
          <button class="fill-mode-option ${locale === 'en' ? 'active' : ''}" data-value="en" aria-pressed="${locale === 'en'}">English</button>
        </div>
      </div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="visible">${msg.visible}</span>
        <div class="switch ${config.visible ? 'active' : ''}" data-setting="visible" role="switch" tabindex="0" aria-checked="${config.visible}" aria-label="${msg.visible}">
          <div class="switch-handle"></div>
        </div>
      </div>

      <div class="setting-item setting-item-stack">
        <span class="setting-label" data-i18n="fillMode">${msg.fillMode}</span>
        <div class="fill-mode-group" data-setting="fillEntry">
          <button class="fill-mode-option ${fillEntry === 'sidepanel' ? 'active' : ''}" data-value="sidepanel" aria-pressed="${fillEntry === 'sidepanel'}" data-i18n="fillSidebar">${msg.fillSidebar}</button>
          <button class="fill-mode-option ${fillEntry === 'inline' ? 'active' : ''}" data-value="inline" aria-pressed="${fillEntry === 'inline'}" data-i18n="fillInline">${msg.fillInline}</button>
          <button class="fill-mode-option ${fillEntry === 'manual' ? 'active' : ''}" data-value="manual" aria-pressed="${fillEntry === 'manual'}" data-i18n="fillManual">${msg.fillManual}</button>
        </div>
      </div>
      <div class="setting-tip" data-fill-tip>${FILL_ENTRY_TIPS[locale][fillEntry]}</div>
      <div class="setting-tip setting-fill-override" data-fill-override${overrideNote ? '' : ' hidden'}>${overrideNote}</div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="autoTriggerLogin">${msg.autoTriggerLogin}</span>
        <div class="switch ${config.autoTriggerLogin ? 'active' : ''}" data-setting="autoTriggerLogin" role="switch" tabindex="0" aria-checked="${config.autoTriggerLogin}" aria-label="${msg.autoTriggerLogin}">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip" data-i18n="autoTriggerTip">${msg.autoTriggerTip}</div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="passwordVisibility">${msg.passwordVisibility}</span>
        <div class="switch ${config.passwordVisibilityToggle ? 'active' : ''}" data-setting="passwordVisibilityToggle" role="switch" tabindex="0" aria-checked="${config.passwordVisibilityToggle}" aria-label="${msg.passwordVisibility}">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip" data-i18n="passwordVisibilityTip">${msg.passwordVisibilityTip}</div>

      <div class="setting-item">
        <span class="setting-label" data-i18n="opacity">${msg.opacity}</span>
        <div class="slider-container">
          <div class="slider" data-setting="opacity" role="slider" tabindex="0" aria-label="${msg.opacity}" aria-valuemin="${OPACITY_MIN_PCT}" aria-valuemax="100" aria-valuenow="${opacityPct}" aria-valuetext="${opacityPct}%">
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
 * @param siteFillOverride 当前站点的覆盖档位（用于刷新覆盖提示文案）
 */
function applyPanelLocale(
  panelRoot: HTMLElement,
  locale: PanelLocale,
  config: FloatingButtonConfig,
  siteFillOverride: FillEntry | null,
): void {
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

  // 站点覆盖提示的文案也要跟着换语言
  renderFillOverride(panelRoot, locale, config, siteFillOverride);

  // 主题色块 tooltip
  panelRoot.querySelectorAll<HTMLElement>('.theme-swatch').forEach(swatch => {
    const name = swatch.getAttribute('data-theme');
    const option = THEME_OPTIONS.find(item => item.name === name);
    if (option) swatch.setAttribute('title', getThemeLabel(option, locale));
  });

  // 语言分段控件选中态
  setPressedState(
    [...panelRoot.querySelectorAll<HTMLElement>('[data-setting="locale"] .fill-mode-option')],
    optionEl => optionEl.getAttribute('data-value') === locale,
  );

  // 非原生控件的无障碍名与同行可见标签同值，跟着换语言一起刷（否则读屏会一直念着旧语言）
  SWITCH_SETTINGS.forEach(setting => {
    panelRoot
      .querySelector<HTMLElement>(`[data-setting="${setting}"]`)
      ?.setAttribute('aria-label', msg[SWITCH_LABEL_KEYS[setting]]);
  });
  // 滑块没有可读的同行标签可兜底，aria-label 是它唯一的无障碍名通道
  panelRoot.querySelector<HTMLElement>('[data-setting="opacity"]')?.setAttribute('aria-label', msg.opacity);
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
  /** 当前站点的覆盖档位；由调用方在异步读到站点规则后经 `setSiteFillOverride` 写入 */
  let siteFillOverride: FillEntry | null = null;
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

  // Esc 关闭：面板有遮罩点击与关闭按钮两条鼠标出口，键盘必须有等价的第三条（WCAG 2.1.1）。
  // 挂在 document 捕获阶段而不是面板内：面板刻意不抢焦点，用户此刻的焦点常常仍停在页面登录框上，
  // 按键路径不经过影子树（口径同内联下拉与保存弹窗的 Esc 兜底）。不 preventDefault——页面自己的
  // Esc 语义（收起它自己的下拉、清空搜索）不该被一个偏好面板撤掉，最坏结果只是面板跟着关，而这正是意图。
  // 必须按 visible 类收窄：悬浮按钮侧的 SettingsPanel 在构造期就绑定视图，此后 show()/hide() 只切类，
  // 无条件响应会把站点页面上每一次 Esc 都吞成「关闭一个根本没打开的面板」。
  const onEscapeKeydown = (e: Event): void => {
    if (!(e instanceof KeyboardEvent) || e.key !== 'Escape') return;
    // 输入法合成期间的 Esc 语义是「取消候选词」，必须让位
    if (e.isComposing) return;
    if (!panelRoot.classList.contains('visible')) return;
    options.onClose?.();
  };
  document.addEventListener('keydown', onEscapeKeydown, true);
  cleanups.push(() => document.removeEventListener('keydown', onEscapeKeydown, true));

  // 布尔 switch
  SWITCH_SETTINGS.forEach(key => {
    const el = panelRoot.querySelector<HTMLElement>(`[data-setting="${key}"]`);
    if (!el) return;
    const toggle = () => {
      const next = !config[key];
      config[key] = next;
      el.classList.toggle('active', next);
      // 开关是 div，选中态既要用类名给眼睛，也要用 aria-checked 给读屏
      el.setAttribute('aria-checked', String(next));
      options.onConfigChange({ [key]: next } as Partial<FloatingButtonConfig>);
    };
    const onClick = () => toggle();
    // 非原生控件必须自己接键盘：Enter 与空格是 role="switch" 的约定激活键，
    // 空格还要 preventDefault，否则按下的是「翻页」而不是「切换」。
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      toggle();
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeydown);
    cleanups.push(() => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKeydown);
    });
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
        setPressedState(optionEls, item => item === optionEl);
        if (fillTipEl) fillTipEl.textContent = FILL_ENTRY_TIPS[locale][entry];
        // 全局档位一旦改到与站点覆盖同档，提示就失去可解释的差异，跟着收回去
        renderFillOverride(panelRoot, locale, config, siteFillOverride);
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
    applyPanelLocale(panelRoot, next, config, siteFillOverride);
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
        setPressedState(swatches, item => item === swatch);
        options.onConfigChange({ theme: name });
      };
      swatch.addEventListener('click', onSwatchClick);
      cleanups.push(() => swatch.removeEventListener('click', onSwatchClick));
    });
  }

  // 透明度滑块
  const opacitySlider = panelRoot.querySelector<HTMLElement>('[data-setting="opacity"]');
  if (opacitySlider) {
    let isDragging = false;

    /** 键盘与外部同步共用的写值入口（`config.opacity` 仍以 0–1 存放，百分比只是显示与 ARIA 的单位） */
    const setOpacityPct = (pct: number) => {
      const clamped = Math.max(OPACITY_MIN_PCT, Math.min(100, pct));
      config.opacity = clamped / 100;
      renderOpacity(opacitySlider, config.opacity);
      options.onConfigChange({ opacity: config.opacity });
    };

    const updateSlider = (clientX: number) => {
      const rect = opacitySlider.getBoundingClientRect();
      let percentage = (clientX - rect.left) / rect.width;
      percentage = Math.max(0.1, Math.min(1, percentage));

      config.opacity = percentage;
      renderOpacity(opacitySlider, percentage);
      options.onConfigChange({ opacity: percentage });
    };

    // 键盘调值：role="slider" 的约定是方向键增减、PageUp/PageDown 大步、Home/End 到端点。
    // 这些键在页面里本有默认动作（滚动），接管后必须 preventDefault。
    const onKeydown = (e: KeyboardEvent) => {
      const pct = Math.round(config.opacity * 100);
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          setOpacityPct(pct + OPACITY_STEP_PCT);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          setOpacityPct(pct - OPACITY_STEP_PCT);
          break;
        case 'PageUp':
          setOpacityPct(pct + OPACITY_STEP_PCT * 2);
          break;
        case 'PageDown':
          setOpacityPct(pct - OPACITY_STEP_PCT * 2);
          break;
        case 'Home':
          setOpacityPct(OPACITY_MIN_PCT);
          break;
        case 'End':
          setOpacityPct(100);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    opacitySlider.addEventListener('keydown', onKeydown);
    cleanups.push(() => opacitySlider.removeEventListener('keydown', onKeydown));

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
    SWITCH_SETTINGS.forEach(key => {
      const el = panelRoot.querySelector<HTMLElement>(`[data-setting="${key}"]`);
      if (!el) return;
      el.classList.toggle('active', !!config[key]);
      el.setAttribute('aria-checked', String(!!config[key]));
    });

    // 更新快速填充方式分段控件与说明文案（限定 fillEntry 分组，避免误改语言分段控件）
    const currentEntry = getFillEntry(config);
    setPressedState(
      [...panelRoot.querySelectorAll<HTMLElement>('[data-setting="fillEntry"] .fill-mode-option')],
      optionEl => optionEl.getAttribute('data-value') === currentEntry,
    );
    const fillTip = panelRoot.querySelector('[data-fill-tip]');
    if (fillTip) fillTip.textContent = FILL_ENTRY_TIPS[locale][currentEntry];
    renderFillOverride(panelRoot, locale, config, siteFillOverride);

    // 更新主题色块选中态
    setPressedState(
      [...panelRoot.querySelectorAll<HTMLElement>('.theme-swatch')],
      swatch => swatch.getAttribute('data-theme') === config.theme,
    );

    // 更新滑块
    const slider = panelRoot.querySelector<HTMLElement>('[data-setting="opacity"]');
    if (slider) renderOpacity(slider, config.opacity);
  };

  /**
   * 写入/清除当前站点的覆盖档位
   *
   * 面板的 HTML 是先渲染、站点规则是之后异步读到的（内容脚本构造期不能等待 storage），
   * 所以覆盖提示需要一个后续点亮的入口；规则被删掉或改成跟随全局时传 null 收回。
   * 非法定值按「无覆盖」处理，不让 storage 里的脏值参与判定。
   */
  const setSiteFillOverride = (entry: FillEntry | null): void => {
    siteFillOverride = isFillEntry(entry) ? entry : null;
    renderFillOverride(panelRoot, locale, config, siteFillOverride);
  };

  const destroy = () => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  };

  return { updateConfig, setLocale: setPanelLocale, setSiteFillOverride, destroy };
}
