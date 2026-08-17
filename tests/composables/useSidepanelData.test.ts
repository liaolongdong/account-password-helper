import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/utils/types';

const initModuleMocks = vi.hoisted(() => ({
  isSessionValid: vi.fn(),
  getAllPasswords: vi.fn(),
  getSidepanelSortConfig: vi.fn(),
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: initModuleMocks.isSessionValid,
}));

vi.mock('@/utils/storage/passwordCrud', () => ({
  getAllPasswords: initModuleMocks.getAllPasswords,
}));

vi.mock('@/utils/storage/configManager', () => ({
  getSidepanelSortConfig: initModuleMocks.getSidepanelSortConfig,
}));

vi.mock('@/composables/useChromeListeners', () => ({
  useChromeListeners: () => ({
    onStorageChange: vi.fn(),
    onMessage: vi.fn(),
    onTabUpdated: vi.fn(),
    onTabActivated: vi.fn(),
    onDocumentEvent: vi.fn(),
    onWindowEvent: vi.fn(),
  }),
}));

import {
  isSessionQuicklyKnownInvalid,
  resolveQuickSessionInvalidHint,
  useSidepanelData,
} from '@/composables/useSidepanelData';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('侧边栏轻量会话判定复用', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    vi.restoreAllMocks();
    initModuleMocks.isSessionValid.mockReset();
    initModuleMocks.getAllPasswords.mockReset();
    initModuleMocks.getSidepanelSortConfig.mockReset();
    initModuleMocks.getAllPasswords.mockResolvedValue([
      {
        id: 'entry-1',
        username: 'user',
        password: 'password',
        url: 'https://accounts.example.com',
        tag: '',
        remark: '',
        createTime: 1,
        updateTime: 1,
        order: 1,
      },
    ]);
    initModuleMocks.getSidepanelSortConfig.mockResolvedValue(null);
  });

  it('复用已发起的判定 Promise，不产生第二轮 storage 探测', async () => {
    await chrome.storage.local.set({ session_password_expiry: Date.now() + 60_000 });
    const sessionGet = vi.spyOn(chrome.storage.session, 'get');
    const localGet = vi.spyOn(chrome.storage.local, 'get');

    const prefetched = isSessionQuicklyKnownInvalid();
    await expect(resolveQuickSessionInvalidHint(prefetched)).resolves.toBe(false);

    expect(sessionGet).toHaveBeenCalledTimes(1);
    expect(localGet).toHaveBeenCalledTimes(1);
  });

  it('未提供预取结果时保持原有完整快速判定行为', async () => {
    await chrome.storage.session.set({ session_lock_state: { locked: true } });
    const sessionGet = vi.spyOn(chrome.storage.session, 'get');
    const localGet = vi.spyOn(chrome.storage.local, 'get');

    await expect(resolveQuickSessionInvalidHint()).resolves.toBe(true);

    expect(sessionGet).toHaveBeenCalledTimes(1);
    expect(localGet).not.toHaveBeenCalled();
  });

  it('预取 Promise 失败时保持未知即 false 的安全降级', async () => {
    await expect(resolveQuickSessionInvalidHint(Promise.reject(new Error('storage unavailable')))).resolves.toBe(false);
  });
});

describe('initSidepanelData 会话提示与权威校验', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    vi.useFakeTimers();
    initModuleMocks.isSessionValid.mockReset();
    initModuleMocks.getAllPasswords.mockReset();
    initModuleMocks.getSidepanelSortConfig.mockReset();
    initModuleMocks.getAllPasswords.mockResolvedValue([
      {
        id: 'entry-1',
        username: 'user',
        password: 'password',
        url: 'https://accounts.example.com',
        tag: '',
        remark: '',
        createTime: 1,
        updateTime: 1,
        order: 1,
      },
    ]);
    initModuleMocks.getSidepanelSortConfig.mockResolvedValue(null);

    const portEvent = { addListener: vi.fn(), removeListener: vi.fn() };
    vi.spyOn(chrome.runtime, 'connect').mockReturnValue({
      name: 'sidepanel',
      onMessage: portEvent,
      onDisconnect: portEvent,
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      sender: undefined,
    } as unknown as chrome.runtime.Port);
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((message: { type?: MessageType }) => {
      if (message.type === MessageType.GET_INITIAL_DATA) return new Promise(() => {});
      return Promise.resolve({ success: true });
    }) as typeof chrome.runtime.sendMessage);
    vi.spyOn(chrome.tabs, 'query').mockImplementation(
      () =>
        Promise.resolve([{ id: 1, url: 'https://accounts.example.com/login' } as chrome.tabs.Tab]) as unknown as void,
    );
  });

  it.each([
    { label: 'hint=true / authority=true', hint: () => Promise.resolve(true), authority: true },
    { label: 'hint=false / authority=true', hint: () => Promise.resolve(false), authority: true },
    {
      label: 'hint=reject / authority=true',
      hint: () => Promise.reject(new Error('storage unavailable')),
      authority: true,
    },
    { label: 'hint=true / authority=false', hint: () => Promise.resolve(true), authority: false },
    { label: 'hint=false / authority=false', hint: () => Promise.resolve(false), authority: false },
  ])('$label：最终状态始终采用完整校验结果', async ({ hint, authority }) => {
    initModuleMocks.isSessionValid.mockResolvedValue(authority);
    const { initSidepanelData } = useSidepanelData();

    const meta = await initSidepanelData(hint());

    expect(initModuleMocks.isSessionValid).toHaveBeenCalledTimes(1);
    expect(meta.sessionValid).toBe(authority);
    if (authority) {
      expect(initModuleMocks.getAllPasswords).toHaveBeenCalled();
    } else {
      expect(initModuleMocks.getAllPasswords).not.toHaveBeenCalled();
    }
  });
});
