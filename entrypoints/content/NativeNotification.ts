import type { NotificationType, NotificationColors } from '@/entrypoints/content/types';
import { tl } from '@/utils/i18n-lite';

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
 * 显示"未匹配到登录表单"的提示通知
 */
export function showNoLoginFormMessage(): void {
  showNativeNotification(tl('cs.notify.noLoginForm'), 'warning');
}

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
