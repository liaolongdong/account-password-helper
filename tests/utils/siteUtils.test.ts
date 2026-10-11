/**
 * 站点聚合纯函数回归测试（utils/siteUtils）
 *
 * 锁定三件事，它们各自决定「按站点筛选」这条自动归类路径是否可用：
 *
 * 1. **同一个站点的多种写法必须落进同一个桶。** 库里 `url` 是用户自由填写的
 *    （完整 URL / 纯域名 / 带端口 / 大小写混杂），分桶口径若不一致，
 *    同一个站点会被拆成好几个候选，用户选中其中一个还筛不出想要的条目。
 * 2. **通配条目（`*.qq.com`）自成一站，不并进 `qq.com`。** 它是条目自己声明的适用范围，
 *    折进主域名等于把「这条是通配的」这一层信息抹掉。
 * 3. **通用条目（空 `url`）汇成末位的 `GENERIC_SITE_KEY` 一桶，但在任何站点筛选下都保留。**
 *    它对任意站点都可用，藏起来会让用户以为库里没有；可它同时也是「没填网址」这一类，
 *    没有这个桶，管理页里就没有任何动作能把这批条目单独挑出来补全。
 */
import { describe, expect, it } from 'vitest';
import { GENERIC_SITE_KEY, collectSiteOptions, matchesSiteFilter, siteKeyOf } from '@/utils/siteUtils';

describe('siteUtils.siteKeyOf', () => {
  it('把同一站点的多种写法收敛为同一个键', () => {
    const keys = [
      'https://Example.COM/login?q=1#top',
      'example.com',
      '  https://example.com  ',
      'http://example.com/dashboard',
    ].map(url => siteKeyOf(url));

    expect(new Set(keys)).toEqual(new Set(['example.com']));
  });

  it('端口被剥掉：localhost 的多个开发端口合并为同一站', () => {
    // normalizeToHostname 走 URL 解析的 hostname，端口不参与分桶。
    // 这与侧边栏的「本站」范围不同（那里本地开发域名按端口隔离）：这里回答的是
    // 「全库按站点摊开成哪些桶」，把 3000/5173 拆成两站只会让候选集变碎。
    expect(siteKeyOf('http://localhost:3000')).toBe('localhost');
    expect(siteKeyOf('http://localhost:5173')).toBe('localhost');
  });

  it('通配条目保留 `*.` 标记，不被 URL 解析器改写', () => {
    expect(siteKeyOf('*.qq.com')).toBe('*.qq.com');
    expect(siteKeyOf('https://*.qq.com')).toBe('*.qq.com');
  });

  it('空值与纯空白返回空串（即通用条目）', () => {
    expect(siteKeyOf('')).toBe('');
    expect(siteKeyOf('   ')).toBe('');
    expect(siteKeyOf(undefined)).toBe('');
    expect(siteKeyOf(null)).toBe('');
  });

  it('解析失败的畸形网址退化为去路径后的首段，不抛异常', () => {
    expect(siteKeyOf('not a url /path')).toBe('not a url ');
  });
});

describe('siteUtils.collectSiteOptions', () => {
  it('按站点计数，同一站点的多条写法合并', () => {
    const options = collectSiteOptions([
      { url: 'https://example.com/login' },
      { url: 'example.com' },
      { url: 'https://other.com' },
    ]);

    expect(options).toEqual([
      { site: 'example.com', count: 2 },
      { site: 'other.com', count: 1 },
    ]);
  });

  it('空 `url` 的通用条目汇成末位的通用桶，与真实站点同表计数', () => {
    const options = collectSiteOptions([{ url: '' }, { url: 'a.com' }, { url: '  ' }]);

    expect(options).toEqual([
      { site: 'a.com', count: 1 },
      { site: GENERIC_SITE_KEY, count: 2 },
    ]);
  });

  it('库内一条网址都没填时，候选集只剩通用桶', () => {
    expect(collectSiteOptions([{ url: '' }, { url: '   ' }])).toEqual([{ site: GENERIC_SITE_KEY, count: 2 }]);
  });

  it('通用桶只收归一后为空串的网址：退化成非空键的畸形值各自成桶', () => {
    // 这一条钉的是「哪些条目会被（无网址）这一档挑出来」的真实边界，JSDoc / ARCHITECTURE /
    // 帮助文案的口径以此为准：判据是 `siteKeyOf` 归一结果为**空串**，实践中即「网址没填」。
    // `normalizeToHostname` 的解析失败分支返回去斜杠首段，所以 `http://` 得到 `http:`、
    // `not a url` 原样留着——它们各自成为一个候选，既不进这一档，也不享受恒保留。
    // 另一处反直觉：URL 解析器会吃掉 `https:` 后面的重复斜杠，`/qq.com` 因此归一成
    // `qq.com`（一个真实站点）而不是空串。
    expect(siteKeyOf('http://')).toBe('http:');
    expect(siteKeyOf('not a url')).toBe('not a url');
    expect(siteKeyOf('/qq.com')).toBe('qq.com');
    expect(siteKeyOf('///')).toBe('');

    expect(collectSiteOptions([{ url: '' }, { url: '///' }, { url: '/qq.com' }, { url: 'http://' }])).toEqual([
      { site: 'http:', count: 1 },
      { site: 'qq.com', count: 1 },
      { site: GENERIC_SITE_KEY, count: 2 },
    ]);

    // 恒保留跟着同一个判据走：残值算「一个奇怪的站点」，选中别的站点时它会被筛掉；
    // 归一为空串才算「没填网址」，才恒保留。
    expect(matchesSiteFilter('http://', ['example.com'])).toBe(false);
    expect(matchesSiteFilter('///', ['example.com'])).toBe(true);
  });

  it('没有通用条目时不产生空转的通用桶', () => {
    expect(collectSiteOptions([{ url: 'a.com' }])).toEqual([{ site: 'a.com', count: 1 }]);
  });

  it('通用桶固定在末位，不被条目数排序带走', () => {
    // 它不是一个站点，跟着计数在列表里跳位会让用户每次打开下拉都要重新找它
    const options = collectSiteOptions([
      { url: '' },
      { url: 'a.com' },
      { url: 'a.com' },
      { url: 'a.com' },
      { url: 'b.com' },
      { url: 'b.com' },
    ]);

    expect(options.map(option => option.site)).toEqual(['a.com', 'b.com', GENERIC_SITE_KEY]);
  });

  it('排序为条目数倒序，同数量时站点键正序（不随平台 locale 规则漂移）', () => {
    const options = collectSiteOptions([
      { url: 'd.com' },
      { url: 'b.com' },
      { url: 'a.com' },
      { url: 'a.com' },
      { url: 'c.com' },
      { url: 'a.com' },
    ]);

    // a.com 三条最前；其余各一条，按归一后的键正序
    expect(options.map(option => option.site)).toEqual(['a.com', 'b.com', 'c.com', 'd.com']);
    expect(options.map(option => option.count)).toEqual([3, 1, 1, 1]);
  });

  it('大小写不同的同一站点合并计数，不因原始写法分裂成两个候选', () => {
    const options = collectSiteOptions([{ url: 'Example.com' }, { url: 'example.com' }, { url: 'EXAMPLE.COM/x' }]);

    expect(options).toEqual([{ site: 'example.com', count: 3 }]);
  });

  it('空列表得到空候选集', () => {
    expect(collectSiteOptions([])).toEqual([]);
  });
});

describe('siteUtils.matchesSiteFilter', () => {
  it('未选中任何站点时不参与筛选，全部放行', () => {
    expect(matchesSiteFilter('example.com', [])).toBe(true);
    expect(matchesSiteFilter('', [])).toBe(true);
  });

  it('命中选中站点才保留，其余剔除', () => {
    expect(matchesSiteFilter('https://example.com/login', ['example.com'])).toBe(true);
    expect(matchesSiteFilter('other.com', ['example.com'])).toBe(false);
  });

  it('多个选中站点之间是或关系', () => {
    const selected = ['example.com', 'other.com'];
    expect(matchesSiteFilter('example.com', selected)).toBe(true);
    expect(matchesSiteFilter('other.com', selected)).toBe(true);
    expect(matchesSiteFilter('third.com', selected)).toBe(false);
  });

  it('通用条目在任何站点筛选下都保留', () => {
    expect(matchesSiteFilter('', ['example.com'])).toBe(true);
    expect(matchesSiteFilter(undefined, ['example.com'])).toBe(true);
  });

  it('只勾通用桶时结果恰好就是通用条目（把没填网址的条目挑出来的落点）', () => {
    expect(matchesSiteFilter('', [GENERIC_SITE_KEY])).toBe(true);
    expect(matchesSiteFilter('  ', [GENERIC_SITE_KEY])).toBe(true);
    expect(matchesSiteFilter('https://example.com/login', [GENERIC_SITE_KEY])).toBe(false);
  });

  it('通用桶与真实站点同选时不额外改变结果（恒保留已在前面生效）', () => {
    const selected = ['example.com', GENERIC_SITE_KEY];
    expect(matchesSiteFilter('example.com', selected)).toBe(true);
    expect(matchesSiteFilter('', selected)).toBe(true);
    expect(matchesSiteFilter('other.com', selected)).toBe(false);
  });

  it('哨兵键不可能等于任何条目归一出的站点键', () => {
    // 不变量来自 normalizeToHostname：URL 解析出的 hostname 不带斜杠，畸形网址的回退分支
    // 先按 `/` 切掉路径。哪天归一函数改了这条路径，这里要当场红出来——
    // 否则一条网址写成 `/no-url` 的条目会被混进通用桶。
    expect(siteKeyOf('/no-url')).not.toBe(GENERIC_SITE_KEY);
    expect(siteKeyOf('no-url')).not.toBe(GENERIC_SITE_KEY);
    expect(siteKeyOf('https://x.com/no-url')).not.toBe(GENERIC_SITE_KEY);
  });
});
