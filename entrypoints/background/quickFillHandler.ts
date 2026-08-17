/**
 * 一键填充快捷键处理模块
 *
 * 处理 quick_fill 快捷键命令与 popup 的 QUICK_FILL 消息：
 * - 会话未验证 → 就地展开内联下拉面板（自带锁定态解锁引导），
 *   页面不可达或无登录字段时回退通知用户先验证主密码
 * - 当前域名无匹配 → 通知无匹配账号
 * - 有匹配（1 条或多条）→ 直接填充侧边栏展示顺序的第一条
 *   （域名匹配优先 + 收藏置顶 + 侧边栏排序配置，与侧边栏列表首条一致）
 * - 填充结果经 FillResult.success 校验后如实反馈，不再假报成功
 *
 * 反馈通道：桌面通知 + 工具栏图标角标（badge）双通道，
 * 规避 macOS 等系统级通知被关闭时用户"完全无感知"的问题。
 *
 * 会话检查优先走同步快路径（isSessionActiveSync），SW 冷启动后模块状态
 * 为空时才回退异步 isSessionValid() 从 storage 恢复会话，减少热路径延迟。
 *
 * @module entrypoints/background/quickFillHandler
 */

import { logger } from '@/utils/logger';
import { tl } from '@/utils/i18n-lite';
import { MessageType } from '@/utils/types';
import { isSessionValid, isSessionActiveSync } from '@/utils/sessionManager-storage';
import { getFillableFrameIds, fillPasswordInFrames } from '@/utils/frameFill';
import {
  ensureCredentialAccessAfterStartupRelock,
  getCachedPasswords,
  getOrWarmCache,
  sortMatchesForDomain,
  recordPendingTotpIfEligible,
} from './passwordCache';

/** 通知 ID 前缀 */
const NOTIFICATION_ID = 'quick-fill';

/** badge 角标自动清除延时（毫秒） */
const BADGE_CLEAR_DELAY_MS = 3000;

/**
 * 显示桌面通知
 * @param message 通知内容
 * @param title 通知标题（默认「一键填充」，供内联下拉等复用方覆盖）
 */
async function showNotification(message: string, title?: string): Promise<void> {
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: title ?? tl('bg.quickFill.title'),
      message,
    });
  } catch (error) {
    logger.error('Background: 一键填充通知创建失败:', error);
  }
}

/**
 * 在扩展工具栏图标上短暂显示结果角标
 *
 * 不依赖系统通知的兜底反馈通道：系统通知被关闭（macOS 常见）时，
 * 用户仍能通过工具栏角标感知填充成功/失败。
 *
 * 角标为全局单例状态：显示前快照既有角标（如版本更新的持久 "new" 蓝底角标，
 * 见 backgroundServices.showUpdateBadge），延时后恢复原角标与背景色而非直接清空，
 * 避免临时反馈永久抹掉持久角标。
 *
 * @param success 是否成功（✓ 绿色 / ! 红色）
 */
async function showBadgeFeedback(success: boolean): Promise<void> {
  try {
    const prevText = await chrome.action.getBadgeText({}).catch(() => '');
    await chrome.action.setBadgeBackgroundColor({ color: success ? '#67c23a' : '#f56c6c' }).catch(() => {});
    await chrome.action.setBadgeText({ text: success ? '✓' : '!' }).catch(() => {});
    setTimeout(() => {
      // 恢复既有角标（版本更新角标为蓝底，颜色与 showUpdateBadge 保持一致），无则清空
      void chrome.action.setBadgeBackgroundColor({ color: '#409eff' }).catch(() => {});
      void chrome.action.setBadgeText({ text: prevText }).catch(() => {});
    }, BADGE_CLEAR_DELAY_MS);
  } catch (error) {
    logger.debug('Background: 一键填充角标反馈失败:', error);
  }
}

/**
 * 统一的失败反馈：桌面通知 + 失败角标
 *
 * 导出供内联下拉快捷键处理（inlineDropdownHandler）复用同一反馈通道。
 * @param message 通知内容
 * @param title 通知标题（默认「一键填充」）
 */
export async function notifyFailure(message: string, title?: string): Promise<void> {
  void showBadgeFeedback(false);
  await showNotification(message, title);
}

/**
 * 获取当前活跃标签页
 *
 * 导出供内联下拉快捷键处理（inlineDropdownHandler）复用。
 * @returns 活跃标签页或 null
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] ?? null;
  } catch (error) {
    logger.error('Background: 获取活跃标签页失败:', error);
    return null;
  }
}

/**
 * 从标签页 URL 中提取 hostname
 * @param url 标签页 URL
 * @returns hostname 或空字符串
 */
function extractHostname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 派生条目展示标题（与内联下拉 getMatchingAccounts 的标题规则一致）
 * @param entry 密码条目
 * @returns 展示标题
 */
function deriveEntryTitle(entry: { tag?: string; url?: string; username?: string }): string {
  return (
    (entry.tag && entry.tag.trim()) || (entry.url && entry.url.trim()) || entry.username || tl('bg.cache.untitled')
  );
}

/**
 * 处理一键填充（快捷键命令 / popup QUICK_FILL 消息共用入口）
 *
 * 完整流程：
 * 1. 复用命令回调提供的 tab（无则查询当前活跃标签页）并提取域名
 * 2. 验证会话有效性（同步快路径优先），失效时就地展开内联下拉面板引导解锁
 * 3. 从缓存获取密码列表，按侧边栏展示顺序过滤排序
 * 4. PING 顶层 frame 确认 content script 可达（旧标签页未注入时引导刷新）
 * 5. 填充排序首条，校验 FillResult 后如实反馈（通知 + badge）
 *
 * @param commandTab 快捷键命令回调提供的标签页（可选，popup 消息路径无此参数）
 */
export async function handleQuickFill(commandTab?: chrome.tabs.Tab): Promise<void> {
  // 快捷键与 popup 都可能在 onStartup clearSession 完成前触发；必须在恢复旧持久
  // 会话或读取 SW 明文缓存之前经过同一启动安全门。
  if (!(await ensureCredentialAccessAfterStartupRelock())) {
    await notifyFailure(tl('bg.quickFill.sessionExpired'));
    return;
  }

  // 优先复用 onCommand 回调提供的 tab，避免冗余查询与窗口焦点竞态
  const tab = commandTab?.id ? commandTab : await getActiveTab();
  if (!tab?.id) {
    logger.warn('Background: 一键填充 - 无法获取当前标签页');
    return;
  }
  const tabId = tab.id;

  const hostname = extractHostname(tab.url);
  if (!hostname) {
    await notifyFailure(tl('bg.quickFill.noUrl'));
    return;
  }

  // 检查会话有效性：优先同步快路径，SW 冷启动后模块状态为空时
  // 才回退到异步 isSessionValid() 从 storage 恢复会话
  if (!isSessionActiveSync()) {
    const sessionValid = await isSessionValid();
    if (!sessionValid) {
      // 会话失效时不仅通知，而是就地展开内联下拉面板：面板自带锁定态
      // 「解锁后填充」引导，点击直达主密码验证，比纯通知更可操作。
      // 动态 import 避免与 inlineDropdownHandler（其静态导入本模块的
      // getActiveTab/notifyFailure）形成循环依赖
      const { tryOpenInlineDropdown } = await import('./inlineDropdownHandler');
      const opened = await tryOpenInlineDropdown(tabId);
      if (opened !== 'opened') {
        // 页面不可达 / 无登录字段时回退原通知链路，确保用户有感知
        await notifyFailure(tl('bg.quickFill.sessionExpired'));
      }
      return;
    }
  }

  // 获取密码列表（优先缓存，降级到全量解密）
  let passwords;
  const cached = await getCachedPasswords();
  if (cached && cached.isAuthenticated) {
    passwords = cached.passwords;
  } else {
    const warmed = await getOrWarmCache();
    passwords = warmed?.passwords ?? [];
  }

  // 按域名过滤并按侧边栏展示顺序排序（域名匹配优先 + 收藏置顶 + 排序配置），
  // 首条即侧边栏列表第一条
  const matched = await sortMatchesForDomain(passwords, hostname);

  if (matched.length === 0) {
    await notifyFailure(tl('bg.quickFill.noMatch'));
    return;
  }

  // 可达性探测：content script 未注入（扩展更新/重载后的旧标签页）时
  // sendMessage 抛 "Could not establish connection"，引导用户刷新页面
  try {
    await chrome.tabs.sendMessage(tabId, { type: MessageType.PING }, { frameId: 0 });
  } catch {
    await notifyFailure(tl('bg.quickFill.pageNotReady'));
    return;
  }

  // 填充排序首条：逐 frame 并行下发（与侧边栏填充路径一致），校验填充结果
  const entry = matched[0];
  try {
    const frameIds = await getFillableFrameIds(tabId);
    const result = await fillPasswordInFrames(tabId, frameIds, {
      username: entry.username,
      password: entry.password,
      autoLogin: false,
    });

    if (!result?.success) {
      logger.debug('Background: 一键填充失败，页面无可填字段或填充被拒');
      await notifyFailure(tl('bg.quickFill.fillFailed'));
      return;
    }

    void showBadgeFeedback(true);
    // 两步接力：条目开启了两步验证时记录待接力标记，
    // 供同域名验证码页（GitHub 式二步登录第二页）自动呈活码胶囊；失败仅降级为不接力
    if (entry.totp && entry.totp.trim()) {
      void recordPendingTotpIfEligible(tabId, entry.id);
    }
    // 多条匹配时明确告知填充了哪条、共几条匹配，可打开侧边栏切换
    if (matched.length > 1) {
      await showNotification(tl('bg.quickFill.multiMatch', { title: deriveEntryTitle(entry), count: matched.length }));
    } else {
      await showNotification(tl('bg.quickFill.fillSuccess'));
    }

    // 静默更新最近使用时间
    const { updatePasswordInSession } = await import('@/utils/storage/passwordCrud');
    const now = Date.now();
    void updatePasswordInSession(entry.id, {
      lastUsedAt: now,
      ...(entry.favorite ? { favoriteUsedAt: now } : {}),
    }).catch(error => logger.error('Background: 一键填充更新最近使用时间失败:', error));
  } catch (error) {
    logger.error('Background: 一键填充发送填充消息失败:', error);
    await notifyFailure(tl('bg.quickFill.fillFailed'));
  }
}
