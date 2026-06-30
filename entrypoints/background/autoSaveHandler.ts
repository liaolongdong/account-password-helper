import { type AutoSavePasswordData, MessageType } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { getSidePanelPort } from './sidePanelManager';
import { invalidatePasswordCache } from './passwordCache';

/**
 * 处理保存密码请求
 * 由 content script 在用户确认后触发，执行会话校验、域名匹配、去重更新和存储
 * @param data 自动保存密码数据
 * @returns 保存结果
 */
export async function handleAutoSavePassword(
  data: AutoSavePasswordData,
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await StorageUtils.autoSavePassword(data);
    if (result.success) {
      // 保存成功后使密码缓存失效，确保下次加载时获取最新数据
      invalidatePasswordCache();

      // 主动通知 sidepanel 刷新数据（如果打开的话）
      const port = getSidePanelPort();
      if (port) {
        try {
          port.postMessage({ type: MessageType.URL_CHANGED });
        } catch {
          // port 可能已断开但尚未触发 disconnect 事件，忽略
        }
      }

      // 发送桌面通知提示用户已自动保存
      try {
        await chrome.notifications.create('auto-save-password', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon/128.png'),
          title: '账号密码已保存',
          message: `${data.username} - ${data.url} ${result.message}`,
        });
      } catch (notifyError) {
        logger.warn('Background: 桌面通知发送失败（可能系统通知权限未开启）:', notifyError);
      }
    }
    return result;
  } catch (error) {
    logger.error('Background: 处理自动保存密码失败:', error);
    return { success: false, message: '自动保存处理失败' };
  }
}
