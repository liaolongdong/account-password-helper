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
import type { MatchingAccountMeta, MatchingAccountsResponse } from '@/utils/types';
import { logger } from '@/utils/logger';
import { applyThemeTokensToHost, DEFAULT_THEME, type ThemeName } from '@/utils/theme';
import { getTagColor, parseTags } from '@/utils/tagUtils';

/** 钥匙图标 */
const KEY_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="m16 7 3 3"/></svg>`;

/** 搜索图标 */
const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;

/** 锁图标（锁定态） */
const LOCK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

/** 星形图标（收藏标记） */
const STAR_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.3 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/></svg>`;

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

.aph-url {
  overflow: hidden;
  font-size: 11px;
  color: #9aa3af;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aph-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border-radius: 4px;
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
  /** 当前主题（由 FormDetector 依据配置推送，避免每次获焦读取 storage） */
  private currentTheme: ThemeName = DEFAULT_THEME;

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
  }

  /**
   * 隐藏触发图标
   */
  private hideIcon(): void {
    this.iconVisible = false;
    this.triggerEl?.classList.remove('visible');
    this.detachTriggerInteractions();
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
    this.triggerEl.setAttribute('title', '快速填充');
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
  }

  /**
   * 构建面板骨架（锁定态 / 搜索 + 列表 + 底部管理），每次打开重建一次
   */
  private buildPanel(): void {
    if (!this.panelEl) return;

    if (this.locked) {
      this.panelEl.innerHTML = `
        <div class="aph-locked" data-action="unlock">
          <div class="aph-locked-icon">${LOCK_ICON}</div>
          <div>
            <div class="aph-locked-title">解锁后填充</div>
            <div class="aph-locked-desc">点击验证主密码以使用快速填充</div>
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
        <input type="text" placeholder="搜索账号、标签、备注、网址..." spellcheck="false" autocomplete="off" />
      </div>
      <div class="aph-list"></div>
      <div class="aph-footer">
        <button class="aph-manage" type="button">${KEY_ICON}<span>密码管理</span></button>
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
      listEl.innerHTML = `<div class="aph-empty">${this.accounts.length === 0 ? '当前网站暂无匹配账号' : '未找到匹配的账号'}</div>`;
      return;
    }

    listEl.innerHTML = this.filtered
      .map((acc, index) => {
        const star = acc.favorite ? `<span class="aph-star">${STAR_ICON}</span>` : '';
        const badge = acc.hasTotp ? `<span class="aph-badge">2FA</span>` : '';
        const account = escapeHtml(acc.username || '(无账号)');
        // 标签与侧边栏保持一致：按分隔符拆分为多枚，并按标签内容生成稳定的哈希配色
        const tagsHtml = parseTags(acc.tag)
          .map(t => {
            const c = getTagColor(t);
            return `<span class="aph-tag" style="color:${c.text};background:${c.background};border-color:${c.border}" title="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
          })
          .join('');
        const url = acc.url ? `<span class="aph-url">${escapeHtml(acc.url)}</span>` : '';
        const sub = tagsHtml || url ? `<div class="aph-row-sub">${tagsHtml}${url}</div>` : '';
        const titleAttr = acc.remark ? ` title="备注：${escapeHtml(acc.remark)}"` : '';
        return `
          <div class="aph-row" data-index="${index}"${titleAttr}>
            <div class="aph-row-icon">${KEY_ICON}</div>
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
   * 搜索输入处理
   */
  private handleSearchInput = (e: Event): void => {
    this.searchKeyword = (e.target as HTMLInputElement).value;
    this.applyFilter();
  };

  /**
   * 列表点击（委托）：选择账号填充
   */
  private handleListClick = (e: Event): void => {
    const row = (e.target as HTMLElement).closest('.aph-row') as HTMLElement | null;
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
