import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

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
 * 3. 校验异常仅返回 false，绝不清除会话，且随后可自然恢复。
 */

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

vi.mock('@/utils/encryption', () => ({
  deriveEncryptionKey: vi.fn(async () => 'data-key'),
  encryptData: vi.fn(async () => 'wrapped-data-key'),
  decryptData: vi.fn(async () => 'plain'),
  clearCryptoKeyCache: vi.fn(),
  encryptPasswordEntry: vi.fn(),
  decryptPasswordEntry: vi.fn(),
}));

/** 冲洗微任务，等待 fire-and-forget 的过期守卫完成 */
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
