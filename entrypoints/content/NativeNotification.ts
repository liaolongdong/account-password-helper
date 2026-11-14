import type { NotificationType, NotificationColors } from '@/entrypoints/content/types';

/**
 * 提示条文案的最大长度（超出部分截断）
 *
 * 提示条可能由不可信来源（页面脚本经 postMessage 委托、外部下发的消息）驱动，
 * 限长避免超长文本撑碎页面布局。
 */
export const NOTICE_MAX_LENGTH = 200;

/** 合法提示类型集合（与 NOTIFICATION_COLOR_MAP 的键一致） */
const VALID_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set(['success', 'warning', 'info', 'error']);

/**
 * 类型守卫：判断值是否为合法提示类型
 *
 * 下游渲染直接以该值查颜色表并解构，非法值会因 undefined 抛 TypeError，
 * 必须在边界处收窄。
 *
 * @param value 待校验的值
 * @returns 是否为合法提示类型
 */
export const isNotificationType = (value: unknown): value is NotificationType =>
  typeof value === 'string' && VALID_NOTIFICATION_TYPES.has(value as NotificationType);

/** 通知类型到颜色的映射 */
const NOTIFICATION_COLOR_MAP: Record<NotificationType, NotificationColors> = {
  success: { bgColor: '#f0f9ec', borderColor: '#b2d3a3', textColor: '#67c23a' },
  warning: { bgColor: '#fdf6ec', borderColor: '#f0c78a', textColor: '#e6a23c' },
  error: { bgColor: '#fef0f0', borderColor: '#f3b4b4', textColor: '#f56c6c' },
  info: { bgColor: '#edf2fc', borderColor: '#b3c1db', textColor: '#909399' },
};

/** 通知类型到图标的映射 */
const NOTIFICATION_ICON_MAP: Record<NotificationType, string> = {
  success: '✓',
  warning: '!',
  info: 'ℹ',
  error: '✗',
};

/**
 * 通知类型 → 自动收起时长（毫秒）
 *
 * 失败/拒收档承载最长的文案（越限字段点名、容量上限、跨窗口冲突、带 URL 的去向说明），
 * max-width 300px 下长句折行后需要更久的阅读窗口；成功提示保持短促不打扰。
 */
const NOTIFICATION_DWELL_MS: Record<NotificationType, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 6000,
};

/** 当前通知的自动收起定时器（同一时刻至多一条通知，模块级单槽即可） */
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前通知节点：到期、点击、被替换都经它收口，避免悬空定时器把新通知提前收走 */
let activeNotification: HTMLElement | null = null;

/** 清除自动收起定时器 */
function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** 收起当前通知并清表（到期 / 点击 / 被替换共用） */
function dismissNotification(): void {
  clearHideTimer();
  activeNotification?.remove();
  activeNotification = null;
}

/**
 * 显示原生通知（模拟 Element Plus ElMessage 样式）
 *
 * 在页面右上角显示一个带图标的通知消息，按类型分档停留后自动消失；悬停暂停计时、
 * 离开重新计时、点击立即收起（与 FillAckChip 同一交互口径），长文案不会读到一半被收走。
 * @param message - 通知消息内容
 * @param type - 通知类型，默认 'warning'
 */
export function showNativeNotification(message: string, type: NotificationType = 'warning'): void {
  // 移除已有通知并清掉它的定时器：旧表不得把新通知提前收走
  dismissNotification();
  // 兜底清扫不受管残留（dev 热重载等极端时序下模块状态与 DOM 可能不一致），守住「至多一条」
  document.querySelector('.native-form-detector-notification')?.remove();

  const { bgColor, borderColor, textColor } = NOTIFICATION_COLOR_MAP[type];

  const notification = document.createElement('div');
  notification.className = 'native-form-detector-notification';
  notification.setAttribute('role', type === 'success' || type === 'info' ? 'status' : 'alert');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    border: 1px solid ${borderColor};
    color: ${textColor};
    padding: 12px 16px;
    border-radius: 4px;
    box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
    z-index: 2147483647;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 300px;
    word-wrap: break-word;
    display: flex;
    align-items: center;
    min-height: 40px;
  `;

  const icon = document.createElement('span');
  icon.innerHTML = NOTIFICATION_ICON_MAP[type] || 'ℹ';
  icon.style.marginRight = '8px';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;

  notification.appendChild(icon);
  notification.appendChild(textSpan);

  const dwell = NOTIFICATION_DWELL_MS[type];
  const armHideTimer = (): void => {
    clearHideTimer();
    hideTimer = setTimeout(dismissNotification, dwell);
  };
  // 存活守卫：通知条是 light DOM，宿主页面可持有被替换/收起的旧节点并向它派发合成事件。
  // 旧节点的回调若仍读写模块单槽，就能停掉/重排/收走「当前」通知（orphan 监听器）。
  // 与 FillAckChip 的 `if (this.visible)` 同一口径：非当前节点的事件一律忽略。
  const isCurrent = (): boolean => activeNotification === notification;
  // 悬停暂停计时：用户正读这句时让它消失，等于把长文案唯一的阅读窗口关掉；离开指针后重新计时
  notification.addEventListener('mouseenter', () => {
    if (isCurrent()) clearHideTimer();
  });
  notification.addEventListener('mouseleave', () => {
    if (isCurrent()) armHideTimer();
  });
  // 点一下视为读完，立即收起
  notification.addEventListener('click', () => {
    if (isCurrent()) dismissNotification();
  });

  document.body.appendChild(notification);
  activeNotification = notification;
  armHideTimer();
}
