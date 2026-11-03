import { logger } from '@/utils/logger';
import { normalizeSiteRuleDomain } from '@/utils/storage/siteRules';
import type {
  CancelSelectorPickData,
  SelectorPickField,
  StartSelectorPickData,
  StartSelectorPickResponse,
} from '@/utils/types';
import { MessageType } from '@/utils/types';

/**
 * 规则域名与标签页 URL 的匹配分档
 *
 * 2 = 含端口的精确 host 命中；1 = 仅 hostname 命中（规则写 example.com，页面在 :8080）；
 * 0 = 不匹配。与 FormDetector.loadSiteRule 的「host 优先、hostname 回退」保持同一口径。
 */
function domainMatchScore(url: string, domain: string): number {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase().replace(/\.$/, '');
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (host === domain) return 2;
    if (hostname === domain) return 1;
  } catch {
    /* malformed tab URL */
  }
  return 0;
}

/**
 * 在已打开的、与规则域名一致的目标标签页里启动选择器拾取
 *
 * 只做窗口/标签页编排；拾取器本身在 content script 里运行。
 * 选择器结果走 `SELECTOR_PICKED` 回传，不在此处读取任何输入值。
 */
export async function handleStartSelectorPick(data: StartSelectorPickData): Promise<StartSelectorPickResponse> {
  const domain = normalizeSiteRuleDomain(data?.domain);
  const field: SelectorPickField | undefined = data?.field;
  const requestId = typeof data?.requestId === 'string' ? data.requestId.trim().slice(0, 64) : '';
  if (!domain || (field !== 'username' && field !== 'password') || !requestId) {
    return { success: false, error: 'INVALID_REQUEST' };
  }

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    logger.error('选择器拾取：查询标签页失败:', error);
    return { success: false, error: 'NO_TAB' };
  }

  const target = tabs
    .map(tab => ({ tab, score: tab.url ? domainMatchScore(tab.url, domain) : 0 }))
    .filter(item => item.tab.id !== undefined && item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.tab.active) - Number(a.tab.active) ||
        (b.tab.lastAccessed ?? 0) - (a.tab.lastAccessed ?? 0),
    )[0]?.tab;
  if (!target?.id) return { success: false, error: 'NO_TAB' };

  // 先确认目标页有内容脚本，再切前台：安装/更新后未刷新的标签页会在这里失败，
  // 此时用户仍停留在管理页，能看到「请刷新目标页」的提示。
  try {
    await chrome.tabs.sendMessage(
      target.id,
      { type: MessageType.START_SELECTOR_PICK, data: { domain, field, requestId } },
      { frameId: 0 },
    );
  } catch (error) {
    logger.warn('选择器拾取：目标页面无内容脚本:', error);
    return { success: false, error: 'NO_CONTENT_SCRIPT' };
  }

  try {
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId !== undefined) await chrome.windows.update(target.windowId, { focused: true });
  } catch (error) {
    // 注入已成功，聚焦失败不回收；用户仍可在标签栏手动切到目标页
    logger.warn('选择器拾取：聚焦目标标签页失败:', error);
  }

  return { success: true, tabId: target.id };
}

/** 取消目标标签页里仍在运行的拾取器；页面已关闭 / 无内容脚本时静默 */
export async function handleCancelSelectorPick(data: CancelSelectorPickData): Promise<void> {
  if (typeof data?.tabId !== 'number' || typeof data?.requestId !== 'string' || !data.requestId) return;
  try {
    await chrome.tabs.sendMessage(
      data.tabId,
      { type: MessageType.CANCEL_SELECTOR_PICK, data: { requestId: data.requestId } },
      { frameId: 0 },
    );
  } catch {
    // 用户可能已经关掉目标标签页；取消是清理动作，不值得打扰
  }
}
