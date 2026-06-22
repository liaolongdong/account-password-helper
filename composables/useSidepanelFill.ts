import type { PasswordEntry, PingResponse, FillResult } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { StorageUtils } from '@/utils/storage';
import type { Ref } from 'vue';

/** 剪贴板自动清除定时器（模块级变量，确保同一时刻只有一个定时器） */
let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前已复制到剪贴板的密码值，用于定时器触发时验证内容是否被替换 */
let copiedPasswordSnapshot: string | null = null;

/**
 * SidePanel 密码填充 Composable
 *
 * 职责：
 * - 完整填充流程（ping -> inject -> detect -> fill -> hide）
 * - 剪贴板操作（复制用户名/密码，密码复制后自动清除）
 * - 编辑跳转
 *
 * @param passwords 密码列表引用，用于就地更新 favoriteUsedAt
 * @returns 填充与剪贴板操作方法
 */
export function useSidepanelFill(passwords?: Ref<PasswordEntry[]>) {
  /**
   * 清除剪贴板并显示通知
   *
   * 优先使用 Async Clipboard API（需文档有焦点）；
   * 当 SidePanel 不在焦点状态时（setTimeout 回调场景），降级到
   * document.execCommand('copy')，在 clipboardWrite 权限加持下
   * 无需用户手势和文档焦点即可写入剪贴板。
   *
   * 清除前会验证剪贴板内容是否仍为原始密码（需文档有焦点）；
   * 若 SidePanel 已失焦无法验证，则采纳\"尽力清除\"策略：直接执行清除以保证密码安全。
   */
  const clearClipboard = async () => {
    // 验证剪贴板内容是否仍为原始密码，防止误清除用户新复制的内容
    if (copiedPasswordSnapshot !== null) {
      try {
        const currentContent = await navigator.clipboard.readText();
        if (currentContent !== copiedPasswordSnapshot) {
          logger.info('剪贴板内容已变更，跳过自动清除');
          copiedPasswordSnapshot = null;
          return;
        }
      } catch {
        // 无法读取剪贴板（文档无焦点）→ 无法验证内容是否已被替换
        // 采用\"尽力清除\"策略：宁可误清也不留密码，这是 Chrome 焦点限制下的安全权衡
        logger.info('无法读取剪贴板内容（文档无焦点），将执行尽力清除');
      }
    }

    try {
      await navigator.clipboard.writeText('');
      ElMessage.info('剪贴板已自动清除');
    } catch {
      // Async Clipboard API 需要文档有焦点，SidePanel 无焦点时降级
      // execCommand('copy') 搭配空选择是 no-op，必须写入非空内容才能覆写剪贴板
      try {
        const textarea = document.createElement('textarea');
        textarea.value = '\u200b'; // 零宽空格，视觉上等同于空，但能让 execCommand 真正写入
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (success) {
          ElMessage.info('剪贴板已自动清除');
        } else {
          ElMessage.warning('自动清除剪贴板失败，请手动清除');
        }
      } catch (fallbackError) {
        logger.error('自动清除剪贴板失败:', fallbackError);
        ElMessage.warning('自动清除剪贴板失败，请手动清除');
      }
    }
  };

  /**
   * 取消待执行的剪贴板自动清除定时器
   * 当用户复制了其他内容（如用户名）时调用，避免定时器误清除新内容
   */
  const cancelPendingClear = () => {
    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }
    copiedPasswordSnapshot = null;
  };

  /**
   * 启动剪贴板自动清除定时器
   * 新的复制操作会取消上一个定时器，避免多个定时器冲突
   */
  const scheduleClearClipboard = async () => {
    // 取消上一个定时器
    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }

    try {
      const config = await StorageUtils.getClipboardConfig();
      if (config.autoClear && config.clearAfterSeconds > 0) {
        clipboardClearTimer = setTimeout(() => {
          clipboardClearTimer = null;
          clearClipboard();
        }, config.clearAfterSeconds * 1000);
      }
    } catch (error) {
      logger.error('读取剪贴板配置失败:', error);
    }
  };
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
        // 填充成功时，刷新 lastUsedAt（"最近使用"排序依据）和 favoriteUsedAt（LRU 依据）
        const now = Date.now();
        if (passwords?.value) {
          const entry = passwords.value.find(p => p.id === password.id);
          if (entry) {
            entry.lastUsedAt = now;
            if (password.favorite) entry.favoriteUsedAt = now;
          }
        }
        // 后台持久化，不阻塞填充流程
        StorageUtils.updatePassword(password.id, {
          lastUsedAt: now,
          ...(password.favorite ? { favoriteUsedAt: now } : {}),
        }).catch(error => logger.error('更新使用时间戳失败:', error));
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
   * 复制用户名时取消待执行的密码自动清除定时器，避免误清除用户名
   * @param username 要复制的用户名
   */
  const copyUsername = async (username: string) => {
    try {
      await navigator.clipboard.writeText(username);
      ElMessage.success('用户名已复制到剪贴板');
      // 取消密码自动清除定时器，避免误清除刚复制的用户名
      cancelPendingClear();
    } catch (error) {
      logger.error('复制用户名失败:', error);
      ElMessage.error('复制用户名失败');
    }
  };

  /**
   * 复制密码到剪贴板
   * 复制成功后根据配置启动自动清除定时器
   * @param password 要复制的密码明文
   */
  const copyPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      ElMessage.success('密码已复制到剪贴板');
      // 记录当前密码快照，用于定时器触发时验证剪贴板内容
      copiedPasswordSnapshot = password;
      // 启动自动清除定时器
      scheduleClearClipboard();
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
