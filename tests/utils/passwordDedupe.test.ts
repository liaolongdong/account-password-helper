import { describe, expect, it } from 'vitest';
import { findDuplicatePasswordIds } from '@/utils/passwordDedupe';
import { makePasswordEntry as entry } from '@/tests/helpers/passwordEntry';

/**
 * 「一键去重」指纹的特征化测试
 *
 * 回归背景：去重指纹曾是 `username|url` 两项。`pathScope` 上线后，其目标场景
 * （同域不同 SPA 路由各存一套账号）恰好让这类条目的 username + url 完全相同，
 * 一次「一键去重」就会把另一条真实账号判为重复删掉。
 */

const base = { username: 'alice', url: 'https://example.com' };

describe('findDuplicatePasswordIds 指纹口径', () => {
  it('同 username + url 但路径作用域不同：不算重复（本条是回归主用例）', () => {
    const desktop = entry({ id: 'desktop', ...base, pathScope: '/#/desktop', updateTime: 10 });
    const admin = entry({ id: 'admin', ...base, pathScope: '/#/admin', updateTime: 20 });

    expect(findDuplicatePasswordIds([desktop, admin])).toEqual({ idsToRemove: [], groupCount: 0 });
  });

  it('路径作用域只是写法不同（归一化后相同）：仍算重复', () => {
    const absolute = entry({ id: 'absolute', ...base, pathScope: '/desktop', updateTime: 20 });
    const bare = entry({ id: 'bare', ...base, pathScope: 'desktop', updateTime: 10 });

    expect(findDuplicatePasswordIds([absolute, bare])).toEqual({ idsToRemove: ['bare'], groupCount: 1 });
  });

  it('无路径作用域与有路径作用域共存：不算重复', () => {
    const general = entry({ id: 'general', ...base, updateTime: 30 });
    const scoped = entry({ id: 'scoped', ...base, pathScope: '/#/desktop', updateTime: 10 });

    expect(findDuplicatePasswordIds([general, scoped])).toEqual({ idsToRemove: [], groupCount: 0 });
  });

  it('三项完全相同时：收藏优先，其余按 updateTime 降序只留第一条', () => {
    const oldest = entry({ id: 'oldest', ...base, pathScope: '/x', updateTime: 10 });
    const newest = entry({ id: 'newest', ...base, pathScope: '/x', updateTime: 30 });
    const favorite = entry({ id: 'favorite', ...base, pathScope: '/x', updateTime: 1, favorite: true });

    const result = findDuplicatePasswordIds([oldest, newest, favorite]);

    expect(result.groupCount).toBe(1);
    expect(result.idsToRemove.sort()).toEqual(['newest', 'oldest']);
  });
});
