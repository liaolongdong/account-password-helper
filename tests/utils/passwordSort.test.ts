import { describe, expect, it } from 'vitest';
import {
  comparePasswordEntries,
  DEFAULT_SIDEPANEL_SORT,
  DEFAULT_SORT,
  sortPasswordEntries,
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
});
