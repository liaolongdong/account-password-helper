import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

const barrierMocks = vi.hoisted(() => ({
  waitBeforeAuthentication: vi.fn(async () => true),
  recoverAfterAuthentication: vi.fn(async () => false),
}));

const encryptionMocks = vi.hoisted(() => ({
  deriveEncryptionKey: vi.fn(async () => 'data-key'),
  encryptData: vi.fn(async () => 'wrapped-data-key'),
  clearCryptoKeyCache: vi.fn(),
  encryptPasswordEntry: vi.fn(),
}));

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: barrierMocks.waitBeforeAuthentication,
  recoverBrowserStartupRelockAfterAuthentication: barrierMocks.recoverAfterAuthentication,
}));

vi.mock('@/utils/encryption', () => encryptionMocks);

import { createSession, SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';

beforeEach(async () => {
  vi.clearAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  barrierMocks.waitBeforeAuthentication.mockResolvedValue(true);
  barrierMocks.recoverAfterAuthentication.mockResolvedValue(false);
});

describe('createSession 启动屏障恢复失败', () => {
  it('回滚刚创建的会话并向调用方报告失败，避免 UI 与凭据入口状态分裂', async () => {
    await expect(createSession('valid-master-password', 24)).rejects.toThrow('恢复浏览器启动安全状态失败');

    const localSession = await chrome.storage.local.get([
      SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
      SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
      SESSION_STORAGE_KEYS.VALIDITY_HOURS,
    ]);
    const memorySession = await chrome.storage.session.get([
      SESSION_MEMORY_KEYS.DATA_KEY,
      SESSION_MEMORY_KEYS.SESSION_LOCK_STATE,
    ]);

    expect(localSession[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]).toBeUndefined();
    expect(localSession[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]).toBeUndefined();
    expect(localSession[SESSION_STORAGE_KEYS.VALIDITY_HOURS]).toBeUndefined();
    expect(memorySession[SESSION_MEMORY_KEYS.DATA_KEY]).toBeUndefined();
    expect(memorySession[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE]).toEqual({ locked: true });
    expect(barrierMocks.waitBeforeAuthentication).toHaveBeenCalledTimes(1);
    expect(barrierMocks.recoverAfterAuthentication).toHaveBeenCalledTimes(1);
  });
});
