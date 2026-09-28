import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

/**
 * 会话内存镜像跨上下文清除后的重置回归测试（S1）
 *
 * 背景：`_doClearSession()` 只清空「执行它的那个上下文」的模块级镜像，而清除会话
 * 常发生在其他上下文（选项页改密后登出、侧边栏/弹窗过期自检、广播失败的锁屏）。
 * 此时后台 SW 仍持有旧的 `sessionWrappedDataKey` / `sessionPasswordExpiry`，
 * 而 `isSessionValid()` 仅在镜像为空时才回读 storage，于是继续用未到期的旧 expiry
 * 判定为有效——后台因此仍可解密、预热缓存、重建快照，等于上锁失效。
 *
 * 锁定不变量：`resetSessionMemoryState()` 后本上下文立即以 storage 为准，
 * 既不会复活已销毁的数据密钥，也不影响随后重新登录恢复正常，
 * 且本上下文的 CryptoKey 句柄缓存一并清空（锁定后不残留可解密句柄）。
 */

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'data-key'),
  deriveSessionKey: vi.fn(async () => 'session-key'),
  encryptData: vi.fn(async () => 'wrapped-data-key'),
  decryptData: vi.fn(async () => 'plain'),
  clearCryptoKeyCache: vi.fn(),
  encryptPasswordEntry: vi.fn(),
  decryptPasswordEntry: vi.fn(),
}));

/** 冲洗微任务与 0ms 定时器 */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadModule() {
  return import('@/utils/sessionManager-storage');
}

/** 写入一个「此刻有效」的会话键，模拟另一上下文已成功登录 */
const seedLiveSession = async (keys: Record<string, string>) => {
  await chrome.storage.local.set({
    [keys.WRAPPED_DATA_KEY]: 'wrapped-key-material',
    [keys.PASSWORD_EXPIRY]: Date.now() + 60 * 60 * 1000,
    [keys.VALIDITY_HOURS]: 24,
  });
  await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: 'session-data-key' });
};

/** 模拟「其他上下文」清除了会话：只动 storage，不触碰本上下文内存镜像 */
const clearSessionElsewhere = async (keys: Record<string, string>) => {
  await chrome.storage.local.remove([keys.WRAPPED_DATA_KEY, keys.PASSWORD_EXPIRY, keys.VALIDITY_HOURS]);
  await chrome.storage.session.remove(SESSION_MEMORY_KEYS.DATA_KEY);
};

describe('resetSessionMemoryState（跨上下文清除会话）', () => {
  it('仅清 TTL 缓存时陈旧镜像仍会判为有效（本项即 S1 的成因）', async () => {
    const { isSessionValid, invalidateSessionCache, SESSION_STORAGE_KEYS } = await loadModule();
    await seedLiveSession(SESSION_STORAGE_KEYS);
    await expect(isSessionValid()).resolves.toBe(true);

    await clearSessionElsewhere(SESSION_STORAGE_KEYS);
    invalidateSessionCache();

    await expect(isSessionValid()).resolves.toBe(true);
  });

  it('重置镜像后会话立即以 storage 为准返回无效', async () => {
    const { isSessionValid, resetSessionMemoryState, SESSION_STORAGE_KEYS } = await loadModule();
    await seedLiveSession(SESSION_STORAGE_KEYS);
    await expect(isSessionValid()).resolves.toBe(true);

    await clearSessionElsewhere(SESSION_STORAGE_KEYS);
    resetSessionMemoryState();

    await expect(isSessionValid()).resolves.toBe(false);
  });

  it('重置后不再从内存镜像复活已销毁的数据密钥', async () => {
    const { getSessionDataKey, isSessionValid, resetSessionMemoryState, SESSION_STORAGE_KEYS } = await loadModule();
    await seedLiveSession(SESSION_STORAGE_KEYS);
    await expect(isSessionValid()).resolves.toBe(true);
    // 预热镜像：修复前锁定后本调用仍直接命中陈旧的内存数据密钥
    await expect(getSessionDataKey()).resolves.toBe('session-data-key');

    await clearSessionElsewhere(SESSION_STORAGE_KEYS);
    resetSessionMemoryState();

    await expect(getSessionDataKey()).resolves.toBeNull();
  });

  it('重置代际推进后，在途解包结果不得回写内存与 storage.session', async () => {
    const { getSessionDataKey, resetSessionMemoryState, SESSION_STORAGE_KEYS } = await loadModule();
    const enc = await import('@/utils/encryption');
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-key-material',
      [SESSION_STORAGE_KEYS.WRAP_KEY]: 'wrap-key',
    });

    let resolveDecrypt!: (v: string) => void;
    const hanging = new Promise<string>(r => {
      resolveDecrypt = r;
    });
    vi.mocked(enc.decryptData).mockReturnValueOnce(hanging);

    const inflight = getSessionDataKey();
    await flush();

    // 解包途中另一上下文清除会话，后台经 storage 监听重置镜像（推进代际）
    await clearSessionElsewhere(SESSION_STORAGE_KEYS);
    resetSessionMemoryState();
    resolveDecrypt('stale-data-key');

    await expect(inflight).resolves.toBeNull();
    const sessionSnap = await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY);
    expect(sessionSnap[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
  });

  it('对照：重置后重新登录（会话键回到 storage）可恢复正常有效判定', async () => {
    const { isSessionValid, invalidateSessionCache, resetSessionMemoryState, SESSION_STORAGE_KEYS } =
      await loadModule();
    await seedLiveSession(SESSION_STORAGE_KEYS);
    await expect(isSessionValid()).resolves.toBe(true);

    await clearSessionElsewhere(SESSION_STORAGE_KEYS);
    resetSessionMemoryState();
    await expect(isSessionValid()).resolves.toBe(false);

    await seedLiveSession(SESSION_STORAGE_KEYS);
    // 真实链路里这一步由后台 storage 监听完成（会话创建事件 → 失效验证缓存）
    invalidateSessionCache();
    await expect(isSessionValid()).resolves.toBe(true);
  });

  it('重复调用幂等：空镜像再次重置不抛错', async () => {
    const { resetSessionMemoryState } = await loadModule();
    expect(() => resetSessionMemoryState()).not.toThrow();
    expect(() => resetSessionMemoryState()).not.toThrow();
  });

  it('重置时清空本上下文 CryptoKey 句柄缓存（与 _doClearSession 的句柄清理对齐）', async () => {
    const { resetSessionMemoryState } = await loadModule();
    const { clearCryptoKeyCache } = await import('@/utils/encryption');
    // 模块 mock 的函数实例在文件内共享，先清掉前序用例的调用记录
    vi.mocked(clearCryptoKeyCache).mockClear();

    resetSessionMemoryState();
    // fire-and-forget：等待动态 import + then 落地
    await flush();

    expect(vi.mocked(clearCryptoKeyCache)).toHaveBeenCalledTimes(1);
  });
});
