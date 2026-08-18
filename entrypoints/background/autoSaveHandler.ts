import {
  type AutoSavePasswordData,
  type CheckCredentialStatusData,
  type CredentialStatusResponse,
  MessageType,
} from '@/utils/types';
import { logger } from '@/utils/logger';
import { getSidePanelPorts } from './sidePanelManager';
import { ensureCredentialAccessAfterStartupRelock, invalidatePasswordCache } from './passwordCache';
import { tl } from '@/utils/i18n-lite';

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
    if (!(await ensureCredentialAccessAfterStartupRelock())) {
      return { success: false, message: tl('bg.autoSave.failedGeneric') };
    }
    // 动态导入 StorageUtils，将 storage 层（masterPassword/autoSaveManager 等）的
    // 模块初始化延迟到自动保存消息到达时（SW 产物被 WXT 内联为单文件，
    // 此懒加载不减少冷启动解析/编译量）。
    const { StorageUtils } = await import('@/utils/storage');
    const result = await StorageUtils.autoSavePassword(data);
    if (result.success) {
      // 保存成功后使密码缓存失效，确保下次加载时获取最新数据
      invalidatePasswordCache();

      // 主动通知 sidepanel 刷新数据（如果打开的话）
      for (const port of getSidePanelPorts()) {
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
          title: tl('bg.autoSave.savedTitle'),
          message: `${data.username} - ${data.url} ${result.message}`,
        });
      } catch (notifyError) {
        logger.warn('Background: 桌面通知发送失败（可能系统通知权限未开启）:', notifyError);
      }
    }
    return result;
  } catch (error) {
    logger.error('Background: 处理自动保存密码失败:', error);
    return { success: false, message: tl('bg.autoSave.failedGeneric') };
  }
}

/**
 * 处理保存前凭证状态预检查请求
 *
 * 由 content script 在捕获登录凭证后、弹窗前触发。沿用与 handleAutoSavePassword
 * 一致的动态 import 模式，延迟 storage 层的模块初始化执行。
 * 检查失败时保底返回 new，不阻断后续保存流程。
 * @param data 预检查请求数据
 * @returns 凭证状态响应
 */
export async function handleCheckCredentialStatus(data: CheckCredentialStatusData): Promise<CredentialStatusResponse> {
  try {
    if (!(await ensureCredentialAccessAfterStartupRelock())) return { status: 'locked' };
    const { StorageUtils } = await import('@/utils/storage');
    return await StorageUtils.checkCredentialStatus(data);
  } catch (error) {
    logger.error('Background: 处理保存前预检查失败:', error);
    return { status: 'new' };
  }
}
