/**
 * 填充成功回执胶囊（Fill Acknowledgement Chip）
 *
 * 侧边栏在填充成功后 300ms 自动关闭，快捷键与右键菜单同样没有页面内提示，
 * 于是「值到底落进框了没有」只能靠用户把视线挪回表单自己核对。本模块把一句
 * 短回执锚定在刚写入的那个输入框下缘，让确认动作发生在视线当前位置。
 *
 * 安全：胶囊只渲染固定文案，绝不承载填充值——账号、密码、动态码一律不进 DOM。
 *
 * 隔离：closed 模式 Shadow DOM + `all: initial` 宿主，主题令牌在展示时按当前
 * 配置内联写入，与接力活码胶囊同一套视觉语言（同族签名元素的轻量变体）。
 */

import type { ThemeName } from '@/utils/theme';
import { applyThemeTokensToHost } from '@/utils/theme';
import { tl } from '@/utils/i18n-lite';

/** 档位 → 自动收起时长（毫秒） */
const ACK_DWELL_MS: Record<FillAckKind, number> = {
  /** 普通回执：短到不打扰输入，长到读得完一句话 */
  filled: 1600,
  check: 1600,
  /** 规则来源那两档要读完、还要留出「这不对，去改规则」的反应时间 */
  rule: 3600,
  ruleCodeLike: 4800,
};

/**
 * 只有规则来源那两档接受指针事件
 *
 * 胶囊贴在字段下缘，而用户下一步常点是「获取验证码」或提交按钮——多一块能拦截点击的
 * 小方片就多一次误吞，所以默认保持对指针透明。`rule` / `ruleCodeLike` 例外：这两档的
 * 价值恰恰是让用户停下来读完并去改规则，值得为它付出一枚小尺寸控件的命中面积。
 * 仍不设 `tabindex`：加入侵任意站点的 Tab 顺序是更宽的交互改动，而这句回执没有需要
 * 键盘触达的操作。
 */
const isInteractiveKind = (kind: FillAckKind): boolean => kind === 'rule' || kind === 'ruleCodeLike';

/** 胶囊与字段下缘的间距（像素） */
const ACK_GAP = 6;

/** 胶囊与视口边缘的最小留白（像素） */
const ACK_VIEWPORT_INSET = 8;

/** 取不到实际尺寸时的兜底宽高（jsdom 等无布局环境下的偏移量） */
const ACK_FALLBACK_WIDTH = 150;
const ACK_FALLBACK_HEIGHT = 24;

/**
 * 回执档位：`filled` 为已核验写入，`check` 为写入成功但站点可能未登记，
 * `rule` 与 `ruleCodeLike` 标注「这一次写入用的是用户自己配的站点规则」——
 * 规则覆盖是权威路径、绕过全部启发式判据，落点是否合意只有用户自己能判断，
 * 因此不替用户拒填，改为把来源说清楚（`ruleCodeLike` 额外提示该框看着像验证码框）。
 */
export type FillAckKind = 'filled' | 'check' | 'rule' | 'ruleCodeLike';

/** 档位 → 胶囊文案 key（固定文案，绝不承载填充值） */
const ACK_TEXT_KEYS: Record<FillAckKind, string> = {
  filled: 'cs.ack.filled',
  check: 'cs.ack.check',
  rule: 'cs.ack.rule',
  ruleCodeLike: 'cs.ack.ruleCodeLike',
};

/**
 * 胶囊样式（主题令牌 `var(--aph-*)` 由宿主内联提供取值）
 *
 * 导出仅供减弱动效兜底与 `:host{all:initial}` 的字符串断言使用（与
 * `floatingButtonStyles`、`settingsPanelViewStyles` 同一约定），运行时不经由此注入。
 */
export const fillAckChipStyles = `
:host {
  all: initial;
}

.aph-ack {
  position: fixed;
  z-index: 2147483647;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 3px 9px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  line-height: 1.5;
  /*
   * 文字取中性深色而不是主色 var(--aph-primary)：六套皮肤的主色在白底上都只有 2.4~3.2:1，
   * 12px 文字达不到 WCAG 1.4.3 的 4.5:1。皮肤识别留给边框与投影（下面两条），
   * 文字只负责被读清——与 theme.ts 的 --aph-text-placeholder 那次「中性档位专管文字」同口径。
   */
  color: #303133;
  background: #fff;
  border: 1px solid var(--aph-primary-border);
  border-radius: 10px;
  box-shadow: 0 2px 10px rgb(var(--aph-primary-rgb) / 22%);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transform: translateY(3px);
  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s;
}

.aph-ack.visible {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

/* 规则来源那两档才开放指针事件，让悬停可以暂停收起（默认档位保持对页面透明） */
.aph-ack.aph-ack--interactive {
  pointer-events: auto;
}

/*
 * 减弱动效：入场那 3px 上浮关掉，淡入淡出保留——它是「回执出现在哪个字段上」的唯一
 * 过渡线索，全关会让突然出现读起来像页面闪烁。口径与接力活码胶囊的减弱档一致。
 */
@media (prefers-reduced-motion: reduce) {
  .aph-ack {
    transition: opacity 0.18s ease, visibility 0.18s;
    transform: none;
  }
}
`;

/**
 * 填充回执胶囊（每个内容脚本 frame 一个实例）
 */
export class FillAckChip {
  private shadowHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private chipEl: HTMLElement | null = null;

  /** 当前锚定的字段（回执落点，仅用于定位与存活性检查） */
  private field: HTMLElement | null = null;
  /** 当前档位（决定停留时长与是否接受指针事件） */
  private kind: FillAckKind = 'filled';
  /** 胶囊是否展示中 */
  private visible = false;
  /** 自动收起定时器 */
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** 重定位 rAF 句柄 */
  private repositionRaf: number | null = null;

  /**
   * 在字段下缘展示一句短回执
   *
   * 重复触发（连续填充两个字段）时就地换文案与锚点，不打断已展示的淡入；
   * 页面尚无 `body`（极端时序）时静默放弃，不影响调用方的填充结果。
   *
   * @param field 刚写入值的输入框
   * @param kind 回执档位
   * @param theme 当前主题（决定胶囊配色）
   */
  show(field: HTMLElement, kind: FillAckKind, theme: ThemeName): void {
    if (!document.body) return;
    this.ensureShadow(theme);
    const chipEl = this.chipEl;
    if (!chipEl) return;

    this.field = field;
    this.kind = kind;
    const textEl = chipEl.querySelector('.aph-ack-text');
    if (textEl) textEl.textContent = tl(ACK_TEXT_KEYS[kind]);
    chipEl.classList.toggle('aph-ack--interactive', isInteractiveKind(kind));

    this.position();
    this.visible = true;
    chipEl.classList.add('visible');
    this.restartHideTimer();
    this.attachReposition();
  }

  /**
   * 收起胶囊并释放字段引用（保留宿主，下次展示复用）
   */
  hide(): void {
    this.visible = false;
    this.field = null;
    this.chipEl?.classList.remove('visible');
    this.stopHideTimer();
    this.detachReposition();
  }

  /**
   * 销毁实例，移除 DOM 与监听
   */
  destroy(): void {
    this.hide();
    this.shadowHost?.remove();
    this.shadowHost = null;
    this.shadowRoot = null;
    this.chipEl = null;
  }

  // ==================== 内部实现 ====================

  /**
   * 惰性创建 Shadow DOM 与胶囊骨架
   * @param theme 当前主题
   */
  private ensureShadow(theme: ThemeName): void {
    if (this.shadowHost) {
      applyThemeTokensToHost(this.shadowHost, theme);
      return;
    }

    this.shadowHost = document.createElement('aph-fill-ack-root');
    // closed 影子树不挂在 `host.shadowRoot` 上，`data-aph` 是外部（测试与排障）
    // 定位宿主节点的唯一凭据，与保存弹窗、填充失败引导同一约定
    this.shadowHost.setAttribute('data-aph', 'fill-ack-chip');
    this.shadowHost.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = fillAckChipStyles;
    this.shadowRoot.appendChild(styleEl);

    // 文本节点独占一个子元素并挂在 role=status 区内：既有内容变化即播报的活区，
    // 也避免后续换文案时把结构一起重写
    this.chipEl = document.createElement('span');
    this.chipEl.className = 'aph-ack';
    this.chipEl.setAttribute('role', 'status');
    const textEl = document.createElement('span');
    textEl.className = 'aph-ack-text';
    this.chipEl.appendChild(textEl);

    // 悬停暂停计时：`rule` / `ruleCodeLike` 要说清的是「这次落点来自你的规则」，
    // 用户正读这句的时候让它消失，等于把唯一的可发现性窗口关掉。离开指针后重新计时。
    this.chipEl.addEventListener('mouseenter', () => {
      if (this.visible) this.stopHideTimer();
    });
    this.chipEl.addEventListener('mouseleave', () => {
      if (this.visible) this.restartHideTimer();
    });
    // 点一下就视为读完，立刻收起：胶囊占的是表单下方的空间，早点让位少一次误吞
    this.chipEl.addEventListener('click', () => this.hide());

    this.shadowRoot.appendChild(this.chipEl);

    document.body.appendChild(this.shadowHost);
    applyThemeTokensToHost(this.shadowHost, theme);
  }

  /**
   * 把胶囊定位到锚定字段的下缘，并在下缘越界时翻到字段上方
   *
   * 字段整体在视口外（表单被滚出屏幕）时不做隐藏——回执的价值恰恰是「填充确实发生了」，
   * 因此坐标一律夹进视口内，宁可贴在视口边缘也要让用户看到。
   */
  private position(): void {
    if (!this.chipEl || !this.field) return;
    const rect = this.field.getBoundingClientRect();
    const width = this.chipEl.offsetWidth || ACK_FALLBACK_WIDTH;
    const height = this.chipEl.offsetHeight || ACK_FALLBACK_HEIGHT;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const maxTop = Math.max(ACK_VIEWPORT_INSET, viewportHeight - height - ACK_VIEWPORT_INSET);
    let top = rect.bottom + ACK_GAP;
    if (top + height > viewportHeight - ACK_VIEWPORT_INSET) {
      top = rect.top - ACK_GAP - height;
    }
    top = Math.min(Math.max(top, ACK_VIEWPORT_INSET), maxTop);

    const maxLeft = Math.max(ACK_VIEWPORT_INSET, viewportWidth - width - ACK_VIEWPORT_INSET);
    const left = Math.min(Math.max(rect.left, ACK_VIEWPORT_INSET), maxLeft);

    this.chipEl.style.left = `${Math.round(left)}px`;
    this.chipEl.style.top = `${Math.round(top)}px`;
  }

  /**
   * 重置自动收起定时器（连续展示时以最后一次为准）
   */
  private restartHideTimer(): void {
    this.stopHideTimer();
    this.hideTimer = setTimeout(() => this.hide(), ACK_DWELL_MS[this.kind]);
  }

  private stopHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /**
   * 绑定滚动/缩放重定位监听（胶囊跟随字段，不留在原地）
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
   * 滚动/缩放重定位（rAF 节流）：字段脱离文档或尺寸归零时直接收起
   */
  private handleReposition = (): void => {
    if (this.repositionRaf !== null) return;
    this.repositionRaf = requestAnimationFrame(() => {
      this.repositionRaf = null;
      if (!this.visible) return;
      if (!this.field || !this.field.isConnected) {
        this.hide();
        return;
      }
      this.position();
    });
  };
}

// ==================== 单例（每个 frame 一个） ====================

let fillAckChipInstance: FillAckChip | null = null;

/**
 * 获取填充回执胶囊单例
 * @returns FillAckChip 实例
 */
export function getFillAckChip(): FillAckChip {
  if (!fillAckChipInstance) {
    fillAckChipInstance = new FillAckChip();
  }
  return fillAckChipInstance;
}

/**
 * 销毁填充回执胶囊单例（页面卸载时调用）
 */
export function destroyFillAckChip(): void {
  fillAckChipInstance?.destroy();
  fillAckChipInstance = null;
}
