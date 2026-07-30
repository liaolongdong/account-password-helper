import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';

/**
 * 进行中的打开流程 Promise
 * 重复请求直接复用同一 Promise：既避免并发重复建 tab，又保证第二次调用也能拿到 tabId（编辑指令不丢失）
 */
let openingPromise: Promise<number | undefined> | null = null;

/**
 * 最近一次创建/复用的 options 标签页 ID
 * tabs.get 按 tabId 校验存活不依赖 url 可见性，可覆盖“tab 已创建但文档尚未提交”的窗口期；
 * 失效采用惰性校验（tabs.get 报错即清除），不注册全局 tabs.onRemoved 监听，
 * 避免关闭任意标签页都唤醒休眠中的 Service Worker（保障侧边栏等场景的冷启动性能）
 */
let cachedOptionsTabId: number | undefined;

/**
 * 激活指定标签页并聚焦其所在窗口
 * tabs.update 返回值自带 windowId，无需额外 tabs.get 往返
 */
async function activateTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) {
    // 聚焦失败不影响复用结果，避免被误判为 TOCTOU 而回退新建重复标签页
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
}

/**
 * 查找已存在的 options 标签页 ID
 *
 * 注意：manifest 未声明 "tabs" 权限且 <all_urls> 不覆盖 chrome-extension:// scheme，
 * tabs.query 返回的 url/pendingUrl 对自身扩展页恒为 undefined（无法用 URL 匹配），
 * 因此改用 runtime.getContexts（Chrome 116+，枚举自身扩展页面上下文无需额外权限）。
 */
async function findExistingOptionsTabId(optionsUrl: string): Promise<number | undefined> {
  // 1) 缓存的 tabId 处于加载中（文档尚未创建）或被内存回收丢弃（文档已销毁）时，
  //    getContexts 均查不到，需信任缓存；激活被丢弃的 tab 会自动重新加载
  if (cachedOptionsTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(cachedOptionsTabId);
      if (tab.id !== undefined && (tab.status === 'loading' || tab.discarded)) {
        // 否定校验：<all_urls> 权限下导航去 http(s) 页面时 url/pendingUrl 可见，
        // 仅当 URL 不可见（自身扩展页的窗口期）或前缀匹配时才信任缓存，
        // 避免把正在导航去其它网站的 tab 误判为 options 页。
        // 已接受的残留缝隙：导航去 chrome:// 等非 host-permission scheme 时 URL 同样不可见，
        // 此否定校验并非完备，触发条件苛刻（需在加载窗口期内手动改址），为权衡后的取舍
        const visibleUrl = tab.pendingUrl || tab.url;
        if (!visibleUrl || visibleUrl.startsWith(optionsUrl)) {
          return tab.id;
        }
        // 已被导航去其它页面，不再信任
        cachedOptionsTabId = undefined;
      }
    } catch {
      // tab 已关闭，惰性清除缓存
      cachedOptionsTabId = undefined;
    }
  }

  // Chrome < 116 理论不可达（manifest 已声明 minimum_chrome_version），防御性降级为新建标签页
  if (typeof chrome.runtime.getContexts !== 'function') {
    return undefined;
  }

  // 2) getContexts 枚举已加载的 options 页上下文（以此为准，防止缓存 tab 已被导航到其它页面）
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.TAB],
  });
  const matches = contexts.filter(c => c.tabId !== -1 && c.documentUrl?.startsWith(optionsUrl));
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0].tabId;
  }

  // 多个 options 标签页并存（用户手动打开）：优先激活最近使用（lastAccessed 最大）的一个
  const matchedTabs = (await Promise.all(matches.map(c => chrome.tabs.get(c.tabId).catch(() => undefined)))).filter(
    (tab): tab is chrome.tabs.Tab => tab !== undefined,
  );
  if (matchedTabs.length === 0) {
    return undefined;
  }
  const latestTab = matchedTabs.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
  return latestTab.id;
}

/**
 * 打开选项页面（全局单实例）
 * - 并发/连点请求复用进行中的 Promise，均能拿到同一 tabId
 * - 已存在 options 标签页（含加载中）：激活并聚焦其所在窗口
 * - 不存在：创建新标签页并缓存 tabId
 */
export function openOptionsPage(): Promise<number | undefined> {
  if (openingPromise) {
    logger.debug('Background: 正在打开选项页面，复用进行中的流程');
    return openingPromise;
  }
  openingPromise = doOpenOptionsPage().finally(() => {
    openingPromise = null;
  });
  return openingPromise;
}

/**
 * 打开选项页面的实际流程（由 openOptionsPage 做并发去重后调用）
 */
async function doOpenOptionsPage(): Promise<number | undefined> {
  try {
    const optionsUrl = chrome.runtime.getURL('options.html');
    const existingTabId = await findExistingOptionsTabId(optionsUrl);

    if (existingTabId !== undefined) {
      try {
        await activateTab(existingTabId);
        cachedOptionsTabId = existingTabId;
        logger.debug('Background: 已激活现有密码管理标签页 tabId=' + existingTabId);
        return existingTabId;
      } catch {
        // 复用目标在激活前被关闭（TOCTOU），清除缓存并回退为新建
        cachedOptionsTabId = undefined;
      }
    }

    const newTab = await chrome.tabs.create({ url: optionsUrl });
    cachedOptionsTabId = newTab.id;
    logger.debug('Background: 已创建新的密码管理标签页 tabId=' + newTab.id);
    return newTab.id;
  } catch (error) {
    logger.error('打开选项页面失败:', error);
  }
  return undefined;
}

/**
 * 等待指定 tab 加载完成，超时后放弃等待
 * 替代固定 500ms 延迟，避免页面未加载完就发消息（竞态条件）
 */
export function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.status === 'complete') finish();
      })
      .catch(() => finish());
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * 打开选项页面并向其发送指定消息
 * 用于 OPEN_OPTIONS_AND_EDIT 和 OPEN_OPTIONS_AND_ADD 消息的公共处理逻辑
 */
export function openOptionsAndSendMessage(
  messageType: MessageType,
  data?: unknown,
): Promise<{ success: boolean; error?: string }> {
  return openOptionsPage()
    .then(async (tabId): Promise<{ success: boolean; error?: string }> => {
      if (tabId === undefined) {
        // 选项页未能打开时如实上报失败，与 sendMessage 失败的上报契约保持一致
        return { success: false, error: 'Failed to open options page' };
      }
      await waitForTabComplete(tabId, 5000);
      try {
        await chrome.tabs.sendMessage(tabId, { type: messageType, data });
      } catch (err) {
        logger.error(`Background: 向选项页发送 ${messageType} 指令失败:`, err);
        // 消息未送达时如实上报失败，避免上游误判编辑/添加指令已生效
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { success: true };
    })
    .catch(error => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}
