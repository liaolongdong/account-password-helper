import { describe, expect, it } from 'vitest';
import { applyListFilters, filterEntriesByScope, matchesSiteScope, type ScopeContext } from '@/utils/passwordFilter';
import { sortPasswordEntries } from '@/utils/passwordSort';
import { isExactHostMatch } from '@/utils/domain';
import type { PasswordEntry } from '@/utils/types';
import { makePasswordEntry as entry } from '@/tests/helpers/passwordEntry';

/**
 * passwordFilter.ts 契约测试
 *
 * 锁定两类不变量：
 * 1. 「本站范围」判定必须与侧边栏既有的当前域名过滤语义完全一致
 *    （无域名放行全部、本地开发按端口、空 URL 通用条目放行、其余按 `resolveMatchTier`
 *    档位判定，缺省 `off` 即精确 host 匹配），
 *    该判定同时决定条目能否填充当前页，误判即导致填充必然失败或外站条目被误当作本站。
 * 2. 所有过滤函数必须返回新数组——`sortPasswordEntries` 为就地排序，
 *    若把上游全量列表引用透出，排序会污染事实来源的顺序。
 */

/** 构造域名上下文的便捷函数 */
const ctx = (domain: string, port = ''): ScopeContext => ({ domain, port });

/** 提取条目 id 序列，便于断言过滤结果 */
const ids = (list: readonly PasswordEntry[]): string[] => list.map(item => item.id);

describe('matchesSiteScope 域名匹配语义', () => {
  it('当前页无域名时放行全部条目（新标签页等场景）', () => {
    expect(matchesSiteScope(entry({ url: 'example.com' }), ctx(''))).toBe(true);
    expect(matchesSiteScope(entry({ url: '' }), ctx(''))).toBe(true);
  });

  it('空 URL 通用条目始终放行', () => {
    expect(matchesSiteScope(entry({ url: '' }), ctx('example.com'))).toBe(true);
    expect(matchesSiteScope(entry({ url: '   ' }), ctx('example.com'))).toBe(true);
  });

  it('精确 hostname 匹配：命中完整 URL / 纯域名，不跨子域名与环境', () => {
    expect(matchesSiteScope(entry({ url: 'https://example.com/login' }), ctx('example.com'))).toBe(true);
    expect(matchesSiteScope(entry({ url: 'example.com' }), ctx('example.com'))).toBe(true);
    expect(matchesSiteScope(entry({ url: 'https://fat.example.com' }), ctx('uat.example.com'))).toBe(false);
    expect(matchesSiteScope(entry({ url: 'example.com' }), ctx('fat.example.com'))).toBe(false);
    expect(matchesSiteScope(entry({ url: 'other.com' }), ctx('example.com'))).toBe(false);
  });

  it('本地开发域名按端口过滤，当前页无端口时放行全部', () => {
    // 当前页无端口：保持既有行为，展示全部
    expect(matchesSiteScope(entry({ url: 'http://localhost:3000' }), ctx('localhost', ''))).toBe(true);
    expect(matchesSiteScope(entry({ url: 'other.com' }), ctx('localhost', ''))).toBe(true);
    // 当前页有端口：条目无端口（通用）或端口一致才放行
    expect(matchesSiteScope(entry({ url: 'http://localhost:3000' }), ctx('localhost', '3000'))).toBe(true);
    expect(matchesSiteScope(entry({ url: 'localhost' }), ctx('localhost', '3000'))).toBe(true);
    expect(matchesSiteScope(entry({ url: '' }), ctx('localhost', '3000'))).toBe(true);
    expect(matchesSiteScope(entry({ url: 'http://localhost:8080' }), ctx('localhost', '3000'))).toBe(false);
    expect(matchesSiteScope(entry({ url: 'http://127.0.0.1:5173' }), ctx('127.0.0.1', '3000'))).toBe(false);
  });
});

describe('matchesSiteScope 跨子域档位', () => {
  /** 覆盖精确 / 通配 / apex / 兄弟子域 / 通用 / 其他环境 / 前缀碰撞 */
  const URLS = ['mail.qq.com', '*.qq.com', 'qq.com', 'music.qq.com', '', 'uat.example.com', 'evil-qq.com'];

  it('off 档与迁移前口径逐条一致（空 URL 或精确 host）', () => {
    const current = ctx('mail.qq.com');
    for (const url of URLS) {
      const legacy = url.trim() === '' || isExactHostMatch(current.domain, url);
      expect(matchesSiteScope(entry({ url }), current)).toBe(legacy);
    }
  });

  it('wildcard 档只额外放行通配条目', () => {
    const current = ctx('mail.qq.com');
    expect(matchesSiteScope(entry({ url: '*.qq.com' }), current, 'wildcard')).toBe(true);
    expect(matchesSiteScope(entry({ url: 'https://*.qq.com/login' }), current, 'wildcard')).toBe(true);
    for (const url of ['qq.com', 'music.qq.com', 'uat.example.com', 'evil-qq.com']) {
      expect(matchesSiteScope(entry({ url }), current, 'wildcard')).toBe(false);
    }
  });

  it('sameMainDomain 档放行通配 / apex / 兄弟子域，拦住前缀碰撞与外域', () => {
    const current = ctx('mail.qq.com');
    for (const url of ['*.qq.com', 'qq.com', 'music.qq.com']) {
      expect(matchesSiteScope(entry({ url }), current, 'sameMainDomain')).toBe(true);
    }
    for (const url of ['evil-qq.com', 'uat.example.com', 'https://mail.qq.com.evil.io']) {
      expect(matchesSiteScope(entry({ url }), current, 'sameMainDomain')).toBe(false);
    }
  });

  it('本地开发域名按端口过滤，三档结果与档位无关', () => {
    for (const url of ['http://localhost:8080', '*.qq.com', 'qq.com', '']) {
      const expected = matchesSiteScope(entry({ url }), ctx('localhost', '3000'), 'off');
      expect(matchesSiteScope(entry({ url }), ctx('localhost', '3000'), 'wildcard')).toBe(expected);
      expect(matchesSiteScope(entry({ url }), ctx('localhost', '3000'), 'sameMainDomain')).toBe(expected);
    }
    expect(matchesSiteScope(entry({ url: 'http://localhost:8080' }), ctx('localhost', '3000'), 'sameMainDomain')).toBe(
      false,
    );
  });

  it('filterEntriesByScope 把档位透传给本站范围判定', () => {
    const source = [
      entry({ id: 'site', url: 'mail.qq.com' }),
      entry({ id: 'apex', url: 'qq.com' }),
      entry({ id: 'offsite', url: 'other.com' }),
    ];
    expect(ids(filterEntriesByScope(source, 'site', ctx('mail.qq.com')))).toEqual(['site']);
    expect(ids(filterEntriesByScope(source, 'site', ctx('mail.qq.com'), 'sameMainDomain'))).toEqual(['site', 'apex']);
  });
});

describe('filterEntriesByScope 范围过滤', () => {
  const source = [
    entry({ id: 'site', url: 'https://example.com/login' }),
    entry({ id: 'generic', url: '' }),
    entry({ id: 'offsite', url: 'other.com' }),
  ];

  it('site 范围只保留本站匹配与空 URL 通用条目', () => {
    expect(ids(filterEntriesByScope(source, 'site', ctx('example.com')))).toEqual(['site', 'generic']);
  });

  it('all 范围放开为全库条目', () => {
    expect(ids(filterEntriesByScope(source, 'all', ctx('example.com')))).toEqual(['site', 'generic', 'offsite']);
  });

  it('无域名时 site 范围等价于全库（与既有行为一致）', () => {
    expect(ids(filterEntriesByScope(source, 'site', ctx('')))).toEqual(['site', 'generic', 'offsite']);
  });

  it('两种范围都返回新数组，就地排序不污染源列表', () => {
    const list = [entry({ id: 'a', updateTime: 1 }), entry({ id: 'b', updateTime: 9 })];

    const all = filterEntriesByScope(list, 'all', ctx('example.com'));
    expect(all).not.toBe(list);
    sortPasswordEntries(all, { prop: 'updateTime', order: 'descending' });
    expect(ids(all)).toEqual(['b', 'a']);
    expect(ids(list)).toEqual(['a', 'b']);

    const site = filterEntriesByScope(list, 'site', ctx(''));
    expect(site).not.toBe(list);
    sortPasswordEntries(site, { prop: 'updateTime', order: 'ascending' });
    expect(ids(site)).toEqual(['a', 'b']);
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('空列表返回空数组', () => {
    expect(filterEntriesByScope([], 'all', ctx('example.com'))).toEqual([]);
    expect(filterEntriesByScope([], 'site', ctx('example.com'))).toEqual([]);
  });
});

describe('applyListFilters 关键词 / 标签 / 收藏过滤', () => {
  const source = [
    entry({ id: 'a', username: 'alice', tag: '工作,重要', remark: '主账号', url: 'example.com', favorite: true }),
    entry({ id: 'b', username: 'bob', tag: '生活', remark: '', url: 'other.com', favorite: false }),
    entry({ id: 'c', username: 'carol', tag: '工作', remark: '测试用', url: '', favorite: false }),
  ];

  it('无任何条件时返回全量副本（新数组）', () => {
    const result = applyListFilters(source, {});
    expect(ids(result)).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(source);
  });

  it('关键词匹配用户名 / 标签 / 备注 / URL，大小写不敏感', () => {
    expect(ids(applyListFilters(source, { keyword: 'ALICE' }))).toEqual(['a']);
    expect(ids(applyListFilters(source, { keyword: '工作' }))).toEqual(['a', 'c']);
    expect(ids(applyListFilters(source, { keyword: '测试' }))).toEqual(['c']);
    expect(ids(applyListFilters(source, { keyword: 'other.com' }))).toEqual(['b']);
    expect(ids(applyListFilters(source, { keyword: '不存在' }))).toEqual([]);
  });

  it('空白关键词等价于不过滤', () => {
    expect(ids(applyListFilters(source, { keyword: '   ' }))).toEqual(['a', 'b', 'c']);
    expect(ids(applyListFilters(source, { keyword: '' }))).toEqual(['a', 'b', 'c']);
  });

  it('标签命中任一即保留，空标签集不参与过滤', () => {
    expect(ids(applyListFilters(source, { tags: ['生活'] }))).toEqual(['b']);
    expect(ids(applyListFilters(source, { tags: ['重要', '生活'] }))).toEqual(['a', 'b']);
    expect(ids(applyListFilters(source, { tags: [] }))).toEqual(['a', 'b', 'c']);
  });

  it('只看收藏仅保留收藏条目', () => {
    expect(ids(applyListFilters(source, { favoriteOnly: true }))).toEqual(['a']);
    expect(ids(applyListFilters(source, { favoriteOnly: false }))).toEqual(['a', 'b', 'c']);
  });

  it('三项条件叠加为交集关系', () => {
    expect(ids(applyListFilters(source, { keyword: '工作', tags: ['重要'], favoriteOnly: true }))).toEqual(['a']);
    expect(ids(applyListFilters(source, { keyword: '工作', tags: ['重要'], favoriteOnly: false }))).toEqual(['a']);
    expect(ids(applyListFilters(source, { keyword: 'bob', tags: ['工作'] }))).toEqual([]);
  });

  it('返回值可安全就地排序，源数组顺序不变', () => {
    const list = [entry({ id: 'a', updateTime: 1 }), entry({ id: 'b', updateTime: 9 })];
    const result = applyListFilters(list, {});
    sortPasswordEntries(result, { prop: 'updateTime', order: 'descending' });
    expect(ids(result)).toEqual(['b', 'a']);
    expect(ids(list)).toEqual(['a', 'b']);
  });
});
