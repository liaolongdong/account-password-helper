import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSidePanelPorts,
  getTabIdSync,
  isSidePanelOpen,
  openSidePanelAndRespond,
  setupSidePanelListeners,
} from '@/entrypoints/background/sidePanelManager';
import { MessageType } from '@/utils/types';

type PortMessageListener = (message: { type: string; windowId?: number; tabId?: number }) => void;
type DisconnectListener = () => void;

function createPort() {
  let messageListener: PortMessageListener | null = null;
  let disconnectListener: DisconnectListener | null = null;
  const port = {
    name: 'sidepanel',
    sender: undefined,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: PortMessageListener) => {
        messageListener = listener;
      }),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((listener: DisconnectListener) => {
        disconnectListener = listener;
      }),
      removeListener: vi.fn(),
    },
  } as unknown as chrome.runtime.Port;

  return {
    port,
    ready: (windowId: number, tabId: number) =>
      messageListener?.({ type: MessageType.SIDEPANEL_READY, windowId, tabId }),
    disconnect: () => disconnectListener?.(),
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Side Panel 多窗口 Port 跟踪', () => {
  it('按窗口隔离实例，并在刷新重叠/交错断开时保留正确状态', async () => {
    vi.useFakeTimers();
    let onConnect: (port: chrome.runtime.Port) => void = () => {
      throw new Error('onConnect listener not registered');
    };
    let onCommand: (command: string, tab?: chrome.tabs.Tab) => void = () => {
      throw new Error('onCommand listener not registered');
    };
    vi.spyOn(chrome.runtime.onConnect, 'addListener').mockImplementation(listener => {
      onConnect = listener;
    });
    vi.spyOn(chrome.commands.onCommand, 'addListener').mockImplementation(listener => {
      onCommand = listener;
    });
    vi.spyOn(chrome.tabs, 'get').mockImplementation(((tabId: number) =>
      Promise.resolve({ id: tabId, windowId: tabId === 11 ? 1 : 2 } as chrome.tabs.Tab)) as typeof chrome.tabs.get);
    if (!chrome.sidePanel) {
      Object.defineProperty(chrome, 'sidePanel', {
        configurable: true,
        value: { open: vi.fn(), close: vi.fn() },
      });
    }
    vi.spyOn(chrome.sidePanel, 'open').mockResolvedValue(undefined);
    vi.spyOn(chrome.sidePanel, 'close').mockResolvedValue(undefined);
    setupSidePanelListeners();

    openSidePanelAndRespond(11, vi.fn());
    await vi.waitFor(() => expect(isSidePanelOpen(1, 11)).toBe(true));

    const windowOneOld = createPort();
    const windowTwo = createPort();
    onConnect(windowOneOld.port);
    onConnect(windowTwo.port);
    windowOneOld.ready(1, 11);
    windowTwo.ready(2, 22);
    await vi.waitFor(() => expect(getSidePanelPorts()).toHaveLength(2));

    expect(isSidePanelOpen(1, 11)).toBe(true);
    expect(isSidePanelOpen(2, 22)).toBe(true);

    onCommand('toggle_sidepanel', { id: 11, windowId: 1 } as chrome.tabs.Tab);
    await vi.waitFor(() =>
      expect(windowOneOld.port.postMessage).toHaveBeenCalledWith({ type: MessageType.CLOSE_SIDEPANEL }),
    );
    expect(windowTwo.port.postMessage).not.toHaveBeenCalledWith({ type: MessageType.CLOSE_SIDEPANEL });

    const windowOneNew = createPort();
    onConnect(windowOneNew.port);
    windowOneNew.ready(1, 11);
    await vi.waitFor(() => expect(getSidePanelPorts()).toHaveLength(3));

    windowOneOld.disconnect();
    expect(isSidePanelOpen(1, 11)).toBe(true);
    expect(isSidePanelOpen(2, 22)).toBe(true);

    windowOneNew.disconnect();
    expect(isSidePanelOpen(1, 11)).toBe(false);
    expect(isSidePanelOpen(2, 22)).toBe(true);

    windowTwo.disconnect();
    expect(getSidePanelPorts()).toEqual([]);
  });
});

describe('getTabIdSync tabId 来源优先级', () => {
  it('内容脚本发送时优先浏览器权威的 sender.tab.id，忽略自报值', () => {
    const sender = { id: chrome.runtime.id, tab: { id: 7 } } as chrome.runtime.MessageSender;
    expect(getTabIdSync(sender, 999)).toBe(7);
    expect(getTabIdSync(sender)).toBe(7);
  });

  it('扩展内部页面（无 sender.tab）回退自报 tabId', () => {
    const sender = { id: chrome.runtime.id } as chrome.runtime.MessageSender;
    expect(getTabIdSync(sender, 42)).toBe(42);
    expect(getTabIdSync(sender)).toBeUndefined();
  });
});
