/**
 * 内联下拉快捷键处理模块
 *
 * 处理 open_inline_dropdown 快捷键命令与 popup 的 OPEN_INLINE_DROPDOWN 消息：
 * 在当前标签页定位登录输入框并直接展开内联填充下拉面板，
 * 与用户点击输入框内钥匙图标的行为完全一致（面板自带锁定态引导，无需前置会话校验）。
 *
 * frame 委派策略（两轮，聚焦优先）：
 * 1. 第一轮仅允许各 frame 锚定「当前聚焦的登录字段」——跨域登录页（登录表单在 iframe 内）
 *    时确保面板展开在用户正在输入的 frame，而非被顶层 frame 的其他字段抢占；
 * 2. 第二轮允许回退到 frame 内检测到的首个登录字段（快捷键按下时焦点不在输入框的场景）。
 * frame 集合复用 getFillableFrameIds（仅顶层及与顶层同主域名的 frame），
 * 与填充路径同一道安全防线，跨域第三方 iframe 不会收到展开指令。
 *
 * @module entrypoints/background/inlineDropdownHandler
 */

import { logger } from '@/utils/logger';
import { tl } from '@/utils/i18n-lite';
import { MessageType } from '@/utils/types';
import { getFillableFrameIds } from '@/utils/frameFill';
import { getActiveTab, notifyFailure } from './quickFillHandler';

/** content 端 OPEN_INLINE_DROPDOWN 的响应形状 */
interface OpenInlineDropdownResponse {
  /** 该 frame 是否已定位到登录字段并展开面板 */
  handled?: boolean;
}

/**
 * 向单个 frame 下发展开指令
 * @param tabId 标签页 ID
 * @param frameId 目标 frame ID
 * @param focusedOnly 是否仅允许锚定当前聚焦的登录字段
 * @returns 该 frame 是否已处理（不可达或未处理均视为 false）
 */
async function dispatchToFrame(tabId: number, frameId: number, focusedOnly: boolean): Promise<boolean> {
  try {
    const res: OpenInlineDropdownResponse | undefined = await chrome.tabs.sendMessage(
      tabId,
      { type: MessageType.OPEN_INLINE_DROPDOWN, data: { focusedOnly } },
      { frameId },
    );
    return res?.handled === true;
  } catch {
    // frame 未注入 content script 或已销毁，跳过
    return false;
  }
}

/**
 * 处理展开内联下拉（快捷键命令 / popup OPEN_INLINE_DROPDOWN 消息共用入口）
 *
 * 完整流程：
 * 1. 复用命令回调提供的 tab（无则查询当前活跃标签页）
 * 2. PING 顶层 frame 确认 content script 可达（旧标签页未注入时引导刷新）
 * 3. 两轮逐 frame 委派：聚焦字段优先 → 回退检测到的首个登录字段
 * 4. 所有 frame 均无登录字段时通知用户（通知 + badge 双通道）
 *
 * @param commandTab 快捷键命令回调提供的标签页（可选，popup 消息路径无此参数）
 */
export async function handleOpenInlineDropdown(commandTab?: chrome.tabs.Tab): Promise<void> {
  // 优先复用 onCommand 回调提供的 tab，避免冗余查询与窗口焦点竞态
  const tab = commandTab?.id ? commandTab : await getActiveTab();
  if (!tab?.id) {
    logger.warn('Background: 内联下拉 - 无法获取当前标签页');
    return;
  }
  const tabId = tab.id;

  // 可达性探测：content script 未注入（扩展更新/重载后的旧标签页）时
  // sendMessage 抛 "Could not establish connection"，引导用户刷新页面
  try {
    await chrome.tabs.sendMessage(tabId, { type: MessageType.PING }, { frameId: 0 });
  } catch {
    await notifyFailure(tl('bg.quickFill.pageNotReady'), tl('bg.inline.title'));
    return;
  }

  const frameIds = await getFillableFrameIds(tabId);

  // 两轮委派：第一轮聚焦字段优先（跨域 iframe 登录场景不被顶层抢占），第二轮回退检测字段
  for (const focusedOnly of [true, false]) {
    for (const frameId of frameIds) {
      if (await dispatchToFrame(tabId, frameId, focusedOnly)) {
        return;
      }
    }
  }

  await notifyFailure(tl('bg.inline.noLoginField'), tl('bg.inline.title'));
}
