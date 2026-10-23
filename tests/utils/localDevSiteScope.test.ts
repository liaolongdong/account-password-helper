import { describe, expect, it } from 'vitest';
import {
  canonicalSiteHost,
  countPortHiddenCandidates,
  isExactHostMatch,
  isHiddenByPortOnly,
  isLoopbackHost,
  matchesPortScope,
  matchesSiteEndpoint,
  normalizeToHostname,
  resolveMatchTier,
  splitHostAndPortDecl,
  siteRankOf,
  NOT_ON_SITE_RANK,
  OTHER_PORT_RANK,
  type EffectiveSitePolicy,
  type PagePortContext,
} from '@/utils/domain';
import { filterEntriesByScope, matchesSiteScope, type ScopeContext } from '@/utils/passwordFilter';
import { filterAndSortEntriesForDomain } from '@/utils/passwordSort';
import { createUrlValidator } from '@/utils/formValidators';
import type { PasswordEntry } from '@/utils/types';
import { makePasswordEntry as entry } from '@/tests/helpers/passwordEntry';

/**
 * 本地开发端点（环回主机）的站点匹配契约
 *
 * 存在理由：`localhost` / `127.0.0.1` 曾走一条「只比端口、不比主机」的独立分支，
 * 于是 `127.0.0.1:3000` 页面上 `example.com` 与 `example.com:3000` 的条目被当作本站
 * 且可填充（跨 origin 凭证外填），而同主机的 `:4000` 条目却静默消失且无任何提示。
 * 这里把修好后的四条不变量钉死：
 * 1. 主机门不可绕开 —— 外站条目在本地页面恒不可见、不可填；
 * 2. 环回写法折叠为同一主体 —— `localhost` / `127.0.0.1` / `[::1]` 同端口互通，
 *    而 `myapp.localhost`、内网 IP 不并入；
 * 3. 端口通配 `<host>:*` 是逐条显式授权 —— `loose` 与 `strict` 都放行，且不泄漏到外站；
 * 4. 「被端口挡住」必须数得出来并能临时放宽显示，但临时放宽只放宽显示、不放宽填充。
 */

/** 从 URL 取端口上下文（与 `parsePagePortContext` 同口径，此处内联以保持用例自解释） */
const pageOf = (rawUrl: string): PagePortContext => {
  const url = new URL(rawUrl);
  if (url.port) return { port: url.port, atDefaultPort: false };
  return url.protocol === 'https:' ? { port: '443', atDefaultPort: true } : { port: '80', atDefaultPort: true };
};

/** 列表条目 id 序列 */
const ids = (list: readonly PasswordEntry[]): string[] => list.map(item => item.id);

/** 本地开发页面与一组覆盖各形态的条目网址 */
const LOCAL_URLS = [
  '',
  'localhost:3000',
  '127.0.0.1:3000',
  'http://localhost:3000/login',
  '[::1]:3000',
  'localhost',
  'localhost:*',
  'localhost:4000',
  '127.0.0.1:4000',
  'myapp.localhost:3000',
  'example.com',
  'https://github.com/login',
  'example.com:3000',
  '192.168.1.5:3000',
];

const LOCAL_CTX: ScopeContext = { domain: '127.0.0.1', page: pageOf('http://127.0.0.1:3000/') };
const LOOSE: EffectiveSitePolicy = { mode: 'off', portScope: 'loose' };
const RELAXED: EffectiveSitePolicy = { mode: 'off', portScope: 'relaxed' };

/** 跑一次 Element Plus 校验器，把 callback 形态转成布尔（通过 = true） */
function passes(validate: ReturnType<typeof createUrlValidator>, value: string): boolean {
  let error: Error | undefined;
  validate({} as never, value, (err?: Error) => {
    error = err;
  });
  return error === undefined;
}

describe('不变量 1：本地页面的主机门不可绕开', () => {
  const visible = (url: string) => matchesSiteScope(entry({ url }), LOCAL_CTX, LOOSE);

  it('本站范围只保留同端点、环回别名、端口通配与空 URL 通用条目', () => {
    expect(LOCAL_URLS.filter(visible)).toEqual([
      '',
      'localhost:3000',
      '127.0.0.1:3000',
      'http://localhost:3000/login',
      '[::1]:3000',
      'localhost',
      'localhost:*',
    ]);
  });

  it('外站条目不可见，无论它写不写端口、端口是否恰好相同', () => {
    for (const url of ['example.com', 'https://github.com/login', 'example.com:3000', '192.168.1.5:3000']) {
      expect(visible(url), url).toBe(false);
    }
  });

  it('`myapp.localhost` 是不同虚拟主机，不因同端口而并入', () => {
    expect(visible('myapp.localhost:3000')).toBe(false);
  });

  it('内联下拉与侧边栏共用同一可见集（杜绝「下拉里有、侧边栏没有」）', () => {
    const all = LOCAL_URLS.map((url, i) => entry({ id: `e${i}`, url }));
    const dropdown = filterAndSortEntriesForDomain(all, LOCAL_CTX.domain, undefined, LOCAL_CTX.page, LOOSE);
    const sidebar = filterEntriesByScope(all, 'site', LOCAL_CTX, LOOSE);
    expect(ids(dropdown).sort()).toEqual(ids(sidebar).sort());
    // 一键填充取首条：首条必须确实是本地端点条目
    expect(dropdown[0]?.url).toMatch(/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::3000|\D)/);
  });

  it('当前页在默认端口（http://127.0.0.1/）时仍受主机门约束', () => {
    const rootCtx: ScopeContext = { domain: '127.0.0.1', page: pageOf('http://127.0.0.1/') };
    expect(matchesSiteScope(entry({ url: 'example.com' }), rootCtx, LOOSE)).toBe(false);
    // 同主机的未写端口与已写端口条目都放行（保持既有「当前页无端口 → 展示全部」意图）
    expect(matchesSiteScope(entry({ url: 'localhost:4000' }), rootCtx, LOOSE)).toBe(true);
    expect(matchesSiteScope(entry({ url: 'localhost' }), rootCtx, LOOSE)).toBe(true);
  });
});

describe('不变量 2：环回写法折叠为同一主体', () => {
  it('isLoopbackHost 认三种字面写法，不认内网 IP 与自定义主机', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', '::1']) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['myapp.localhost', '192.168.1.5', '10.0.0.5', 'myapp.test', 'example.com', '']) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it('canonicalSiteHost 只折叠环回，其余主机逐字不变', () => {
    expect(canonicalSiteHost('127.0.0.1')).toBe('localhost');
    expect(canonicalSiteHost('[::1]')).toBe('localhost');
    expect(canonicalSiteHost('LOCALHOST')).toBe('localhost');
    expect(canonicalSiteHost('  localhost ')).toBe('localhost');
    expect(canonicalSiteHost('myapp.localhost')).toBe('myapp.localhost');
    expect(canonicalSiteHost('192.168.1.5')).toBe('192.168.1.5');
    expect(canonicalSiteHost('sub.example.com')).toBe('sub.example.com');
  });

  it('off 档下 localhost 页面命中 127.0.0.1 条目，反向亦然', () => {
    expect(resolveMatchTier('localhost', '127.0.0.1:3000', 'off')).toBe(0);
    expect(resolveMatchTier('127.0.0.1', 'localhost:3000', 'off')).toBe(0);
    expect(resolveMatchTier('[::1]', 'localhost:3000', 'off')).toBe(0);
  });

  it('Popup 计数用的 isExactHostMatch 同样认别名（否则两个入口又会各说一套）', () => {
    expect(isExactHostMatch('localhost', '127.0.0.1:3000')).toBe(true);
    expect(isExactHostMatch('127.0.0.1', 'localhost:3000')).toBe(true);
    expect(isExactHostMatch('127.0.0.1', '[::1]:3000')).toBe(true);
    expect(isExactHostMatch('localhost', 'myapp.localhost:3000')).toBe(false);
    expect(isExactHostMatch('localhost', 'example.com:3000')).toBe(false);
  });

  it('wildcard 档下 `*.localhost` 条目终于覆盖 127.0.0.1 页面', () => {
    expect(resolveMatchTier('127.0.0.1', '*.localhost', 'wildcard')).toBe(1);
    expect(resolveMatchTier('localhost', '*.localhost', 'wildcard')).toBe(1);
    expect(resolveMatchTier('myapp.localhost', '*.other', 'wildcard')).toBe(-1);
  });

  it('sameMainDomain 档不因别名把环回与公网折到一起', () => {
    expect(resolveMatchTier('localhost', 'example.com', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier('example.com', 'localhost:3000', 'sameMainDomain')).toBe(-1);
  });
});

describe('不变量 3：`<host>:*` 端口通配是逐条显式授权', () => {
  it('splitHostAndPortDecl 认字面 `:*`，并与 IPv6 / 凭据形态共存', () => {
    expect(splitHostAndPortDecl('localhost:*')).toEqual({ host: 'localhost', port: '', anyPort: true });
    expect(splitHostAndPortDecl('https://example.com:*/login')).toEqual({
      host: 'example.com',
      port: '',
      anyPort: true,
    });
    expect(splitHostAndPortDecl('localhost:3000')).toEqual({ host: 'localhost', port: '3000', anyPort: false });
    expect(splitHostAndPortDecl('http://[::1]:8080/api')).toEqual({ host: '[::1]', port: '8080', anyPort: false });
    expect(splitHostAndPortDecl('https://user:pw@example.com/')).toEqual({
      host: 'example.com',
      port: '',
      anyPort: false,
    });
    // 凭据必须先剥掉：`https://user:pw@localhost:*` 走的是 URL 解析抛错后的文本口径，
    // 若不剥就会得到 `user:pw@localhost` 这个匹配不上任何站点的死条目
    expect(splitHostAndPortDecl('https://user:pw@localhost:*')).toEqual({
      host: 'localhost',
      port: '',
      anyPort: true,
    });
    expect(splitHostAndPortDecl('')).toEqual({ host: '', port: '', anyPort: false });
  });

  it('normalizeToHostname 不被 `:*` 留下脏尾（否则主机门永不命中）', () => {
    expect(normalizeToHostname('localhost:*')).toBe('localhost');
    expect(normalizeToHostname('https://example.com:*/login')).toBe('example.com');
    expect(normalizeToHostname('*.localhost:*')).toBe('*.localhost');
  });

  it('strict 档下 `:*` 放行，未写端口仍按门面地址处理', () => {
    const at8443 = pageOf('https://example.com:8443/');
    expect(matchesPortScope('example.com:*', at8443, 'strict')).toBe(true);
    expect(matchesPortScope('example.com', at8443, 'strict')).toBe(false);
    expect(matchesPortScope('example.com:8443', at8443, 'strict')).toBe(true);
    expect(matchesPortScope('example.com:9090', at8443, 'strict')).toBe(false);
  });

  it('`:*` 条目在本地页面可见，但绝不因此带出外站条目', () => {
    const ctx: ScopeContext = { domain: 'localhost', page: pageOf('http://localhost:3000/') };
    expect(matchesSiteScope(entry({ url: 'localhost:*' }), ctx, LOOSE)).toBe(true);
    expect(matchesSiteScope(entry({ url: 'example.com:*' }), ctx, LOOSE)).toBe(false);
    // 同一判据在域名之外也成立：`:*` 只放开端口轴，不放开主机轴
    expect(matchesSiteEndpoint('localhost:*', 'localhost', ctx.page, LOOSE)).toBe(true);
    expect(matchesSiteEndpoint('example.com:*', 'localhost', ctx.page, LOOSE)).toBe(false);
  });

  it('录入校验接受 `:*`，仍拒绝非法端口与既有非法形态', () => {
    const validate = createUrlValidator(key => key);
    for (const value of [
      'localhost:*',
      '127.0.0.1:*',
      '*.localhost:*',
      'example.com:*',
      'https://example.com:*/login',
      'https://user:pw@localhost:*',
    ]) {
      expect(passes(validate, value), `${value} 应通过`).toBe(true);
    }
    for (const value of ['localhost:**', 'localhost:999999', 'https://exa mple.com', 'https://', '*.evil']) {
      expect(passes(validate, value), `${value} 应被拒`).toBe(false);
    }
  });
});

describe('不变量 5：排序按「与当前站点的关联度」，与档位无关', () => {
  const fat = { domain: 'fat.example.com', page: pageOf('https://fat.example.com/') };
  const loose: EffectiveSitePolicy = { mode: 'off', portScope: 'loose' };

  /** 关联度从高到低：精确 → 通配 → 主域 apex → 兄弟子域 → 空 URL 通用 → 无关站点 */
  it('全站范围里同主域兄弟子域排在无关站点之前', () => {
    const rank = (url: string) => siteRankOf(url, fat.domain, fat.page, loose);
    expect(rank('fat.example.com')).toBe(0);
    expect(rank('*.example.com')).toBe(1);
    expect(rank('example.com')).toBe(2);
    expect(rank('dev.example.com')).toBe(3);
    expect(rank('')).toBe(4);
    expect(rank('github.com')).toBe(NOT_ON_SITE_RANK);
    // 用户提的那条：dev 与 github 在改前同为二值 1，谁前谁后只由收藏与最后使用时间决定
    expect(rank('dev.example.com')).toBeLessThan(rank('github.com'));
  });

  it('排序权重必须严格递增分层，且外站与「其他端口」永远在最后', () => {
    const ranks = ['fat.example.com', '*.example.com', 'example.com', 'dev.example.com', ''].map(url =>
      siteRankOf(url, fat.domain, fat.page, loose),
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(OTHER_PORT_RANK).toBeGreaterThan(NOT_ON_SITE_RANK);
    expect(NOT_ON_SITE_RANK).toBeGreaterThan(4);
  });

  it('「本站」可见集的顺序不受影响：精确仍在通用条目之前', () => {
    const onSite = ['fat.example.com', ''].map(url => siteRankOf(url, fat.domain, fat.page, loose));
    expect(onSite).toEqual([0, 4]);
  });

  it('同主机其他端口只在「本档位下算本站却被端口挡住」时沉底', () => {
    const local = { host: 'localhost', page: pageOf('http://localhost:3000/') };
    // 环回 + loose：:4000 属于本站主机，但端口不过 → 沉到最末（临时放宽带回时也排在这里）
    expect(siteRankOf('localhost:4000', local.host, local.page, loose)).toBe(OTHER_PORT_RANK);
    expect(siteRankOf('localhost:3000', local.host, local.page, loose)).toBe(0);
    // 本地页面上的外站条目属于「与当前站点无关」，不是「其他端口」
    expect(siteRankOf('github.com', local.host, local.page, loose)).toBe(NOT_ON_SITE_RANK);
    expect(siteRankOf('example.com:3000', local.host, local.page, loose)).toBe(NOT_ON_SITE_RANK);
  });

  it('档位只决定可见性、不决定关联度：off 与 sameMainDomain 下排出的顺序一致', () => {
    const urls = ['fat.example.com', 'dev.example.com', 'github.com', ''];
    const byOff = urls.map(url => siteRankOf(url, fat.domain, fat.page, loose));
    const byWide = urls.map(url =>
      siteRankOf(url, fat.domain, fat.page, { mode: 'sameMainDomain', portScope: 'strict' } as EffectiveSitePolicy),
    );
    expect(byOff).toEqual(byWide);
  });

  it('判据取持久化策略：调用方传入展示策略之外的任何档位都不改变「本站」相对顺序', () => {
    const local = { host: 'localhost', page: pageOf('http://localhost:3000/') };
    // 侧边栏排序恒按用户所选的 loose 判定沉底（`App.vue` 传的是 sitePolicy，
    // 由 crossSubdomainTierWiring.test.ts 的源码守卫钉住，见「临时放宽不渗入填充判据」一条）
    expect(siteRankOf('localhost:4000', local.host, local.page, loose)).toBe(OTHER_PORT_RANK);
    expect(siteRankOf('localhost:*', local.host, local.page, loose)).toBe(0);
  });
});

describe('不变量 4：被端口挡住的条目可数、可临时放宽，但不放宽填充', () => {
  it('loose + 本地域名也能数出同主机其他端口的隐藏条目（旧实现在 loose 下恒 0）', () => {
    const entries = [{ url: 'localhost:4000' }, { url: '127.0.0.1:5173' }, { url: 'localhost:3000' }, { url: '' }];
    expect(countPortHiddenCandidates(entries, '127.0.0.1', LOOSE, LOCAL_CTX.page)).toBe(2);
  });

  it('公网 + loose 不比较端口，隐藏计数恒 0（默认路径零额外遍历）', () => {
    const entries = [{ url: 'example.com' }, { url: 'example.com:8443' }];
    expect(countPortHiddenCandidates(entries, 'example.com', LOOSE, pageOf('https://example.com'))).toBe(0);
  });

  it('临时放宽只放开显示：relaxed 让同主机其他端口可见，主机门仍然生效', () => {
    expect(matchesSiteEndpoint('localhost:4000', '127.0.0.1', LOCAL_CTX.page, RELAXED)).toBe(true);
    expect(matchesSiteEndpoint('example.com:4000', '127.0.0.1', LOCAL_CTX.page, RELAXED)).toBe(false);
    expect(matchesSiteEndpoint('localhost:4000', '127.0.0.1', LOCAL_CTX.page, LOOSE)).toBe(false);
    expect(isHiddenByPortOnly('localhost:4000', '127.0.0.1', LOCAL_CTX.page, LOOSE)).toBe(true);
    expect(isHiddenByPortOnly('example.com', '127.0.0.1', LOCAL_CTX.page, LOOSE)).toBe(false);
  });

  it('relaxed 集合恒为 loose 集合的超集，且两者都不含外站条目', () => {
    const all = LOCAL_URLS.map((url, i) => entry({ id: `e${i}`, url }));
    const scoped = (policy: EffectiveSitePolicy) => new Set(ids(filterEntriesByScope(all, 'site', LOCAL_CTX, policy)));
    const looseSet = scoped(LOOSE);
    const relaxedSet = scoped(RELAXED);
    for (const id of looseSet) expect(relaxedSet.has(id), id).toBe(true);
    expect(relaxedSet.size).toBeGreaterThan(looseSet.size);
    for (const item of all) {
      const url = item.url ?? '';
      if (!url) continue;
      // 用同一套解析口径取主机：按 `:` 硬切会把 `[::1]:3000` 的 IPv6 主机切坏
      const host = splitHostAndPortDecl(url).host;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '*.localhost';
      if (!isLocal) {
        expect(looseSet.has(item.id), url).toBe(false);
        expect(relaxedSet.has(item.id), url).toBe(false);
      }
    }
  });
});
