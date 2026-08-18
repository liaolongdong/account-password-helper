import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/utils/types';
import type { PasswordEntry } from '@/utils/types';

const initModuleMocks = vi.hoisted(() => ({
  isSessionValid: vi.fn(),
  invalidateSessionCache: vi.fn(),
  adoptRekeyedSession: vi.fn(),
  getAllPasswords: vi.fn(),
  getSidepanelSortConfig: vi.fn(),
}));

const listenerMocks = vi.hoisted(() => ({
  storageChange: null as ((changes: Record<string, chrome.storage.StorageChange>) => void) | null,
  message: null as
    | ((
        message: { type: MessageType },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => void | boolean)
    | null,
  windowEvent: null as ((event: Event) => unknown) | null,
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: initModuleMocks.isSessionValid,
  invalidateSessionCache: initModuleMocks.invalidateSessionCache,
  adoptRekeyedSession: initModuleMocks.adoptRekeyedSession,
}));

vi.mock('@/utils/storage/passwordCrud', () => ({
  getAllPasswords: initModuleMocks.getAllPasswords,
}));

vi.mock('@/utils/storage/configManager', () => ({
  getSidepanelSortConfig: initModuleMocks.getSidepanelSortConfig,
}));

vi.mock('@/composables/useChromeListeners', () => ({
  useChromeListeners: () => ({
    onStorageChange: (callback: (changes: Record<string, chrome.storage.StorageChange>) => void) => {
      listenerMocks.storageChange = callback;
    },
    onMessage: (
      callback: (
        message: { type: MessageType },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => void | boolean,
    ) => {
      listenerMocks.message = callback;
    },
    onTabUpdated: vi.fn(),
    onTabActivated: vi.fn(),
    onDocumentEvent: vi.fn(),
    onWindowEvent: (_event: string, callback: (event: Event) => unknown) => {
      listenerMocks.windowEvent = callback;
    },
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
    listenerMocks.storageChange = null;
    listenerMocks.message = null;
    listenerMocks.windowEvent = null;
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
    listenerMocks.storageChange = null;
    listenerMocks.message = null;
    listenerMocks.windowEvent = null;
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

  it('Background 拒绝时继续采纳有效的本地路径', async () => {
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('service worker unavailable'));
    const { initSidepanelData, isAuthenticated, passwords } = useSidepanelData();

    const meta = await initSidepanelData(Promise.resolve(false));

    expect(meta.raceWinner).toBe('local');
    expect(meta.sessionValid).toBe(true);
    expect(isAuthenticated.value).toBe(true);
    expect(passwords.value).toHaveLength(1);
  });

  it('快照探测完成前已同步启动 Background 路径', async () => {
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    const { initSidepanelData } = useSidepanelData();

    const pending = initSidepanelData(Promise.resolve(false));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: MessageType.GET_INITIAL_DATA });
    await expect(pending).resolves.toMatchObject({ raceWinner: 'local', sessionValid: true });
  });

  it('Background 拒绝且本地会话无效时安全显示锁定态', async () => {
    initModuleMocks.isSessionValid.mockResolvedValue(false);
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('service worker unavailable'));
    const { initSidepanelData, isAuthenticated, passwords } = useSidepanelData();

    const meta = await initSidepanelData(Promise.resolve(true));

    expect(meta.raceWinner).toBe('local');
    expect(meta.sessionValid).toBe(false);
    expect(isAuthenticated.value).toBe(false);
    expect(passwords.value).toEqual([]);
  });

  it('Background 与本地路径都失败时在上限内安全锁定', async () => {
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    initModuleMocks.getAllPasswords.mockRejectedValueOnce(new Error('storage unavailable'));
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('service worker unavailable'));
    const { initSidepanelData, isAuthenticated } = useSidepanelData();

    const pending = initSidepanelData(Promise.resolve(false));
    await vi.advanceTimersByTimeAsync(3000);
    const meta = await pending;

    expect(meta.raceWinner).toBeNull();
    expect(meta.sessionValid).toBe(false);
    expect(isAuthenticated.value).toBe(false);
  });

  it('初始化等待期间会话键被移除时丢弃旧本地明文结果', async () => {
    let resolvePasswords!: (value: PasswordEntry[]) => void;
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    initModuleMocks.getAllPasswords.mockImplementationOnce(
      () => new Promise<PasswordEntry[]>(resolve => (resolvePasswords = resolve)),
    );
    const { initSidepanelData, isAuthenticated, passwords } = useSidepanelData();
    const pending = initSidepanelData(Promise.resolve(false));

    await vi.waitFor(() => expect(initModuleMocks.getAllPasswords).toHaveBeenCalled());
    listenerMocks.storageChange?.({
      session_password_expiry: { oldValue: Date.now() + 60_000, newValue: undefined },
    });
    resolvePasswords([
      {
        id: 'stale-entry',
        username: 'stale',
        password: 'stale-password',
        url: 'https://accounts.example.com',
        tag: '',
        remark: '',
        createTime: 1,
        updateTime: 1,
        order: 1,
      },
    ]);

    const meta = await pending;
    expect(meta.sessionValid).toBe(false);
    expect(isAuthenticated.value).toBe(false);
    expect(passwords.value).toEqual([]);
  });

  it('旧会话权威检查在 SESSION_EXPIRED 后返回 true 也不能重新解锁', async () => {
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    const { initSidepanelData, isAuthenticated, passwords } = useSidepanelData();
    await initSidepanelData(Promise.resolve(false));
    expect(isAuthenticated.value).toBe(true);

    let resolveAuthority!: (value: boolean) => void;
    initModuleMocks.isSessionValid.mockImplementationOnce(
      () => new Promise<boolean>(resolve => (resolveAuthority = resolve)),
    );
    const staleCheck = listenerMocks.windowEvent?.(new Event('sessionExpired')) as Promise<void>;
    await vi.waitFor(() => expect(initModuleMocks.isSessionValid).toHaveBeenCalledTimes(2));

    listenerMocks.message?.({ type: MessageType.SESSION_EXPIRED }, {} as chrome.runtime.MessageSender, vi.fn());
    resolveAuthority(true);
    await staleCheck;

    expect(isAuthenticated.value).toBe(false);
    expect(passwords.value).toEqual([]);
  });

  it('rekey 后的新密码加载不会被更早启动的旧加载覆盖', async () => {
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    const { initSidepanelData, loadPasswords, passwords } = useSidepanelData();
    await initSidepanelData(Promise.resolve(false));

    let resolveOldLoad!: (value: PasswordEntry[]) => void;
    initModuleMocks.getAllPasswords.mockImplementationOnce(
      () => new Promise<PasswordEntry[]>(resolve => (resolveOldLoad = resolve)),
    );
    const oldLoad = loadPasswords(true);
    await vi.waitFor(() => expect(initModuleMocks.getAllPasswords).toHaveBeenCalledTimes(2));

    initModuleMocks.getAllPasswords.mockResolvedValueOnce([
      {
        id: 'new-entry',
        username: 'new',
        password: 'new-password',
        url: 'https://accounts.example.com',
        tag: '',
        remark: '',
        createTime: 2,
        updateTime: 2,
        order: 1,
      },
    ]);
    listenerMocks.storageChange?.({
      session_wrapped_data_key: { oldValue: 'old-key', newValue: 'new-key' },
    });
    await vi.waitFor(() => expect(passwords.value[0]?.id).toBe('new-entry'));

    resolveOldLoad([
      {
        id: 'stale-entry',
        username: 'stale',
        password: 'stale-password',
        url: 'https://accounts.example.com',
        tag: '',
        remark: '',
        createTime: 1,
        updateTime: 1,
        order: 1,
      },
    ]);
    await oldLoad;

    expect(passwords.value[0]?.id).toBe('new-entry');
  });

  it('启动屏障 pending 超时不会抢先提交假锁定，随后有效 Background 结果仍可胜出', async () => {
    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: true } });
    await chrome.storage.session.set({
      browser_startup_relock_state: { status: 'pending', updatedAt: Date.now() },
    });
    let resolveBackground!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      () => new Promise(resolve => (resolveBackground = resolve)),
    );
    const { initSidepanelData, isAuthenticated } = useSidepanelData();
    const pending = initSidepanelData(Promise.resolve(false));

    await vi.advanceTimersByTimeAsync(1500);
    await chrome.storage.session.set({
      browser_startup_relock_state: { status: 'complete', updatedAt: Date.now() },
    });
    resolveBackground({
      success: true,
      data: { sessionValid: true, passwords: [], sortConfig: null },
    });

    await expect(pending).resolves.toMatchObject({ raceWinner: 'bg', sessionValid: true });
    expect(isAuthenticated.value).toBe(true);
  });

  it('启动重锁 failed 后显式认证 recovery 会恢复当前面板且不要求重启浏览器', async () => {
    const failedAt = Date.now();
    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: true } });
    await chrome.storage.session.set({
      browser_startup_relock_state: { status: 'failed', updatedAt: failedAt },
    });
    initModuleMocks.isSessionValid.mockResolvedValue(true);
    const { initSidepanelData, isAuthenticated, passwords } = useSidepanelData();

    await expect(initSidepanelData(Promise.resolve(false))).resolves.toMatchObject({ sessionValid: false });
    expect(isAuthenticated.value).toBe(false);

    const recovery = { recoveredAt: Date.now(), failedUpdatedAt: failedAt };
    await chrome.storage.session.set({ browser_startup_relock_recovery: recovery });
    listenerMocks.storageChange?.({
      browser_startup_relock_recovery: { oldValue: undefined, newValue: recovery },
    });

    await vi.waitFor(() => expect(isAuthenticated.value).toBe(true));
    expect(passwords.value).toHaveLength(1);
  });
});
