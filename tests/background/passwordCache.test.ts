import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

/**
 * passwordCache.applyMetadataOnlyUpdate 单元测试
 *
 * 覆盖元数据原地修补的核心语义：
 * - 缓存缺失时返回 false（调用方回退全量失效）；
 * - 白名单字段同步拷入；
 * - at-rest 键删除（取消收藏移除 favoriteUsedAt）同步从内存缓存删除，
 *   避免缓存/快照残留陈旧字段与 storage 持续偏离；
 * - 敏感字段绝不拷入明文缓存（即使 newValue 携带变化后的密文）。
 *
 * 会话模块 mock 掉：getSessionDataKey 返回 null 使快照持久化提前返回，
 * 避免测试触碰真实加密链路。
 */

const sessionMocks = vi.hoisted(() => ({
  isSessionValid: vi.fn(async () => true),
  isSessionActiveSync: vi.fn(() => true),
  getSessionDataKey: vi.fn(() => null),
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: sessionMocks.isSessionValid,
  isSessionActiveSync: sessionMocks.isSessionActiveSync,
  getSessionDataKey: sessionMocks.getSessionDataKey,
}));

vi.mock('@/utils/storage/configManager', () => ({
  getSidepanelSortConfig: vi.fn(async () => null),
}));

import {
  applyMetadataOnlyUpdate,
  consumePendingTotp,
  getDecryptedEntryById,
  getCachedPasswords,
  getInlineTotpCode,
  getMatchingAccounts,
  invalidatePasswordCache,
  resetCredentialAccessBarrierForStartup,
  updatePasswordCache,
} from '@/entrypoints/background/passwordCache';
import { handleQuickFill } from '@/entrypoints/background/quickFillHandler';

beforeEach(async () => {
  // 重置模块级缓存状态，保证用例 hermetic
  vi.clearAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  invalidatePasswordCache();
  resetCredentialAccessBarrierForStartup();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('applyMetadataOnlyUpdate', () => {
  it('内存缓存缺失时返回 false（回退全量失效）', async () => {
    const result = await applyMetadataOnlyUpdate([{ id: 'a' }]);
    expect(result).toBe(false);
  });

  it('入参非数组时返回 false', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a' })], '*', true);
    const result = await applyMetadataOnlyUpdate('not-an-array');
    expect(result).toBe(false);
  });

  it('白名单字段同步拷入缓存并返回 true', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a', favorite: false, lastUsedAt: 0 })], '*', true);

    const result = await applyMetadataOnlyUpdate([
      { id: 'a', favorite: true, favoriteUsedAt: 123, lastUsedAt: 456, updateTime: 789 },
    ]);

    expect(result).toBe(true);
    const cached = await getCachedPasswords();
    expect(cached?.passwords[0].favorite).toBe(true);
    expect(cached?.passwords[0].favoriteUsedAt).toBe(123);
    expect(cached?.passwords[0].lastUsedAt).toBe(456);
    expect(cached?.passwords[0].updateTime).toBe(789);
  });

  it('at-rest 键删除（取消收藏）同步从缓存删除陈旧 favoriteUsedAt', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a', favorite: true, favoriteUsedAt: 111 })], '*', true);

    // 取消收藏落盘后 at-rest 条目不再含 favoriteUsedAt 键
    const result = await applyMetadataOnlyUpdate([{ id: 'a', favorite: false }]);

    expect(result).toBe(true);
    const cached = await getCachedPasswords();
    expect(cached?.passwords[0].favorite).toBe(false);
    expect('favoriteUsedAt' in (cached?.passwords[0] ?? {})).toBe(false);
  });

  it('敏感字段绝不拷入明文缓存（密文变化被忽略）', async () => {
    updatePasswordCache([makePasswordEntry({ id: 'a', password: 'plain-secret' })], '*', true);

    // 构造携带「新密文」的 newValue：修补只允许白名单字段，password 必须保持原明文
    const result = await applyMetadataOnlyUpdate([{ id: 'a', password: 'cipher-v2', lastUsedAt: 100 }]);

    expect(result).toBe(true);
    const cached = await getCachedPasswords();
    expect(cached?.passwords[0].password).toBe('plain-secret');
    expect(cached?.passwords[0].lastUsedAt).toBe(100);
  });
});

describe('浏览器启动重锁凭据边界', () => {
  it('pending 期间快捷填充与内联凭据入口都不恢复旧会话或下发数据', async () => {
    vi.useFakeTimers();
    await chrome.storage.local.set({ idle_lock_config: { relockOnBrowserRestart: true } });
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.BROWSER_STARTUP_RELOCK_STATE]: { status: 'pending', updatedAt: Date.now() },
    });
    updatePasswordCache(
      [makePasswordEntry({ id: 'secret', password: 'plain-secret', totp: 'JBSWY3DPEHPK3PXP' })],
      '*',
      true,
    );
    resetCredentialAccessBarrierForStartup();

    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage');
    const checks = Promise.all([
      getCachedPasswords(),
      getMatchingAccounts('example.com'),
      getDecryptedEntryById('secret'),
      getInlineTotpCode('secret'),
      consumePendingTotp(1, 'example.com'),
      handleQuickFill({ id: 1, url: 'https://example.com', windowId: 1 } as chrome.tabs.Tab),
    ]);

    await vi.advanceTimersByTimeAsync(1500);
    const [cached, matching, entry, totp, pending] = await checks;

    expect(cached).toBeNull();
    expect(matching).toEqual({ locked: true, accounts: [] });
    expect(entry).toBeNull();
    expect(totp).toBeNull();
    expect(pending).toBeNull();
    expect(sessionMocks.isSessionValid).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
