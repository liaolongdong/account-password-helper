import { describe, expect, it } from 'vitest';
import { findOtherPathScopePeers, type PathScopePeer } from '@/utils/pathScopePeers';

/**
 * 路径冲突提示的纯函数口径
 *
 * 这里锁的是「什么算同一条账号的另一路由条目」：
 * 同 origin（host + 已声明的端口）、同用户名（trim 后精确比较）、
 * 非空且归一后不同的 pathScope。空 scope 是通用条目，不构成冲突；
 * 归一后相同（尾斜杠 / 裸片段）也不该提示。
 */
const peer = (overrides: Partial<PathScopePeer>): PathScopePeer => ({
  username: 'alice',
  url: 'example.com',
  pathScope: '',
  ...overrides,
});

describe('findOtherPathScopePeers', () => {
  it('同 host 同用户名、不同路径：命中其它路由条目', () => {
    const peers = [
      peer({ url: 'https://example.com/login', pathScope: '/#/admin' }),
      peer({ url: 'example.com', pathScope: '/#/desktop' }),
    ];
    const hits = findOtherPathScopePeers(peers, { username: 'alice', url: 'example.com', pathScope: '' });
    expect(hits.map(h => h.pathScope)).toEqual(['/#/admin', '/#/desktop']);
  });

  it('端口属于 origin：端口不同（或一侧未声明）不提示', () => {
    const peers = [peer({ url: 'example.com:8443', pathScope: '/#/admin' })];
    // 同端口：命中
    expect(
      findOtherPathScopePeers(peers, { username: 'alice', url: 'https://example.com:8443/app', pathScope: '' }),
    ).toHaveLength(1);
    // 换端口 / 未声明端口：都不视为同一站点
    expect(findOtherPathScopePeers(peers, { username: 'alice', url: 'example.com:9443', pathScope: '' })).toEqual([]);
    expect(findOtherPathScopePeers(peers, { username: 'alice', url: 'example.com', pathScope: '' })).toEqual([]);
  });

  it('通配条目与具体主机不互相触发提示', () => {
    const peers = [peer({ url: '*.qq.com', pathScope: '/#/admin' })];
    expect(findOtherPathScopePeers(peers, { username: 'alice', url: 'mail.qq.com', pathScope: '' })).toEqual([]);
  });

  it('空路径的通用条目不算冲突来源', () => {
    const peers = [peer({ pathScope: '' }), peer({ pathScope: '   ' })];
    expect(findOtherPathScopePeers(peers, { username: 'alice', url: 'example.com', pathScope: '' })).toEqual([]);
  });

  it('归一后相同的路径不再提示（尾斜杠 / 裸片段视为同一作用域）', () => {
    const peers = [peer({ pathScope: '/desktop/' })];
    expect(findOtherPathScopePeers(peers, { username: 'alice', url: 'example.com', pathScope: 'desktop' })).toEqual([]);
  });

  it('用户名不同或 host 不同都不提示（用户名 trim 后精确比较）', () => {
    const peers = [
      peer({ username: 'bob', pathScope: '/#/admin' }),
      peer({ username: 'alice', url: 'another.test', pathScope: '/#/admin' }),
    ];
    expect(
      findOtherPathScopePeers(peers, { username: ' alice ', url: 'https://example.com/a', pathScope: '' }),
    ).toEqual([]);
  });

  it('当前输入缺少 host 或用户名时短路为无冲突', () => {
    const peers = [peer({ pathScope: '/#/admin' })];
    expect(findOtherPathScopePeers(peers, { username: '', url: 'example.com', pathScope: '' })).toEqual([]);
    expect(findOtherPathScopePeers(peers, { username: 'alice', url: '', pathScope: '' })).toEqual([]);
  });
});
