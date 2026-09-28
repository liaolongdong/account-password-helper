import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/utils/types';
import type { PasswordEntry } from '@/utils/types';

/**
 * 侧边栏竞速采纳与切标签页过滤回归测试（A1 / A2）
 *
 * A1：快照路径此前不参与竞速裁决（`raceWinner` 只记 bg/local），快照胜出时本地路径
 *     仍会跑完整全量解密，结果再在 `.then` 里被静默丢弃——白烧一次 CPU/磁盘 IO，
 *     并与首屏渲染抢资源。修复后快照计入竞速标记，本地路径在会话判定通过后设弃赛点。
 *     同时把迟到 bg 结果从「持有整份解密响应」收窄为布尔标记，行为等价、不再长驻明文。
 * A2：切换标签页 / URL 变化此前会追加一次非静默 `loadPasswords()`，把已渲染的列表
 *     整体替换成 loading 态再解密一遍相同数据（可见闪烁 + Windows 慢盘数百毫秒）。
 *     域名过滤本就由 `filteredPasswords` computed 承担，只需更新过滤条件。
 *
 * 依赖经 mock 从接缝注入：sessionManager-storage / passwordCrud / configManager /
 * encryption（快照解密）/ useChromeListeners（捕获 tab 与 message 回调）。
 * 定时器隔离：全程假定时器，仅在需要推进 800ms 竞速门时显式 advance，
 * 微任务推进用 `flush`（process.nextTick 不被假定时器接管）。
 */

const mocks = vi.hoisted(() => ({
  isSessionValid: vi.fn(),
  invalidateSessionCache: vi.fn(),
  adoptRekeyedSession: vi.fn(),
  getAllPasswords: vi.fn(),
  getAllPasswordsDetailed: vi.fn(),
  getSidepanelSortConfig: vi.fn(),
  decryptData: vi.fn(),
}));

const listeners = vi.hoisted(() => ({
  tabActivated: null as ((info: { tabId: number; windowId: number }) => Promise<void>) | null,
  message: null as
    | ((
        message: { type: MessageType },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => void | boolean)
    | null,
}));

const env = vi.hoisted(() => ({
  /** 当前活动标签页 URL（tabs.query mock 读取，用例内可改写模拟切标签页） */
  activeTabUrl: 'https://accounts.example.com/login',
  /** GET_INITIAL_DATA 的受控应答 */
  backgroundResponse: null as { resolve: (value: unknown) => void } | null,
  /** 快照条目（decryptData 返回的 JSON 由此构造） */
  snapshotEntries: [] as PasswordEntry[],
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: mocks.isSessionValid,
  invalidateSessionCache: mocks.invalidateSessionCache,
  adoptRekeyedSession: mocks.adoptRekeyedSession,
}));

vi.mock('@/utils/storage/passwordCrud', () => ({
  getAllPasswords: mocks.getAllPasswords,
  getAllPasswordsDetailed: mocks.getAllPasswordsDetailed,
}));

vi.mock('@/utils/storage/configManager', () => ({
  getSidepanelSortConfig: mocks.getSidepanelSortConfig,
}));

vi.mock('@/utils/encryption', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, decryptData: mocks.decryptData };
});

vi.mock('@/composables/useChromeListeners', () => ({
  useChromeListeners: () => ({
    onStorageChange: vi.fn(),
    onMessage: (
      callback: (
        message: { type: MessageType },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => void | boolean,
    ) => {
      listeners.message = callback;
    },
    onTabUpdated: vi.fn(),
    onTabActivated: (callback: (info: { tabId: number; windowId: number }) => Promise<void>) => {
      listeners.tabActivated = callback;
    },
    onDocumentEvent: vi.fn(),
    onWindowEvent: vi.fn(),
  }),
}));

import { useSidepanelData } from '@/composables/useSidepanelData';

/** 快照/本地路径共用的条目夹具 */
const entry = (id: string): PasswordEntry => ({
  id,
  username: 'user',
  password: 'password',
  url: 'https://accounts.example.com',
  tag: '',
  remark: '',
  createTime: 1,
  updateTime: 1,
  order: 1,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
};

/** 推进微任务与动态 import 的异步 I/O，时钟只拨 1ms（远低于 800ms 竞速门与兜底超时） */
const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(1);
};

/** 等待条件成立（同上：累计推进量远小于竞速门，不会被兜底超时抢先提交假锁定） */
const until = async (condition: () => boolean, rounds = 60) => {
  for (let i = 0; i < rounds && !condition(); i++) await vi.advanceTimersByTimeAsync(1);
  expect(condition()).toBe(true);
};

const setupSenders = () => {
  const sent: Record<string, number> = {};
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((message: { type?: MessageType }) => {
    const type = message?.type ?? 'unknown';
    sent[type] = (sent[type] ?? 0) + 1;
    if (type === MessageType.GET_INITIAL_DATA) {
      const gate = deferred<unknown>();
      env.backgroundResponse = gate;
      return gate.promise;
    }
    return Promise.resolve({ success: true });
  }) as typeof chrome.runtime.sendMessage);
  return sent;
};

beforeEach(async () => {
  vi.useFakeTimers();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  listeners.tabActivated = null;
  listeners.message = null;
  env.activeTabUrl = 'https://accounts.example.com/login';
  env.backgroundResponse = null;
  env.snapshotEntries = [entry('snapshot-entry')];
  Object.values(mocks).forEach(m => m.mockReset?.());
  mocks.getSidepanelSortConfig.mockResolvedValue(null);
  mocks.getAllPasswords.mockResolvedValue([entry('local-entry')]);
  mocks.getAllPasswordsDetailed.mockImplementation(async () => ({
    entries: [entry('local-entry')],
    undecryptableCount: 0,
  }));
  mocks.decryptData.mockImplementation(async () =>
    JSON.stringify({ passwords: env.snapshotEntries, sortConfig: null, timestamp: Date.now() }),
  );
  vi.spyOn(chrome.runtime, 'connect').mockReturnValue({
    name: 'sidepanel',
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as chrome.runtime.Port);
  vi.spyOn(chrome.tabs, 'query').mockImplementation((() =>
    Promise.resolve([{ id: 1, url: env.activeTabUrl }] as chrome.tabs.Tab[])) as unknown as typeof chrome.tabs.query);
  // 预热 lazyImport 缓存：动态 import 的首次解析要过真实 I/O（假定时器无法放行），
  // 预加载后竞速时序只由用例内的受控 Promise 决定
  await import('@/utils/encryption');
  await import('@/utils/browserStartupRelock');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('A1 快照计入竞速裁决', () => {
  it('快照胜出后本地路径弃赛：不执行全量解密，首屏由快照提交', async () => {
    await chrome.storage.local.set({ session_password_expiry: Date.now() + 60_000 });
    await chrome.storage.session.set({ password_cache_snapshot: 'cipher-blob', session_data_key: 'data-key' });
    const gate = deferred<PasswordEntry[]>();
    mocks.isSessionValid.mockImplementation(() => gate.promise);
    const sent = setupSenders();

    const { initSidepanelData, isAuthenticated, loading, passwords } = useSidepanelData();
    const pending = initSidepanelData(Promise.resolve(false));

    // 快照路径完成（解密被调用）即已置竞速标记；本地路径此刻仍冻结在会话判定上
    await until(() => mocks.decryptData.mock.calls.length > 0);
    gate.resolve([entry('local-entry')]);

    await expect(pending).resolves.toMatchObject({ raceWinner: 'snapshot', sessionValid: true });
    expect(isAuthenticated.value).toBe(true);
    expect(loading.value).toBe(false);
    expect(passwords.value[0]?.id).toBe('snapshot-entry');
    expect(mocks.getAllPasswords).not.toHaveBeenCalled();
    // 快照胜出仍触发一次后台缓存兜底，且只有这一次（本地路径不再重复提交）
    await flush();
    expect(sent[MessageType.UPDATE_PASSWORD_CACHE]).toBe(1);
  });

  it('对照：快照缺失时本地路径照常完成全量解密并胜出', async () => {
    mocks.isSessionValid.mockResolvedValue(true);
    setupSenders();

    const { initSidepanelData, isAuthenticated, passwords } = useSidepanelData();
    const meta = await initSidepanelData(Promise.resolve(false));

    expect(meta).toMatchObject({ raceWinner: 'local', sessionValid: true });
    expect(mocks.getAllPasswords).toHaveBeenCalledTimes(1);
    expect(isAuthenticated.value).toBe(true);
    expect(passwords.value[0]?.id).toBe('local-entry');
  });

  it('本地胜出后 Background 才应答（未超 800ms 竞速门）：仍按有效会话触发一次预热兜底', async () => {
    const gate = deferred<PasswordEntry[]>();
    mocks.isSessionValid.mockResolvedValue(true);
    mocks.getAllPasswords.mockImplementation(() => gate.promise);
    const sent = setupSenders();

    const { initSidepanelData, isAuthenticated, loading, passwords } = useSidepanelData();
    const pending = initSidepanelData(Promise.resolve(false));

    await until(() => mocks.getAllPasswords.mock.calls.length > 0);
    gate.resolve([entry('local-entry')]);
    await until(() => sent[MessageType.GET_INITIAL_DATA] === 1);
    env.backgroundResponse?.resolve({
      success: true,
      data: { sessionValid: true, passwords: [entry('bg-entry')], sortConfig: null },
    });

    const meta = await pending;
    expect(meta).toMatchObject({ raceWinner: 'local' });
    await until(() => (sent[MessageType.UPDATE_PASSWORD_CACHE] ?? 0) === 1);
    // 迟到的 bg 结果只做缓存兜底，绝不回头改动已提交的首屏
    expect(isAuthenticated.value).toBe(true);
    expect(loading.value).toBe(false);
    expect(passwords.value.map(e => e.id)).toEqual(['local-entry']);
    // 竞速门未被跨越：bg 走的是「已决出胜负 → 静默更新」分支
    expect(meta.bgPathMs).not.toBeNull();
    expect(meta.bgPathMs).toBeLessThan(800);
  });

  it('Background 迟到应答为无效会话时不触发预热（避免用假会话刷新缓存）', async () => {
    const gate = deferred<PasswordEntry[]>();
    mocks.isSessionValid.mockResolvedValue(true);
    mocks.getAllPasswords.mockImplementation(() => gate.promise);
    const sent = setupSenders();

    const { initSidepanelData } = useSidepanelData();
    const pending = initSidepanelData(Promise.resolve(false));

    await until(() => mocks.getAllPasswords.mock.calls.length > 0);
    gate.resolve([entry('local-entry')]);
    env.backgroundResponse?.resolve({ success: true, data: { sessionValid: false, passwords: [], sortConfig: null } });

    await pending;
    await flush();
    expect(sent[MessageType.UPDATE_PASSWORD_CACHE] ?? 0).toBe(0);
  });

  it('本地路径冻结在会话判定时，越过 800ms 竞速门的 bg 原始响应仍可胜出提交', async () => {
    // 覆盖 bgLateCandidate 分支：竞速门淘汰的是「无响应」，不是「迟到的有效结果」，
    // 否则面板只能空等到 3s 兜底超时并提交假锁定态
    mocks.isSessionValid.mockImplementation(() => new Promise<boolean>(() => {}));
    const sent = setupSenders();

    const { initSidepanelData, isAuthenticated, loading, passwords } = useSidepanelData();
    const pending = initSidepanelData(Promise.resolve(false));

    await until(() => sent[MessageType.GET_INITIAL_DATA] === 1);
    await vi.advanceTimersByTimeAsync(900);
    env.backgroundResponse?.resolve({
      success: true,
      data: { sessionValid: true, passwords: [entry('bg-entry')], sortConfig: null },
    });

    await expect(pending).resolves.toMatchObject({ raceWinner: 'bg', sessionValid: true });
    expect(isAuthenticated.value).toBe(true);
    expect(loading.value).toBe(false);
    expect(passwords.value.map(e => e.id)).toEqual(['bg-entry']);
    // 本地路径仍冻结在会话判定，未重复提交
    expect(mocks.getAllPasswords).not.toHaveBeenCalled();
  });
});

describe('A2 切换标签页仅更新过滤条件', () => {
  /** 完成一次本地路径胜出初始化，返回 composable 状态供后续断言 */
  const initAuthenticatedPanel = async () => {
    mocks.isSessionValid.mockResolvedValue(true);
    setupSenders();
    const state = useSidepanelData();
    await state.initSidepanelData(Promise.resolve(false));
    expect(state.isAuthenticated.value).toBe(true);
    expect(state.currentDomain.value).toBe('accounts.example.com');
    mocks.getAllPasswordsDetailed.mockClear();
    mocks.getAllPasswords.mockClear();
    return state;
  };

  it('标签页激活换域名：更新 currentDomain/currentPort，不触发全量重载与 loading', async () => {
    const { currentDomain, currentPort, loading, passwords } = await initAuthenticatedPanel();

    env.activeTabUrl = 'https://admin.example.com:8443/dashboard';
    await listeners.tabActivated?.({ tabId: 2, windowId: 1 });

    expect(currentDomain.value).toBe('admin.example.com');
    expect(currentPort.value).toBe('8443');
    expect(mocks.getAllPasswordsDetailed).not.toHaveBeenCalled();
    expect(mocks.getAllPasswords).not.toHaveBeenCalled();
    expect(loading.value).toBe(false);
    // 全量列表原样保留（域名过滤由组件侧 computed 承担），A2 的前提是数据不丢
    expect(passwords.value).toHaveLength(1);
    expect(passwords.value.map(e => e.id)).toEqual(['local-entry']);
    expect(passwords.value[0]?.url).toBe('https://accounts.example.com');
  });

  it('URL_CHANGED 消息同样只更新域名，不复载列表', async () => {
    const { currentDomain } = await initAuthenticatedPanel();

    env.activeTabUrl = 'https://other.example.cn/path';
    const sendResponse = vi.fn();
    listeners.message?.({ type: MessageType.URL_CHANGED }, {} as chrome.runtime.MessageSender, sendResponse);
    await flush();

    expect(currentDomain.value).toBe('other.example.cn');
    expect(mocks.getAllPasswordsDetailed).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('同域名同端口的重复事件不改动任何状态', async () => {
    const { currentDomain, currentPort } = await initAuthenticatedPanel();

    await listeners.tabActivated?.({ tabId: 1, windowId: 1 });

    expect(currentDomain.value).toBe('accounts.example.com');
    expect(currentPort.value).toBe('');
    expect(mocks.getAllPasswordsDetailed).not.toHaveBeenCalled();
  });
});
