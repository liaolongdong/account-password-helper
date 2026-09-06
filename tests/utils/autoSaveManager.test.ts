import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import type { PasswordEntry } from '@/utils/types';

/**
 * autoSaveManager.ts 单元测试
 *
 * 覆盖：
 * - findMatchingEntry：账号 + 域名匹配（精确、存储为完整 URL、子域名双向包含、无 URL、域名不同）；
 * - checkCredentialStatus：会话失效 / 空值 / 新账号 / 相同 / 密码变化 各分支，及读取异常保底行为；
 * - checkCredentialStatus 风险提示：弱密码/复用计数的附带边界（仅弹窗分支携带）。
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
 * 风险提示（risk）附带边界
 *
 * risk 基于预检查已解密的全量条目就地计算，不产生额外存储读取；
 * 仅在实际会弹窗的 `new` / `password_changed` 两个分支携带。
 */
describe('checkCredentialStatus 风险提示', () => {
  /** 四项规则全通过的强密码（长度/字母/数字/特殊字符） */
  const STRONG = 'Str0ng!Pass';

  beforeEach(() => {
    isSessionValid.mockResolvedValue(true);
  });

  it('新账号且密码较弱时返回 weak', async () => {
    getAllPasswords.mockResolvedValue([makePasswordEntry({ username: 'bob', url: 'github.com', password: STRONG })]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'abc', url: 'example.com' });
    expect(res.status).toBe('new');
    expect(res.risk).toEqual({ weak: true });
  });

  it('新账号且密码被其它账号复用时返回 reusedCount', async () => {
    getAllPasswords.mockResolvedValue([
      makePasswordEntry({ username: 'bob', url: 'github.com', password: STRONG }),
      makePasswordEntry({ username: 'carol', url: 'gitlab.com', password: STRONG }),
    ]);
    const res = await checkCredentialStatus({ username: 'alice', password: STRONG, url: 'example.com' });
    expect(res.status).toBe('new');
    expect(res.risk).toEqual({ reusedCount: 2 });
  });

  it('弱密码与复用同时命中时两个维度都返回', async () => {
    getAllPasswords.mockResolvedValue([makePasswordEntry({ username: 'bob', url: 'github.com', password: 'abc' })]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'abc', url: 'example.com' });
    expect(res.risk).toEqual({ weak: true, reusedCount: 1 });
  });

  it('密码足够强且未被复用时不返回 risk（避免渲染空警示条）', async () => {
    getAllPasswords.mockResolvedValue([makePasswordEntry({ username: 'bob', url: 'github.com', password: 'other' })]);
    const res = await checkCredentialStatus({ username: 'alice', password: STRONG, url: 'example.com' });
    expect(res.status).toBe('new');
    expect(res.risk).toBeUndefined();
  });

  it('password_changed 时复用计数按新密码统计，不含自身与旧密码同用者', async () => {
    getAllPasswords.mockResolvedValue([
      // 即将被更新的条目自身：持旧密码，不应因「同账号」而被计入
      makePasswordEntry({ username: 'alice', url: 'github.com', password: 'OldPass1!' }),
      // 与旧密码相同的其它账号：更新后已不再与它共用，不应计入（否则结果为 2）
      makePasswordEntry({ username: 'dave', url: 'gitee.com', password: 'OldPass1!' }),
      // 唯一与新密码相同的其它账号
      makePasswordEntry({ username: 'carol', url: 'gitlab.com', password: 'NewPass1!' }),
    ]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'NewPass1!', url: 'github.com' });
    expect(res.status).toBe('password_changed');
    expect(res.risk).toEqual({ reusedCount: 1 });
  });

  it('password_changed 且新密码较弱时同时返回 weak', async () => {
    getAllPasswords.mockResolvedValue([
      makePasswordEntry({ username: 'alice', url: 'github.com', password: 'OldPass1!' }),
    ]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'abc', url: 'github.com' });
    expect(res.status).toBe('password_changed');
    expect(res.risk).toEqual({ weak: true });
  });

  it('locked 不携带 risk，也不读取密码库', async () => {
    isSessionValid.mockResolvedValue(false);
    const res = await checkCredentialStatus({ username: 'alice', password: 'abc', url: 'example.com' });
    expect(res.status).toBe('locked');
    expect(res.risk).toBeUndefined();
    expect(getAllPasswords).not.toHaveBeenCalled();
  });

  it('identical（静默跳过）不携带 risk', async () => {
    getAllPasswords.mockResolvedValue([makePasswordEntry({ username: 'alice', url: 'github.com', password: 'abc' })]);
    const res = await checkCredentialStatus({ username: 'alice', password: 'abc', url: 'github.com' });
    expect(res.status).toBe('identical');
    expect(res.risk).toBeUndefined();
  });

  it('空凭证与读取异常两种保底分支均不携带 risk', async () => {
    const empty = await checkCredentialStatus({ username: '', password: '', url: 'example.com' });
    expect(empty.status).toBe('new');
    expect(empty.risk).toBeUndefined();

    getAllPasswords.mockRejectedValueOnce(new Error('boom'));
    const failed = await checkCredentialStatus({ username: 'alice', password: 'abc', url: 'example.com' });
    expect(failed.status).toBe('new');
    expect(failed.risk).toBeUndefined();
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
