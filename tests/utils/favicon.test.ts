import { describe, expect, it } from 'vitest';
import { getFaviconUrl, normalizeUrlForFavicon } from '@/utils/favicon';

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
