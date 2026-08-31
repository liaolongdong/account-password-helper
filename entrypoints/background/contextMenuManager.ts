/**
 * 右键上下文菜单管理模块
 *
 * 提供第四种填充入口：在输入框上右键直接填充，无需先唤起面板。
 *
 * 菜单结构（Chrome 自动归组到扩展名下）：
 * - 可编辑元素（editable）：填充用户名 / 填充密码 / 填充两步验证码 / 生成并填充强密码
 * - 页面空白处（page）：打开侧边栏 / 打开密码管理页
 *
 * 填充语义与一键填充一致：按当前标签页域名匹配最优条目（侧边栏展示顺序首条），
 * 多条匹配时取第一条。明文仅经 tabs.sendMessage 定向下发到右键发生的 frame，
 * 下发前经 isFrameFillable 门控（与 FILL_BY_ID 同一道防线）。
 *
 * 反馈策略：成功仅显示工具栏角标（填充本身在输入框内可见，避免通知打扰）；
 * 失败经「通知 + 角标」双通道反馈（复用一键填充的 notifyFailure）。
 *
 * @module entrypoints/background/contextMenuManager
 */

import { logger } from '@/utils/logger';
import { tl, onLiteLocaleChanged } from '@/utils/i18n-lite';
import { MessageType, type ContextMenuFillAction, type PasswordEntry } from '@/utils/types';
import { isSessionValid, isSessionActiveSync } from '@/utils/sessionManager-storage';
import { isFrameFillable } from '@/utils/frameFill';
import { generatePassword } from '@/utils/passwordGenerator';
import { notifyFailure, showBadgeFeedback, extractHostname, extractPortFromUrl } from './quickFillHandler';
import { openOptionsPage } from './optionsPageManager';
import { openSidePanelAndRespond } from './sidePanelManager';
import {
  ensureCredentialAccessAfterStartupRelock,
  getCachedPasswords,
  getOrWarmCache,
  sortMatchesForDomain,
  getInlineTotpCode,
  recordPendingTotpIfEligible,
} from './passwordCache';

/** 菜单项 ID 与填充动作的映射（open* 两项无填充动作） */
const MENU_IDS = {
  fillUsername: 'aph-cm-fill-username',
  fillPassword: 'aph-cm-fill-password',
  fillTotp: 'aph-cm-fill-totp',
  generatePassword: 'aph-cm-generate-password',
  openSidepanel: 'aph-cm-open-sidepanel',
  openOptions: 'aph-cm-open-options',
} as const;

/** 填充类菜单项 ID → 填充动作 */
const FILL_ACTION_BY_MENU_ID: Record<string, ContextMenuFillAction> = {
  [MENU_IDS.fillUsername]: 'username',
  [MENU_IDS.fillPassword]: 'password',
  [MENU_IDS.fillTotp]: 'totp',
  [MENU_IDS.generatePassword]: 'generate',
};

/** 菜单项定义（标题经 i18n-lite 按当前语言渲染，语言切换时整体重建） */
function buildMenuItems(): chrome.contextMenus.CreateProperties[] {
  // Firefox 等无 sidePanel API 的环境不展示「打开侧边栏」，避免点击无反应的死菜单项
  const pageItems: chrome.contextMenus.CreateProperties[] = [];
  if (chrome.sidePanel) {
    pageItems.push({ id: MENU_IDS.openSidepanel, title: tl('cm.openSidepanel'), contexts: ['page'] });
  }
  pageItems.push({ id: MENU_IDS.openOptions, title: tl('cm.openOptions'), contexts: ['page'] });

  return [
    { id: MENU_IDS.fillUsername, title: tl('cm.fillUsername'), contexts: ['editable'] },
    { id: MENU_IDS.fillPassword, title: tl('cm.fillPassword'), contexts: ['editable'] },
    { id: MENU_IDS.fillTotp, title: tl('cm.fillTotp'), contexts: ['editable'] },
    { id: MENU_IDS.generatePassword, title: tl('cm.generatePassword'), contexts: ['editable'] },
    ...pageItems,
  ];
}

/** 并发重建互斥：语言切换与初始化竞态时只执行一轮重建 */
let _rebuildInFlight: Promise<void> | null = null;

/** Promise 化 removeAll（callback 形式兼容所有类型定义版本） */
function removeAllMenus(): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.contextMenus.removeAll(() => resolve());
    } catch (error) {
      logger.debug('Background: 清除右键菜单失败:', error);
      resolve();
    }
  });
}

/** Promise 化 create 并吞掉重复 ID 等预期错误（removeAll 后正常不会出现） */
function createMenuItem(item: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.contextMenus.create(item, () => {
        if (chrome.runtime.lastError) {
          logger.debug('Background: 创建右键菜单项失败: ' + chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (error) {
      logger.debug('Background: 创建右键菜单项异常:', error);
      resolve();
    }
  });
}

/**
 * 重建全部右键菜单（清除旧项后按当前语言重建）
 */
function rebuildContextMenus(): Promise<void> {
  if (_rebuildInFlight) return _rebuildInFlight;
  _rebuildInFlight = (async () => {
    try {
      await removeAllMenus();
      for (const item of buildMenuItems()) {
        await createMenuItem(item);
      }
    } catch (error) {
      logger.error('Background: 重建右键菜单失败:', error);
    } finally {
      _rebuildInFlight = null;
    }
  })();
  return _rebuildInFlight;
}

/** 右键菜单失败反馈统一入口（标题固定为「右键填充」，正文复用既有文案） */
async function notifyContextMenuFailure(message: string): Promise<void> {
  await notifyFailure(message, tl('cm.title'));
}

/**
 * 解析填充动作对应的条目与明文值（纯函数，便于单元测试）
 *
 * - generate：不依赖条目，现场生成强密码
 * - username/password：取侧边栏展示顺序首条（域名匹配优先 + 收藏置顶 + 排序配置）
 *
 * TOTP 动作需要异步计算动态码，由调用方分支处理；类型上收窄为排除 'totp'，
 * 杜绝误传时静默返回密码。
 *
 * @param matched 当前域名匹配并排序后的条目列表
 * @param action 填充动作（不含 totp）
 * @returns ok 形态携带条目与明文值；errorKey 形态携带失败文案的 i18n key
 */
export function resolveContextMenuFill(
  matched: PasswordEntry[],
  action: Exclude<ContextMenuFillAction, 'totp'>,
): { ok: true; entry: PasswordEntry | null; value: string } | { ok: false; errorKey: string } {
  if (action === 'generate') {
    return { ok: true, entry: null, value: generatePassword() };
  }
  if (matched.length === 0) {
    return { ok: false, errorKey: 'bg.quickFill.noMatch' };
  }
  const entry = matched[0];
  const value = action === 'username' ? entry.username : entry.password;
  if (!value) {
    return { ok: false, errorKey: 'bg.quickFill.fillFailed' };
  }
  return { ok: true, entry, value };
}

/**
 * 处理填充类菜单项点击：会话门控 → 域名匹配 → 解析明文 → 定向下发 → 反馈
 *
 * @param action 填充动作
 * @param tab 右键发生的标签页
 * @param frameId 右键发生的 frame ID（undefined 视为顶层）
 */
async function handleContextMenuFill(
  action: ContextMenuFillAction,
  tab: chrome.tabs.Tab | undefined,
  frameId: number | undefined,
): Promise<void> {
  // 浏览器启动重锁安全门：与一键填充同一道防线
  if (!(await ensureCredentialAccessAfterStartupRelock())) {
    await notifyContextMenuFailure(tl('bg.quickFill.sessionExpired'));
    return;
  }

  const tabId = tab?.id;
  if (!tabId || !tab?.url) {
    await notifyContextMenuFailure(tl('bg.quickFill.noUrl'));
    return;
  }
  const hostname = extractHostname(tab.url);
  if (!hostname) {
    await notifyContextMenuFailure(tl('bg.quickFill.noUrl'));
    return;
  }

  if (!isSessionActiveSync()) {
    const sessionValid = await isSessionValid();
    if (!sessionValid) {
      await notifyContextMenuFailure(tl('bg.quickFill.sessionExpired'));
      return;
    }
  }

  // 获取密码列表（优先缓存，降级到全量解密）
  let passwords: PasswordEntry[];
  const cached = await getCachedPasswords();
  if (cached && cached.isAuthenticated) {
    passwords = cached.passwords;
  } else {
    passwords = (await getOrWarmCache())?.passwords ?? [];
  }

  const matched = await sortMatchesForDomain(passwords, hostname, extractPortFromUrl(tab.url));

  // 解析明文值：TOTP 单独处理（需异步计算动态码），其余经纯函数解析
  let entry: PasswordEntry | null;
  let value: string;
  if (action === 'totp') {
    entry = matched.find(e => e.totp && e.totp.trim()) ?? null;
    if (!entry) {
      await notifyContextMenuFailure(tl('cm.noTotpEntry'));
      return;
    }
    const totp = await getInlineTotpCode(entry.id);
    if (!totp) {
      await notifyContextMenuFailure(tl('cm.noTotpEntry'));
      return;
    }
    value = totp.code;
  } else {
    const resolution = resolveContextMenuFill(matched, action);
    if (!resolution.ok) {
      await notifyContextMenuFailure(tl(resolution.errorKey));
      return;
    }
    entry = resolution.entry;
    value = resolution.value;
  }

  // 安全：仅顶层或与顶层同主域名的 frame 可接收明文（与 FILL_BY_ID 同一道防线）
  if (!(await isFrameFillable(tabId, frameId))) {
    await notifyContextMenuFailure(tl('cm.frameNotFillable'));
    return;
  }

  let response: { success?: boolean; message?: string } | undefined;
  try {
    response = await chrome.tabs.sendMessage(
      tabId,
      { type: MessageType.CONTEXT_MENU_FILL, data: { action, value } },
      { frameId: frameId ?? 0 },
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // 页面导航/扩展更新后 content script 未注入，引导刷新（与一键填充一致）
    if (errorMsg.includes('Receiving end does not exist')) {
      await notifyContextMenuFailure(tl('bg.quickFill.pageNotReady'));
    } else {
      logger.error('Background: 右键菜单填充消息下发失败:', error);
      await notifyContextMenuFailure(tl('bg.quickFill.fillFailed'));
    }
    return;
  }

  if (!response?.success) {
    await notifyContextMenuFailure(response?.message || tl('bg.quickFill.fillFailed'));
    return;
  }

  // 成功：仅角标反馈（填充结果在输入框内可见，不再弹通知打扰）
  void showBadgeFeedback(true);

  if (entry) {
    // 两步接力：账密填充成功且条目配置了两步验证时记录待接力标记
    // （TOTP 填充本身不接力；与 FILL_BY_ID / 一键填充行为一致）
    if (action !== 'totp' && entry.totp && entry.totp.trim()) {
      void recordPendingTotpIfEligible(tabId, entry.id);
    }
    // 静默更新最近使用时间（与侧边栏/一键填充路径一致，保持排序与 LRU 依据）
    const entryId = entry.id;
    const entryFavorite = entry.favorite;
    void import('@/utils/storage/passwordCrud')
      .then(({ updatePasswordInSession }) => {
        const now = Date.now();
        return updatePasswordInSession(entryId, {
          lastUsedAt: now,
          ...(entryFavorite ? { favoriteUsedAt: now } : {}),
        });
      })
      .catch(error => logger.error('Background: 右键菜单填充更新最近使用时间失败:', error));
  }
}

/**
 * 右键菜单点击统一分发
 *
 * @param info 菜单点击信息（含菜单项 ID 与右键发生的 frameId）
 * @param tab 右键发生的标签页
 */
async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  try {
    if (info.menuItemId === MENU_IDS.openSidepanel) {
      if (!tab?.id || !chrome.sidePanel) return;
      openSidePanelAndRespond(
        tab.id,
        response => {
          // 打开失败（手势未透传、特殊页面等）不能静默，经「通知 + 角标」反馈
          if (!response?.success) {
            void notifyContextMenuFailure(tl('cm.openSidepanelFailed'));
          }
        },
        { trigger: 'context' },
      );
      return;
    }
    if (info.menuItemId === MENU_IDS.openOptions) {
      await openOptionsPage();
      return;
    }
    const action = FILL_ACTION_BY_MENU_ID[String(info.menuItemId)];
    if (action) {
      await handleContextMenuFill(action, tab, info.frameId);
    }
  } catch (error) {
    logger.error('Background: 右键菜单点击处理失败:', error);
  }
}

/** 是否已注册过点击监听（SW 单次生命周期内幂等） */
let _clickListenerRegistered = false;

/**
 * 初始化右键上下文菜单
 *
 * 在 SW 启动时调用：立即按当前语言创建菜单（默认中文兜底），
 * 语言偏好异步加载完成或运行中切换时经 onLiteLocaleChanged 重建。
 * 项目保活策略使 SW 常驻，本函数每个浏览器会话实际只执行一次。
 */
export function setupContextMenu(): void {
  if (!chrome.contextMenus) {
    // 防御：个别环境（如部分 Firefox 配置文件）API 不可用时静默跳过
    return;
  }

  if (!_clickListenerRegistered) {
    _clickListenerRegistered = true;
    chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
  }

  void rebuildContextMenus();
  onLiteLocaleChanged(() => {
    void rebuildContextMenus();
  });
}
