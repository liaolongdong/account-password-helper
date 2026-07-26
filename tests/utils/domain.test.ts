import { describe, expect, it } from 'vitest';
import {
  getMainDomain,
  isSameMainDomain,
  isLocalDevDomain,
  normalizeToHostname,
  isExactHostMatch,
} from '@/utils/domain';

/**
 * domain.ts 契约与安全回归测试
 *
 * 重点锁定「主域名提取」与「同主域名校验」的安全边界：
 * 这两个函数用于决定凭证是否可下发到某个跨 frame，误判即导致明文密码泄露给
 * 无关跨域 iframe。测试既覆盖常规/已知 ccTLD，也覆盖对抗样本（钓鱼域名、
 * 未显式收录的两段式 ccTLD），防止未来重构回退安全属性。
 */

describe('getMainDomain 常规域名', () => {
  it('普通二级域名取最后两段', () => {
    expect(getMainDomain('login.example.com')).toBe('example.com');
    expect(getMainDomain('a.b.c.example.com')).toBe('example.com');
    expect(getMainDomain('example.com')).toBe('example.com');
  });

  it('IP 与单段 hostname 原样返回', () => {
    expect(getMainDomain('192.168.1.1')).toBe('192.168.1.1');
    expect(getMainDomain('localhost')).toBe('localhost');
  });
});

describe('getMainDomain 已显式收录的两段式 ccTLD', () => {
  it('取最后三段（如 com.cn / co.uk / com.hk）', () => {
    expect(getMainDomain('app.example.com.cn')).toBe('example.com.cn');
    expect(getMainDomain('mail.example.co.uk')).toBe('example.co.uk');
    expect(getMainDomain('www.example.com.hk')).toBe('example.com.hk');
    expect(getMainDomain('a.example.gov.uk')).toBe('example.gov.uk');
  });
});

describe('getMainDomain 未显式收录的 ccTLD（启发式兜底）', () => {
  it('末段为两字母国家码且二级为常见注册标签时取最后三段', () => {
    expect(getMainDomain('shop.example.com.br')).toBe('example.com.br');
    expect(getMainDomain('a.example.co.in')).toBe('example.co.in');
    expect(getMainDomain('www.example.com.mx')).toBe('example.com.mx');
    expect(getMainDomain('sub.example.co.za')).toBe('example.co.za');
  });

  it('二级标签非常见注册标签时不误判为 ccTLD（保持两段）', () => {
    // io 为两字母，但 blog 非注册标签 → blog.io 本身即可注册域名
    expect(getMainDomain('my.blog.io')).toBe('blog.io');
    // co 为两字母国家码，但 example 非注册标签 → example.co 本身即可注册域名
    expect(getMainDomain('sub.example.co')).toBe('example.co');
  });
});

describe('isLocalDevDomain', () => {
  it('仅 localhost 与 127.0.0.1 判为本地开发域名', () => {
    expect(isLocalDevDomain('localhost')).toBe(true);
    expect(isLocalDevDomain('127.0.0.1')).toBe(true);
    expect(isLocalDevDomain('example.com')).toBe(false);
  });
});

describe('isSameMainDomain 合法跨子域名场景（应放行）', () => {
  it('同主域名的不同子域名判为同主域名', () => {
    expect(isSameMainDomain('https://login.example.com', 'https://app.example.com')).toBe(true);
    expect(isSameMainDomain('https://accounts.google.com', 'https://mail.google.com')).toBe(true);
  });

  it('已知 ccTLD 下的同主域名跨子域名判为同主域名', () => {
    expect(isSameMainDomain('https://a.example.com.cn', 'https://b.example.com.cn')).toBe(true);
    expect(isSameMainDomain('https://sub.example.co.uk', 'https://www.example.co.uk')).toBe(true);
  });

  it('未收录 ccTLD 下的同主域名跨子域名仍判为同主域名', () => {
    expect(isSameMainDomain('https://a.example.com.br', 'https://b.example.com.br')).toBe(true);
  });
});

describe('isSameMainDomain 对抗样本（必须拒绝，防凭证泄露）', () => {
  it('钓鱼域名不与目标同主域名', () => {
    // 前缀伪装
    expect(isSameMainDomain('https://evil-github.com', 'https://github.com')).toBe(false);
    // 后缀嵌套伪装：github.com.evil.com 主域名为 evil.com
    expect(isSameMainDomain('https://github.com.evil.com', 'https://github.com')).toBe(false);
  });

  it('未收录 ccTLD 下不同注册主体不得判为同主域名（核心安全回归）', () => {
    // 修复前：bank.com.br 与 evil.com.br 均塌缩为 com.br → 误判同主域名
    expect(isSameMainDomain('https://bank.com.br', 'https://evil.com.br')).toBe(false);
    expect(isSameMainDomain('https://pay.co.in', 'https://attacker.co.in')).toBe(false);
  });

  it('子域名不与其他主域名混淆', () => {
    expect(isSameMainDomain('https://example.com', 'https://example.org')).toBe(false);
  });

  it('非法 origin 保守返回 false', () => {
    expect(isSameMainDomain('not-a-url', 'https://example.com')).toBe(false);
  });
});

describe('normalizeToHostname', () => {
  it('兼容完整 URL / 纯域名 / 带端口', () => {
    expect(normalizeToHostname('https://example.com/login')).toBe('example.com');
    expect(normalizeToHostname('example.com')).toBe('example.com');
    expect(normalizeToHostname('localhost:3000')).toBe('localhost');
  });

  it('空输入返回空串', () => {
    expect(normalizeToHostname('')).toBe('');
  });
});

describe('isExactHostMatch', () => {
  it('仅完整 hostname 相同才匹配', () => {
    expect(isExactHostMatch('fat.example.com', 'fat.example.com')).toBe(true);
    expect(isExactHostMatch('example.com', 'https://example.com/login')).toBe(true);
  });

  it('不同子域名 / 主域名不匹配（多测试环境隔离）', () => {
    expect(isExactHostMatch('fat.example.com', 'uat.example.com')).toBe(false);
    expect(isExactHostMatch('fat.example.com', 'example.com')).toBe(false);
  });

  it('任一侧为空返回 false', () => {
    expect(isExactHostMatch('', 'example.com')).toBe(false);
    expect(isExactHostMatch('example.com', '')).toBe(false);
  });
});
