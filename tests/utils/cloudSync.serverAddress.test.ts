import { describe, expect, it } from 'vitest';
import {
  needsServerInsecureConfirm,
  normalizeServerBaseUrl,
  resolveServerBaseUrl,
} from '@/utils/cloudSync/adapters/serverAddress';

const DEFAULT = 'https://api.example.com';

describe('needsServerInsecureConfirm', () => {
  it('HTTPS、本机 HTTP 与无效输入不要求确认', () => {
    expect(needsServerInsecureConfirm('https://api.corp.example')).toBe(false);
    expect(needsServerInsecureConfirm('http://localhost:8080')).toBe(false);
    expect(needsServerInsecureConfirm('http://127.0.0.1:8080')).toBe(false);
    expect(needsServerInsecureConfirm('http://[::1]:8080')).toBe(false);
    expect(needsServerInsecureConfirm('not-a-url')).toBe(false);
    expect(needsServerInsecureConfirm('')).toBe(false);
  });

  it('内网或公网 HTTP 均要求显式确认', () => {
    expect(needsServerInsecureConfirm('http://192.168.1.8:8080')).toBe(true);
    expect(needsServerInsecureConfirm('http://api.corp.example')).toBe(true);
  });
});

describe('resolveServerBaseUrl', () => {
  it('空值回退默认地址，并保留自定义路径前缀', () => {
    expect(resolveServerBaseUrl('', DEFAULT, false)).toBe(DEFAULT);
    expect(resolveServerBaseUrl('https://api.corp.example/gateway/', DEFAULT, false)).toBe(
      'https://api.corp.example/gateway',
    );
  });

  it('默认放行本机 HTTP 与 HTTPS', () => {
    expect(resolveServerBaseUrl('http://localhost:8080/', DEFAULT, false)).toBe('http://localhost:8080');
    expect(resolveServerBaseUrl('https://api.corp.example/', DEFAULT, false)).toBe('https://api.corp.example');
  });

  it('内网 HTTP 未确认时拒绝，确认后放行', () => {
    expect(() => resolveServerBaseUrl('http://192.168.1.8:8080', DEFAULT, false)).toThrowError(/explicit confirmation/);
    expect(resolveServerBaseUrl('http://192.168.1.8:8080/', DEFAULT, true)).toBe('http://192.168.1.8:8080');
  });

  it('无效地址与非 http(s) 协议拒绝', () => {
    expect(() => resolveServerBaseUrl('not-a-url', DEFAULT, false)).toThrowError(/invalid server base url/);
    expect(() => resolveServerBaseUrl('ftp://api.corp.example', DEFAULT, false)).toThrowError(/unsupported protocol/);
  });
});

describe('normalizeServerBaseUrl', () => {
  it('官方地址归一为 null，自定义地址返回归一化值', () => {
    expect(normalizeServerBaseUrl('', DEFAULT, false)).toBeNull();
    expect(normalizeServerBaseUrl(DEFAULT, DEFAULT, false)).toBeNull();
    expect(normalizeServerBaseUrl('https://api.corp.example/', DEFAULT, false)).toBe('https://api.corp.example');
  });
});
