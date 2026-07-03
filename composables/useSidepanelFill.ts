import type { PasswordEntry, PingResponse, FillResult } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { updatePasswordInSession } from '@/utils/storage/passwordCrud';
import { getClipboardConfig } from '@/utils/storage/configManager';
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
      const config = await getClipboardConfig();
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
   * 获取标签页中所有 frame 的 ID 列表
   * 通过 webNavigation API 获取，包含顶层 frame（frameId=0）和所有 iframe
   * @param tabId 标签页ID
   * @returns frame ID 数组，获取失败时返回 [0]（仅顶层 frame）
   */
  const getAllFrameIds = async (tabId: number): Promise<number[]> => {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (!frames || frames.length === 0) {
        return [0];
      }
      return frames.map(f => f.frameId);
    } catch (error) {
      logger.warn('获取 frame 列表失败，回退到仅顶层 frame:', error);
      return [0];
    }
  };

  /**
   * 向所有 frame 并行发送 PING 并聚合检测结果
   * 任一 frame 检测到登录字段即视为 success，
   * 同时收集所有 frame 的字段统计，返回汇总结果
   * @param tabId 标签页ID
   * @param frameIds 所有 frame ID 列表
   * @returns 聚合后的 PingResponse 或 null
   */
  const pingAllFrames = async (tabId: number, frameIds: number[]): Promise<PingResponse | null> => {
    let aggregatedResponse: PingResponse | null = null;

    const results = await Promise.allSettled(
      frameIds.map(frameId => chrome.tabs.sendMessage(tabId, { type: MessageType.PING }, { frameId })),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const response = result.value;
        if (response && response.success) {
          const pingRes = response as PingResponse;
          if (!aggregatedResponse) {
            aggregatedResponse = { ...pingRes, fieldsDetected: { ...pingRes.fieldsDetected } };
          } else {
            // 累加各 frame 的字段数量
            aggregatedResponse.fieldsDetected = {
              username: (aggregatedResponse.fieldsDetected?.username ?? 0) + (pingRes.fieldsDetected?.username ?? 0),
              password: (aggregatedResponse.fieldsDetected?.password ?? 0) + (pingRes.fieldsDetected?.password ?? 0),
              mobile: (aggregatedResponse.fieldsDetected?.mobile ?? 0) + (pingRes.fieldsDetected?.mobile ?? 0),
              verifyCode:
                (aggregatedResponse.fieldsDetected?.verifyCode ?? 0) + (pingRes.fieldsDetected?.verifyCode ?? 0),
            };
          }
        }
      }
      // rejected 的 frame 没有 content script，跳过
    }

    return aggregatedResponse;
  };

  /**
   * 等待字段检测完成
   * 使用指数退避策略轮询检查，支持跨 frame 检测
   * @param tabId 标签页ID
   * @param maxRetries 最大重试次数
   * @param frameIds 可选，所有 frame ID 列表，传入时会跨 frame PING
   * @returns 是否检测到字段
   */
  const waitForFieldsDetected = async (
    tabId: number,
    maxRetries: number = 3,
    frameIds?: number[],
  ): Promise<boolean> => {
    let delay = 100;
    const maxDelay = 1000;
    const useMultiFrame = frameIds && frameIds.length > 0;

    for (let i = 0; i < maxRetries; i++) {
      const pingResponse = useMultiFrame ? await pingAllFrames(tabId, frameIds) : await pingContentScript(tabId, 1);

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

  /**
   * 向所有 frame 发送填充消息，返回第一个成功的响应
   * 各 frame 的 FormDetector 收到消息后自行判断是否有匹配字段并尝试填充
   * @param tabId 标签页ID
   * @param frameIds 所有 frame ID 列表
   * @param fillData 填充数据（用户名、密码、autoLogin）
   * @returns FillResult 或 null
   */
  const fillPasswordInAllFrames = async (
    tabId: number,
    frameIds: number[],
    fillData: { username: string; password: string; autoLogin: boolean },
  ): Promise<FillResult | null> => {
    // 并行向所有 frame 发送填充消息，避免顶层 frame 的慢响应（~9s 重试）阻塞 iframe 的快速填充（~0.2s）
    const results = await Promise.allSettled(
      frameIds.map(frameId =>
        chrome.tabs.sendMessage(
          tabId,
          {
            type: MessageType.FILL_PASSWORD,
            data: fillData,
          },
          { frameId },
        ),
      ),
    );

    // 取第一个成功的响应
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const response = result.value as FillResult | undefined;
        if (response?.success) {
          return response;
        }
      }
    }

    return null;
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

      // 获取所有 frame ID（包括顶层 frame 和 iframe），
      // 以便后续 PING 和 FILL 能够命中 iframe 内嵌的登录表单
      const frameIds = await getAllFrameIds(tabId);

      // 步骤1: 先检查所有 frame 中 content script 是否已就绪（通过 PING）
      let pingResponse = await pingAllFrames(tabId, frameIds);

      // 步骤2: 只有在所有 frame 都 PING 失败时才尝试注入 content script
      // 注入顶层 frame 即可（allFrames: true 配置会使其在所有 frame 中运行）
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

        pingResponse = await pingAllFrames(tabId, frameIds);
        if (!pingResponse) {
          ElMessage.error('页面脚本未就绪，请刷新页面后重试');
          return;
        }
      }

      // 步骤3: 检查所有 frame 中是否已检测到字段，如果没有则等待
      const hasFields =
        pingResponse.fieldsDetected &&
        (pingResponse.fieldsDetected.username > 0 ||
          pingResponse.fieldsDetected.password > 0 ||
          pingResponse.fieldsDetected.mobile > 0);

      if (!hasFields) {
        const detected = await waitForFieldsDetected(tabId, 3, frameIds);
        if (!detected) {
          ElMessage.warning('未检测到登录表单，请确保页面包含登录输入框');
          return;
        }
      }

      // 步骤4: 向所有 frame 发送填充消息，取第一个成功的响应
      const fillData = {
        username: password.username,
        password: password.password,
        autoLogin,
      };
      const response = await fillPasswordInAllFrames(tabId, frameIds, fillData);

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
        updatePasswordInSession(password.id, {
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
