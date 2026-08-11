/**
 * 两步接力活码胶囊（TOTP Handoff）
 *
 * GitHub 式两阶段登录中，账密页与验证码页不在同一页面：账密填充成功后
 * background 记录待接力标记，本模块在同域名验证码页检测到验证码输入框时，
 * 将活码胶囊锚定在其右内缘——点击胶囊复制动态码，点击「填入」一键填充。
 *
 * 设计语言与内联面板 `.aph-totp` 胶囊一致（同一枚签名元素贯穿两个页面）。
 *
 * 安全：TOTP 密钥始终驻留 background，胶囊每次取码经 GET_INLINE_TOTP 门控
 * （仅一次性动态码）；待接力标记只含条目 ID 与 hostname，由 SW 按发起标签页
 * URL 精确比对后下发。
 *
 * 隔离：closed 模式 Shadow DOM + `all: initial` 宿主，主题令牌随整体换肤。
 */

import { MessageType } from '@/utils/types';
import type { InlineTotpCodeData } from '@/utils/types';
import { logger } from '@/utils/logger';
import { applyThemeTokensToHost, DEFAULT_THEME, type ThemeName } from '@/utils/theme';
import { tl } from '@/utils/i18n-lite';
import { copyTextToClipboard } from '@/entrypoints/content/domUtils';

/** 填入图标（与内联面板活码胶囊一致） */
const FILL_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="m7 8 5 5 5-5"/><path d="M5 21h14"/></svg>`;

/** 关闭图标（本次不再提示） */
const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

/** 胶囊样式（主题令牌 var(--aph-*) 由宿主内联提供取值） */
const capsuleStyles = `
:host {
  all: initial;
}

* {
  box-sizing: border-box;
}

.aph-handoff {
  position: fixed;
  z-index: 2147483647;
  display: none;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 5px 0 9px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--aph-primary);
  background: #fff;
  border: 1px solid var(--aph-primary-border);
  border-radius: 13px;
  box-shadow: 0 2px 10px rgb(var(--aph-primary-rgb) / 22%);
  cursor: pointer;
  transition: box-shadow 0.15s ease, opacity 0.2s ease, transform 0.2s ease;
  opacity: 0;
  transform: translateY(-3px);
}

.aph-handoff.visible {
  display: inline-flex;
  opacity: 1;
  transform: translateY(0);
}

.aph-handoff:hover {
  box-shadow: 0 3px 14px rgb(var(--aph-primary-rgb) / 35%);
}

.aph-handoff-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1.5px;
}

.aph-handoff-countdown {
  min-width: 17px;
  font-size: 10px;
  color: #9aa3af;
  text-align: right;
}

.aph-handoff-fill {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  color: var(--aph-primary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.aph-handoff-fill:hover {
  background: var(--aph-primary-bg);
  opacity: 1;
}

.aph-handoff-close {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  color: #9aa3af;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.aph-handoff-close:hover {
  color: #6b7280;
}
`;

/** 字段不可见或脱离文档时隐藏胶囊的检查间隔（毫秒，随秒级心跳顺带执行） */
type TimerHandle = ReturnType<typeof setInterval>;

/**
 * 两步接力活码胶囊（每个内容脚本 frame 一个实例）
 */
export class TotpHandoffCapsule {
  private shadowHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private capsuleEl: HTMLElement | null = null;

  /** 当前锚定的验证码输入框 */
  private field: HTMLInputElement | null = null;
  /** 当前接力的条目 ID */
  private entryId = '';
  /** 当前活码状态 */
  private state: InlineTotpCodeData | null = null;
  /** 胶囊是否展示中 */
  private visible = false;
  /** 秒级心跳（倒计时 + 到期刷新 + 字段存活性检查） */
  private timer: TimerHandle | null = null;
  /** 取码/刷新中的去重标记 */
  private fetching = false;
  /** 重定位 rAF 句柄 */
  private repositionRaf: number | null = null;
  /** 当前主题（由 FormDetector 依据配置推送） */
  private currentTheme: ThemeName = DEFAULT_THEME;
  /** 本页生命周期内已被用户关闭的条目 ID（抵御在途响应/重检测导致的关而复现） */
  private dismissedIds = new Set<string>();

  /**
   * 在验证码输入框旁展示接力胶囊并拉取首个动态码
   *
   * 同一字段重复触发时幂等；字段变化（SPA 重渲染）时迁移锚点；
   * 用户已关闭过的条目在本页生命周期内不再展示（「本次不再提示」）。
   * @param field 页面检测到的验证码输入框
   * @param entryId 待接力条目 ID（background 已校验域名与会话）
   */
  show(field: HTMLInputElement, entryId: string): void {
    if (this.dismissedIds.has(entryId)) return;
    if (this.visible && this.field === field && this.entryId === entryId) return;

    this.field = field;
    this.entryId = entryId;
    this.ensureShadow();
    void this.refreshCode(true);
  }

  /**
   * 隐藏胶囊（保留实例；pending 的清除由调用方或填充/关闭动作负责）
   */
  hide(): void {
    this.visible = false;
    this.state = null;
    this.field = null;
    this.capsuleEl?.classList.remove('visible');
    this.stopTimer();
    this.detachReposition();
  }

  /**
   * 更新主题：缓存主题名并对已创建的宿主实时换肤
   * @param theme 主题名
   */
  setTheme(theme: ThemeName): void {
    this.currentTheme = theme;
    if (this.shadowHost) applyThemeTokensToHost(this.shadowHost, theme);
  }

  /**
   * 销毁实例，移除 DOM 与监听
   */
  destroy(): void {
    this.hide();
    this.shadowHost?.remove();
    this.shadowHost = null;
    this.shadowRoot = null;
    this.capsuleEl = null;
  }

  // ==================== 内部实现 ====================

  /**
   * 惰性创建 Shadow DOM 与胶囊骨架
   */
  private ensureShadow(): void {
    if (this.shadowRoot) return;

    this.shadowHost = document.createElement('aph-totp-handoff-root');
    this.shadowHost.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = capsuleStyles;
    this.shadowRoot.appendChild(styleEl);

    this.capsuleEl = document.createElement('span');
    this.capsuleEl.className = 'aph-handoff';
    this.capsuleEl.setAttribute('title', tl('cs.handoff.capsuleTitle'));
    this.capsuleEl.innerHTML = `
      <span class="aph-handoff-code"></span>
      <span class="aph-handoff-countdown"></span>
      <button class="aph-handoff-fill" type="button" title="${tl('cs.handoff.fillTitle')}">${FILL_ICON}</button>
      <button class="aph-handoff-close" type="button" title="${tl('cs.handoff.closeTitle')}">${CLOSE_ICON}</button>
    `;
    // 事件隔离：阻止冒泡穿透 Shadow DOM 到达页面 document，mousedown 阻止默认避免焦点跌落
    this.capsuleEl.addEventListener('mousedown', e => e.preventDefault());
    this.capsuleEl.addEventListener('click', e => e.stopPropagation());
    this.capsuleEl.addEventListener('click', this.handleCapsuleClick);
    this.shadowRoot.appendChild(this.capsuleEl);

    document.body.appendChild(this.shadowHost);
    applyThemeTokensToHost(this.shadowHost, this.currentTheme);
  }

  /**
   * 胶囊点击（委托）：填入/关闭按钮优先，其余区域复制动态码
   */
  private handleCapsuleClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (target.closest('.aph-handoff-fill')) {
      void this.handleFill();
      return;
    }
    if (target.closest('.aph-handoff-close')) {
      this.handleClose();
      return;
    }
    void this.handleCopy();
  };

  /**
   * 拉取/刷新动态码（密钥驻留 background，仅下发一次性动态码）
   * @param firstShow 是否首次展示（失败时静默收起，不闪烁）
   */
  private async refreshCode(firstShow = false): Promise<void> {
    if (this.fetching) return;
    this.fetching = true;
    const entryId = this.entryId;

    let data: InlineTotpCodeData | null = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.GET_INLINE_TOTP, data: { id: entryId } });
      if (res && res.success && res.data) data = res.data as InlineTotpCodeData;
    } catch (error) {
      logger.debug('两步接力：请求动态码失败（扩展上下文可能失效）:', error);
    }
    this.fetching = false;

    // 异步窗口内接力目标可能已切换或已隐藏，丢弃过期响应
    if (entryId !== this.entryId) return;
    if (!data) {
      logger.debug('两步接力：动态码获取失败（会话可能已锁定），收起胶囊');
      this.hide();
      return;
    }

    this.state = data;
    this.renderCode();
    this.reveal();
    if (firstShow) logger.info('两步接力：验证码页活码胶囊已就绪');
  }

  /**
   * 展示胶囊：定位 + 淡入 + 启动心跳与重定位监听
   */
  private reveal(): void {
    if (!this.capsuleEl || !this.field) return;
    this.visible = true;
    this.position();
    // position() 已判定需收起（如字段滚出视口）时不再强制展示，避免未定位闪现
    if (!this.visible) return;
    this.capsuleEl.classList.add('visible');
    this.startTimer();
    this.attachReposition();
  }

  /**
   * 将胶囊定位到验证码输入框右内缘（垂直居中）
   */
  private position(): void {
    if (!this.capsuleEl || !this.field) return;
    const rect = this.field.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      this.hide();
      return;
    }
    const width = this.capsuleEl.offsetWidth || 130;
    const height = this.capsuleEl.offsetHeight || 26;
    const left = Math.max(4, rect.right - width - 6);
    const top = rect.top + (rect.height - height) / 2;
    this.capsuleEl.style.left = `${Math.round(left)}px`;
    this.capsuleEl.style.top = `${Math.round(top)}px`;
  }

  /**
   * 将当前活码状态渲染到胶囊槽位
   */
  private renderCode(): void {
    if (!this.capsuleEl || !this.state) return;
    const codeEl = this.capsuleEl.querySelector('.aph-handoff-code');
    if (codeEl) codeEl.textContent = this.state.code;
    this.renderCountdown();
  }

  /**
   * 渲染剩余秒数
   */
  private renderCountdown(): void {
    if (!this.capsuleEl || !this.state) return;
    const countdownEl = this.capsuleEl.querySelector('.aph-handoff-countdown');
    if (!countdownEl) return;
    const remaining = Math.max(0, Math.ceil((this.state.expiresAt - Date.now()) / 1000));
    countdownEl.textContent = `${remaining}s`;
  }

  /**
   * 启动秒级心跳：刷新倒计时、到期换码、检查字段存活性
   */
  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(this.tick, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 秒级心跳
   */
  private tick = (): void => {
    // 字段脱离文档或不可见（SPA 重渲染/页面跳转）时收起，等待下次检测重新接力
    if (!this.field || !this.field.isConnected || !isFieldVisible(this.field)) {
      this.hide();
      return;
    }
    if (!this.state) return;
    if (this.state.expiresAt - Date.now() <= 0) {
      void this.refreshCode();
      return;
    }
    this.renderCountdown();
  };

  /**
   * 复制当前动态码并给出短暂反馈（动态码 30 秒自失效，无需剪贴板定时清除）
   */
  private async handleCopy(): Promise<void> {
    if (!this.state) return;
    const ok = await copyTextToClipboard(this.state.code);
    this.flashMessage(ok ? tl('cs.inline.totpCopied') : tl('cs.inline.totpFailed'));
  }

  /**
   * 「填入」点击：委托 background 现算动态码并经 FILL_TOTP 回填发起 frame
   */
  private async handleFill(): Promise<void> {
    const entryId = this.entryId;
    let message = '';
    try {
      const res = await chrome.runtime.sendMessage({ type: MessageType.FILL_TOTP_BY_ID, data: { id: entryId } });
      if (entryId !== this.entryId) return;
      if (res && res.success) {
        // 接力完成：清除 pending 并收起胶囊
        this.clearPending();
        this.hide();
        return;
      }
      message = res?.message || '';
      logger.warn('两步接力：验证码填充未成功:', message);
    } catch (error) {
      logger.error('两步接力：验证码填充请求失败:', error);
    }
    this.flashMessage(message || tl('cs.inline.totpFailed'));
  }

  /**
   * 关闭点击：清除 pending，本次页面生命周期内不再提示
   */
  private handleClose(): void {
    // 本地抑制优先：即使清除消息在途失败或重检测先到，本页也不再复现
    if (this.entryId) this.dismissedIds.add(this.entryId);
    this.clearPending();
    this.hide();
  }

  /**
   * 通知 background 清除待接力标记（fire-and-forget）
   */
  private clearPending(): void {
    chrome.runtime.sendMessage({ type: MessageType.CLEAR_PENDING_TOTP }).catch(() => {
      // 上下文失效时忽略
    });
  }

  /**
   * 在动态码槽位短暂展示反馈文案，随后还原
   * @param message 反馈文案
   */
  private flashMessage(message: string): void {
    const codeEl = this.capsuleEl?.querySelector('.aph-handoff-code');
    if (!codeEl || !this.state) return;
    const prev = this.state.code;
    codeEl.textContent = message;
    window.setTimeout(() => {
      // 取实时活码还原，避免闪光窗口跨越周期边界时写回旧码
      if (codeEl.isConnected) codeEl.textContent = this.state?.code ?? prev;
    }, 1400);
  }

  /**
   * 绑定滚动/缩放重定位监听
   */
  private attachReposition(): void {
    window.addEventListener('scroll', this.handleReposition, true);
    window.addEventListener('resize', this.handleReposition);
  }

  private detachReposition(): void {
    window.removeEventListener('scroll', this.handleReposition, true);
    window.removeEventListener('resize', this.handleReposition);
    if (this.repositionRaf !== null) {
      cancelAnimationFrame(this.repositionRaf);
      this.repositionRaf = null;
    }
  }

  /**
   * 滚动/缩放重定位（rAF 节流）
   */
  private handleReposition = (): void => {
    if (this.repositionRaf !== null) return;
    this.repositionRaf = requestAnimationFrame(() => {
      this.repositionRaf = null;
      if (this.visible) this.position();
    });
  };
}

/**
 * 判断验证码输入框当前是否可见（尺寸非零且在视口内）
 * @param field 输入框
 * @returns 是否可见
 */
function isFieldVisible(field: HTMLInputElement): boolean {
  const rect = field.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

// ==================== 单例（每个 frame 一个） ====================

let handoffCapsuleInstance: TotpHandoffCapsule | null = null;

/**
 * 获取两步接力胶囊单例
 * @returns TotpHandoffCapsule 实例
 */
export function getTotpHandoffCapsule(): TotpHandoffCapsule {
  if (!handoffCapsuleInstance) {
    handoffCapsuleInstance = new TotpHandoffCapsule();
  }
  return handoffCapsuleInstance;
}

/**
 * 销毁两步接力胶囊单例
 */
export function destroyTotpHandoffCapsule(): void {
  if (handoffCapsuleInstance) {
    handoffCapsuleInstance.destroy();
    handoffCapsuleInstance = null;
  }
}
