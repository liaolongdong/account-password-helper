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
 * 显示原生通知（模拟 Element Plus ElMessage 样式）
 * 在页面右上角显示一个带图标的通知消息，3秒后自动消失
 * @param message - 通知消息内容
 * @param type - 通知类型，默认 'warning'
 */
export function showNativeNotification(message: string, type: NotificationType = 'warning'): void {
  // 移除已有的通知
  const existingNotification = document.querySelector('.native-form-detector-notification') as HTMLElement;
  if (existingNotification) {
    existingNotification.remove();
  }

  const { bgColor, borderColor, textColor } = NOTIFICATION_COLOR_MAP[type];

  const notification = document.createElement('div');
  notification.className = 'native-form-detector-notification';
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

  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}
