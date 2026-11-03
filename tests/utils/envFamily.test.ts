/**
 * 环境族聚合纯函数回归测试（utils/envFamily）
 *
 * 这个候选集决定本地页芯片上出现哪些环境，因此每条断言都在防一种具体的错：
 *
 * 1. **候选集只能来自库里真实存在的网址。** 内置环境词只用于识别标签，不用于生成选项——
 *    否则芯片会列出一堆点了什么也带不出来的环境。
 * 2. **同一注册域的不同环境必须分开成族。** 把 `dev.example.com` 与 `fat.example.com`
 *    并成一族，绑定后就分不清填的是哪套凭证。
 * 3. **不同注册域的同名环境也必须分开。** `dev.example.com` 与 `dev.other.com` 是两个系统，
 *    合并等于跨域串号。
 * 4. **注册域本体只有在「该域已有环境族」时才算线上候选。** 不加这条限制，
 *    库里的 `github.com`、`qq.com` 都会伪装成 prod 环境挤进芯片。
 * 5. **环回主机不进候选集。** `localhost` 不能绑定到它自己身上。
 */
import { describe, expect, it } from 'vitest';
import { APEX_ENV_LABEL, collectEnvFamilies, envLabelOfHost, isProductionEnv } from '@/utils/envFamily';

const urls = (...list: string[]) => list.map(url => ({ url }));

describe('envFamily.envLabelOfHost', () => {
  it('从左往右取第一个命中的环境标签', () => {
    expect(envLabelOfHost('fat.example.com')).toBe('fat');
    expect(envLabelOfHost('api.fat.example.com')).toBe('fat');
    expect(envLabelOfHost('dev.example.com.cn')).toBe('dev');
  });

  it('只认完整标签，不做前缀匹配', () => {
    expect(envLabelOfHost('pre-fix.example.com')).toBeNull();
    expect(envLabelOfHost('testbed.example.com')).toBeNull();
    expect(envLabelOfHost('prod-api.example.com')).toBeNull();
  });

  it('注册域本体与无环境标签的主机返回 null', () => {
    expect(envLabelOfHost('example.com')).toBeNull();
    expect(envLabelOfHost('www.example.com')).toBeNull();
    expect(envLabelOfHost('mail.qq.com')).toBeNull();
  });

  it('大小写与 IP 不产出环境标签', () => {
    expect(envLabelOfHost('192.168.1.10')).toBeNull();
    expect(envLabelOfHost('uat.example.com')).toBe('uat');
  });
});

describe('envFamily.isProductionEnv', () => {
  it('线上词与注册域本体哨兵算线上，其余不算', () => {
    expect(isProductionEnv('prod')).toBe(true);
    expect(isProductionEnv('online')).toBe(true);
    expect(isProductionEnv('fat')).toBe(false);
    expect(isProductionEnv(APEX_ENV_LABEL)).toBe(false);
  });
});

describe('envFamily.collectEnvFamilies', () => {
  it('把同一系统的四个环境摊成四族，并按条目数倒序', () => {
    const families = collectEnvFamilies(
      urls(
        'https://fat.example.com/login',
        'fat.example.com',
        'https://dev.example.com',
        'https://example.com',
        'https://github.com',
      ),
    );

    expect(families.map(f => [f.env, f.host, f.count, f.production])).toEqual([
      ['fat', 'fat.example.com', 2, false],
      ['dev', 'dev.example.com', 1, false],
      ['prod', 'example.com', 1, true],
    ]);
  });

  it('不同注册域的同名环境分成两族，不跨域串号', () => {
    const families = collectEnvFamilies(urls('dev.example.com', 'dev.other.com'));

    expect(families).toHaveLength(2);
    expect(families.map(f => f.mainDomain).sort()).toEqual(['example.com', 'other.com']);
  });

  it('同环境多子主机聚成一族，代表主机取条目最多的那个', () => {
    const families = collectEnvFamilies(
      urls('fat.example.com', 'fat.example.com', 'api.fat.example.com', 'web.fat.example.com'),
    );

    expect(families).toHaveLength(1);
    expect(families[0].host).toBe('fat.example.com');
    expect(families[0].count).toBe(2);
    expect(families[0].siblingCount).toBe(2);
  });

  it('带端口与大小写混杂的写法仍归同一主机：归一只看 hostname', () => {
    const families = collectEnvFamilies(urls('https://FAT.example.com:8443/login', 'fat.example.com:3000'));

    expect(families).toHaveLength(1);
    expect(families[0].host).toBe('fat.example.com');
    expect(families[0].count).toBe(2);
  });

  it('陌生站点不会被伪装成 prod 候选', () => {
    const families = collectEnvFamilies(urls('github.com', 'qq.com', 'https://example.com/x'));

    expect(families).toEqual([]);
  });

  it('环回主机不进候选集：本地端点不是「环境」', () => {
    const families = collectEnvFamilies(urls('localhost:3000', '127.0.0.1:4000', '[::1]:5173'));

    expect(families).toEqual([]);
  });

  it('`*.localhost` 这类环回通配也不进候选集', () => {
    expect(collectEnvFamilies(urls('*.localhost'))).toEqual([]);
  });

  it('没有环境词可识别时返回空数组，芯片不出现', () => {
    expect(collectEnvFamilies(urls('example.com', 'github.com', ''))).toEqual([]);
    expect(collectEnvFamilies([])).toEqual([]);
  });

  it('空网址与畸形网址不产生族', () => {
    expect(collectEnvFamilies(urls('', '   ', 'not a url'))).toEqual([]);
  });

  it('线上环境的四种常见写法都标 production', () => {
    const families = collectEnvFamilies(urls('prod.example.com', 'production.other.com', 'online.a.com', 'live.b.com'));

    expect(families.every(f => f.production)).toBe(true);
  });
});
