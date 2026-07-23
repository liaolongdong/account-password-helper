import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import type { PasswordEntry } from '@/utils/types';

/**
 * autoSaveManager.ts 单元测试
 *
 * 覆盖：
 * - findMatchingEntry：账号 + 域名匹配（精确、存储为完整 URL、子域名双向包含、无 URL、域名不同）；
 * - checkCredentialStatus：会话失效 / 空值 / 新账号 / 相同 / 密码变化 各分支，及读取异常保底行为。
 *
 * 会话与密码读取通过模块 mock 从接缝注入，保持测试 hermetic。
 */

const { isSessionValid, getAllPasswords } = vi.hoisted(() => ({
  isSessionValid: vi.fn<() => Promise<boolean>>(),
  getAllPasswords: vi.fn<() => Promise<PasswordEntry[]>>(),
}));

vi.mock('@/utils/storage/facades', () => ({
  isSessionValid,
}));

vi.mock('@/utils/storage/passwordCrud', () => ({
  getAllPasswords,
  updatePassword: vi.fn(),
  savePassword: vi.fn(),
}));

// configManager 仅 evictLRUFavoriteIfNeeded 使用，mock 掉避免无关的真实 storage 调用
vi.mock('@/utils/storage/configManager', () => ({
  getFavoriteLimit: vi.fn(),
}));

import { checkCredentialStatus, findMatchingEntry } from '@/utils/storage/autoSaveManager';

beforeEach(() => {
  isSessionValid.mockReset();
  getAllPasswords.mockReset();
});

describe('findMatchingEntry', () => {
  it('用户名一致 + 域名精确匹配时返回条目', () => {
    const list = [makePasswordEntry({ id: '1', username: 'alice', url: 'github.com', password: 'x' })];
    expect(findMatchingEntry(list, { username: 'alice', url: 'github.com' })?.id).toBe('1');
  });

  it('条目 url 存储为完整 URL 时按 hostname 匹配', () => {
    const list = [makePasswordEntry({ id: '1', username: 'alice', url: 'https://github.com/login', password: 'x' })];
    expect(findMatchingEntry(list, { username: 'alice', url: 'github.com' })?.id).toBe('1');
  });

  it('子域名双向包含时匹配（account.example.com 与 example.com）', () => {
    const list = [makePasswordEntry({ id: '1', username: 'alice', url: 'account.example.com', password: 'x' })];
    expect(findMatchingEntry(list, { username: 'alice', url: 'example.com' })?.id).toBe('1');
  });

  it('用户名不一致时返回 undefined', () => {
    const list = [makePasswordEntry({ id: '1', username: 'bob', url: 'github.com' })];
    expect(findMatchingEntry(list, { username: 'alice', url: 'github.com' })).toBeUndefined();
  });

  it('域名不同时返回 undefined', () => {
    const list = [makePasswordEntry({ id: '1', username: 'alice', url: 'gitlab.com' })];
    expect(findMatchingEntry(list, { username: 'alice', url: 'github.com' })).toBeUndefined();
  });

  it('条目无 url 时跳过（返回 undefined）', () => {
    const list = [makePasswordEntry({ id: '1', username: 'alice', url: '' })];
    expect(findMatchingEntry(list, { username: 'alice', url: 'github.com' })).toBeUndefined();
  });
});

describe('checkCredentialStatus', () => {
  it('会话失效时返回 locked，且不读取密码库', async () => {
    isSessionValid.mockResolvedValue(false);
    const res = await checkCredentialStatus({ username: 'alice', password: 'p', url: 'github.com' });
    expect(res.status).toBe('locked');
    expect(getAllPasswords).not.toHaveBeenCalled();
  });

  it('账号或密码为空时返回 new', async () => {
    isSessionValid.mockResolvedValue(true);
    const res = await checkCredentialStatus({ username: '', password: '', url: 'github.com' });
    expect(res.status).toBe('new');
  });

  it('无匹配条目时返回 new', async () => {
    isSessionValid.mockResolvedValue(true);
    getAllPasswords.mockResolvedValue([makePasswordEntry({ username: 'bob', url: 'github.com', password: 'x' })]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'p', url: 'github.com' });
    expect(res.status).toBe('new');
  });

  it('匹配条目且密码相同时返回 identical（不带 existing）', async () => {
    isSessionValid.mockResolvedValue(true);
    getAllPasswords.mockResolvedValue([
      makePasswordEntry({ username: 'alice', url: 'github.com', password: 'same-pass' }),
    ]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'same-pass', url: 'github.com' });
    expect(res.status).toBe('identical');
    expect(res.existing).toBeUndefined();
  });

  it('匹配条目但密码不同时返回 password_changed，并带 existing 标签/备注', async () => {
    isSessionValid.mockResolvedValue(true);
    getAllPasswords.mockResolvedValue([
      makePasswordEntry({ username: 'alice', url: 'github.com', password: 'old', tag: 'work', remark: 'note' }),
    ]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'new', url: 'github.com' });
    expect(res.status).toBe('password_changed');
    expect(res.existing).toEqual({ tag: 'work', remark: 'note' });
  });

  it('读取密码库抛错时保底返回 new（不阻断保存流程）', async () => {
    isSessionValid.mockResolvedValue(true);
    getAllPasswords.mockRejectedValue(new Error('boom'));
    const res = await checkCredentialStatus({ username: 'alice', password: 'p', url: 'github.com' });
    expect(res.status).toBe('new');
  });
});
