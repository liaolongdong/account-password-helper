import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

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

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: vi.fn(async () => true),
  isSessionActiveSync: vi.fn(() => true),
  getSessionDataKey: vi.fn(() => null),
}));

vi.mock('@/utils/storage/configManager', () => ({
  getSidepanelSortConfig: vi.fn(async () => null),
}));

import {
  applyMetadataOnlyUpdate,
  getCachedPasswords,
  invalidatePasswordCache,
  updatePasswordCache,
} from '@/entrypoints/background/passwordCache';

beforeEach(() => {
  // 重置模块级缓存状态，保证用例 hermetic
  invalidatePasswordCache();
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
