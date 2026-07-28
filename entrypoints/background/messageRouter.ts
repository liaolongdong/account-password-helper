import { type RuntimeMessage, MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import {
  getTabIdSync,
  openSidePanelAndRespond,
  closeSidePanelWithResponse,
  isSidePanelOpen,
  getSidePanelPort,
} from './sidePanelManager';
import { openOptionsPage, openOptionsAndSendMessage } from './optionsPageManager';
import {
  getCachedPasswords,
  invalidatePasswordCache,
  getCachedSortConfig,
  warmPasswordCache,
  getOrWarmCache,
  getMatchingAccounts,
  getDecryptedEntryById,
} from './passwordCache';
import { handleAutoSavePassword, handleCheckCredentialStatus } from './autoSaveHandler';
import { handleQuickFill } from './quickFillHandler';
import { handleOpenInlineDropdown } from './inlineDropdownHandler';
import { performUpdateCheck, syncSwKeepaliveAlarm } from './backgroundServices';
import { isFrameFillable } from '@/utils/frameFill';

/**
 * SW 模块加载时刻（epoch 毫秒）
 *
 * GET_INITIAL_DATA 响应体附带 swUptimeMs = Date.now() - _swLoadedAt，
 * 侧边栏环形日志据此判定慢点归属于 SW 冷启动还是解密/storage 读取。
 */
const _swLoadedAt = Date.now();

/**
 * 延迟加载 sessionManager-storage 模块
 *
 * 仅在 GET_INITIAL_DATA（isSessionValid）和 INVALIDATE_PASSWORD_CACHE
 * （invalidateSessionCache / markSessionInvalid / clearSession）路径中使用，
 * 延迟 session/encryption 模块的初始化执行到首次消息到达时。
 * 注：SW 产物被 WXT 内联为单文件，此懒加载不减少冷启动解析/编译量。
 */
let _sessionModule: typeof import('@/utils/sessionManager-storage') | null = null;
async function _getSessionModule(): Promise<typeof import('@/utils/sessionManager-storage')> {
  if (!_sessionModule) {
    _sessionModule = await import('@/utils/sessionManager-storage');
  }
  return _sessionModule;
}

/**
 * 延迟加载 passwordCrud 模块
 *
 * 仅在 GET_INITIAL_DATA 冷路径（缓存未命中时从 storage 读取全量密码列表）中使用。
 */
let _crudModule: typeof import('@/utils/storage/passwordCrud') | null = null;
async function _getCrudModule(): Promise<typeof import('@/utils/storage/passwordCrud')> {
  if (!_crudModule) {
    _crudModule = await import('@/utils/storage/passwordCrud');
  }
  return _crudModule;
}

/**
 * 处理 GET_INITIAL_DATA 请求
 *
 * 在 Background SW 中执行会话验证 + 数据加载 + 排序配置读取，
 * 将结果打包返回给 sidepanel。利用 SW 保活机制（Phase 1）使热路径
 * （isSessionActiveSync → true）在 ~1ms 内完成，消除 Windows 上
 * sidepanel 端的 storage IPC 和加密模块开销。
 *
 * 缓存加速路径：
 * - 热缓存（passwordCache + sortConfig 都已预热）：~1ms 返回
 * - 冷缓存（首次打开）：~100-300ms（storage 读取），完成后自动预热
 *
 * @param domain 当前页面域名（当前未使用，保留兼容性）
 * @returns 包含会话状态、密码列表、排序配置及 SW 侧性能分解（perf）的响应数据
 */
async function handleGetInitialData(_domain?: string) {
  // SW 侧性能分解：处理耗时 + 冷/热启动判定 + 缓存命中标记，
  // 与侧边栏侧 bgPathMs 对照可归因「IPC + SW 唤醒」与「SW 内处理」各自占比
  const _perfStart = performance.now();
  const _buildPerf = (cacheHit: boolean) => ({
    swProcessMs: Math.round((performance.now() - _perfStart) * 10) / 10,
    cacheHit,
    swUptimeMs: Date.now() - _swLoadedAt,
  });

  const { isSessionValid } = await _getSessionModule();
  const sessionValid = await isSessionValid();

  if (!sessionValid) {
    return { sessionValid: false, passwords: [], sortConfig: null, perf: _buildPerf(false) };
  }

  // 快速路径：尝试命中内存缓存（由 warmPasswordCache 或上次 sidepanel 填充）
  const cached = await getCachedPasswords();
  if (cached && cached.isAuthenticated) {
    const sortConfig = await getCachedSortConfig();
    logger.debug('Background: GET_INITIAL_DATA 命中缓存，条目数:' + cached.passwords.length);
    return { sessionValid: true, passwords: cached.passwords, sortConfig, perf: _buildPerf(true) };
  }

  // 冷路径：经 getOrWarmCache 去重执行全量解密并回填缓存，与并发的
  // SIDEPANEL_PRELOAD(warmPasswordCache) 共享同一 in-flight，避免重复 AES-GCM 解密。
  // 始终返回全量列表，由 sidepanel 端做域名过滤和排序（filteredPasswords computed）。
  const [warmed, sortConfig] = await Promise.all([getOrWarmCache(), getCachedSortConfig()]);
  const passwords = warmed?.passwords ?? [];

  return { sessionValid: true, passwords, sortConfig, perf: _buildPerf(false) };
}

/**
 * 处理 FILL_BY_ID：按条目 ID 从缓存取明文，复用 FILL_PASSWORD 下发到发起填充的 frame
 *
 * 安全：明文仅在此刻经 FILL_PASSWORD 瞬时下发到内容脚本所在 frame（与侧边栏填充暴露面一致），
 * 且只能回填发起请求的 tab/frame 自身，无法定向其他标签页；下发前经 isFrameFillable 校验，
 * 仅顶层或与顶层同主域名的 frame 可接收，跨域 iframe（如第三方广告位）会被拒绝，防止越权骗取顶层站点凭证。
 *
 * @param data FILL_BY_ID 载荷（条目 ID 与是否自动登录）
 * @param tabId 发起请求的标签页 ID
 * @param frameId 发起请求的 frame ID（用于精确回填含表单的 frame）
 * @returns 填充结果或失败信息
 */
async function handleFillById(data: { id: string; autoLogin?: boolean }, tabId: number, frameId: number | undefined) {
  // 安全：仅允许顶层或与顶层同主域名的 frame 接收明文凭证，
  // 避免跨域 iframe 伪造登录框骗取顶层站点账密（与侧边栏 getFillableFrameIds 同一道防线）
  if (!(await isFrameFillable(tabId, frameId))) {
    return { success: false, message: '当前 frame 无权填充' };
  }

  const entry = await getDecryptedEntryById(data.id);
  if (!entry) {
    return { success: false, message: '会话已锁定或账号不存在' };
  }

  const fillMessage = {
    type: MessageType.FILL_PASSWORD,
    data: { username: entry.username, password: entry.password, autoLogin: data.autoLogin },
  };
  // 显式定向发起 frame：frameId 缺失时回退顶层（0）而非广播全帧，
  // 与上方 isFrameFillable「仅顶层或同主域名 frame 可接收」的门控语义保持一致
  const result = await chrome.tabs.sendMessage(tabId, fillMessage, { frameId: frameId ?? 0 });

  // 后台静默刷新最近使用时间（不阻塞填充结果），保持“最近使用”排序与 LRU 依据一致
  void _getCrudModule()
    .then(({ updatePasswordInSession }) => {
      const now = Date.now();
      return updatePasswordInSession(entry.id, {
        lastUsedAt: now,
        ...(entry.favorite ? { favoriteUsedAt: now } : {}),
      });
    })
    .catch(error => logger.error('Background: FILL_BY_ID 更新最近使用时间失败:', error));

  return result;
}

/**
 * 判定消息是否来自可信的扩展内部页面上下文（sidepanel/popup/options）
 *
 * 仅扩展自身页面满足：`sender.id === chrome.runtime.id` 且 `sender.tab === undefined`
 * （网页内容脚本的 `sender.tab` 恒有值，因此被拒）；并附加 url 同源校验作为纵深防御。
 *
 * 用于保护会返回明文密码列表的消息（GET_INITIAL_DATA），
 * 避免任意内容脚本上下文越权读取整份密码数据。
 */
function isTrustedInternalSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab !== undefined) return false;
  return sender.url ? sender.url.startsWith(chrome.runtime.getURL('')) : true;
}

/**
 * 设置消息路由监听器
 * 处理来自 content script 和 popup 的所有 runtime 消息
 *
 * 关键：SHOW_SIDEPANEL 和 TOGGLE_SIDEPANEL 必须在同步执行路径中调用 sidePanel.open()
 * 不能在调用 open() 之前使用 await，否则会打断用户手势链
 */
export function setupMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    switch (message.type) {
      case MessageType.SIDEPANEL_PRELOAD: {
        // 预唤醒消息：主动预热密码缓存（轻量、缓存已存在时 no-op）。
        // 注意：此处不触发 maybeWarmSidePanelResources——本消息到达即意味着用户
        // 「即将/正在」打开侧边栏，此刻从 SW 侧全量 fetch ~20 个 chunk 会与
        // 渲染进程加载关键资源争抢磁盘 IO / 杀软扫描带宽，反而放大白屏时长
        // （Windows 会话失效态白屏的主要放大器）。资源预热改由「侧边栏打开完成后
        // 延时空闲执行」（见 sidePanelManager port 连接）与 SW 保活 tick 承担。
        warmPasswordCache();
        sendResponse({ success: true });
        return;
      }

      case MessageType.SHOW_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message.data?.tabId);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        // 埋点元信息优先透传消息体（popup 回退路径携带 trigger='popup'，避免覆盖为 'content'）
        openSidePanelAndRespond(tabId, sendResponse, {
          clickTs: message.data?.clickTs,
          trigger: message.data?.trigger ?? 'content',
        });
        return true;
      }

      case MessageType.HIDE_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message.data?.tabId);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        closeSidePanelWithResponse(tabId, sendResponse);
        return true;
      }

      case MessageType.TOGGLE_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message.data?.tabId);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        logger.debug('Background: 切换侧边栏, tabId:' + tabId + ', port状态:' + isSidePanelOpen());

        if (isSidePanelOpen()) {
          closeSidePanelWithResponse(tabId, sendResponse);
        } else {
          openSidePanelAndRespond(tabId, sendResponse, { clickTs: message.data?.clickTs, trigger: 'float' });
        }
        return true;
      }

      case MessageType.URL_CHANGED: {
        const tabId = sender.tab?.id;
        if (tabId) {
          sendResponse({ success: true, result: 'URL变化处理完成' });
        } else {
          sendResponse({ success: false, error: '无法获取标签ID' });
        }
        break;
      }

      case MessageType.OPEN_OPTIONS_PAGE:
        openOptionsPage()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.error('处理OPEN_OPTIONS_PAGE失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case MessageType.OPEN_OPTIONS_AND_EDIT:
        openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_EDIT, message.data).then(sendResponse);
        return true;

      case MessageType.OPEN_OPTIONS_AND_ADD:
        openOptionsAndSendMessage(MessageType.OPEN_OPTIONS_AND_ADD).then(sendResponse);
        return true;

      case MessageType.UPDATE_PASSWORD_CACHE: {
        // 轻量触发（无载荷）：由 background 自行经 warmPasswordCache 去重预热缓存，
        // 避免 sidepanel 回传全量明文列表的序列化开销（数百条目时主线程 5-30ms）；
        // 缓存已存在时 no-op，会话无效时内部门控自动跳过
        void warmPasswordCache();
        sendResponse({ success: true });
        break;
      }

      case MessageType.INVALIDATE_PASSWORD_CACHE: {
        // 使用 async IIFE 使动态 import + 异步 clearSession 在 switch-case 内正确执行
        void (async () => {
          const {
            invalidateSessionCache: invalidateSess,
            markSessionInvalid: markSessInvalid,
            clearSession: clearSess,
          } = await _getSessionModule();

          invalidatePasswordCache();
          invalidateSess();
          // 同步标记会话为无效（在 async clearSession 之前执行），
          // 使并发的 isSessionValid() 调用立即从缓存返回 false，
          // 消除 clearSession() 异步执行期间（~100-200ms）的竞态窗口
          markSessInvalid();

          // 在 BG SW 上下文中清除会话（lockSession 已在 popup/options 上下文中调用过 clearSession，
          // 但 BG SW 有独立的模块级状态和 _sessionValidCache，必须同步清除，
          // 否则 isSessionValid() 的 5 秒 TTL 缓存会返回过期的 true，
          // 导致后续 GET_INITIAL_DATA 在用户重新打开侧边栏时返回错误的已认证状态）
          clearSess().catch(e => {
            logger.error('Background: INVALIDATE_PASSWORD_CACHE 清除会话失败:', e);
          });

          // 会话已清除，停止 SW 保活闹钟
          syncSwKeepaliveAlarm();
        })();

        const port = getSidePanelPort();
        if (port) {
          try {
            port.postMessage({ type: MessageType.SESSION_EXPIRED });
          } catch {
            // port 可能已断开
          }
        }

        try {
          chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
        } catch {
          // 无监听者时忽略
        }

        sendResponse({ success: true });
        break;
      }

      case MessageType.AUTO_SAVE_PASSWORD: {
        handleAutoSavePassword(message.data).then(result => {
          sendResponse(result);
        });
        return true;
      }

      case MessageType.CHECK_CREDENTIAL_STATUS: {
        // 仅返回状态枚举与非密码元数据，不回传已存明文密码，内容脚本可调用
        handleCheckCredentialStatus(message.data).then(result => {
          sendResponse(result);
        });
        return true;
      }

      case MessageType.CHECK_UPDATE: {
        performUpdateCheck().then(updateInfo => {
          sendResponse({ success: true, data: updateInfo });
        });
        return true;
      }

      case MessageType.GET_INITIAL_DATA: {
        // 安全校验：仅允许扩展内部页面获取明文密码列表
        if (!isTrustedInternalSender(sender)) {
          sendResponse({ success: false, error: '未授权的请求来源' });
          break;
        }
        const requestedDomain = message.data?.domain;
        handleGetInitialData(requestedDomain)
          .then(data => {
            sendResponse({ success: true, data });
          })
          .catch(error => {
            logger.error('Background: GET_INITIAL_DATA 处理失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      case MessageType.GET_MATCHING_ACCOUNTS: {
        // 域名从 sender.tab.url 派生（顶层可信），仅返回元数据，内容脚本可调用
        const gmaTabId = sender.tab?.id;
        const gmaFrameId = sender.frameId;
        const rawUrl = sender.tab?.url;
        let domain = message.data?.domain ?? '';
        if (rawUrl) {
          try {
            domain = new URL(rawUrl).hostname;
          } catch {
            // 解析失败时保底使用 message.data.domain
          }
        }
        void (async () => {
          try {
            // 安全：跨域 iframe（与顶层不同主域名）不得读取顶层站点账号元数据（含用户名/标签/备注/URL），
            // 返回空列表而非锁定态，既不泄露账号存在性、也不触发误导性的解锁提示
            if (typeof gmaTabId === 'number' && !(await isFrameFillable(gmaTabId, gmaFrameId))) {
              sendResponse({ success: true, data: { locked: false, accounts: [] } });
              return;
            }
            const data = await getMatchingAccounts(domain);
            sendResponse({ success: true, data });
          } catch (error) {
            logger.error('Background: GET_MATCHING_ACCOUNTS 处理失败:', error);
            sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
          }
        })();
        return true;
      }

      case MessageType.FILL_BY_ID: {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }
        handleFillById(message.data, tabId, sender.frameId)
          .then(sendResponse)
          .catch(error => {
            logger.error('Background: FILL_BY_ID 处理失败:', error);
            sendResponse({ success: false, message: '填充失败' });
          });
        return true;
      }

      case MessageType.QUICK_FILL: {
        handleQuickFill()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.error('Background: QUICK_FILL 处理失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      case MessageType.OPEN_INLINE_DROPDOWN: {
        // popup 入口：在当前活跃标签页展开内联下拉（与快捷键 open_inline_dropdown 同一处理器）
        handleOpenInlineDropdown()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.error('Background: OPEN_INLINE_DROPDOWN 处理失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      default:
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
  });
}
