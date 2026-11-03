/**
 * 本地开发环境绑定的匹配契约（utils/domain 的并集层）
 *
 * 绑定回答的是「这一页其实是哪个环境的后端」。四条不变式，每条都对应一个会真实发生的错：
 *
 * 1. **只有环回页面能绑定。** 这条判据必须在纯函数里而不是芯片里——公网页面一旦接受绑定，
 *    「在 github.com 上把 example.com 的凭证也变成可填」就成了一个用户点得出的动作。
 * 2. **绑定是并集而不是替换。** 本地端点自己的条目不能因为绑定了 fat 就消失。
 * 3. **绑定轴不比端口。** 本地 `:3000` 是前端 dev server 的端口，与远端环境端口无关。
 * 4. **徽章判据与放开门禁同源。** `isAdmittedByEnvOnly` 必须恰好等于「只有绑定轴放行」的集合，
 *    否则会出现「本机条目被标成 fat 环境」或「fat 条目没有来源标记」。
 */
import { describe, expect, it } from 'vitest';
import {
  effectiveEnvHost,
  isAdmittedByEnvOnly,
  matchesSiteWithEnv,
  siteRankWithEnv,
  NOT_ON_SITE_RANK,
  SAME_HOST_OTHER_PORT_RANK,
  siteRankOf,
  type EffectiveSitePolicy,
  type PagePortContext,
} from '@/utils/domain';

const pageOf = (rawUrl: string): PagePortContext => {
  const url = new URL(rawUrl);
  if (url.port) return { port: url.port, atDefaultPort: false };
  return url.protocol === 'https:' ? { port: '443', atDefaultPort: true } : { port: '80', atDefaultPort: true };
};

/** 默认档：跨子域关闭 + 端口宽松（环回仍比端口） */
const LOOSE: EffectiveSitePolicy = { mode: 'off', portScope: 'loose' };
/** 端口隔离档 */
const STRICT: EffectiveSitePolicy = { mode: 'off', portScope: 'strict' };
/** 最宽档 */
const WIDEST: EffectiveSitePolicy = { mode: 'sameMainDomain', portScope: 'loose' };

const LOCAL = pageOf('http://localhost:3000');
const FAT = 'fat.example.com';

describe('domain.effectiveEnvHost', () => {
  it('环回页面才生效，公网页面传入绑定也一律当作没绑定', () => {
    expect(effectiveEnvHost('localhost', FAT)).toBe(FAT);
    expect(effectiveEnvHost('127.0.0.1', FAT)).toBe(FAT);
    expect(effectiveEnvHost('github.com', FAT)).toBeNull();
    expect(effectiveEnvHost('evil.com', FAT)).toBeNull();
  });

  it('空绑定、把本机绑给自己都不生效', () => {
    expect(effectiveEnvHost('localhost', null)).toBeNull();
    expect(effectiveEnvHost('localhost', undefined)).toBeNull();
    expect(effectiveEnvHost('localhost', '127.0.0.1')).toBeNull();
    expect(effectiveEnvHost('127.0.0.1', 'localhost')).toBeNull();
  });

  it('同机不同虚拟主机不是「绑给自己」：dev.localhost 仍可绑定', () => {
    expect(effectiveEnvHost('localhost', 'dev.localhost')).toBe('dev.localhost');
  });
});

describe('domain.matchesSiteWithEnv', () => {
  it('绑定让该环境的条目在本地页变成本站（默认档下按精确主机命中）', () => {
    expect(matchesSiteWithEnv('fat.example.com', 'localhost', LOCAL, LOOSE, FAT)).toBe(true);
    expect(matchesSiteWithEnv('https://fat.example.com/login', 'localhost', LOCAL, LOOSE, FAT)).toBe(true);
    expect(matchesSiteWithEnv('dev.example.com', 'localhost', LOCAL, LOOSE, FAT)).toBe(false);
  });

  it('本机条目不因绑定而消失：并集，不是替换', () => {
    expect(matchesSiteWithEnv('localhost:3000', 'localhost', LOCAL, LOOSE, FAT)).toBe(true);
    expect(matchesSiteWithEnv('127.0.0.1:3000', 'localhost', LOCAL, LOOSE, FAT)).toBe(true);
  });

  it('外站条目在任何绑定下都不会被带进来', () => {
    for (const url of ['github.com', 'qq.com', 'evil-fat.example.com']) {
      expect(matchesSiteWithEnv(url, 'localhost', LOCAL, LOOSE, FAT)).toBe(false);
    }
  });

  it('绑定轴不比端口：strict 档下 fat 的任意端口都算本站', () => {
    expect(matchesSiteWithEnv('fat.example.com:8443', 'localhost', LOCAL, STRICT, FAT)).toBe(true);
    // 真实端点这一轴仍然比端口：本机另一个端口照旧被挡住
    expect(matchesSiteWithEnv('localhost:4000', 'localhost', LOCAL, STRICT, FAT)).toBe(false);
  });

  it('默认档下不带出同主域兄弟子域，放宽档才带：档位语义对绑定轴同样成立', () => {
    expect(matchesSiteWithEnv('api.fat.example.com', 'localhost', LOCAL, LOOSE, FAT)).toBe(false);
    expect(matchesSiteWithEnv('api.fat.example.com', 'localhost', LOCAL, WIDEST, FAT)).toBe(true);
    expect(matchesSiteWithEnv('example.com', 'localhost', LOCAL, WIDEST, FAT)).toBe(true);
  });

  it('公网页面传绑定 = 逐字不变（与不传时同结论）', () => {
    const page = pageOf('https://github.com/dashboard');
    for (const url of ['github.com', 'fat.example.com', '']) {
      expect(matchesSiteWithEnv(url, 'github.com', page, LOOSE, FAT)).toBe(
        matchesSiteWithEnv(url, 'github.com', page, LOOSE, null),
      );
    }
  });
});

describe('domain.siteRankWithEnv', () => {
  const rank = (url: string, env: string | null = FAT) => siteRankWithEnv(url, 'localhost', LOCAL, LOOSE, env);

  it('绑定环境的条目与当前端点并列首位，外站仍沉底', () => {
    expect(rank('localhost:3000')).toBe(0);
    expect(rank('127.0.0.1:3000')).toBe(0);
    expect(rank('fat.example.com')).toBe(0);
    expect(rank('github.com')).toBe(NOT_ON_SITE_RANK);
  });

  it('本机另一个端口仍紧跟当前端点，不受绑定影响', () => {
    expect(rank('localhost:4000')).toBe(SAME_HOST_OTHER_PORT_RANK);
  });

  it('未绑定时与 siteRankOf 逐字一致：默认路径零行为变化', () => {
    for (const url of ['localhost:3000', 'localhost:4000', 'fat.example.com', 'github.com', '']) {
      expect(siteRankWithEnv(url, 'localhost', LOCAL, LOOSE, null)).toBe(siteRankOf(url, 'localhost', LOCAL, LOOSE));
    }
  });

  it('公网页面即使传了绑定也拿不到环境条目的高位', () => {
    const page = pageOf('https://github.com/dashboard');
    expect(siteRankWithEnv('fat.example.com', 'github.com', page, LOOSE, FAT)).toBe(NOT_ON_SITE_RANK);
  });
});

describe('domain.isAdmittedByEnvOnly', () => {
  const flagged = (url: string, env: string | null = FAT) => isAdmittedByEnvOnly(url, 'localhost', LOCAL, LOOSE, env);

  it('只给「仅由绑定带入」的条目亮徽章', () => {
    expect(flagged('fat.example.com')).toBe(true);
    expect(flagged('localhost:3000')).toBe(false);
    expect(flagged('github.com')).toBe(false);
  });

  it('网址留空的通用条目本来就属于任何站点，不标环境', () => {
    expect(flagged('')).toBe(false);
  });

  it('未绑定与公网页面下恒 false', () => {
    expect(flagged('fat.example.com', null)).toBe(false);
    expect(isAdmittedByEnvOnly('fat.example.com', 'github.com', pageOf('https://github.com'), LOOSE, FAT)).toBe(false);
  });

  it('与放开门禁同源：徽章为真的条目，matchesSiteWithEnv 必为真且真实端点为假', () => {
    const candidates = ['', 'localhost:3000', '127.0.0.1:3000', 'localhost:4000', FAT, 'github.com', 'dev.example.com'];
    for (const url of candidates) {
      const only = flagged(url);
      expect(only).toBe(
        !matchesSiteWithEnv(url, 'localhost', LOCAL, LOOSE, null) &&
          matchesSiteWithEnv(url, 'localhost', LOCAL, LOOSE, FAT),
      );
    }
  });
});
