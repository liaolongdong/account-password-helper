import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFaviconDataUrl, getFaviconUrl, normalizeUrlForFavicon } from '@/utils/favicon';
import { clearPlaintextKeyedCaches } from '@/utils/plaintextCacheCleanup';

/**
 * favicon.ts 契约测试
 *
 * 网站图标 URL 基于扩展本地 `_favicon/` 端点构造（零外部网络请求），
 * 锁定「URL 归一化」与「端点参数编码」行为，防止未来重构导致
 * 图标失效或将未编码的用户输入拼入 URL。
 */

describe('normalizeUrlForFavicon', () => {
  it('空输入返回空字符串', () => {
    expect(normalizeUrlForFavicon('')).toBe('');
    expect(normalizeUrlForFavicon('   ')).toBe('');
  });

  it('无协议地址自动补全 https://', () => {
    expect(normalizeUrlForFavicon('github.com')).toBe('https://github.com');
    expect(normalizeUrlForFavicon('login.example.com/path')).toBe('https://login.example.com/path');
  });

  it('已带协议的地址原样保留（含 http）', () => {
    expect(normalizeUrlForFavicon('https://github.com')).toBe('https://github.com');
    expect(normalizeUrlForFavicon('http://192.168.1.1:8080')).toBe('http://192.168.1.1:8080');
    expect(normalizeUrlForFavicon('HTTPS://Example.com')).toBe('HTTPS://Example.com');
  });

  it('首尾空白被裁剪', () => {
    expect(normalizeUrlForFavicon('  github.com  ')).toBe('https://github.com');
  });

  it('通配条目还原为可取图标的主机（`*` 不是合法主机名）', () => {
    expect(normalizeUrlForFavicon('*.qq.com')).toBe('https://qq.com');
    expect(normalizeUrlForFavicon('https://*.qq.com/login')).toBe('https://qq.com/login');
    expect(normalizeUrlForFavicon('*.')).toBe('');
  });
});

describe('getFaviconUrl', () => {
  it('空地址返回空字符串', () => {
    expect(getFaviconUrl('')).toBe('');
  });

  it('基于 _favicon/ 端点构造并编码 pageUrl 参数', () => {
    const url = getFaviconUrl('github.com', 32);
    expect(url).toContain('/_favicon/');
    expect(url).toContain(`pageUrl=${encodeURIComponent('https://github.com')}`);
    expect(url).toContain('size=32');
  });

  it('默认尺寸为 32', () => {
    expect(getFaviconUrl('example.com')).toContain('size=32');
  });

  it('特殊字符地址被安全编码', () => {
    const url = getFaviconUrl('example.com/a?b=1&c=2');
    expect(url).toContain(encodeURIComponent('https://example.com/a?b=1&c=2'));
    // 原始 & 不应裸露在查询参数中破坏 URL 结构
    expect(url.split('?')[1]).not.toContain('c=2&');
  });
});

describe('fetchFaviconDataUrl 的缓存随会话边界销毁', () => {
  /** 本地端点响应桩：只统计被真正读取了几次（缓存命中即不再发请求） */
  let reads: number;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    reads = 0;
    globalThis.fetch = vi.fn(async () => {
      reads++;
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
        headers: { get: () => 'image/png' },
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('同一 URL 命中缓存不重复读取，但清理器跑过之后必须重新读取', async () => {
    await expect(fetchFaviconDataUrl('github.com', 32)).resolves.toContain('data:image/png;base64,');
    expect(reads).toBe(1);

    await fetchFaviconDataUrl('github.com', 32);
    expect(reads, '同域名图标在缓存存活期内应只读取一次').toBe(1);

    // 键取自条目 url 字段的明文派生值，锁定/过期时必须整把丢弃
    clearPlaintextKeyedCaches();
    await fetchFaviconDataUrl('github.com', 32);
    expect(reads, 'clearPlaintextKeyedCaches() 未清掉 favicon 缓存：站点清单在保活的 SW 里无限期驻留').toBe(2);
  });

  it('不同尺寸各自占一个键', async () => {
    await fetchFaviconDataUrl('example.com', 16);
    await fetchFaviconDataUrl('example.com', 32);
    expect(reads).toBe(2);
  });
});
