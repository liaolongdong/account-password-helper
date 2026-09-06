/**
 * 右键菜单填充目标记忆与执行
 *
 * 右键菜单的填充对象是「用户右键点击的那个输入框」，但 chrome.contextMenus
 * 的点击回调只能拿到 frameId、拿不到具体元素，因此由 content script 在
 * contextmenu 事件时记录可编辑目标，收到 background 下发的
 * CONTEXT_MENU_FILL 消息后就地填充。
 *
 * 每个 frame 独立维护自己的目标引用（content script allFrames 注入），
 * background 通过 tabs.sendMessage({ frameId }) 精确下发到右键发生的 frame。
 *
 * @module entrypoints/content/contextMenuTarget
 */

import type { ContextMenuFillData } from '@/utils/types';
import { tl } from '@/utils/i18n-lite';
import { logger } from '@/utils/logger';
import { InputFiller, type FillableFormControl } from '@/entrypoints/content/InputFiller';
import { isElementVisible } from './domUtils';

/** 右键菜单填充结果（与 FormDetector 其余填充处理器的响应形状保持一致） */
export interface ContextMenuFillResult {
  success: boolean;
  message?: string;
}

/** 最近一次右键点击的可编辑目标（每个 frame 独立） */
let lastContextMenuTarget: FillableFormControl | null = null;

/** 最近一次右键目标是否为不支持填充的可编辑区域（如 contenteditable 富文本） */
let lastContextMenuUnsupported = false;

/**
 * 记录右键点击的可编辑目标
 *
 * 由 content 入口的 contextmenu 捕获监听调用。仅接受 input / textarea；
 * Chrome 的 editable 右键上下文还包含 contenteditable，本扩展暂不支持，
 * 置空目标并记录不支持标记，填充时据此给出准确文案。
 *
 * @param target 右键事件目标元素
 */
export function rememberContextMenuTarget(target: EventTarget | null): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    lastContextMenuTarget = target;
    lastContextMenuUnsupported = false;
    return;
  }
  lastContextMenuTarget = null;
  lastContextMenuUnsupported = target instanceof HTMLElement && target.isContentEditable;
}

/**
 * 解析当前仍有效的右键目标
 *
 * SPA 重渲染、元素移除或站点隐藏字段都会使缓存引用失效，
 * 必须校验连接性、可见性与可编辑性后再填充。
 *
 * @returns 可填充目标或 null
 */
function resolveContextMenuTarget(): FillableFormControl | null {
  const target = lastContextMenuTarget;
  if (!target || !target.isConnected || !isElementVisible(target)) return null;
  if (target.disabled || target.readOnly) return null;
  return target;
}

/** 复用输入框填充器的多策略赋值（原生 setter → execCommand → 逐字符） */
const inputFiller = new InputFiller();

/**
 * 解析当前仍有效的右键目标输入框（供内联下拉锚定使用）
 *
 * 与填充路径共用同一套有效性校验（连接性 / 可见性 / 可编辑），额外收窄到
 * HTMLInputElement：内联面板的锚定 API 只接受 input（textarea 无钥匙图标先例）。
 * 会话失效时把解锁面板锚定到用户右键的那个框，比回退到「首个检测到的登录字段」
 * 更贴合用户当时的注意力落点。
 *
 * @returns 可锚定的输入框，无有效右键目标时为 null
 */
export function resolveContextMenuInputTarget(): HTMLInputElement | null {
  const target = resolveContextMenuTarget();
  return target instanceof HTMLInputElement ? target : null;
}

/**
 * 执行右键菜单填充：把 background 解析好的值填入被右键的输入框
 *
 * @param data 填充载荷（动作类型 + 明文值）
 * @returns 填充结果；失败时附带用户可理解的文案（经 content 侧 i18n-lite 渲染）
 */
export async function fillContextMenuTarget(data: ContextMenuFillData): Promise<ContextMenuFillResult> {
  // 边界校验：消息载荷视为不可信输入，非法载荷安全降级
  if (!data || typeof data.value !== 'string') {
    return { success: false, message: tl('cs.cm.fillFailed') };
  }

  const target = resolveContextMenuTarget();
  if (!target) {
    return { success: false, message: tl(lastContextMenuUnsupported ? 'cs.cm.notEditable' : 'cs.cm.noTarget') };
  }

  try {
    const result = await inputFiller.setInputValueWithStrategies(target, data.value);
    if (result.filled) {
      return { success: true };
    }
    return { success: false, message: tl('cs.cm.fillFailed') };
  } catch (error) {
    logger.error('右键菜单填充失败:', error);
    return { success: false, message: tl('cs.cm.fillFailed') };
  }
}
