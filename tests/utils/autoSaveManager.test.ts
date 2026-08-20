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

import { checkCredentialStatus, findMatchingEntry, isDomainMatchForAutoSave } from '@/utils/storage/autoSaveManager';
import type { AutoSaveConfig } from '@/utils/types';

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

/**
 * 创建测试用的 AutoSaveConfig
 */
function makeConfig(overrides: Partial<AutoSaveConfig> = {}): AutoSaveConfig {
  return { enabled: true, domainPatterns: [], excludedDomains: [], ...overrides };
}

describe('isDomainMatchForAutoSave（端口区分匹配）', () => {
  // ── 黑名单：无端口（保持原有行为） ──

  it('黑名单无端口时匹配精确 hostname', () => {
    const config = makeConfig({ excludedDomains: ['github.com'] });
    expect(isDomainMatchForAutoSave('github.com', config)).toBe(false);
  });

  it('黑名单无端口时匹配子域名', () => {
    const config = makeConfig({ excludedDomains: ['example.com'] });
    expect(isDomainMatchForAutoSave('sub.example.com', config)).toBe(false);
  });

  it('黑名单无端口时不限当前页面端口', () => {
    const config = makeConfig({ excludedDomains: ['localhost'] });
    expect(isDomainMatchForAutoSave('localhost:3000', config)).toBe(false);
  });

  it('黑名单无端口时不匹配不同域名', () => {
    const config = makeConfig({ excludedDomains: ['github.com'] });
    expect(isDomainMatchForAutoSave('gitlab.com', config)).toBe(true);
  });

  // ── 黑名单：含端口（新增端口区分） ──

  it('黑名单含端口时精确匹配 host + port', () => {
    const config = makeConfig({ excludedDomains: ['localhost:3000'] });
    expect(isDomainMatchForAutoSave('localhost:3000', config)).toBe(false);
  });

  it('黑名单含端口时不匹配不同端口', () => {
    const config = makeConfig({ excludedDomains: ['localhost:3000'] });
    expect(isDomainMatchForAutoSave('localhost:8080', config)).toBe(true);
  });

  it('黑名单含端口时不匹配无端口的同一 hostname', () => {
    const config = makeConfig({ excludedDomains: ['localhost:3000'] });
    expect(isDomainMatchForAutoSave('localhost', config)).toBe(true);
  });

  it('黑名单含端口时不匹配子域名', () => {
    const config = makeConfig({ excludedDomains: ['example.com:8080'] });
    expect(isDomainMatchForAutoSave('sub.example.com:8080', config)).toBe(true);
  });

  // ── 域名规则：无端口 ──

  it('域名规则无端口时匹配 hostname 及子域名', () => {
    const config = makeConfig({ domainPatterns: [{ id: '1', pattern: 'example.com', isRegex: false }] });
    expect(isDomainMatchForAutoSave('example.com', config)).toBe(true);
    expect(isDomainMatchForAutoSave('sub.example.com', config)).toBe(true);
    expect(isDomainMatchForAutoSave('other.com', config)).toBe(false);
  });

  // ── 域名规则：含端口 ──

  it('域名规则含端口时精确匹配 host + port', () => {
    const config = makeConfig({ domainPatterns: [{ id: '1', pattern: 'localhost:3000', isRegex: false }] });
    expect(isDomainMatchForAutoSave('localhost:3000', config)).toBe(true);
  });

  it('域名规则含端口时不匹配不同端口', () => {
    const config = makeConfig({ domainPatterns: [{ id: '1', pattern: 'localhost:3000', isRegex: false }] });
    expect(isDomainMatchForAutoSave('localhost:8080', config)).toBe(false);
  });

  it('域名规则含端口时不匹配无端口', () => {
    const config = makeConfig({ domainPatterns: [{ id: '1', pattern: 'localhost:3000', isRegex: false }] });
    expect(isDomainMatchForAutoSave('localhost', config)).toBe(false);
  });

  // ── 正则表达式：仅对 hostname 匹配 ──

  it('正则表达式仅对 hostname 匹配（忽略端口）', () => {
    const config = makeConfig({ domainPatterns: [{ id: '1', pattern: '.*\\.example\\.com', isRegex: true }] });
    expect(isDomainMatchForAutoSave('sub.example.com', config)).toBe(true);
    expect(isDomainMatchForAutoSave('sub.example.com:8080', config)).toBe(true);
    expect(isDomainMatchForAutoSave('example.com', config)).toBe(false);
  });

  // ── 空规则 ──

  it('规则列表为空时匹配所有非黑名单域名', () => {
    const config = makeConfig();
    expect(isDomainMatchForAutoSave('any-domain.com', config)).toBe(true);
    expect(isDomainMatchForAutoSave('localhost:3000', config)).toBe(true);
  });

  // ── 黑名单优先级 ──

  it('黑名单优先级高于域名规则', () => {
    const config = makeConfig({
      excludedDomains: ['localhost:3000'],
      domainPatterns: [{ id: '1', pattern: 'localhost', isRegex: false }],
    });
    // localhost:3000 被黑名单精确屏蔽
    expect(isDomainMatchForAutoSave('localhost:3000', config)).toBe(false);
    // localhost:8080 不被黑名单屏蔽，且匹配域名规则
    expect(isDomainMatchForAutoSave('localhost:8080', config)).toBe(true);
  });

  // ── 输入边界 ──

  it('空输入返回 false', () => {
    expect(isDomainMatchForAutoSave('', makeConfig())).toBe(false);
  });
});
