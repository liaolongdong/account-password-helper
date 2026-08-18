import { describe, expect, it, vi } from 'vitest';
import {
  comparePasswordEntries,
  DEFAULT_SIDEPANEL_SORT,
  DEFAULT_SORT,
  sortPasswordEntries,
  filterAndSortEntriesForDomain,
  type SortState,
} from '@/utils/passwordSort';
import type { PasswordEntry } from '@/utils/types';
import { makePasswordEntry as entry } from '@/tests/helpers/passwordEntry';

/**
 * passwordSort.ts 特征化测试
 *
 * 锁定当前排序契约（优先级链、方向语义、缺失值处理、就地排序等），
 * 仅记录现状，不主张应然。
 */

describe('默认排序常量', () => {
  it('列表默认按 updateTime 降序', () => {
    expect(DEFAULT_SORT).toEqual({ prop: 'updateTime', order: 'descending' });
  });

  it('侧边栏默认按 lastUsedAt 降序', () => {
    expect(DEFAULT_SIDEPANEL_SORT).toEqual({ prop: 'lastUsedAt', order: 'descending' });
  });
});

describe('comparePasswordEntries 优先级链', () => {
  it('priorityFn 优先级最高，数值越小越靠前（且压过收藏置顶）', () => {
    const fav = entry({ id: 'a', favorite: true });
    const normal = entry({ id: 'b', favorite: false });
    // priorityFn 让 normal 优先（返回更小值），即使 fav 是收藏
    const priorityFn = (e: PasswordEntry) => (e.id === 'b' ? 0 : 1);
    expect(comparePasswordEntries(fav, normal, DEFAULT_SORT, priorityFn)).toBeGreaterThan(0);
  });

  it('收藏条目置顶，且不受排序方向影响', () => {
    const fav = entry({ id: 'a', favorite: true, updateTime: 1 });
    const normal = entry({ id: 'b', favorite: false, updateTime: 999 });
    // 降序下收藏在前
    expect(comparePasswordEntries(fav, normal, { prop: 'updateTime', order: 'descending' })).toBeLessThan(0);
    // 升序下收藏仍在前
    expect(comparePasswordEntries(fav, normal, { prop: 'updateTime', order: 'ascending' })).toBeLessThan(0);
  });
});

describe('comparePasswordEntries 字段与方向', () => {
  it('prop 或 order 为空时回退到 updateTime 降序', () => {
    const a = entry({ updateTime: 100 });
    const b = entry({ updateTime: 200 });
    const empty: SortState = { prop: '', order: null };
    // b 更新 → b 在前 → compare(a,b) 为正
    expect(comparePasswordEntries(a, b, empty)).toBeGreaterThan(0);
  });

  it('数值字段：升序小值在前、降序大值在前', () => {
    const a = entry({ order: 1 });
    const b = entry({ order: 2 });
    expect(comparePasswordEntries(a, b, { prop: 'order', order: 'ascending' })).toBeLessThan(0);
    expect(comparePasswordEntries(a, b, { prop: 'order', order: 'descending' })).toBeGreaterThan(0);
  });

  it('字符串字段：按 localeCompare，方向可反转', () => {
    const a = entry({ username: 'apple' });
    const b = entry({ username: 'banana' });
    expect(comparePasswordEntries(a, b, { prop: 'username', order: 'ascending' })).toBeLessThan(0);
    expect(comparePasswordEntries(a, b, { prop: 'username', order: 'descending' })).toBeGreaterThan(0);
  });

  it('有值/无值混合：降序时有值在前，升序时有值在后', () => {
    const withVal = entry({ lastUsedAt: 5 });
    const without = entry({ lastUsedAt: undefined });
    expect(comparePasswordEntries(withVal, without, { prop: 'lastUsedAt', order: 'descending' })).toBeLessThan(0);
    expect(comparePasswordEntries(withVal, without, { prop: 'lastUsedAt', order: 'ascending' })).toBeGreaterThan(0);
  });
});

describe('sortPasswordEntries', () => {
  it('就地排序并返回同一数组引用', () => {
    const list = [entry({ id: 'x', order: 3 }), entry({ id: 'y', order: 1 })];
    const result = sortPasswordEntries(list, { prop: 'order', order: 'ascending' });
    expect(result).toBe(list);
    expect(result.map(e => e.id)).toEqual(['y', 'x']);
  });

  it('默认排序：收藏置顶，其余按 updateTime 降序', () => {
    const list = [
      entry({ id: 'old', updateTime: 100 }),
      entry({ id: 'fav', updateTime: 1, favorite: true }),
      entry({ id: 'new', updateTime: 300 }),
    ];
    const result = sortPasswordEntries(list);
    expect(result.map(e => e.id)).toEqual(['fav', 'new', 'old']);
  });

  it('每条记录仅计算一次优先级，且保持原优先级链排序结果', () => {
    const list = Array.from({ length: 2000 }, (_, index) =>
      entry({
        id: String(index),
        favorite: index % 11 === 0,
        updateTime: 2000 - index,
      }),
    );
    const priorityFn = vi.fn((item: PasswordEntry) => Number(item.id) % 3);
    const expected = [...list].sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SORT, item => Number(item.id) % 3));

    const result = sortPasswordEntries([...list], DEFAULT_SORT, priorityFn);

    expect(priorityFn).toHaveBeenCalledTimes(list.length);
    expect(result.map(item => item.id)).toEqual(expected.map(item => item.id));
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])(
    '非有限统一优先级 %s 保持旧比较器的相等语义',
    priority => {
      const list = [
        entry({ id: 'normal', favorite: false, updateTime: 1 }),
        entry({ id: 'favorite', favorite: true, updateTime: 999 }),
      ];

      const result = sortPasswordEntries([...list], DEFAULT_SORT, () => priority);

      expect(result.map(item => item.id)).toEqual(['normal', 'favorite']);
    },
  );
});

describe('filterAndSortEntriesForDomain（一键填充/内联下拉共用）', () => {
  it('仅纳入精确主机匹配条目，且域名匹配优先于空 URL 条目', () => {
    const list = [
      entry({ id: 'noUrl', url: '', lastUsedAt: 999 }),
      entry({ id: 'match', url: 'https://a.example.com/login', lastUsedAt: 1 }),
      entry({ id: 'other', url: 'https://b.example.com', lastUsedAt: 500 }),
    ];
    const result = filterAndSortEntriesForDomain(list, 'a.example.com');
    // b.example.com 不匹配被过滤；域名匹配的 match 优先于 lastUsedAt 更大的空 URL 条目
    expect(result.map(e => e.id)).toEqual(['match', 'noUrl']);
  });

  it('本地开发域名放行全部条目', () => {
    const list = [
      entry({ id: 'a', url: 'https://a.example.com', lastUsedAt: 1 }),
      entry({ id: 'b', url: 'https://b.example.com', lastUsedAt: 2 }),
    ];
    const result = filterAndSortEntriesForDomain(list, 'localhost');
    expect(result).toHaveLength(2);
    // localhost 下两条均不精确匹配（优先级相同），按侧边栏默认 lastUsedAt 降序
    expect(result.map(e => e.id)).toEqual(['b', 'a']);
  });

  it('本地域名仍保持精确匹配优先级，且优先级高于远程收藏和空 URL', () => {
    const list = [
      entry({ id: 'remoteFav', url: 'https://remote.example.com', favorite: true, lastUsedAt: 999 }),
      entry({ id: 'empty', url: '', lastUsedAt: 1000 }),
      entry({ id: 'local', url: 'http://localhost:3000/login', lastUsedAt: 1 }),
    ];

    expect(filterAndSortEntriesForDomain(list, 'localhost').map(item => item.id)).toEqual([
      'local',
      'remoteFav',
      'empty',
    ]);
  });

  it('重复 id 不会共享优先级缓存，排序按条目对象语义执行', () => {
    const list = [entry({ id: 'same', url: '', favorite: true }), entry({ id: 'same', url: 'https://x.com' })];

    expect(filterAndSortEntriesForDomain(list, 'x.com').map(item => item.url)).toEqual(['https://x.com', '']);
  });

  it('同为域名匹配时收藏置顶，首条即侧边栏展示第一条', () => {
    const list = [
      entry({ id: 'recent', url: 'https://x.com', lastUsedAt: 999 }),
      entry({ id: 'fav', url: 'https://x.com', favorite: true, lastUsedAt: 1 }),
    ];
    const result = filterAndSortEntriesForDomain(list, 'x.com');
    expect(result[0].id).toBe('fav');
  });

  it('自定义排序配置生效（username 升序）', () => {
    const list = [
      entry({ id: 'z', url: 'https://x.com', username: 'zoe' }),
      entry({ id: 'a', url: 'https://x.com', username: 'amy' }),
    ];
    const sort: SortState = { prop: 'username', order: 'ascending' };
    const result = filterAndSortEntriesForDomain(list, 'x.com', sort);
    expect(result.map(e => e.id)).toEqual(['a', 'z']);
  });

  it('无匹配时返回空数组，且不修改入参数组', () => {
    const list = [entry({ id: 'a', url: 'https://a.com' }), entry({ id: 'b', url: 'https://b.com' })];
    const snapshot = list.map(e => e.id);
    const result = filterAndSortEntriesForDomain(list, 'no-match.example.org');
    expect(result).toEqual([]);
    expect(list.map(e => e.id)).toEqual(snapshot);
  });
});
