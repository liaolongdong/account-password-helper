import { describe, expect, it } from 'vitest';
import { pickMostRecentWebTab } from '@/utils/qrScanner';

/**
 * qrScanner.ts 标签页挑选逻辑测试
 *
 * `pickMostRecentWebTab` 决定「扫描网页二维码」自动截取哪个标签页，
 * 锁定候选过滤（仅 http/https、排除休眠页）与最近浏览优先的排序契约。
 */

/** 构造最小标签页桩对象 */
function makeTab(partial: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return { id: 1, windowId: 1, active: false, url: 'https://example.com', ...partial } as chrome.tabs.Tab;
}

describe('pickMostRecentWebTab', () => {
  it('无候选标签页返回 null', () => {
    expect(pickMostRecentWebTab([])).toBeNull();
  });

  it('过滤非网页标签页（扩展页 / chrome:// / 无 URL）', () => {
    const tabs = [
      makeTab({ id: 1, url: 'chrome-extension://abc/options.html' }),
      makeTab({ id: 2, url: 'chrome://extensions/' }),
      makeTab({ id: 3, url: undefined }),
    ];
    expect(pickMostRecentWebTab(tabs)).toBeNull();
  });

  it('排除已休眠（discarded）的标签页', () => {
    const tabs = [makeTab({ id: 1, discarded: true, lastAccessed: 200 }), makeTab({ id: 2, lastAccessed: 100 })];
    expect(pickMostRecentWebTab(tabs)?.id).toBe(2);
  });

  it('按 lastAccessed 降序取最近浏览的网页', () => {
    const tabs = [
      makeTab({ id: 1, lastAccessed: 100 }),
      makeTab({ id: 2, lastAccessed: 300 }),
      makeTab({ id: 3, lastAccessed: 200 }),
    ];
    expect(pickMostRecentWebTab(tabs)?.id).toBe(2);
  });

  it('lastAccessed 缺失时按 0 参与排序（不抛错）', () => {
    const tabs = [makeTab({ id: 1 }), makeTab({ id: 2, lastAccessed: 50 })];
    expect(pickMostRecentWebTab(tabs)?.id).toBe(2);
  });

  it('http 页面同样是合法候选', () => {
    const tabs = [makeTab({ id: 1, url: 'http://192.168.1.1:8080/login', lastAccessed: 10 })];
    expect(pickMostRecentWebTab(tabs)?.id).toBe(1);
  });
});
