import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCancelSelectorPick, handleStartSelectorPick } from '@/entrypoints/background/selectorPickerHandler';
import { MessageType } from '@/utils/types';

/**
 * 选择器拾取的跨标签页编排
 *
 * 这里只验证 Background 的选择与投递；页面侧的高亮/选择器生成由
 * tests/content/selectorPicker.test.ts 与 e2e/site-rules.spec.ts 覆盖。
 */
describe('selectorPickerHandler', () => {
  let query: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let focusWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    query = vi.fn();
    update = vi.fn().mockResolvedValue({});
    sendMessage = vi.fn().mockResolvedValue({ success: true });
    focusWindow = vi.fn().mockResolvedValue({});
    (globalThis as any).chrome = {
      runtime: { id: 'test-extension' },
      tabs: { query, update, sendMessage },
      windows: { update: focusWindow },
    };
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
  });

  it('选中同域名标签页，切前台并投递到顶层 frame', async () => {
    query.mockResolvedValue([
      { id: 3, url: 'https://example.com/login', active: true, windowId: 1, lastAccessed: 20 },
      { id: 2, url: 'http://localhost:3000/login', active: false, windowId: 1, lastAccessed: 10 },
    ]);

    const result = await handleStartSelectorPick({
      domain: 'LocalHost:3000',
      field: 'username',
      requestId: 'req-1',
    });

    expect(result).toEqual({ success: true, tabId: 2 });
    expect(update).toHaveBeenCalledWith(2, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(1, { focused: true });
    expect(sendMessage).toHaveBeenCalledWith(
      2,
      {
        type: MessageType.START_SELECTOR_PICK,
        data: { domain: 'localhost:3000', field: 'username', requestId: 'req-1' },
      },
      { frameId: 0 },
    );
  });

  it('同域名有多个标签页时优先当前活跃的那个', async () => {
    query.mockResolvedValue([
      { id: 2, url: 'https://example.com/a', active: false, windowId: 1, lastAccessed: 30 },
      { id: 4, url: 'https://example.com/b', active: true, windowId: 1, lastAccessed: 10 },
    ]);

    const result = await handleStartSelectorPick({ domain: 'example.com', field: 'password', requestId: 'req-2' });

    expect(result).toEqual({ success: true, tabId: 4 });
    expect(update).toHaveBeenCalledWith(4, { active: true });
  });

  it('没有已打开的同域名标签页时返回 NO_TAB，不尝试注入', async () => {
    query.mockResolvedValue([{ id: 3, url: 'https://other.example/login', active: true }]);

    const result = await handleStartSelectorPick({ domain: 'example.com', field: 'username', requestId: 'req-3' });

    expect(result).toEqual({ success: false, error: 'NO_TAB' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('目标页没有内容脚本时返回 NO_CONTENT_SCRIPT', async () => {
    query.mockResolvedValue([{ id: 2, url: 'https://example.com/login', active: false, windowId: 1 }]);
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));

    const result = await handleStartSelectorPick({ domain: 'example.com', field: 'username', requestId: 'req-4' });

    expect(result).toEqual({ success: false, error: 'NO_CONTENT_SCRIPT' });
    // 注入失败时不能把用户留在目标页；提示显示在仍处于前台的 Options 页
    expect(update).not.toHaveBeenCalled();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it('无端口规则可匹配任意端口的同 hostname 标签页（与内容脚本 fallback 同口径）', async () => {
    query.mockResolvedValue([{ id: 2, url: 'http://localhost:3000/login', active: false, windowId: 1 }]);

    const result = await handleStartSelectorPick({ domain: 'localhost', field: 'username', requestId: 'req-7' });

    expect(result).toEqual({ success: true, tabId: 2 });
    expect(sendMessage).toHaveBeenCalledWith(
      2,
      { type: MessageType.START_SELECTOR_PICK, data: { domain: 'localhost', field: 'username', requestId: 'req-7' } },
      { frameId: 0 },
    );
  });

  it('带端口规则只匹配同一端口的标签页', async () => {
    query.mockResolvedValue([
      { id: 2, url: 'http://localhost:4000/login', active: false, windowId: 1, lastAccessed: 10 },
      { id: 5, url: 'http://localhost:3000/login', active: false, windowId: 1, lastAccessed: 20 },
    ]);

    const result = await handleStartSelectorPick({ domain: 'localhost:3000', field: 'password', requestId: 'req-8' });

    expect(result).toEqual({ success: true, tabId: 5 });
  });

  it('非法域名或字段直接拒绝，不查询标签页', async () => {
    const result = await handleStartSelectorPick({
      domain: 'https://example.com',
      field: 'username',
      requestId: 'req-5',
    });
    expect(result).toEqual({ success: false, error: 'INVALID_REQUEST' });
    expect(query).not.toHaveBeenCalled();
  });

  it('取消拾取向目标标签页投递取消指令', async () => {
    await handleCancelSelectorPick({ tabId: 2, requestId: 'req-6' });

    expect(sendMessage).toHaveBeenCalledWith(
      2,
      { type: MessageType.CANCEL_SELECTOR_PICK, data: { requestId: 'req-6' } },
      { frameId: 0 },
    );
  });
});
