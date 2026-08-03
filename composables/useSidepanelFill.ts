import type { PasswordEntry, PingResponse, FillResult } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { getFillableFrameIds, fillPasswordInFrames } from '@/utils/frameFill';
import { getClipboardConfig } from '@/utils/storage/configManager';
import { lazyImport } from '@/utils/lazyImport';
import type { Ref } from 'vue';

/** 剪贴板自动清除定时器（模块级变量，确保同一时刻只有一个定时器） */
let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前已复制到剪贴板的密码值，用于定时器触发时验证内容是否被替换 */
let copiedPasswordSnapshot: string | null = null;

/**
 * 延迟加载 totp 模块（首次填充/复制验证码时触发）
 * 静态导入会将 totp chunk 拉入侧边栏入口 modulepreload 清单，
 * 增加锁屏态（Windows 冷盘）首屏关键路径的文件冷读数量
 */
const getTotpModule = lazyImport(() => import('@/utils/totp'));
const generateTotpCode = async (secret: string): Promise<string> => {
  const mod = await getTotpModule();
  return mod.generateTOTP(secret);
};

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
      ElMessage.info(t('fill.clipboardCleared'));
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
          ElMessage.info(t('fill.clipboardCleared'));
        } else {
          ElMessage.warning(t('fill.clipboardClearFailed'));
        }
      } catch (fallbackError) {
        logger.error('自动清除剪贴板失败:', fallbackError);
        ElMessage.warning(t('fill.clipboardClearFailed'));
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
   * 向所有 frame 发送 TOTP 验证码填充消息，返回首个成功响应（均失败时返回首个响应以展示提示）
   * @param tabId 标签页ID
   * @param frameIds 所有 frame ID 列表
   * @param code 本地计算得到的动态验证码
   * @returns FillResult 或 null
   */
  const fillTotpInAllFrames = async (tabId: number, frameIds: number[], code: string): Promise<FillResult | null> => {
    const results = await Promise.allSettled(
      frameIds.map(frameId =>
        chrome.tabs.sendMessage(tabId, { type: MessageType.FILL_TOTP, data: { code } }, { frameId }),
      ),
    );

    let firstResponse: FillResult | null = null;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const response = result.value as FillResult | undefined;
        if (response?.success) {
          return response;
        }
        if (response && !firstResponse) {
          firstResponse = response;
        }
      }
    }

    return firstResponse;
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
        ElMessage.error(t('fill.noTabInfo'));
        return;
      }

      const tabId = tab.id;
      const autoLogin = options?.autoLogin ?? false;

      // 获取「顶层 + 同主域名」可填充 frame 集合：检测（PING）与填充（FILL）复用同一集合，
      // 既命中同站 iframe 内嵌登录表单，又避免向跨域第三方 iframe 广播明文凭证
      const frameIds = await getFillableFrameIds(tabId);

      // 步骤1: 先检查各 frame 中 content script 是否已就绪（通过 PING）
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
          ElMessage.error(t('fill.injectFailed'));
          return;
        }

        pingResponse = await pingAllFrames(tabId, frameIds);
        if (!pingResponse) {
          ElMessage.error(t('fill.scriptNotReady'));
          return;
        }
      }

      // 步骤3: 检查各 frame 中是否已检测到字段，如果没有则等待
      const hasFields =
        pingResponse.fieldsDetected &&
        (pingResponse.fieldsDetected.username > 0 ||
          pingResponse.fieldsDetected.password > 0 ||
          pingResponse.fieldsDetected.mobile > 0);

      if (!hasFields) {
        const detected = await waitForFieldsDetected(tabId, 3, frameIds);
        if (!detected) {
          ElMessage.warning(t('fill.noLoginForm'));
          return;
        }
      }

      // 步骤4: 向可填充 frame 集合发送填充消息，取第一个成功的响应
      const fillData = {
        username: password.username,
        password: password.password,
        autoLogin,
      };
      const response = await fillPasswordInFrames(tabId, frameIds, fillData);

      // 步骤5: 根据响应显示结果
      if (response && response.success) {
        ElMessage.success(response.message || t('fill.fillSuccess'));
        // 填充成功时，刷新 lastUsedAt（"最近使用"排序依据）和 favoriteUsedAt（LRU 依据）
        const now = Date.now();
        if (passwords?.value) {
          const entry = passwords.value.find(p => p.id === password.id);
          if (entry) {
            entry.lastUsedAt = now;
            if (password.favorite) entry.favoriteUsedAt = now;
          }
        }
        // 后台持久化，不阻塞填充流程：委托 background SW 上下文执行防抖写入，
        // 因为填充成功后立即隐藏面板，sidepanel 页面上下文中的防抖定时器
        // 会随页面卸载被销毁导致 lastUsedAt 丢失（"最近使用"排序不更新）
        chrome.runtime
          .sendMessage({
            type: MessageType.UPDATE_PASSWORD_METADATA,
            data: {
              id: password.id,
              updates: {
                lastUsedAt: now,
                ...(password.favorite ? { favoriteUsedAt: now } : {}),
              },
            },
          })
          .catch(error => logger.error('更新使用时间戳失败:', error));
        // 隐藏侧边栏（必须携带 tabId，因为 sidepanel 发出的消息 sender.tab 为 undefined）
        await chrome.runtime.sendMessage({
          type: MessageType.HIDE_SIDEPANEL,
          data: { tabId },
        });
      } else {
        const rawMsg = response?.message || '';
        // 优先用结构化 reason 判断（跨语言稳定）；字符串匹配保留作旧版本 content script 兜底
        const isNoForm = response?.reason === 'no_form' || rawMsg.includes('未检测到登录表单');
        const errorMsg = isNoForm ? t('fill.noLoginForm') : rawMsg;
        ElMessage.warning(errorMsg);
      }
    } catch (error: any) {
      logger.error('填充密码失败:', error);
      if (error.message && error.message.includes('Could not establish connection')) {
        ElMessage.error(t('fill.connectFailed'));
      } else {
        ElMessage.error(t('fill.fillFailed'));
      }
    }
  };

  /**
   * 填充密码并自动触发登录
   */
  const handleFillAndLogin = (password: PasswordEntry) => {
    fillPassword(password, { autoLogin: true });
  };

  // ==================== 填充 / 复制 TOTP 验证码 ====================

  /**
   * 填充条目的 TOTP 两步验证码到当前页面
   *
   * 本地计算当前动态码 → 确保 content script 就绪 → 向可填充 frame 集合发送 FILL_TOTP。
   * @param password 目标密码条目
   */
  const fillTotp = async (password: PasswordEntry) => {
    if (!password.totp || !password.totp.trim()) {
      ElMessage.warning(t('fill.noTotpConfigured'));
      return;
    }

    let code: string;
    try {
      code = await generateTotpCode(password.totp);
    } catch (error) {
      logger.error('生成验证码失败:', error);
      ElMessage.error(t('fill.totpGenerateFailed'));
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        ElMessage.error(t('fill.noTabInfo'));
        return;
      }
      const tabId = tab.id;
      const frameIds = await getFillableFrameIds(tabId);

      // 确保 content script 就绪（必要时注入）
      let pingResponse = await pingAllFrames(tabId, frameIds);
      if (!pingResponse) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/content.js'],
          });
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (injectError) {
          logger.error('Content script 注入失败:', injectError);
          ElMessage.error(t('fill.injectFailed'));
          return;
        }
        pingResponse = await pingAllFrames(tabId, frameIds);
        if (!pingResponse) {
          ElMessage.error(t('fill.scriptNotReady'));
          return;
        }
      }

      const response = await fillTotpInAllFrames(tabId, frameIds, code);
      if (response && response.success) {
        ElMessage.success(response.message || t('fill.totpFillSuccess'));
        await chrome.runtime.sendMessage({
          type: MessageType.HIDE_SIDEPANEL,
          data: { tabId },
        });
      } else {
        ElMessage.warning(response?.message || t('fill.noTotpInput'));
      }
    } catch (error: any) {
      logger.error('填充验证码失败:', error);
      ElMessage.error(t('fill.totpFillFailed'));
    }
  };

  /**
   * 复制条目的 TOTP 两步验证码到剪贴板
   * 验证码 30 秒自失效，不挂自动清除定时器
   *
   * 注意：先异步生成动态码（Web Crypto）会耗掉侧边栏的瞬时用户激活/文档聚焦，
   * 导致 Async Clipboard API 可能抛错；因此失败时降级到 execCommand 兑底（与 clearClipboard 一致）。
   * @param password 目标密码条目
   */
  const copyTotp = async (password: PasswordEntry) => {
    if (!password.totp || !password.totp.trim()) {
      ElMessage.warning(t('fill.noTotpConfigured'));
      return;
    }

    let code: string;
    try {
      code = await generateTotpCode(password.totp);
    } catch (error) {
      logger.error('生成验证码失败:', error);
      ElMessage.error(t('fill.totpGenerateFailed'));
      return;
    }

    // 优先 Async Clipboard API（需文档聚焦）；因上方 await 生成可能丢失瞬时激活，失败时降级 execCommand
    try {
      await navigator.clipboard.writeText(code);
      ElMessage.success(t('fill.totpCopied'));
      return;
    } catch {
      logger.info('Async Clipboard 写入失败（可能文档失焦），降级 execCommand');
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        ElMessage.success(t('fill.totpCopied'));
      } else {
        ElMessage.error(t('fill.totpCopyFailed'));
      }
    } catch (fallbackError) {
      logger.error('复制验证码失败:', fallbackError);
      ElMessage.error(t('fill.totpCopyFailed'));
    }
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
      ElMessage.error(t('fill.openEditFailed'));
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
      ElMessage.success(t('fill.usernameCopied'));
      // 取消密码自动清除定时器，避免误清除刚复制的用户名
      cancelPendingClear();
    } catch (error) {
      logger.error('复制用户名失败:', error);
      ElMessage.error(t('fill.usernameCopyFailed'));
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
      ElMessage.success(t('fill.passwordCopied'));
      // 记录当前密码快照，用于定时器触发时验证剪贴板内容
      copiedPasswordSnapshot = password;
      // 启动自动清除定时器
      scheduleClearClipboard();
    } catch (error) {
      logger.error('复制密码失败:', error);
      ElMessage.error(t('fill.passwordCopyFailed'));
    }
  };

  return {
    fillPassword,
    handleFillAndLogin,
    fillTotp,
    copyTotp,
    handleEditPassword,
    copyUsername,
    copyPassword,
  };
}
