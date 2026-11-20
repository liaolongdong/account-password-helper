/**
 * 内联下拉展开流程（inlineDropdownHandler）回归测试
 *
 * 重点锁定右键菜单会话失效引导新增的「锚定轮次」安全边界：
 * `useContextMenuTarget` 只允许下发到 `getFillableFrameIds` 返回的 frame 集合
 * （顶层 + 与顶层同主域名的 frame）。右键发生在跨域第三方 iframe 时，该 frame 不在集合内，
 * 一旦放行就等于把「展开凭证面板」的指令发进了第三方框架——与填充路径的
 * `isFrameFillable` 防线（明文只发给可信 frame）不再同调。
 *
 * 同时覆盖：锚定轮次未命中（目标失效）时回落常规两轮、content script 不可达时返回 pageNotReady。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { tryOpenInlineDropdown } from '@/entrypoints/background/inlineDropdownHandler';
import { getFillableFrameIds } from '@/utils/frameFill';
import { MessageType } from '@/utils/types';

vi.mock('@/utils/i18n-lite', () => ({
  tl: vi.fn((key: string) => key),
}));

// 被测模块只用到 getActiveTab / notifyFailure（本文件的用例不触达它们），
// mock 掉可避免把 quickFillHandler 的整条依赖链拉进来看不到边界的用例
vi.mock('@/entrypoints/background/quickFillHandler', () => ({
  getActiveTab: vi.fn(async () => null),
  notifyFailure: vi.fn(async () => {}),
}));

vi.mock('@/utils/frameFill', () => ({
  getFillableFrameIds: vi.fn(async () => [0]),
}));

const mockedFillable = vi.mocked(getFillableFrameIds);

/** 一次展开指令的记录 */
interface OpenCall {
  frameId: number | undefined;
  useContextMenuTarget?: boolean;
  focusedOnly?: boolean;
  toggleCloseOnly?: boolean;
}

let sendSpy: ReturnType<typeof vi.spyOn>;
/** 本用例内收到的 OPEN_INLINE_DROPDOWN 指令 */
let openCalls: OpenCall[];
/** 哪些 frame 应答「已展开」（缺省全部应答 false，模拟未命中） */
let handledFrames: Set<number>;
/** 哪些 frame 应答「已收起一个打开的面板」（仅 toggle 首轮探测使用） */
let closeHandledFrames: Set<number>;
/** 哪些 frame 应答「取数期间被用户主动收起」（dismissed） */
let dismissedFrames: Set<number>;

beforeEach(() => {
  vi.clearAllMocks();
  openCalls = [];
  handledFrames = new Set<number>();
  closeHandledFrames = new Set<number>();
  dismissedFrames = new Set<number>();
  mockedFillable.mockResolvedValue([0]);

  // fakeBrowser 的 tabs.sendMessage 桩非 vi.fn，需 spy 包装；默认值统一放 beforeEach
  sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation(((
    _tabId: number,
    message: { type?: MessageType; data?: OpenCall },
    options?: { frameId?: number },
  ) => {
    if (message?.type === MessageType.PING) return Promise.resolve({ success: true, ready: true });
    if (message?.type === MessageType.OPEN_INLINE_DROPDOWN) {
      const frameId = options?.frameId;
      openCalls.push({ frameId, ...message.data });
      if (message.data?.toggleCloseOnly === true) {
        return Promise.resolve({ handled: frameId !== undefined && closeHandledFrames.has(frameId) });
      }
      if (frameId !== undefined && dismissedFrames.has(frameId)) {
        return Promise.resolve({ handled: true, dismissed: true });
      }
      return Promise.resolve({ handled: frameId !== undefined && handledFrames.has(frameId) });
    }
    return Promise.resolve(undefined);
  }) as never);
});

afterEach(() => {
  sendSpy.mockRestore();
});

describe('tryOpenInlineDropdown 的右键锚定轮次', () => {
  it('右键 frame 在可信集合内：优先以 useContextMenuTarget 下发到该 frame', async () => {
    mockedFillable.mockResolvedValue([0, 2]);
    handledFrames.add(2);

    const result = await tryOpenInlineDropdown(1, { useContextMenuTarget: true, frameId: 2 });

    expect(result).toBe('opened');
    expect(openCalls[0]).toEqual({ frameId: 2, useContextMenuTarget: true });
    // 已展开即止，不再走常规两轮委派
    expect(openCalls).toHaveLength(1);
  });

  it('右键 frame 不在可信集合内（跨域 iframe）：绝不向它下发展开指令', async () => {
    mockedFillable.mockResolvedValue([0]);

    const result = await tryOpenInlineDropdown(1, { useContextMenuTarget: true, frameId: 3 });

    expect(result).toBe('noLoginField');
    expect(openCalls.some(call => call.frameId === 3)).toBe(false);
    expect(openCalls.some(call => call.useContextMenuTarget)).toBe(false);
  });

  it('锚定轮次未命中（被右键的框已失效）时回落到常规两轮委派', async () => {
    mockedFillable.mockResolvedValue([0, 2]);
    handledFrames.add(0);

    const result = await tryOpenInlineDropdown(1, { useContextMenuTarget: true, frameId: 2 });

    expect(result).toBe('opened');
    // 第一枪是锚定轮（frame 2 未命中），随后才是聚焦字段轮
    expect(openCalls[0]).toEqual({ frameId: 2, useContextMenuTarget: true });
    expect(openCalls[1]).toEqual({ frameId: 0, focusedOnly: true });
  });

  it('未开启锚定时保持原有两轮委派行为（快捷键路径零变化）', async () => {
    mockedFillable.mockResolvedValue([0]);
    handledFrames.add(0);

    const result = await tryOpenInlineDropdown(1);

    expect(result).toBe('opened');
    expect(openCalls).toEqual([{ frameId: 0, focusedOnly: true }]);
  });

  it('顶层 frame 不可达（旧标签页未注入）时返回 pageNotReady，不下发展开指令', async () => {
    sendSpy.mockImplementation(((_tabId: number, message: { type?: MessageType }) => {
      if (message?.type === MessageType.PING) return Promise.reject(new Error('Could not establish connection.'));
      return Promise.resolve({ handled: true });
    }) as never);

    const result = await tryOpenInlineDropdown(1, { useContextMenuTarget: true, frameId: 0 });

    expect(result).toBe('pageNotReady');
    expect(openCalls).toHaveLength(0);
  });
});

describe('tryOpenInlineDropdown 的快捷键收起语义（toggle）', () => {
  it('任一 frame 收起成功即返回 closed，且不再下发展开轮次', async () => {
    mockedFillable.mockResolvedValue([0, 2]);
    closeHandledFrames.add(2);

    const result = await tryOpenInlineDropdown(1, { toggle: true });

    expect(result).toBe('closed');
    // 只发 close-only 探测，且命中后立即停止
    expect(openCalls).toEqual([
      { frameId: 0, toggleCloseOnly: true },
      { frameId: 2, toggleCloseOnly: true },
    ]);
  });

  it('没有任何打开的面板时回落到常规展开（快捷键仍能打开）', async () => {
    mockedFillable.mockResolvedValue([0]);
    handledFrames.add(0);

    const result = await tryOpenInlineDropdown(1, { toggle: true });

    expect(result).toBe('opened');
    expect(openCalls).toEqual([
      { frameId: 0, toggleCloseOnly: true },
      { frameId: 0, focusedOnly: true },
    ]);
  });

  it('未传 toggle 的调用方（popup / 右键菜单）不会被收起语义影响', async () => {
    mockedFillable.mockResolvedValue([0]);
    closeHandledFrames.add(0); // 即使内容端有面板可收，也不该走 close-only 探测
    handledFrames.add(0);

    const result = await tryOpenInlineDropdown(1);

    expect(result).toBe('opened');
    expect(openCalls.length).toBeGreaterThan(0);
    expect(openCalls.every(call => call.toggleCloseOnly !== true)).toBe(true);
  });
});

describe('tryOpenInlineDropdown 的 dismissed 终态', () => {
  it('取数期间被用户收起时立即终止回落轮次，不再尝试其它 frame / 第二轮', async () => {
    mockedFillable.mockResolvedValue([0, 2]);
    dismissedFrames.add(0);

    const result = await tryOpenInlineDropdown(1);

    expect(result).toBe('dismissed');
    // 只尝试了第一个 frame 的聚焦轮，未继续 frame 2、也未进入第二轮
    expect(openCalls).toEqual([{ frameId: 0, focusedOnly: true }]);
  });

  it('右键锚定轮命中 dismissed 同样终止（用户收起优先于其它轮次）', async () => {
    mockedFillable.mockResolvedValue([0, 2]);
    dismissedFrames.add(2);

    const result = await tryOpenInlineDropdown(1, { useContextMenuTarget: true, frameId: 2 });

    expect(result).toBe('dismissed');
    expect(openCalls).toEqual([{ frameId: 2, useContextMenuTarget: true }]);
  });
});
