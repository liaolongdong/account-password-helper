import { logger } from '@/utils/logger';
import { getClipboardConfig } from '@/utils/storage/configManager';

/**
 * 剪贴板复制与自动清除工具（UI 无关）
 *
 * 承载「复制密码后按配置限时自动清除」这一安全承诺的纯机制层：
 * 写入剪贴板、管理自动清除定时器、清除前校验内容未被替换、失焦时降级
 * `document.execCommand`。不依赖 Element Plus / Vue，用户可见反馈由调用方
 * 通过返回值与 {@link ClipboardClearCallback} 注入，便于在不同入口（侧边栏 /
 * 管理页详情抽屉）复用自己的文案与消息组件。
 *
 * 仅在具备 DOM 与 `clipboardWrite` 权限的扩展页面上下文（options / sidepanel /
 * popup）中使用；每个上下文持有独立的模块级定时器状态，互不干扰。
 *
 * @module utils/clipboard
 */

/** 自动清除完成后的回调；`ok` 为 false 表示清除失败，调用方据此提示手动清除 */
export type ClipboardClearCallback = (ok: boolean) => void;

/** 自动清除定时器（模块级，确保同一上下文同一时刻只有一个待执行清除） */
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** 已复制到剪贴板的敏感值快照，用于定时器触发时校验内容是否被用户替换 */
let secretSnapshot: string | null = null;

/**
 * 清除剪贴板
 *
 * 优先 Async Clipboard API（需文档聚焦）；失焦时降级 `document.execCommand('copy')`，
 * 在 `clipboardWrite` 权限加持下无需用户手势即可写入。清除前校验剪贴板内容是否仍为
 * 原始敏感值，避免误清除用户期间新复制的内容；无法读取（失焦）时采纳「尽力清除」策略。
 *
 * @returns 是否成功清除（内容已被替换而跳过时返回 true，视为无需清除）
 */
async function clearClipboard(): Promise<boolean> {
  if (secretSnapshot !== null) {
    try {
      const current = await navigator.clipboard.readText();
      if (current !== secretSnapshot) {
        logger.info('剪贴板内容已变更，跳过自动清除');
        secretSnapshot = null;
        return true;
      }
    } catch {
      // 无法读取剪贴板（文档无焦点）→ 无法验证是否被替换，采纳「尽力清除」：宁可误清也不留密码
      logger.info('无法读取剪贴板内容（文档无焦点），将执行尽力清除');
    }
  }

  try {
    await navigator.clipboard.writeText('');
    return true;
  } catch {
    // Async Clipboard API 需文档聚焦，失焦时降级 execCommand
    // execCommand('copy') 搭配空选择是 no-op，必须写入非空内容才能覆写剪贴板
    try {
      const textarea = document.createElement('textarea');
      textarea.value = '\u200b'; // 零宽空格：视觉等同空，但能让 execCommand 真正写入
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (fallbackError) {
      logger.error('自动清除剪贴板失败:', fallbackError);
      return false;
    }
  }
}

/**
 * 取消待执行的自动清除定时器
 *
 * 复制非敏感内容（用户名 / 网址）时调用，避免定时器误清除刚复制的新内容。
 */
export function cancelPendingClipboardClear(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  secretSnapshot = null;
}

/**
 * 按剪贴板配置启动自动清除定时器
 *
 * 新的复制会先取消上一个定时器，避免多个定时器冲突；仅在配置启用且延时 > 0 时排程。
 *
 * @param onCleared 清除完成后的回调（可选）
 */
async function scheduleClipboardClear(onCleared?: ClipboardClearCallback): Promise<void> {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  try {
    const config = await getClipboardConfig();
    if (config.autoClear && config.clearAfterSeconds > 0) {
      clearTimer = setTimeout(() => {
        clearTimer = null;
        void clearClipboard().then(ok => onCleared?.(ok));
      }, config.clearAfterSeconds * 1000);
    }
  } catch (error) {
    logger.error('读取剪贴板配置失败:', error);
  }
}

/**
 * 复制敏感文本（密码 / 历史密码）到剪贴板，并按配置启动自动清除
 *
 * @param text 明文敏感值；空值直接返回 false，不写入
 * @param onCleared 自动清除完成后的回调（可选，用于 UI 提示「已清除」）
 * @returns 是否成功写入剪贴板
 */
export async function copySecretToClipboard(text: string, onCleared?: ClipboardClearCallback): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    secretSnapshot = text;
    await scheduleClipboardClear(onCleared);
    return true;
  } catch (error) {
    logger.error('复制密码到剪贴板失败:', error);
    return false;
  }
}

/**
 * 复制普通文本（用户名 / 网址等非敏感值）到剪贴板
 *
 * 复制成功后取消待执行的密码自动清除定时器，避免误清除刚复制的普通文本。
 *
 * @param text 待复制文本；空值直接返回 false，不写入
 * @returns 是否成功写入剪贴板
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    cancelPendingClipboardClear();
    return true;
  } catch (error) {
    logger.error('复制文本到剪贴板失败:', error);
    return false;
  }
}
