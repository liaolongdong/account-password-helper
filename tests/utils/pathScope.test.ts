import { describe, expect, it } from 'vitest';
import {
  matchesPathScope,
  normalizePathScope,
  pagePathOf,
  pathScopePriority,
  parsePagePortContext,
  type DomainMatchMode,
  type PortScope,
  type SitePolicy,
} from '@/utils/domain';
import { filterAndSortEntriesForDomain, DEFAULT_SIDEPANEL_SORT } from '@/utils/passwordSort';
import { matchesSiteScope, type ScopeContext } from '@/utils/passwordFilter';
import { makePasswordEntry as entry } from '@/tests/helpers/passwordEntry';

/**
 * pathScope（路径作用域）特征化测试
 *
 * 锁定 F-2 URL 粒度匹配的核心契约：
 * - 路径口径统一为 `pathname + hash`（query 不参与路由身份）；
 * - 归一化对完整 URL / 绝对路径 / 裸片段 / hash 片段统一成同一形态；
 * - 匹配是「主机门之内的硬过滤」：有 scope 的条目只在命中其路径时出现，
 *   无 scope（空/undefined）恒命中，取不到页面路径时放行（向后兼容）；
 * - 排序：同主机档位内，显式路径绑定排在最前，通用条目作回退。
 */

const policy = (mode: DomainMatchMode = 'off', portScope: PortScope = 'loose'): SitePolicy => ({ mode, portScope });
const page = (url: string) => parsePagePortContext(url);

describe('pagePathOf 路径合成', () => {
  it('hash 路由：pathname + hash 拼接', () => {
    expect(pagePathOf('/', '#/desktop')).toBe('/#/desktop');
    expect(pagePathOf('/', '#/')).toBe('/#/');
  });

  it('普通路径与根路径', () => {
    expect(pagePathOf('/login', '')).toBe('/login');
    expect(pagePathOf('/', '')).toBe('/');
  });

  it('两者皆空回退到根路径', () => {
    expect(pagePathOf(undefined, undefined)).toBe('/');
    expect(pagePathOf('', '')).toBe('/');
  });

  it('剥掉 query（hash 内的查询参数也不参与路由身份）', () => {
    expect(pagePathOf('/', '#/r?q=1')).toBe('/#/r');
    expect(pagePathOf('/search', '#/r?q=1')).toBe('/search#/r');
  });
});

describe('normalizePathScope 归一化', () => {
  it('完整 URL 取 pathname + hash', () => {
    expect(normalizePathScope('https://a.com/#/desktop')).toBe('/#/desktop');
    expect(normalizePathScope('https://a.com/login')).toBe('/login');
    expect(normalizePathScope('https://a.com/')).toBe('/');
  });

  it('绝对路径 / 裸片段 / hash 片段归一成同一形态', () => {
    expect(normalizePathScope('/desktop')).toBe('/desktop');
    expect(normalizePathScope('desktop')).toBe('/desktop');
    expect(normalizePathScope('#/desktop')).toBe('/#/desktop');
  });

  it('空值 / 不可解析输入退回空串（等同不限路径）', () => {
    expect(normalizePathScope('')).toBe('');
    expect(normalizePathScope(undefined)).toBe('');
    expect(normalizePathScope(null)).toBe('');
    expect(normalizePathScope('https://')).toBe('');
  });

  it('剥掉 query', () => {
    expect(normalizePathScope('/desktop?q=1')).toBe('/desktop');
  });
});

describe('matchesPathScope 硬过滤语义', () => {
  it('无 scope 恒命中（存量条目行为不变）', () => {
    expect(matchesPathScope('', '/anything')).toBe(true);
    expect(matchesPathScope(undefined, '/anything')).toBe(true);
  });

  it('取不到页面路径时放行（不因缺路径而藏条目）', () => {
    expect(matchesPathScope('/desktop', undefined)).toBe(true);
  });

  it('精确命中', () => {
    expect(matchesPathScope('/desktop', '/desktop')).toBe(true);
    expect(matchesPathScope('/#/desktop', '/#/desktop')).toBe(true);
  });

  it('前缀命中（scope + / 为边界）', () => {
    expect(matchesPathScope('/desktop', '/desktop/123')).toBe(true);
    expect(matchesPathScope('/#/desktop', '/#/desktop/123')).toBe(true);
  });

  it('边界：不把 /desktopx 误配给 /desktop', () => {
    expect(matchesPathScope('/desktop', '/desktopx')).toBe(false);
    expect(matchesPathScope('/desktop', '/desktop-ish')).toBe(false);
  });

  it('不同路径不命中', () => {
    expect(matchesPathScope('/desktop', '/login')).toBe(false);
    expect(matchesPathScope('/#/desktop', '/#/')).toBe(false);
  });
});

describe('pathScopePriority 排序权重', () => {
  it('命中 scope 排最前（0），无 scope 作回退（1）', () => {
    expect(pathScopePriority('/desktop', '/desktop')).toBe(0);
    expect(pathScopePriority('', '/desktop')).toBe(1);
    expect(pathScopePriority(undefined, '/desktop')).toBe(1);
  });
});

describe('filterAndSortEntriesForDomain 路径门与排序', () => {
  const general = entry({ id: 'general', url: 'https://example.com', updateTime: 10 });
  const desktop = entry({ id: 'desktop', url: 'https://example.com', pathScope: '/#/desktop', updateTime: 20 });

  it('命中路径时：路径条目排最前、通用条目作回退', () => {
    const list = filterAndSortEntriesForDomain(
      [general, desktop],
      'example.com',
      DEFAULT_SIDEPANEL_SORT,
      page('https://example.com/#/desktop'),
      policy(),
      null,
      '/#/desktop',
    );
    expect(list.map(p => p.id)).toEqual(['desktop', 'general']);
  });

  it('不命中路径时：路径条目被硬过滤，只留通用', () => {
    const list = filterAndSortEntriesForDomain(
      [general, desktop],
      'example.com',
      DEFAULT_SIDEPANEL_SORT,
      page('https://example.com/#/'),
      policy(),
      null,
      '/#/',
    );
    expect(list.map(p => p.id)).toEqual(['general']);
  });

  it('不传 path（旧调用方）：路径条目仍显示，向后兼容', () => {
    const list = filterAndSortEntriesForDomain(
      [general, desktop],
      'example.com',
      DEFAULT_SIDEPANEL_SORT,
      page('https://example.com/#/'),
      policy(),
      null,
    );
    expect(list.map(p => p.id).sort()).toEqual(['desktop', 'general']);
  });
});

describe('matchesSiteScope 路径门', () => {
  const ctxOf = (domain: string, path?: string): ScopeContext => ({
    domain,
    page: page(`https://${domain}/`),
    envHost: null,
    path,
  });

  it('命中路径：路径条目与通用条目都算本站', () => {
    const desktop = entry({ url: 'https://example.com', pathScope: '/#/desktop' });
    const general = entry({ url: 'https://example.com' });
    expect(matchesSiteScope(desktop, ctxOf('example.com', '/#/desktop'), policy())).toBe(true);
    expect(matchesSiteScope(general, ctxOf('example.com', '/#/desktop'), policy())).toBe(true);
  });

  it('不命中路径：路径条目被挡在站外', () => {
    const desktop = entry({ url: 'https://example.com', pathScope: '/#/desktop' });
    expect(matchesSiteScope(desktop, ctxOf('example.com', '/#/'), policy())).toBe(false);
  });

  it('无路径上下文：路径条目放行（向后兼容）', () => {
    const desktop = entry({ url: 'https://example.com', pathScope: '/#/desktop' });
    expect(matchesSiteScope(desktop, ctxOf('example.com'), policy())).toBe(true);
  });
});
