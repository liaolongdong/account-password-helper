/**
 * 跨子域名分级匹配测试（classifySiteMatch / filterEntriesBySiteLevel）
 *
 * 契约（当前页 fat.example.com:8443）：
 * 1. 六级排序：精确 → 同子域端口不同 → 其他子域端口一致 → 主域名 → 其他子域无端口 → 兜底；
 * 2. 端口归一化：条目/页面端口为空/443/80 视为「无端口」，https 隐式 443 与显式 :443 同端口；
 * 3. 显式端口不一致的条目落入兜底级（5），主域名不同的条目 NoMatch；
 * 4. filterEntriesBySiteLevel：开关关闭 = 历史精确行为；空 URL 排最后；
 *    本地开发域名不参与分级；无域名放行全部。
 */
import { describe, expect, it } from 'vitest';
import { classifySiteMatch, SiteMatchLevel } from '@/utils/domain';
import { filterEntriesBySiteLevel } from '@/utils/passwordFilter';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

const HOST = 'fat.example.com';
const PORT = '8443';

describe('classifySiteMatch 六级判定', () => {
  it('同子域 + 端口一致 → ExactHost；条目无端口视为一致', () => {
    expect(classifySiteMatch(HOST, PORT, 'fat.example.com:8443')).toBe(SiteMatchLevel.ExactHost);
    expect(classifySiteMatch(HOST, PORT, 'fat.example.com')).toBe(SiteMatchLevel.ExactHost);
    expect(classifySiteMatch(HOST, '', 'fat.example.com')).toBe(SiteMatchLevel.ExactHost);
  });

  it('默认端口归一化：条目 :443 与页面无端口视为同端口', () => {
    expect(classifySiteMatch(HOST, '', 'fat.example.com:443')).toBe(SiteMatchLevel.ExactHost);
    expect(classifySiteMatch(HOST, '443', 'fat.example.com')).toBe(SiteMatchLevel.ExactHost);
    expect(classifySiteMatch(HOST, '', 'fat.example.com:80')).toBe(SiteMatchLevel.ExactHost);
  });

  it('同子域 + 显式端口不同 → SameHostDiffPort', () => {
    expect(classifySiteMatch(HOST, PORT, 'fat.example.com:9090')).toBe(SiteMatchLevel.SameHostDiffPort);
    // 页面无端口、条目带显式端口 → 端口不同
    expect(classifySiteMatch(HOST, '', 'fat.example.com:9090')).toBe(SiteMatchLevel.SameHostDiffPort);
  });

  it('其他子域 + 显式端口一致 → SubDomainMatchPort', () => {
    expect(classifySiteMatch(HOST, PORT, 'uat.example.com:8443')).toBe(SiteMatchLevel.SubDomainMatchPort);
  });

  it('主域名条目（端口一致或无端口）→ MainDomain', () => {
    expect(classifySiteMatch(HOST, PORT, 'example.com')).toBe(SiteMatchLevel.MainDomain);
    expect(classifySiteMatch(HOST, PORT, 'example.com:8443')).toBe(SiteMatchLevel.MainDomain);
  });

  it('其他子域 + 无端口（通用）→ SubDomainNoPort', () => {
    expect(classifySiteMatch(HOST, PORT, 'dev.example.com')).toBe(SiteMatchLevel.SubDomainNoPort);
  });

  it('端口不一致的近似条目（其他子域 / 主域名）→ 兜底 SameMainDiffPort', () => {
    expect(classifySiteMatch(HOST, PORT, 'uat.example.com:9090')).toBe(SiteMatchLevel.SameMainDiffPort);
    expect(classifySiteMatch(HOST, PORT, 'example.com:9090')).toBe(SiteMatchLevel.SameMainDiffPort);
  });

  it('主域名不同 → NoMatch；空 URL → EmptyUrl', () => {
    expect(classifySiteMatch(HOST, PORT, 'other.org')).toBe(SiteMatchLevel.NoMatch);
    expect(classifySiteMatch(HOST, PORT, 'https://evil-example.com')).toBe(SiteMatchLevel.NoMatch);
    expect(classifySiteMatch(HOST, PORT, '')).toBe(SiteMatchLevel.EmptyUrl);
  });

  it('两段式 ccTLD 主域名识别', () => {
    expect(classifySiteMatch('fat.example.com.cn', '', 'example.com.cn')).toBe(SiteMatchLevel.MainDomain);
    expect(classifySiteMatch('fat.example.com.cn', '', 'uat.example.com.cn')).toBe(SiteMatchLevel.SubDomainNoPort);
    // bank.com.br 与 evil.com.br 主域名不同（ccTLD 兜底识别），不互相降级命中
    expect(classifySiteMatch('bank.com.br', '', 'evil.com.br')).toBe(SiteMatchLevel.NoMatch);
  });

  it('URL 规范化：完整 URL / 大小写 / 路径均正确分级', () => {
    expect(classifySiteMatch(HOST, PORT, 'https://FAT.Example.COM:8443/login')).toBe(SiteMatchLevel.ExactHost);
    expect(classifySiteMatch(HOST, PORT, 'https://example.com')).toBe(SiteMatchLevel.MainDomain);
  });
});

describe('filterEntriesBySiteLevel', () => {
  const ctx = (crossSubdomain: boolean) => ({ domain: HOST, port: PORT, crossSubdomain });

  const entries = [
    makePasswordEntry({ id: 'exact', url: 'fat.example.com:8443' }),
    makePasswordEntry({ id: 'port-diff', url: 'fat.example.com:9090' }),
    makePasswordEntry({ id: 'sub-port', url: 'uat.example.com:8443' }),
    makePasswordEntry({ id: 'main', url: 'example.com' }),
    makePasswordEntry({ id: 'sub-noport', url: 'dev.example.com' }),
    makePasswordEntry({ id: 'approx', url: 'sit.example.com:9090' }),
    makePasswordEntry({ id: 'empty-url', url: '' }),
    makePasswordEntry({ id: 'foreign', url: 'other.org' }),
  ];

  it('开关关闭：仅精确匹配 + 空 URL（历史行为）', () => {
    const result = filterEntriesBySiteLevel(entries, ctx(false));
    expect(result.map(r => r.entry.id)).toEqual(['exact', 'empty-url']);
    expect(result[0].level).toBe(SiteMatchLevel.ExactHost);
  });

  it('开关开启：六级顺序 + 外站排除 + 空 URL 最后', () => {
    const result = filterEntriesBySiteLevel(entries, ctx(true));
    expect(result.map(r => r.entry.id)).toEqual([
      'exact',
      'port-diff',
      'sub-port',
      'main',
      'sub-noport',
      'approx',
      'empty-url',
    ]);
  });

  it('本地开发域名不参与分级：走端口过滤旧逻辑，级别记精确', () => {
    const localEntries = [
      makePasswordEntry({ id: 'p3000', url: 'http://localhost:3000' }),
      makePasswordEntry({ id: 'p8080', url: 'http://localhost:8080' }),
      makePasswordEntry({ id: 'noport', url: '' }),
    ];
    const result = filterEntriesBySiteLevel(localEntries, {
      domain: 'localhost',
      port: '3000',
      crossSubdomain: true,
    });
    expect(result.map(r => r.entry.id)).toEqual(['p3000', 'noport']);
    expect(result.every(r => r.level === SiteMatchLevel.ExactHost)).toBe(true);
  });

  it('无域名（新标签页）：放行全部且级别记精确', () => {
    const result = filterEntriesBySiteLevel(entries, { domain: '', port: '', crossSubdomain: true });
    expect(result).toHaveLength(entries.length);
    expect(result.every(r => r.level === SiteMatchLevel.ExactHost)).toBe(true);
  });
});
