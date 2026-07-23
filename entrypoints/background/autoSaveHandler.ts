import {
  type AutoSavePasswordData,
  type CheckCredentialStatusData,
  type CredentialStatusResponse,
  MessageType,
} from '@/utils/types';
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
    // 动态导入 StorageUtils，避免将 storage 层（masterPassword/autoSaveManager 等）
    // 打入 SW 初始包，减少冷启动 parse/compile 开销；仅在自动保存消息到达时加载。
    const { StorageUtils } = await import('@/utils/storage');
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

/**
 * 处理保存前凭证状态预检查请求
 *
 * 由 content script 在捕获登录凭证后、弹窗前触发。沿用与 handleAutoSavePassword
 * 一致的动态 import 模式，避免将 storage 层打入 SW 初始包。
 * 检查失败时保底返回 new，不阻断后续保存流程。
 * @param data 预检查请求数据
 * @returns 凭证状态响应
 */
export async function handleCheckCredentialStatus(data: CheckCredentialStatusData): Promise<CredentialStatusResponse> {
  try {
    const { StorageUtils } = await import('@/utils/storage');
    return await StorageUtils.checkCredentialStatus(data);
  } catch (error) {
    logger.error('Background: 处理保存前预检查失败:', error);
    return { status: 'new' };
  }
}
