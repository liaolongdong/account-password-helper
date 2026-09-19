/** @vitest-environment jsdom */

/**
 * 站点规则写入/消费端共用的校验回归测试
 *
 * 背景：站点规则首次有了真实消费端（内容脚本按域名精确匹配读取规则并改写字段检测结果）。
 * 域名是匹配主键，写入端与读取端（`location.hostname`）形态不一致会让规则静默失效；
 * 选择器来自 storage，属不可信输入，必须在使用前完成语法与长度校验。
 */
import { describe, expect, it } from 'vitest';
import {
  isValidCssSelector,
  normalizeSiteRuleDomain,
  SITE_RULE_DOMAIN_MAX_LENGTH,
  SITE_RULE_SELECTOR_MAX_LENGTH,
} from '@/utils/storage/siteRules';

describe('normalizeSiteRuleDomain（规则主键规范化）', () => {
  it('去空白并转小写，与内容脚本 location.hostname 形态对齐', () => {
    expect(normalizeSiteRuleDomain('  Example.COM  ')).toBe('example.com');
    expect(normalizeSiteRuleDomain('ACCOUNT.Example.CO.UK')).toBe('account.example.co.uk');
  });

  it('接受单标签主机名、IP 与带端口形态（本地测试环境常用）', () => {
    expect(normalizeSiteRuleDomain('localhost')).toBe('localhost');
    expect(normalizeSiteRuleDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeSiteRuleDomain('Localhost:8899')).toBe('localhost:8899');
  });

  it('拒绝 URL 形态（用户最易误填，且永远不会被 hostname 命中）', () => {
    expect(normalizeSiteRuleDomain('https://example.com')).toBeNull();
    expect(normalizeSiteRuleDomain('http://example.com/login')).toBeNull();
  });

  it('拒绝空标签、连续点与首尾点/连字符', () => {
    expect(normalizeSiteRuleDomain('')).toBeNull();
    expect(normalizeSiteRuleDomain('   ')).toBeNull();
    expect(normalizeSiteRuleDomain('a..b.com')).toBeNull();
    expect(normalizeSiteRuleDomain('.example.com')).toBeNull();
    expect(normalizeSiteRuleDomain('example.com.')).toBeNull();
    expect(normalizeSiteRuleDomain('-example.com')).toBeNull();
    expect(normalizeSiteRuleDomain('example-.com')).toBeNull();
  });

  it('拒绝通配符与非法字符', () => {
    expect(normalizeSiteRuleDomain('*.example.com')).toBeNull();
    expect(normalizeSiteRuleDomain('example.com?x=1')).toBeNull();
    expect(normalizeSiteRuleDomain('user@example.com')).toBeNull();
  });

  it('拒绝超出 DNS 主机名长度上限的输入（每段标签本身合法）', () => {
    const tooLong = Array.from({ length: 7 }, () => 'a'.repeat(40)).join('.');
    expect(tooLong.length).toBeGreaterThan(SITE_RULE_DOMAIN_MAX_LENGTH);
    expect(normalizeSiteRuleDomain(tooLong)).toBeNull();
  });

  it('非字符串输入按不可信处理，返回 null 而不抛异常', () => {
    expect(normalizeSiteRuleDomain(undefined)).toBeNull();
    expect(normalizeSiteRuleDomain(null)).toBeNull();
    expect(normalizeSiteRuleDomain(12345)).toBeNull();
    expect(normalizeSiteRuleDomain({ domain: 'example.com' })).toBeNull();
  });
});

describe('isValidCssSelector（选择器语法与长度预算）', () => {
  it('接受常见属性/ID/层级选择器', () => {
    expect(isValidCssSelector('input[type="password"]')).toBe(true);
    expect(isValidCssSelector('#login-user')).toBe(true);
    expect(isValidCssSelector('form > input[name="user"]')).toBe(true);
  });

  it('拒绝语法非法的选择器（与消费端 querySelector 同一判定）', () => {
    expect(isValidCssSelector('input[')).toBe(false);
    expect(isValidCssSelector(':::bogus')).toBe(false);
    expect(isValidCssSelector('input,,input')).toBe(false);
  });

  it('拒绝空值与超出长度预算的选择器（避免每轮检测拖慢页面主线程）', () => {
    const withinBudget = `input#${'a'.repeat(SITE_RULE_SELECTOR_MAX_LENGTH - 'input#'.length)}`;
    expect(withinBudget.length).toBe(SITE_RULE_SELECTOR_MAX_LENGTH);
    expect(isValidCssSelector(withinBudget)).toBe(true);
    expect(isValidCssSelector(`${withinBudget}a`)).toBe(false);
    expect(isValidCssSelector('')).toBe(false);
    expect(isValidCssSelector('   ')).toBe(false);
  });

  it('非字符串输入返回 false 而不抛异常', () => {
    expect(isValidCssSelector(undefined)).toBe(false);
    expect(isValidCssSelector(null)).toBe(false);
    expect(isValidCssSelector(42)).toBe(false);
    expect(isValidCssSelector(['input'])).toBe(false);
  });
});
