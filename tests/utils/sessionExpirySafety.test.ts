import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';

/**
 * isSessionValid 过期/异常清理安全性回归测试
 *
 * 背景：过期分支曾 fire-and-forget 直接 clearSession()，过期判定与真正清除
 * 之间的时间窗内若用户已显式认证创建新会话，会把新会话误删；异常分支同样
 * 无条件 clearSession()，一次瞬时存储读取错误即永久销毁仍有效的会话。
 *
 * 本套件锁定修复后的不变量：
 * 1. 过期清理前复核持久化过期时间：已变化（新会话）则跳过清除；
 * 2. 仍然过期时清理照常执行（锁定状态镜像同步更新）；
 * 3. 校验异常仅返回 false，绝不清除会话，且随后可自然恢复；
 * 4. 旧版会话透明迁移同样受会话代际保护：迁移途中的锁定不得被陈旧密钥材料复活。
 */

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'data-key'),
  deriveSessionKey: vi.fn(async () => 'legacy-wrap-key'),
  encryptData: vi.fn(async () => 'wrapped-data-key'),
  decryptData: vi.fn(async () => 'plain'),
  clearCryptoKeyCache: vi.fn(),
  encryptPasswordEntry: vi.fn(),
  decryptPasswordEntry: vi.fn(),
}));

/** 冲洗微任务，等待 fire-and-forget 的过期守卫完成 */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** 可控挂起的 Promise，用于把长异步边界（解包 / PBKDF2）冻结在指定点 */
const deferred = () => {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

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

describe('过期清理守卫', () => {
  it('过期窗口内已创建新会话（持久化过期时间已变化）时跳过清除', async () => {
    const { isSessionValid, SESSION_STORAGE_KEYS } = await loadModule();
    const expiredAt = Date.now() - 1000;
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'old-wrapped',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: expiredAt,
    });

    // 守卫的复核读取（单键）返回「新会话」的未来过期时间，
    // 模拟过期判定后、清除落地前用户已显式认证创建新会话
    const realGet = chrome.storage.local.get.bind(chrome.storage.local) as (
      keys?: unknown,
    ) => Promise<Record<string, unknown>>;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys: unknown) => {
      if (keys === SESSION_STORAGE_KEYS.PASSWORD_EXPIRY) {
        return { [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 60_000 };
      }
      return realGet(keys);
    });

    await expect(isSessionValid()).resolves.toBe(false);
    await flush();

    // 新会话的密钥材料必须完整保留
    const after = await realGet([SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY, SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]);
    expect(after[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBe('old-wrapped');
    expect(after[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]).toBe(expiredAt);
  });

  it('确认仍然过期时清除会话并写入锁定状态镜像', async () => {
    const { isSessionValid, SESSION_STORAGE_KEYS } = await loadModule();
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'old-wrapped',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() - 1000,
    });

    await expect(isSessionValid()).resolves.toBe(false);
    await flush();

    const after = await chrome.storage.local.get([
      SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
      SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    ]);
    expect(after[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBeUndefined();
    expect(after[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]).toBeUndefined();

    const lockState = await chrome.storage.session.get(SESSION_MEMORY_KEYS.SESSION_LOCK_STATE);
    expect(lockState[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
  });

  it('复核读取自身失败时跳过清除（宁可残留过期键也不误删新会话）', async () => {
    const { isSessionValid, SESSION_STORAGE_KEYS } = await loadModule();
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'old-wrapped',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() - 1000,
    });

    const realGet = chrome.storage.local.get.bind(chrome.storage.local) as (
      keys?: unknown,
    ) => Promise<Record<string, unknown>>;
    let callCount = 0;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys: unknown) => {
      callCount += 1;
      // 首次读取（isSessionValid 批量读）正常，复核读取（第二次）失败
      if (callCount >= 2) throw new Error('simulated recheck failure');
      return realGet(keys);
    });

    await expect(isSessionValid()).resolves.toBe(false);
    await flush();

    const after = await realGet(SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY);
    expect(after[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBe('old-wrapped');
  });
});

describe('校验异常路径', () => {
  it('瞬时存储读取异常仅返回 false，不清除会话', async () => {
    const { isSessionValid, SESSION_STORAGE_KEYS } = await loadModule();
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'valid-wrapped',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 60_000,
    });

    vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('transient storage error'));

    await expect(isSessionValid()).resolves.toBe(false);
    await flush();

    // 会话密钥材料未被清除
    const after = await chrome.storage.local.get(SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY);
    expect(after[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBe('valid-wrapped');
  });

  it('瞬时异常后失效缓存，下次校验自然恢复为有效', async () => {
    const { isSessionValid, invalidateSessionCache, SESSION_STORAGE_KEYS } = await loadModule();
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'valid-wrapped',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 60_000,
    });

    vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('transient storage error'));
    await expect(isSessionValid()).resolves.toBe(false);

    invalidateSessionCache();
    await expect(isSessionValid()).resolves.toBe(true);
  });
});

describe('会话代际保护（B6）', () => {
  /** 准备可被冷解包命中的新格式会话键（storage.session 空 → 触发解包） */
  const seedWrappedSession = async (SESSION_STORAGE_KEYS: Record<string, string>) => {
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-key-material',
      [SESSION_STORAGE_KEYS.WRAP_KEY]: 'wrap-key',
    });
  };

  it('解包回填途中被锁定：陈旧数据密钥不回写内存/ storage.session', async () => {
    const { getSessionDataKey, markSessionInvalid, SESSION_STORAGE_KEYS } = await loadModule();
    const enc = await import('@/utils/encryption');
    await seedWrappedSession(SESSION_STORAGE_KEYS);

    const d = deferred();
    vi.mocked(enc.decryptData).mockReturnValueOnce(d.promise);

    // 冷解包：会挂起在 decryptData 这一最终异步边界
    const inflight = getSessionDataKey();
    await flush(); // 让各 await 推进至 decryptData 挂起处

    // 解包期间用户锁定：推进代际
    markSessionInvalid();

    // 解密此时才完成——结果属于已被作废的旧代际
    d.resolve('stale-data-key');
    await expect(inflight).resolves.toBeNull();

    // 陈旧密钥绝不能重新驻留 storage.session（否则复活已销毁的密钥）
    const sessionSnap = await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY);
    expect(sessionSnap[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
  });

  it('对照：解包期间未锁定则正常回填密钥与 storage.session', async () => {
    const { getSessionDataKey, SESSION_STORAGE_KEYS } = await loadModule();
    await seedWrappedSession(SESSION_STORAGE_KEYS);

    await expect(getSessionDataKey()).resolves.toBe('plain');
    const sessionSnap = await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY);
    expect(sessionSnap[SESSION_MEMORY_KEYS.DATA_KEY]).toBe('plain');
  });
});

describe('旧版会话透明迁移的代际保护', () => {
  /** 旧版遗留会话键：主密码密文 + 未到期的过期时间 */
  const seedLegacySession = async (keys: Record<string, string>, expiry: number) => {
    await chrome.storage.local.set({
      [keys.MASTER_PASSWORD]: 'legacy-master-password-blob',
      [keys.PASSWORD_EXPIRY]: expiry,
      [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'verifier', salt: 'the-salt', kdf: 'pbkdf2-sha256' },
    });
  };

  it('迁移派生密钥途中被锁定：不得重建会话密钥材料，也不得改写锁定状态镜像', async () => {
    const { isSessionValid, markSessionInvalid, SESSION_STORAGE_KEYS } = await loadModule();
    const enc = await import('@/utils/encryption');
    await seedLegacySession(SESSION_STORAGE_KEYS, Date.now() + 60_000);

    const d = deferred();
    vi.mocked(enc.deriveEncryptionKey).mockReturnValueOnce(d.promise);

    const inflight = isSessionValid();
    // 确认已冻结在 PBKDF2 这一长异步边界内，锁定确实落在迁移途中
    await vi.waitFor(() => expect(enc.deriveEncryptionKey).toHaveBeenCalled());
    markSessionInvalid();
    await flush(); // 让锁定状态镜像的 fire-and-forget 写入落地
    d.resolve('stale-data-key');

    await expect(inflight).resolves.toBe(false);

    const after = await chrome.storage.local.get([
      SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
      SESSION_STORAGE_KEYS.WRAP_KEY,
    ]);
    expect(after[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBeUndefined();
    expect(after[SESSION_STORAGE_KEYS.WRAP_KEY]).toBeUndefined();

    const sessionSnap = await chrome.storage.session.get([
      SESSION_MEMORY_KEYS.DATA_KEY,
      SESSION_MEMORY_KEYS.SESSION_LOCK_STATE,
    ]);
    expect(sessionSnap[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
    expect(sessionSnap[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
  });

  it('对照：迁移期间未锁定则正常落盘新格式并解除锁定镜像', async () => {
    const { isSessionValid, SESSION_STORAGE_KEYS } = await loadModule();
    const expiry = Date.now() + 60_000;
    await seedLegacySession(SESSION_STORAGE_KEYS, expiry);

    await expect(isSessionValid()).resolves.toBe(true);

    const after = await chrome.storage.local.get([
      SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
      SESSION_STORAGE_KEYS.WRAP_KEY,
      SESSION_STORAGE_KEYS.MASTER_PASSWORD,
    ]);
    expect(after[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBe('wrapped-data-key');
    expect(typeof after[SESSION_STORAGE_KEYS.WRAP_KEY]).toBe('string');
    // 旧版主密码密文已被清除，主密码不再落盘
    expect(after[SESSION_STORAGE_KEYS.MASTER_PASSWORD]).toBeUndefined();

    const sessionSnap = await chrome.storage.session.get([
      SESSION_MEMORY_KEYS.DATA_KEY,
      SESSION_MEMORY_KEYS.SESSION_LOCK_STATE,
    ]);
    expect(sessionSnap[SESSION_MEMORY_KEYS.DATA_KEY]).toBe('data-key');
    expect(sessionSnap[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: false, expiresAt: expiry });
  });
});
