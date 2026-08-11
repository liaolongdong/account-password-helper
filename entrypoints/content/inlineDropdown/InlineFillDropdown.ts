/**
 * 页面内联填充（字段内钥匙图标 + 迷你面板）
 *
 * 当填充模式为 'inline' 时：登录输入框获焦后，在其右侧内缘叠加一个钥匙图标；
 * 点击图标 → 主动令登录框失焦（关闭 Chrome 原生密码下拉）→ 展开一个类侧边栏的迷你面板
 * （顶部固定搜索、可滚动列表、底部固定“密码管理”）。选择某条后经 background 复用
 * FILL_PASSWORD 管线完成填充。
 *
 * 安全：内容脚本仅从 background 获取「当前域名匹配账号」的展示元数据（账号/标签/备注/网址，绝不含密码）；
 * 明文仅在用户显式选择时经 background 瞬时下发到本 frame，暴露面与侧边栏一致。
 *
 * 隔离：图标与面板同处一个 closed 模式 Shadow DOM，`all: initial` 宿主避免与页面样式互相污染；
 * 主题令牌以内联方式写入宿主，令图标/面板随整体主题换肤。
 */

import { MessageType } from '@/utils/types';
import type { InlineTotpCodeData, MatchingAccountMeta, MatchingAccountsResponse } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { applyThemeTokensToHost, DEFAULT_THEME, type ThemeName } from '@/utils/theme';
import { getTagColor, parseTags } from '@/utils/tagUtils';
import { tl } from '@/utils/i18n-lite';
import { copyTextToClipboard } from '@/entrypoints/content/domUtils';

/** 钥匙图标（与 components/InlineKeyIcon.vue 保持一致，修改请同步） */
const KEY_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="m16 7 3 3"/></svg>`;

/** 搜索图标 */
const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;

/** 锁图标（锁定态） */
const LOCK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

/** 星形图标（收藏标记） */
const STAR_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.3 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/></svg>`;

/** 填入图标（TOTP 活码胶囊内的填充动作） */
const TOTP_FILL_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="m7 8 5 5 5-5"/><path d="M5 21h14"/></svg>`;

/** 图标与面板样式（使用主题令牌 var(--aph-*)，由宿主内联提供取值） */
const inlineStyles = `
:host {
  all: initial;
}

* {
  box-sizing: border-box;
}

/* 字段内触发图标 */
.aph-trigger {
  position: fixed;
  z-index: 2147483647;
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--aph-primary);
  background: #fff;
  border: 1px solid var(--aph-primary-border);
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.aph-trigger.visible {
  display: inline-flex;
}

.aph-trigger:hover {
  transform: scale(1.08);
  box-shadow: 0 2px 8px rgb(var(--aph-primary-rgb) / 30%);
}

/* 首次引导气泡（终生仅展示一次，锚定钥匙图标上方，避开下方的 Chrome 原生密码下拉） */
.aph-hint {
  position: fixed;
  z-index: 2147483647;
  max-width: 240px;
  padding: 6px 10px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  line-height: 1.5;
  color: #fff;
  pointer-events: none;
  background: var(--aph-primary);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 35%);
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  transform: translateY(4px);
}

.aph-hint.visible {
  opacity: 1;
  transform: translateY(0);
}

/* 迷你面板 */
.aph-panel {
  position: fixed;
  z-index: 2147483647;
  display: none;
  flex-direction: column;
  width: 300px;
  max-width: 380px;
  max-height: 360px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #fff;
  border: 1px solid var(--aph-primary-border);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
}

.aph-panel.visible {
  display: flex;
}

/* 顶部搜索 */
.aph-search {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f2f5;
}

.aph-search .aph-search-icon {
  display: flex;
  flex-shrink: 0;
  color: #9aa3af;
}

.aph-search input {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #1f2937;
  background: transparent;
  border: none;
  outline: none;
}

.aph-search input::placeholder {
  color: #b6bcc6;
}

/* 列表 */
.aph-list {
  flex: 1;
  min-height: 0;
  padding: 6px 0;
  overflow-y: auto;
}

.aph-list::-webkit-scrollbar {
  width: 6px;
}

.aph-list::-webkit-scrollbar-thumb {
  background: #d7dbe0;
  border-radius: 3px;
}

.aph-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.aph-row:hover,
.aph-row.active {
  background: var(--aph-primary-bg);
}

.aph-row-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border-radius: 50%;
}

.aph-row.active .aph-row-icon {
  color: #fff;
  background: var(--aph-primary);
}

/* 网站图标：与钥匙图标同位展示，尺寸固定零偏移 */
.aph-row-favicon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  border-radius: 3px;
}

.aph-row-main {
  flex: 1;
  min-width: 0;
}

.aph-row-account {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aph-row-account .aph-star {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  color: #e6a23c;
}

.aph-row-account-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aph-row-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  overflow: hidden;
}

.aph-tag {
  flex-shrink: 0;
  max-width: 140px;
  padding: 0 6px;
  overflow: hidden;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid transparent;
  border-radius: 4px;
}

/* 搜索命中高亮：重置 mark 默认黄底，主题色加重；标签内沿用标签自身配色仅加粗，与侧边栏高亮策略一致 */
.aph-hit {
  padding: 0;
  font-weight: 700;
  color: var(--aph-primary);
  background: transparent;
}

.aph-tag .aph-hit {
  color: inherit;
}

/* 补充信息槽位（备注优先、URL 兜底，二者互斥展示）的弱化样式 */
.aph-url,
.aph-remark {
  overflow: hidden;
  font-size: 11px;
  color: #9aa3af;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 2FA 徽标（button 触发器）：点击后经 background 拉取一次性动态码，原位展开活码胶囊 */
.aph-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  font-family: inherit;
  font-size: 10px;
  line-height: 16px;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.aph-badge:hover {
  color: #fff;
  background: var(--aph-primary);
}

/* TOTP 活码胶囊：点击胶囊复制动态码，右侧按钮触发页面填充 */
.aph-totp {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  line-height: 16px;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border-radius: 4px;
  cursor: pointer;
}

.aph-totp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
}

.aph-totp-countdown {
  min-width: 16px;
  font-size: 10px;
  color: #9aa3af;
  text-align: right;
}

.aph-totp-fill {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  padding: 0;
  color: var(--aph-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s ease;
}

.aph-totp-fill:hover {
  opacity: 1;
}

.aph-empty {
  padding: 26px 16px;
  font-size: 13px;
  color: #9aa3af;
  text-align: center;
}

/* 底部管理 */
.aph-footer {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid #f0f2f5;
}

.aph-manage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border: 1px solid var(--aph-primary-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.aph-manage:hover {
  color: #fff;
  background: var(--aph-primary);
  border-color: var(--aph-primary);
}

/* 锁定态 */
.aph-locked {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  cursor: pointer;
}

.aph-locked:hover {
  background: var(--aph-primary-bg);
}

.aph-locked-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border-radius: 50%;
}

.aph-locked-title {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
}

.aph-locked-desc {
  margin-top: 1px;
  font-size: 12px;
  color: #6b7280;
}
`;

/** 首次引导气泡自动消失延迟（毫秒） */
const HINT_AUTO_HIDE_MS = 5000;

/** 首次引导气泡淡出过渡时长（毫秒，与 .aph-hint 的 CSS transition 保持一致） */
const HINT_FADE_MS = 200;

/** showTriggerFor 选项 */
interface TriggerOptions {
  /** 该字段是否已存在密码显隐眼睛图标（用于图标避让） */
  hasEyeToggle?: boolean;
}

/**
 * 内联填充管理器（每个内容脚本 frame 一个实例）
 */
export class InlineFillDropdown {
  private shadowHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private triggerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;

  /** 当前锚定的输入框 */
  private currentInput: HTMLInputElement | null = null;
  /** 触发图标右内缘偏移（避让眼睛图标时增大） */
  private iconRightOffset = 6;

  /** 全量匹配账号（打开面板时拉取） */
  private accounts: MatchingAccountMeta[] = [];
  /** 搜索过滤后的账号 */
  private filtered: MatchingAccountMeta[] = [];
  /** 搜索关键字 */
  private searchKeyword = '';
  /** 键盘高亮索引（-1 未高亮） */
  private activeIndex = -1;
  /** 会话是否锁定 */
  private locked = false;

  /** 图标是否可见 */
  private iconVisible = false;
  /** 面板是否打开 */
  private panelOpen = false;
  /** 请求序号，用于丢弃过期响应 */
  private requestSeq = 0;
  /** 重定位 rAF 句柄 */
  private repositionRaf: number | null = null;
  /** 图标失焦隐藏计时器 */
  private hideIconTimer: ReturnType<typeof setTimeout> | null = null;
  /** 首次引导气泡元素（终生仅展示一次） */
  private hintEl: HTMLElement | null = null;
  /** 引导气泡自动隐藏计时器 */
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  /** 引导是否已处理完毕（内存缓存，避免每次获焦重复读 storage） */
  private hintSettled = false;
  /** 当前主题（由 FormDetector 依据配置推送，避免每次获焦读取 storage） */
  private currentTheme: ThemeName = DEFAULT_THEME;

  /** TOTP 活码状态（key: 账号 ID；仅面板打开期间保留，关闭即清空） */
  private totpStates = new Map<string, InlineTotpCodeData>();
  /** TOTP 拉取/刷新中的账号 ID 集合（防抖并发点击与到期重复刷新） */
  private totpPending = new Set<string>();
  /** TOTP 倒计时刷新定时器（有活码展示时运行，每秒一次） */
  private totpTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 为登录字段展示触发图标（获焦触发，不拉取数据）
   * @param input 目标输入框
   * @param options 触发选项（图标避让等）
   */
  showTriggerFor(input: HTMLInputElement, options: TriggerOptions = {}): void {
    // 面板已针对同一输入框打开时，无需重复处理
    if (this.panelOpen && this.currentInput === input) return;

    // 清除上一字段遗留的隐藏计时器，避免其在新字段展示图标后误触发隐藏
    if (this.hideIconTimer) {
      clearTimeout(this.hideIconTimer);
      this.hideIconTimer = null;
    }
    // 切换到新字段前解绑旧输入框的 blur 监听，避免监听器泄漏
    if (this.currentInput && this.currentInput !== input) {
      this.currentInput.removeEventListener('blur', this.handleFieldBlur);
    }

    this.currentInput = input;
    this.iconRightOffset = options.hasEyeToggle ? 28 : 6;
    this.ensureShadow();

    this.iconVisible = true;
    this.positionTrigger();
    this.triggerEl?.classList.add('visible');
    this.attachTriggerInteractions();
    // 首次使用引导：内联为默认填充方式后，用一次性气泡补偿钥匙图标的可发现性
    void this.maybeShowFirstUseHint();
  }

  /**
   * 直接为指定输入框展开面板（快捷键 / Popup 触发，行为与点击钥匙图标一致）
   *
   * 跳过图标展示阶段，复用 openPanel 的完整链路（失焦登录框 → 拉取匹配账号 → 渲染定位）。
   * @param input 目标输入框（面板锚定其下方）
   */
  openPanelFor(input: HTMLInputElement): void {
    // 面板已针对同一输入框打开时，无需重复处理
    if (this.panelOpen && this.currentInput === input) return;

    // 清除上一字段遗留的隐藏计时器，避免其在面板打开后误触发图标态清理
    if (this.hideIconTimer) {
      clearTimeout(this.hideIconTimer);
      this.hideIconTimer = null;
    }
    // 切换到新字段前解绑旧输入框的 blur 监听，避免监听器泄漏
    if (this.currentInput && this.currentInput !== input) {
      this.currentInput.removeEventListener('blur', this.handleFieldBlur);
    }

    this.currentInput = input;
    this.ensureShadow();
    void this.openPanel();
  }

  /**
   * 隐藏触发图标
   */
  private hideIcon(): void {
    this.iconVisible = false;
    this.triggerEl?.classList.remove('visible');
    this.detachTriggerInteractions();
    this.hideHint();
  }

  /**
   * 关闭面板并隐藏图标（回到无 UI 状态）
   */
  hide(): void {
    this.closePanel();
    this.hideIcon();
  }

  /**
   * 销毁实例，移除 DOM 与监听
   */
  destroy(): void {
    this.detachTriggerInteractions();
    this.detachPanelInteractions();
    if (this.hideIconTimer) {
      clearTimeout(this.hideIconTimer);
      this.hideIconTimer = null;
    }
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.clearTotpStates();
    this.hintEl = null;
    this.shadowHost?.remove();
    this.shadowHost = null;
    this.shadowRoot = null;
    this.triggerEl = null;
    this.panelEl = null;
    this.currentInput = null;
    this.accounts = [];
    this.filtered = [];
    this.iconVisible = false;
    this.panelOpen = false;
  }

  /**
   * 惰性创建 Shadow DOM（图标 + 面板同处一个宿主）
   */
  private ensureShadow(): void {
    if (this.shadowRoot) return;

    this.shadowHost = document.createElement('aph-inline-fill-root');
    this.shadowHost.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = inlineStyles;
    this.shadowRoot.appendChild(styleEl);

    this.triggerEl = document.createElement('button');
    this.triggerEl.className = 'aph-trigger';
    this.triggerEl.setAttribute('title', tl('cs.inline.trigger'));
    this.triggerEl.innerHTML = KEY_ICON;
    // mousedown 阻止默认，避免点击图标令登录框失焦（保持后续 blur 时序可控）
    this.triggerEl.addEventListener('mousedown', e => e.preventDefault());
    this.triggerEl.addEventListener('click', this.handleTriggerClick);
    this.shadowRoot.appendChild(this.triggerEl);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'aph-panel';
    this.shadowRoot.appendChild(this.panelEl);

    document.body.appendChild(this.shadowHost);

    // 应用当前缓存的主题令牌到宿主（取值由 FormDetector 依据配置推送）
    applyThemeTokensToHost(this.shadowHost, this.currentTheme);
  }

  /**
   * 更新主题：缓存主题名并对已创建的宿主实时换肤
   *
   * 由 FormDetector 在配置加载/变更时推送，避免本实例在每次获焦时读取 storage。
   * @param theme 主题名
   */
  setTheme(theme: ThemeName): void {
    this.currentTheme = theme;
    if (this.shadowHost) applyThemeTokensToHost(this.shadowHost, theme);
  }

  // ==================== 触发图标 ====================

  /**
   * 图标点击：打开面板
   */
  private handleTriggerClick = (e: Event): void => {
    e.stopPropagation();
    void this.openPanel();
  };

  /**
   * 定位触发图标到输入框右内缘（垂直居中）
   */
  private positionTrigger(): void {
    if (!this.triggerEl || !this.currentInput) return;
    const rect = this.currentInput.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0 || rect.height < 18) {
      this.hideIcon();
      return;
    }
    const size = 22;
    const left = rect.right - size - this.iconRightOffset;
    const top = rect.top + (rect.height - size) / 2;
    this.triggerEl.style.left = `${Math.round(left)}px`;
    this.triggerEl.style.top = `${Math.round(top)}px`;
    this.positionHint();
  }

  // ==================== 首次引导气泡 ====================

  /**
   * 首次展示钥匙图标时展示一次性引导气泡（终生仅一次，展示即写入标记）
   *
   * 默认填充方式切换为内联后，钥匙图标相比自动弹出的侧边栏更隐蔽，
   * 用气泡提示补偿可发现性；5 秒后自动淡出，图标点击/面板展开/失焦时立即移除。
   */
  private async maybeShowFirstUseHint(): Promise<void> {
    if (this.hintSettled || this.hintEl) return;
    // 先行占位，避免快速多次获焦并发重复展示
    this.hintSettled = true;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.INLINE_FILL_HINT_SHOWN);
      if (result[STORAGE_KEYS.INLINE_FILL_HINT_SHOWN]) return;
      // 异步窗口内图标可能已隐藏/面板已打开，不再展示（标记未写入，下次获焦仍有机会）
      if (!this.iconVisible || this.panelOpen || !this.shadowRoot) {
        this.hintSettled = false;
        return;
      }
      // 先写标记再渲染：把多 frame / 多标签页并发窗口从“渲染+写入”压缩至单次 get/set 间隙
      await chrome.storage.local.set({ [STORAGE_KEYS.INLINE_FILL_HINT_SHOWN]: true });
      // 写标记期间的 await 窗口内状态可能再变，渲染前复查一次
      if (this.iconVisible && !this.panelOpen && this.shadowRoot) {
        this.renderHint();
      }
    } catch (error) {
      logger.debug('内联首次引导气泡处理失败（扩展上下文可能失效）:', error);
    }
  }

  /**
   * 渲染引导气泡并启动自动消失计时
   */
  private renderHint(): void {
    if (!this.shadowRoot) return;
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'aph-hint';
    this.hintEl.textContent = tl('cs.inline.firstUseHint');
    this.shadowRoot.appendChild(this.hintEl);
    this.positionHint();
    // 下一帧再添加 visible，确保淡入过渡生效
    requestAnimationFrame(() => this.hintEl?.classList.add('visible'));
    this.hintTimer = setTimeout(() => this.hideHint(), HINT_AUTO_HIDE_MS);
  }

  /**
   * 将引导气泡定位到钥匙图标上方（右对齐，随滚动/缩放重定位）
   *
   * 放上方而非下方：Chrome 原生密码下拉固定出现在输入框正下方，
   * 且作为浏览器级 UI 层级永远高于页面内容，下方放置会被其遮挡；
   * 仅当输入框贴近视口顶部、上方放不下时降级回下方。
   */
  private positionHint(): void {
    if (!this.hintEl || !this.triggerEl) return;
    const triggerLeft = parseFloat(this.triggerEl.style.left) || 0;
    const triggerTop = parseFloat(this.triggerEl.style.top) || 0;
    const left = Math.max(8, triggerLeft + 22 - this.hintEl.offsetWidth);
    const above = triggerTop - this.hintEl.offsetHeight - 10;
    const top = above >= 8 ? above : triggerTop + 28;
    this.hintEl.style.left = `${Math.round(left)}px`;
    this.hintEl.style.top = `${Math.round(top)}px`;
  }

  /**
   * 淡出并移除引导气泡
   */
  private hideHint(): void {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    const el = this.hintEl;
    if (!el) return;
    this.hintEl = null;
    el.classList.remove('visible');
    // 过渡结束后移除节点
    setTimeout(() => el.remove(), HINT_FADE_MS);
  }

  /**
   * 绑定图标阶段监听（失焦隐藏、滚动/缩放重定位）
   */
  private attachTriggerInteractions(): void {
    this.currentInput?.addEventListener('blur', this.handleFieldBlur);
    window.addEventListener('scroll', this.handleReposition, true);
    window.addEventListener('resize', this.handleReposition);
  }

  /**
   * 解绑图标阶段监听
   */
  private detachTriggerInteractions(): void {
    this.currentInput?.removeEventListener('blur', this.handleFieldBlur);
    if (!this.panelOpen) {
      window.removeEventListener('scroll', this.handleReposition, true);
      window.removeEventListener('resize', this.handleReposition);
    }
  }

  /**
   * 登录框失焦：延迟隐藏图标（面板打开中则不隐藏）
   */
  private handleFieldBlur = (): void => {
    if (this.hideIconTimer) clearTimeout(this.hideIconTimer);
    this.hideIconTimer = setTimeout(() => {
      this.hideIconTimer = null;
      if (!this.panelOpen) this.hideIcon();
    }, 150);
  };

  // ==================== 面板 ====================

  /**
   * 打开面板：失焦登录框（关闭 Chrome 原生下拉）→ 拉取匹配账号 → 渲染
   */
  private async openPanel(): Promise<void> {
    if (!this.currentInput) return;
    const input = this.currentInput;

    this.panelOpen = true;
    this.hideIcon();
    // 立即失焦登录框，令 Chrome 原生密码下拉关闭，避免与本面板重叠
    try {
      input.blur();
    } catch {
      // 忽略 blur 异常
    }

    const seq = ++this.requestSeq;
    let response: { success?: boolean; data?: MatchingAccountsResponse } | undefined;
    try {
      response = await chrome.runtime.sendMessage({ type: MessageType.GET_MATCHING_ACCOUNTS });
    } catch (error) {
      logger.debug('内联面板：获取匹配账号失败（扩展上下文可能失效）:', error);
      this.panelOpen = false;
      return;
    }
    if (seq !== this.requestSeq || !this.panelOpen) return;
    if (!response || !response.success || !response.data) {
      this.panelOpen = false;
      return;
    }

    this.locked = response.data.locked;
    this.accounts = response.data.accounts || [];
    this.searchKeyword = '';
    this.activeIndex = -1;

    this.buildPanel();
    this.positionPanel();
    this.panelEl?.classList.add('visible');
    this.attachPanelInteractions();
    if (!this.locked) this.focusSearch();
  }

  /**
   * 关闭面板
   */
  private closePanel(): void {
    if (!this.panelOpen && !this.panelEl?.classList.contains('visible')) return;
    this.panelOpen = false;
    this.panelEl?.classList.remove('visible');
    this.detachPanelInteractions();
    this.activeIndex = -1;
    this.clearTotpStates();
  }

  /**
   * 构建面板骨架（锁定态 / 搜索 + 列表 + 底部管理），每次打开重建一次
   */
  private buildPanel(): void {
    if (!this.panelEl) return;

    // 面板事件隔离（统一挂载于面板容器，覆盖列表项/底部按钮/锁定态行/搜索区）：
    // Shadow DOM 只隔离样式，不隔离事件冒泡与焦点变化——面板宿主挂在 body 下，
    // 点击泄漏到页面 document 会被弹窗「点击外部关闭」监听判定为外部交互，
    // 焦点从面板跌落 body 亦会触发「焦点逃出容器即关闭」类弹窗逻辑。
    // 监听器引用稳定，重复调用 buildPanel 不会产生重复绑定。
    this.panelEl.addEventListener('mousedown', this.handlePanelMouseDown);
    this.panelEl.addEventListener('click', this.handlePanelClick);

    if (this.locked) {
      this.panelEl.innerHTML = `
        <div class="aph-locked" data-action="unlock">
          <div class="aph-locked-icon">${LOCK_ICON}</div>
          <div>
            <div class="aph-locked-title">${tl('cs.inline.lockedTitle')}</div>
            <div class="aph-locked-desc">${tl('cs.inline.lockedDesc')}</div>
          </div>
        </div>
      `;
      const unlock = this.panelEl.querySelector('[data-action="unlock"]');
      unlock?.addEventListener('click', () => this.openUnlock());
      return;
    }

    this.panelEl.innerHTML = `
      <div class="aph-search">
        <span class="aph-search-icon">${SEARCH_ICON}</span>
        <input type="text" placeholder="${tl('cs.inline.searchPlaceholder')}" spellcheck="false" autocomplete="off" />
      </div>
      <div class="aph-list"></div>
      <div class="aph-footer">
        <button class="aph-manage" type="button">${KEY_ICON}<span>${tl('cs.inline.manage')}</span></button>
      </div>
    `;

    const searchInput = this.panelEl.querySelector('.aph-search input') as HTMLInputElement | null;
    searchInput?.addEventListener('input', this.handleSearchInput);

    const manageBtn = this.panelEl.querySelector('.aph-manage');
    manageBtn?.addEventListener('click', () => this.openOptions());

    const listEl = this.panelEl.querySelector('.aph-list');
    listEl?.addEventListener('click', this.handleListClick);

    this.applyFilter();
  }

  /**
   * 应用搜索过滤并渲染列表（不重建搜索框，保持输入焦点）
   */
  private applyFilter(): void {
    const kw = this.searchKeyword.trim().toLowerCase();
    this.filtered = !kw
      ? this.accounts
      : this.accounts.filter(
          a =>
            a.username.toLowerCase().includes(kw) ||
            a.tag.toLowerCase().includes(kw) ||
            a.remark.toLowerCase().includes(kw) ||
            a.url.toLowerCase().includes(kw),
        );
    this.activeIndex = -1;
    this.renderList();
  }

  /**
   * 渲染列表区
   */
  private renderList(): void {
    const listEl = this.panelEl?.querySelector('.aph-list');
    if (!listEl) return;

    if (this.filtered.length === 0) {
      listEl.innerHTML = `<div class="aph-empty">${this.accounts.length === 0 ? tl('cs.inline.emptyNoAccounts') : tl('cs.inline.emptyNoMatch')}</div>`;
      return;
    }

    // 高亮关键字与 applyFilter 的过滤口径一致（trim 后不区分大小写）
    const highlightKw = this.searchKeyword.trim();

    listEl.innerHTML = this.filtered
      .map((acc, index) => {
        const star = acc.favorite ? `<span class="aph-star">${STAR_ICON}</span>` : '';
        const badge = acc.hasTotp ? this.renderTotpCell(acc.id, index) : '';
        const account = highlightHtml(acc.username || tl('cs.inline.noUsername'), highlightKw);
        // 标签与侧边栏保持一致：按分隔符拆分为多枚，并按标签内容生成稳定的哈希配色
        const tagsHtml = parseTags(acc.tag)
          .map(t => {
            const c = getTagColor(t);
            return `<span class="aph-tag" style="color:${c.text};background:${c.background};border-color:${c.border}" title="${escapeHtml(t)}">${highlightHtml(t, highlightKw)}</span>`;
          })
          .join('');
        // 补充信息槽位：备注优先、URL 兜底，二者互斥——列表已按域名过滤，
        // URL 区分度趋近于零；备注是事实上的账号标签且参与搜索过滤，
        // 必须行内可见；截断后的全文由行级 title 兜底展示
        const supplementText = acc.remark || acc.url || '';
        const supplementClass = acc.remark ? 'aph-remark' : 'aph-url';
        const supplement = supplementText
          ? `<span class="${supplementClass}">${highlightHtml(supplementText, highlightKw)}</span>`
          : '';
        const sub = tagsHtml || supplement ? `<div class="aph-row-sub">${tagsHtml}${supplement}</div>` : '';
        const titleAttr = acc.remark
          ? ` title="${tl('cs.inline.remarkTitle', { remark: escapeHtml(acc.remark) })}"`
          : '';
        // 网站图标（background 下发的 dataURL，严格校验前缀 + 转义，防属性注入），
        // 无图标时降级为原钥匙图标
        const rowIcon = acc.favicon?.startsWith('data:image/')
          ? `<img class="aph-row-favicon" src="${escapeHtml(acc.favicon)}" alt="" draggable="false" />`
          : KEY_ICON;
        return `
          <div class="aph-row" data-index="${index}"${titleAttr}>
            <div class="aph-row-icon">${rowIcon}</div>
            <div class="aph-row-main">
              <div class="aph-row-account">${star}<span class="aph-row-account-text">${account}</span></div>
              ${sub}
            </div>
            ${badge}
          </div>
        `;
      })
      .join('');
  }

  /**
   * 面板 mousedown 拦截：阻止默认行为，避免焦点从面板（搜索框）跌落至 body
   */
  private handlePanelMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
  };

  /**
   * 面板 click 拦截：阻止冒泡穿透 Shadow DOM 到达页面 document
   */
  private handlePanelClick = (e: MouseEvent): void => {
    e.stopPropagation();
  };

  /**
   * 搜索输入处理
   */
  private handleSearchInput = (e: Event): void => {
    this.searchKeyword = (e.target as HTMLInputElement).value;
    this.applyFilter();
  };

  /**
   * 列表点击（委托）：TOTP 填充/展开复制优先判定，其次选择账号填充
   */
  private handleListClick = (e: Event): void => {
    const target = e.target as HTMLElement;

    const fillBtn = target.closest('[data-action="totp-fill"]') as HTMLElement | null;
    if (fillBtn) {
      const index = Number(fillBtn.getAttribute('data-index'));
      if (!Number.isNaN(index)) void this.handleTotpFill(index, fillBtn);
      return;
    }

    const totpEl = target.closest('[data-action="totp"]') as HTMLElement | null;
    if (totpEl) {
      const index = Number(totpEl.getAttribute('data-index'));
      if (!Number.isNaN(index)) void this.handleTotpToggle(index, totpEl);
      return;
    }

    const row = target.closest('.aph-row') as HTMLElement | null;
    if (!row) return;
    const index = Number(row.getAttribute('data-index'));
    if (!Number.isNaN(index)) this.select(index);
  };

  /**
   * 聚焦搜索框
   */
  private focusSearch(): void {
    const searchInput = this.panelEl?.querySelector('.aph-search input') as HTMLInputElement | null;
    searchInput?.focus();
  }

  /**
   * 选择某个账号，经 background 复用 FILL_PASSWORD 完成填充
   * @param index 过滤后列表中的索引
   */
  private async select(index: number): Promise<void> {
    const account = this.filtered[index];
    if (!account) return;
    this.hide();
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.FILL_BY_ID, data: { id: account.id } });
      if (!res || res.success === false) {
        logger.warn('内联面板：填充未成功:', res?.message);
      }
    } catch (error) {
      logger.error('内联面板：填充请求失败:', error);
    }
  }

  /**
   * 打开选项页以验证主密码解锁会话
   */
  private openUnlock(): void {
    this.hide();
    chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_PAGE }).catch(() => {
      // 无接收者时忽略
    });
  }

  /**
   * 打开密码管理（选项页）
   */
  private openOptions(): void {
    this.hide();
    chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_PAGE }).catch(() => {
      // 无接收者时忽略
    });
  }

  // ==================== TOTP 活码（2FA） ====================

  /**
   * 渲染条目行末的 TOTP 单元格：已拉取且未过期时展示活码胶囊，否则展示 2FA 徽标触发器
   * @param id 账号条目 ID
   * @param index 过滤后列表中的索引
   * @returns 单元格 HTML 字符串
   */
  private renderTotpCell(id: string, index: number): string {
    const state = this.totpStates.get(id);
    if (state && state.expiresAt > Date.now()) {
      return this.buildTotpCapsule(id, index, state).outerHTML;
    }
    if (state) this.totpStates.delete(id);
    return this.buildTotpBadge(id, index).outerHTML;
  }

  /**
   * 构建 2FA 徽标触发器元素（点击后经 background 拉取动态码）
   * @param id 账号条目 ID
   * @param index 过滤后列表中的索引
   * @returns 徽标元素
   */
  private buildTotpBadge(id: string, index: number): HTMLElement {
    const el = document.createElement('button');
    el.className = 'aph-badge';
    el.type = 'button';
    el.setAttribute('data-action', 'totp');
    el.setAttribute('data-index', String(index));
    el.setAttribute('data-totp-id', id);
    el.setAttribute('title', tl('cs.inline.totpShow'));
    el.textContent = '2FA';
    return el;
  }

  /**
   * 构建 TOTP 活码胶囊元素（点击胶囊复制动态码，内置「填入」按钮触发页面填充）
   * @param id 账号条目 ID
   * @param index 过滤后列表中的索引
   * @param state 活码状态（动态码 + 到期时间）
   * @returns 胶囊元素
   */
  private buildTotpCapsule(id: string, index: number, state: InlineTotpCodeData): HTMLElement {
    const remaining = Math.max(1, Math.ceil((state.expiresAt - Date.now()) / 1000));
    const el = document.createElement('span');
    el.className = 'aph-totp';
    el.setAttribute('data-action', 'totp');
    el.setAttribute('data-index', String(index));
    el.setAttribute('data-totp-id', id);
    el.setAttribute('title', tl('cs.inline.totpCopyTitle'));
    el.innerHTML = `
      <span class="aph-totp-code">${escapeHtml(state.code)}</span>
      <span class="aph-totp-countdown">${remaining}s</span>
      <button class="aph-totp-fill" type="button" data-action="totp-fill" data-index="${index}" title="${tl('cs.inline.totpFill')}">${TOTP_FILL_ICON}</button>
    `;
    return el;
  }

  /**
   * TOTP 徽标/胶囊点击：未展开时经 background 拉取活码；已展开时复制当前动态码
   *
   * 安全：TOTP 密钥始终驻留 background，内容脚本仅接收 30 秒自失效的一次性动态码。
   * @param index 过滤后列表中的索引
   * @param triggerEl 被点击的徽标或胶囊元素
   */
  private async handleTotpToggle(index: number, triggerEl: HTMLElement): Promise<void> {
    const account = this.filtered[index];
    if (!account) return;
    const id = account.id;

    const state = this.totpStates.get(id);
    if (state && state.expiresAt > Date.now()) {
      await this.copyTotp(state.code, triggerEl);
      return;
    }
    if (this.totpPending.has(id)) return;
    this.totpPending.add(id);

    // 加载态：徽标原位文案提示（过期胶囊场景无文案槽位，静默等待即可）
    const badge = triggerEl.classList.contains('aph-badge') ? triggerEl : null;
    if (badge) badge.textContent = tl('cs.inline.totpLoading');

    const data = await this.fetchTotpCode(id);
    this.totpPending.delete(id);
    if (!this.panelOpen || !triggerEl.isConnected) return;

    if (!data) {
      logger.warn('内联面板：两步验证码获取失败（会话可能已锁定）');
      if (badge) {
        badge.textContent = tl('cs.inline.totpFailed');
        window.setTimeout(() => {
          if (badge.isConnected) badge.textContent = '2FA';
        }, 1400);
      }
      return;
    }

    this.totpStates.set(id, data);
    triggerEl.replaceWith(this.buildTotpCapsule(id, index, data));
    this.syncTotpTimer();
  }

  /**
   * TOTP「填入」按钮点击：委托 background 现算动态码并经 FILL_TOTP 回填发起 frame
   *
   * 不先隐藏面板：填充失败（如无验证码输入框）时保留面板并给出反馈，
   * 成功由 FormDetector 的填充链路完成后主动 hide。
   * @param index 过滤后列表中的索引
   * @param fillEl 填入按钮元素
   */
  private async handleTotpFill(index: number, fillEl: HTMLElement): Promise<void> {
    const account = this.filtered[index];
    if (!account) return;

    // 失败时优先展示 FormDetector 透传的本地化原因（如「未找到验证码输入框」）
    let message = '';
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.FILL_TOTP_BY_ID, data: { id: account.id } });
      if (res && res.success) {
        this.hide();
        return;
      }
      message = res?.message || '';
      logger.warn('内联面板：验证码填充未成功:', message);
    } catch (error) {
      logger.error('内联面板：验证码填充请求失败:', error);
    }
    if (fillEl.isConnected)
      this.flashCapsuleMessage(fillEl.closest('.aph-totp'), message || tl('cs.inline.totpFailed'));
  }

  /**
   * 复制 TOTP 动态码并在胶囊上给出短暂反馈（动态码 30 秒自失效，无需剪贴板定时清除）
   * @param code 当前动态码
   * @param capsuleEl 活码胶囊元素
   */
  private async copyTotp(code: string, capsuleEl: HTMLElement): Promise<void> {
    const ok = await copyTextToClipboard(code);
    if (!this.panelOpen || !capsuleEl.isConnected) return;
    this.flashCapsuleMessage(capsuleEl, ok ? tl('cs.inline.totpCopied') : tl('cs.inline.totpFailed'));
  }

  /**
   * 在胶囊动态码槽位短暂展示反馈文案，随后还原动态码
   * @param capsuleEl 活码胶囊元素（可能为 null）
   * @param message 反馈文案
   */
  private flashCapsuleMessage(capsuleEl: Element | null | undefined, message: string): void {
    const codeEl = capsuleEl?.querySelector('.aph-totp-code');
    if (!codeEl) return;
    const id = capsuleEl?.getAttribute('data-totp-id') ?? '';
    const prev = codeEl.textContent;
    codeEl.textContent = message;
    window.setTimeout(() => {
      // 取实时活码还原，避免闪光窗口跨越周期边界时写回旧码
      if (codeEl.isConnected) codeEl.textContent = this.totpStates.get(id)?.code ?? prev;
    }, 1400);
  }

  /**
   * 经 background 获取当前 TOTP 动态码（仅返回一次性动态码，绝不含密钥）
   * @param id 账号条目 ID
   * @returns 活码数据，失败/未配置时返回 null
   */
  private async fetchTotpCode(id: string): Promise<InlineTotpCodeData | null> {
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.GET_INLINE_TOTP, data: { id } });
      if (res && res.success && res.data) return res.data as InlineTotpCodeData;
      return null;
    } catch (error) {
      logger.debug('内联面板：请求两步验证码失败（扩展上下文可能失效）:', error);
      return null;
    }
  }

  /**
   * 按需启停 TOTP 倒计时定时器（面板打开且有展示中的活码才运行）
   */
  private syncTotpTimer(): void {
    if (this.totpStates.size > 0 && this.panelOpen) {
      if (!this.totpTimer) this.totpTimer = setInterval(this.tickTotp, 1000);
    } else if (this.totpTimer) {
      clearInterval(this.totpTimer);
      this.totpTimer = null;
    }
  }

  /**
   * TOTP 每秒心跳：刷新各胶囊倒计时；到期后向 background 请求下一周期动态码，
   * 不在列表中的过期状态直接清除
   */
  private tickTotp = (): void => {
    if (!this.panelOpen || this.totpStates.size === 0) {
      this.syncTotpTimer();
      return;
    }
    const now = Date.now();
    for (const [id, state] of this.totpStates) {
      const remaining = Math.ceil((state.expiresAt - now) / 1000);
      const cell = this.panelEl?.querySelector(`.aph-totp[data-totp-id="${id}"]`);
      if (remaining <= 0) {
        if (cell) void this.refreshTotpCode(id);
        else this.totpStates.delete(id);
        continue;
      }
      const countdown = cell?.querySelector('.aph-totp-countdown');
      if (countdown) countdown.textContent = `${remaining}s`;
    }
  };

  /**
   * 刷新某条目下一周期的 TOTP 动态码：成功原位替换胶囊；
   * 失败（会话锁定/配置失效）降级回 2FA 徽标
   * @param id 账号条目 ID
   */
  private async refreshTotpCode(id: string): Promise<void> {
    if (this.totpPending.has(id)) return;
    this.totpPending.add(id);
    const data = await this.fetchTotpCode(id);
    this.totpPending.delete(id);
    if (!this.panelOpen) return;

    const cell = this.panelEl?.querySelector(`.aph-totp[data-totp-id="${id}"]`);
    const index = cell ? Number(cell.getAttribute('data-index')) : -1;
    if (!data) {
      this.totpStates.delete(id);
      if (cell && index >= 0) cell.replaceWith(this.buildTotpBadge(id, index));
      this.syncTotpTimer();
      return;
    }
    this.totpStates.set(id, data);
    if (cell && index >= 0) cell.replaceWith(this.buildTotpCapsule(id, index, data));
  }

  /**
   * 清空 TOTP 活码状态并停止倒计时（面板关闭/销毁时调用）
   */
  private clearTotpStates(): void {
    this.totpStates.clear();
    this.totpPending.clear();
    if (this.totpTimer) {
      clearInterval(this.totpTimer);
      this.totpTimer = null;
    }
  }

  /**
   * 计算并应用面板位置（锚定输入框下方，空间不足时上翻）
   */
  private positionPanel(): void {
    if (!this.panelEl || !this.currentInput) return;
    const rect = this.currentInput.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) {
      this.closePanel();
      return;
    }

    const width = Math.min(380, Math.max(300, rect.width));
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - width);
    }

    const gap = 4;
    const panelHeight = this.panelEl.offsetHeight || 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < panelHeight + gap && rect.top > spaceBelow;
    const top = placeAbove ? Math.max(8, rect.top - panelHeight - gap) : rect.bottom + gap;

    this.panelEl.style.left = `${Math.round(left)}px`;
    this.panelEl.style.top = `${Math.round(top)}px`;
    this.panelEl.style.width = `${Math.round(width)}px`;
  }

  /**
   * 更新键盘高亮态并滚动到可见
   */
  private updateActive(): void {
    const rows = Array.from(this.panelEl?.querySelectorAll<HTMLElement>('.aph-row') ?? []);
    rows.forEach((row, index) => {
      const isActive = index === this.activeIndex;
      row.classList.toggle('active', isActive);
      if (isActive) row.scrollIntoView({ block: 'nearest' });
    });
  }

  /**
   * 绑定面板阶段监听（外部点击、键盘、滚动/缩放）
   */
  private attachPanelInteractions(): void {
    document.addEventListener('mousedown', this.handleOutsideMouseDown, true);
    document.addEventListener('keydown', this.handlePanelKeydown, true);
    window.addEventListener('scroll', this.handleReposition, true);
    window.addEventListener('resize', this.handleReposition);
  }

  /**
   * 解绑面板阶段监听
   */
  private detachPanelInteractions(): void {
    document.removeEventListener('mousedown', this.handleOutsideMouseDown, true);
    document.removeEventListener('keydown', this.handlePanelKeydown, true);
    window.removeEventListener('scroll', this.handleReposition, true);
    window.removeEventListener('resize', this.handleReposition);
    if (this.repositionRaf !== null) {
      cancelAnimationFrame(this.repositionRaf);
      this.repositionRaf = null;
    }
  }

  /**
   * 面板键盘导航：↑/↓ 遍历、Enter 填充高亮项、Esc 关闭
   */
  private handlePanelKeydown = (e: KeyboardEvent): void => {
    if (!this.panelOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return;
    }
    if (this.locked) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.filtered.length - 1);
        this.updateActive();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.updateActive();
        break;
      case 'Enter':
        if (this.activeIndex >= 0) {
          e.preventDefault();
          this.select(this.activeIndex);
        }
        break;
    }
  };

  /**
   * 滚动/缩放重定位（rAF 节流），面板打开时定位面板，否则定位图标
   */
  private handleReposition = (): void => {
    if (this.repositionRaf !== null) return;
    this.repositionRaf = requestAnimationFrame(() => {
      this.repositionRaf = null;
      if (this.panelOpen) this.positionPanel();
      else if (this.iconVisible) this.positionTrigger();
    });
  };

  /**
   * 外部按下：点击面板与宿主之外时关闭
   */
  private handleOutsideMouseDown = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (!target) return;
    if (this.shadowHost && (target === this.shadowHost || this.shadowHost.contains(target))) return;
    this.hide();
  };
}

/**
 * HTML 转义，防止账号元数据破坏结构或注入属性
 * @param value 原始文本
 * @returns 转义后的文本
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 搜索命中高亮（XSS 安全）：先在原文上按关键字不区分大小写切分，
 * 逐段转义后再包裹命中片段，避免先转义再匹配导致实体串被误命中
 * @param text 原始文本
 * @param keyword 搜索关键字（空串时仅转义）
 * @returns 可安全注入 innerHTML 的片段
 */
function highlightHtml(text: string, keyword: string): string {
  if (!keyword) return escapeHtml(text);
  const lowerText = text.toLowerCase();
  const lowerKw = keyword.toLowerCase();
  let html = '';
  let cursor = 0;
  let idx = lowerText.indexOf(lowerKw);
  while (idx !== -1) {
    html += escapeHtml(text.slice(cursor, idx));
    html += `<mark class="aph-hit">${escapeHtml(text.slice(idx, idx + keyword.length))}</mark>`;
    cursor = idx + keyword.length;
    idx = lowerText.indexOf(lowerKw, cursor);
  }
  return html + escapeHtml(text.slice(cursor));
}

// ==================== 单例（每个 frame 一个） ====================

let inlineFillDropdownInstance: InlineFillDropdown | null = null;

/**
 * 获取内联填充管理器单例
 * @returns InlineFillDropdown 实例
 */
export function getInlineFillDropdown(): InlineFillDropdown {
  if (!inlineFillDropdownInstance) {
    inlineFillDropdownInstance = new InlineFillDropdown();
  }
  return inlineFillDropdownInstance;
}

/**
 * 销毁内联填充管理器单例
 */
export function destroyInlineFillDropdown(): void {
  if (inlineFillDropdownInstance) {
    inlineFillDropdownInstance.destroy();
    inlineFillDropdownInstance = null;
  }
}
