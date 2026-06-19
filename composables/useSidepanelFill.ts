import type { PasswordEntry, PingResponse, FillResult } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';

/**
 * SidePanel 密码填充 Composable
 *
 * 职责：
 * - 完整填充流程（ping -> inject -> detect -> fill -> hide）
 * - 剪贴板操作（复制用户名/密码）
 * - 编辑跳转
 *
 * @returns 填充与剪贴板操作方法
 */
export function useSidepanelFill() {
  // ==================== 内部工具函数 ====================

  /**
   * 向 content script 发送 PING 消息，验证就绪状态
   * @param tabId 标签页ID
   * @param maxRetries 最大重试次数
   * @returns PingResponse 或 null
   */
  const pingContentScript = async (tabId: number, maxRetries: number = 3): Promise<PingResponse | null> => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: MessageType.PING });
        if (response && response.success) {
          return response as PingResponse;
        }
      } catch (_error) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return null;
  };

  /**
   * 等待字段检测完成
   * 使用指数退避策略轮询检查
   */
  const waitForFieldsDetected = async (tabId: number, maxRetries: number = 3): Promise<boolean> => {
    let delay = 100;
    const maxDelay = 1000;

    for (let i = 0; i < maxRetries; i++) {
      const pingResponse = await pingContentScript(tabId, 1);
      if (pingResponse && pingResponse.fieldsDetected) {
        const { username, password, mobile } = pingResponse.fieldsDetected;
        if (username > 0 || password > 0 || mobile > 0) {
          return true;
        }
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
    }

    return false;
  };

  // ==================== 填充密码 ====================

  /**
   * 填充密码到当前页面
   * 完整流程：PING 检测 -> 注入脚本 -> 字段检测 -> 发送填充 -> 隐藏侧边栏
   *
   * @param password 要填充的密码条目
   * @param options 可选配置
   * @param options.autoLogin 是否自动触发登录
   */
  const fillPassword = async (password: PasswordEntry, options?: { autoLogin?: boolean }) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        ElMessage.error('无法获取当前页面信息');
        return;
      }

      const tabId = tab.id;
      const autoLogin = options?.autoLogin ?? false;

      // 步骤1: 先检查 content script 是否已就绪（通过 PING）
      let pingResponse = await pingContentScript(tabId, 2);

      // 步骤2: 只有在 PING 失败时才尝试注入 content script
      if (!pingResponse) {
        logger.debug('Content script 未就绪，尝试注入...');
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/content.js'],
          });
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (injectError) {
          logger.error('Content script 注入失败:', injectError);
          ElMessage.error('无法在当前页面中注入脚本，请刷新页面后重试');
          return;
        }

        pingResponse = await pingContentScript(tabId, 5);
        if (!pingResponse) {
          ElMessage.error('页面脚本未就绪，请刷新页面后重试');
          return;
        }
      }

      // 步骤3: 检查字段是否已检测到，如果没有则等待
      const hasFields =
        pingResponse.fieldsDetected &&
        (pingResponse.fieldsDetected.username > 0 ||
          pingResponse.fieldsDetected.password > 0 ||
          pingResponse.fieldsDetected.mobile > 0);

      if (!hasFields) {
        const detected = await waitForFieldsDetected(tabId);
        if (!detected) {
          ElMessage.warning('未检测到登录表单，请确保页面包含登录输入框');
          return;
        }
      }

      // 步骤4: 发送填充消息
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: MessageType.FILL_PASSWORD,
        data: {
          username: password.username,
          password: password.password,
          autoLogin,
        },
      })) as FillResult;

      // 步骤5: 根据响应显示结果
      if (response && response.success) {
        ElMessage.success(response.message || '密码填充成功');
        // 隐藏侧边栏（必须携带 tabId，因为 sidepanel 发出的消息 sender.tab 为 undefined）
        await chrome.runtime.sendMessage({
          type: MessageType.HIDE_SIDEPANEL,
          data: { tabId },
        });
      } else {
        const rawMsg = response?.message || '';
        const isNoForm = rawMsg.includes('未检测到登录表单');
        const errorMsg = isNoForm ? '未检测到登录表单，请确保页面包含登录输入框' : rawMsg;
        ElMessage.warning(errorMsg);
      }
    } catch (error: any) {
      logger.error('填充密码失败:', error);
      if (error.message && error.message.includes('Could not establish connection')) {
        ElMessage.error('无法连接到页面脚本，请刷新页面后重试');
      } else {
        ElMessage.error('填充密码失败，请确保页面已加载完成');
      }
    }
  };

  /**
   * 填充密码并自动触发登录
   */
  const handleFillAndLogin = (password: PasswordEntry) => {
    fillPassword(password, { autoLogin: true });
  };

  // ==================== 编辑跳转 ====================

  /**
   * 跳转到密码管理页并打开指定条目的编辑弹窗
   */
  const handleEditPassword = async (password: PasswordEntry) => {
    try {
      await chrome.runtime.sendMessage({
        type: MessageType.OPEN_OPTIONS_AND_EDIT,
        data: { editId: password.id },
      });
    } catch (error) {
      logger.error('SidePanel: 打开编辑页面失败:', error);
      ElMessage.error('打开编辑页面失败');
    }
  };

  // ==================== 剪贴板操作 ====================

  /**
   * 复制用户名到剪贴板
   * @param username 要复制的用户名
   */
  const copyUsername = async (username: string) => {
    try {
      await navigator.clipboard.writeText(username);
      ElMessage.success('用户名已复制到剪贴板');
    } catch (error) {
      logger.error('复制用户名失败:', error);
      ElMessage.error('复制用户名失败');
    }
  };

  /**
   * 复制密码到剪贴板
   * @param password 要复制的密码明文
   */
  const copyPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      ElMessage.success('密码已复制到剪贴板');
    } catch (error) {
      logger.error('复制密码失败:', error);
      ElMessage.error('复制密码失败');
    }
  };

  return {
    fillPassword,
    handleFillAndLogin,
    handleEditPassword,
    copyUsername,
    copyPassword,
  };
}
