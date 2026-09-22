import { describe, expect, it } from 'vitest';
import {
  getMainDomain,
  isSameMainDomain,
  isLocalDevDomain,
  normalizeToHostname,
  normalizeToHostAndPort,
  isExactHostMatch,
  matchesPortForLocalDev,
  toNavigableUrl,
  resolveMatchTier,
  stripWildcardPrefix,
  splitWildcardHost,
  isDomainMatchMode,
  countSameMainDomainCandidates,
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

describe('normalizeToHostAndPort', () => {
  it('完整 URL 带端口保留 host:port', () => {
    expect(normalizeToHostAndPort('https://localhost:3000/path')).toBe('localhost:3000');
    expect(normalizeToHostAndPort('https://example.com:8080/login')).toBe('example.com:8080');
  });

  it('纯域名带端口保留端口', () => {
    expect(normalizeToHostAndPort('example.com:8080')).toBe('example.com:8080');
    expect(normalizeToHostAndPort('localhost:3000')).toBe('localhost:3000');
  });

  it('无端口时仅返回 hostname', () => {
    expect(normalizeToHostAndPort('example.com')).toBe('example.com');
    expect(normalizeToHostAndPort('https://example.com/login')).toBe('example.com');
    expect(normalizeToHostAndPort('localhost')).toBe('localhost');
  });

  it('IP 地址带端口', () => {
    expect(normalizeToHostAndPort('192.168.1.1:9090')).toBe('192.168.1.1:9090');
    expect(normalizeToHostAndPort('http://10.0.0.1:8080/api')).toBe('10.0.0.1:8080');
  });

  it('IP 地址无端口', () => {
    expect(normalizeToHostAndPort('192.168.1.1')).toBe('192.168.1.1');
  });

  it('空输入返回空串', () => {
    expect(normalizeToHostAndPort('')).toBe('');
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

describe('matchesPortForLocalDev', () => {
  it('当前页面无端口时始终匹配（展示全部）', () => {
    expect(matchesPortForLocalDev('http://localhost:3000', '')).toBe(true);
    expect(matchesPortForLocalDev('http://localhost:8080', '')).toBe(true);
    expect(matchesPortForLocalDev('', '')).toBe(true);
    expect(matchesPortForLocalDev(undefined, '')).toBe(true);
  });

  it('条目 URL 为空时始终匹配（无 URL 条目始终展示）', () => {
    expect(matchesPortForLocalDev('', '3000')).toBe(true);
    expect(matchesPortForLocalDev('  ', '3000')).toBe(true);
    expect(matchesPortForLocalDev(undefined, '3000')).toBe(true);
    expect(matchesPortForLocalDev(null, '3000')).toBe(true);
  });

  it('条目 URL 无端口时匹配（通用条目不限端口）', () => {
    expect(matchesPortForLocalDev('http://localhost', '3000')).toBe(true);
    expect(matchesPortForLocalDev('localhost', '8080')).toBe(true);
  });

  it('条目 URL 有端口且与当前页面端口一致时匹配', () => {
    expect(matchesPortForLocalDev('http://localhost:3000', '3000')).toBe(true);
    expect(matchesPortForLocalDev('http://127.0.0.1:8080', '8080')).toBe(true);
  });

  it('条目 URL 有端口但与当前页面端口不一致时不匹配', () => {
    expect(matchesPortForLocalDev('http://localhost:3000', '8080')).toBe(false);
    expect(matchesPortForLocalDev('http://127.0.0.1:5173', '3000')).toBe(false);
  });
});

describe('toNavigableUrl 协议补全', () => {
  it('已带 http/https 时原样解析为规范化 URL', () => {
    expect(toNavigableUrl('https://example.com/login')).toBe('https://example.com/login');
    expect(toNavigableUrl('https://example.com/login?next=1#top')).toBe('https://example.com/login?next=1#top');
    expect(toNavigableUrl('http://example.com')).toBe('http://example.com/');
  });

  it('无协议时补 https', () => {
    expect(toNavigableUrl('example.com')).toBe('https://example.com/');
    expect(toNavigableUrl('example.com/login?a=1')).toBe('https://example.com/login?a=1');
    expect(toNavigableUrl('sub.example.com')).toBe('https://sub.example.com/');
    // host:port 形式不应被误判为「已带协议」
    expect(toNavigableUrl('example.com:8080')).toBe('https://example.com:8080/');
  });

  it('本地开发域名与 IP 字面量补 http', () => {
    expect(toNavigableUrl('localhost')).toBe('http://localhost/');
    expect(toNavigableUrl('localhost:3000/admin')).toBe('http://localhost:3000/admin');
    expect(toNavigableUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/');
    expect(toNavigableUrl('192.168.1.10:9090/x')).toBe('http://192.168.1.10:9090/x');
  });

  it('首尾空白被裁剪，大小写协议不影响判定', () => {
    expect(toNavigableUrl('  example.com  ')).toBe('https://example.com/');
    expect(toNavigableUrl('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('协议相对写法（//host）按 https 解析，不保留为不合法 URL', () => {
    expect(toNavigableUrl('//example.com')).toBe('https://example.com/');
  });
});

describe('toNavigableUrl 协议白名单（安全边界）', () => {
  it('拒绝 javascript: / data: / mailto: 等非层级 scheme', () => {
    expect(toNavigableUrl('javascript:alert(1)')).toBeNull();
    expect(toNavigableUrl('JaVaScRiPt:alert(document.domain)')).toBeNull();
    expect(toNavigableUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(toNavigableUrl('mailto:someone@example.com')).toBeNull();
    expect(toNavigableUrl('about:blank')).toBeNull();
    expect(toNavigableUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('拒绝 chrome: / file: 等浏览器内部协议', () => {
    expect(toNavigableUrl('chrome://extensions')).toBeNull();
    expect(toNavigableUrl('chrome-extension://abcdefg/page.html')).toBeNull();
    expect(toNavigableUrl('file:///etc/passwd')).toBeNull();
    expect(toNavigableUrl('devtools://devtools/bundled/inspector.html')).toBeNull();
  });

  it('空值与畸形输入返回 null', () => {
    expect(toNavigableUrl('')).toBeNull();
    expect(toNavigableUrl('   ')).toBeNull();
    expect(toNavigableUrl(undefined)).toBeNull();
    expect(toNavigableUrl(null)).toBeNull();
    expect(toNavigableUrl('https://')).toBeNull();
  });
});

/**
 * 通配条目的派生路径
 *
 * `*.qq.com` 存的是适用范围，不是可导航主机：直接补协议会得到 `https://*.qq.com/`
 * 这种必然解析失败（或解析到字面量 `*` 主机）的地址。导航、图标两条派生路径
 * 都必须先还原为可访问主机，且不得因此放宽协议白名单。
 */
describe('通配条目的可导航主机还原', () => {
  it('无协议通配条目剥掉最左通配段后按常规补协议', () => {
    expect(toNavigableUrl('*.qq.com')).toBe('https://qq.com/');
    expect(toNavigableUrl('  *.qq.com  ')).toBe('https://qq.com/');
    expect(toNavigableUrl('*.localhost:3000')).toBe('http://localhost:3000/');
  });

  it('带协议通配条目保留路径与查询，只剥主机通配段', () => {
    expect(toNavigableUrl('https://*.qq.com/login?a=1')).toBe('https://qq.com/login?a=1');
  });

  it('剥通配段仍在协议白名单之内', () => {
    expect(toNavigableUrl('javascript:*.qq.com')).toBeNull();
    expect(toNavigableUrl('chrome://*.qq.com')).toBeNull();
  });

  it('只剩通配段的条目无可导航主机', () => {
    expect(toNavigableUrl('*.')).toBeNull();
    expect(toNavigableUrl('https://*.')).toBeNull();
  });

  it('splitWildcardHost 只在最左段判定', () => {
    expect(splitWildcardHost('*.qq.com')).toEqual({ wildcard: true, rest: 'qq.com' });
    expect(splitWildcardHost('qq.com')).toEqual({ wildcard: false, rest: 'qq.com' });
    expect(splitWildcardHost('*.*.qq.com')).toEqual({ wildcard: true, rest: '*.qq.com' });
    expect(splitWildcardHost('mail.*.qq.com')).toEqual({ wildcard: false, rest: 'mail.*.qq.com' });
    expect(splitWildcardHost('*.')).toEqual({ wildcard: true, rest: '' });
  });
});

describe('resolveMatchTier：跨子域分层匹配', () => {
  const CUR = 'mail.qq.com';

  it('off 档与迁移前精确口径一致（只有精确 host 与空 URL 命中）', () => {
    expect(resolveMatchTier(CUR, 'mail.qq.com', 'off')).toBe(0);
    expect(resolveMatchTier(CUR, 'https://mail.qq.com/login', 'off')).toBe(0);
    expect(resolveMatchTier(CUR, '', 'off')).toBe(4);
    expect(resolveMatchTier(CUR, '   ', 'off')).toBe(4);
    expect(resolveMatchTier(CUR, undefined, 'off')).toBe(4);
    expect(resolveMatchTier(CUR, '*.qq.com', 'off')).toBe(-1);
    expect(resolveMatchTier(CUR, 'qq.com', 'off')).toBe(-1);
    expect(resolveMatchTier(CUR, 'music.qq.com', 'off')).toBe(-1);
    expect(resolveMatchTier(CUR, 'uat.example.com', 'off')).toBe(-1);
    // 缺省参数即 off
    expect(resolveMatchTier(CUR, 'qq.com')).toBe(-1);
  });

  it('wildcard 档只额外放行通配条目', () => {
    expect(resolveMatchTier(CUR, '*.qq.com', 'wildcard')).toBe(1);
    expect(resolveMatchTier(CUR, 'https://*.qq.com/login', 'wildcard')).toBe(1);
    expect(resolveMatchTier(CUR, 'qq.com', 'wildcard')).toBe(-1);
    expect(resolveMatchTier(CUR, 'music.qq.com', 'wildcard')).toBe(-1);
  });

  it('sameMainDomain 档：通配 1 → apex 2 → 兄弟子域 3', () => {
    expect(resolveMatchTier(CUR, '*.qq.com', 'sameMainDomain')).toBe(1);
    expect(resolveMatchTier(CUR, 'qq.com', 'sameMainDomain')).toBe(2);
    expect(resolveMatchTier(CUR, 'music.qq.com', 'sameMainDomain')).toBe(3);
    expect(resolveMatchTier(CUR, 'a.b.qq.com', 'sameMainDomain')).toBe(3);
  });

  it('通配命中走「主域名相等」边界，不被前缀碰撞绕过', () => {
    for (const mode of ['wildcard', 'sameMainDomain'] as const) {
      expect(resolveMatchTier('evil-qq.com', '*.qq.com', mode)).toBe(-1);
      expect(resolveMatchTier('notqq.com', '*.qq.com', mode)).toBe(-1);
      expect(resolveMatchTier('mail.qq.com.evil.io', '*.qq.com', mode)).toBe(-1);
      expect(resolveMatchTier('qq.com.evil.io', '*.qq.com', mode)).toBe(-1);
    }
  });

  it('两段式 ccTLD 口径与 getMainDomain 一致', () => {
    expect(resolveMatchTier('a.example.com.cn', '*.example.com.cn', 'sameMainDomain')).toBe(1);
    expect(resolveMatchTier('a.example.com.cn', 'example.com.cn', 'sameMainDomain')).toBe(2);
    expect(resolveMatchTier('a.example.com.cn', 'other.com.cn', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier('shop.example.com.br', 'example.com.br', 'sameMainDomain')).toBe(2);
    // 未收录的 `*.co.uk` 形态：base 自身只有两段，主域名口径不会误放宽
    expect(resolveMatchTier('x.co.uk', '*.co.uk', 'sameMainDomain')).toBe(-1);
  });

  it('apex 页面自身：通配与其他子域都算同主域，精确仍为 0', () => {
    expect(resolveMatchTier('qq.com', 'qq.com', 'sameMainDomain')).toBe(0);
    expect(resolveMatchTier('qq.com', '*.qq.com', 'sameMainDomain')).toBe(1);
    expect(resolveMatchTier('qq.com', 'mail.qq.com', 'sameMainDomain')).toBe(3);
  });

  it('IP 与非法输入安全降级为不匹配', () => {
    expect(resolveMatchTier('192.168.1.10', '192.168.1.10', 'off')).toBe(0);
    expect(resolveMatchTier('192.168.1.10', '192.168.1.20', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier('192.168.1.10', '*.168.1.10', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier(CUR, '*.', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier(CUR, '   ', 'sameMainDomain')).toBe(4);
  });

  it('当前页无域名时除通用条目外不匹配（特殊路径由调用方短路）', () => {
    expect(resolveMatchTier('', 'anything.com', 'sameMainDomain')).toBe(-1);
    expect(resolveMatchTier('', '', 'sameMainDomain')).toBe(4);
  });
});

describe('stripWildcardPrefix / isDomainMatchMode', () => {
  it('只剥最左侧一个通配段', () => {
    expect(stripWildcardPrefix('*.qq.com')).toBe('qq.com');
    expect(stripWildcardPrefix('https://*.qq.com/login')).toBe('https://qq.com/login');
    expect(stripWildcardPrefix('  *.qq.com  ')).toBe('qq.com');
    expect(stripWildcardPrefix('mail.qq.com')).toBe('mail.qq.com');
    expect(stripWildcardPrefix('*.mail.*.qq.com')).toBe('mail.*.qq.com');
    expect(stripWildcardPrefix('')).toBe('');
    expect(stripWildcardPrefix(undefined)).toBe('');
    expect(stripWildcardPrefix(null)).toBe('');
  });

  it('档位判定只认三个合法枚举', () => {
    for (const bad of [undefined, null, '', 'OFF', 'yolo', {}, 1]) {
      expect(isDomainMatchMode(bad)).toBe(false);
    }
    for (const ok of ['off', 'wildcard', 'sameMainDomain']) {
      expect(isDomainMatchMode(ok)).toBe(true);
    }
  });
});

describe('countSameMainDomainCandidates：空态引导计数', () => {
  const CUR = 'mail.qq.com';
  const ENTRIES = [
    { url: 'mail.qq.com' }, // 精确：当前档位已放行
    { url: '*.qq.com' }, // 通配
    { url: 'qq.com' }, // 主域
    { url: 'music.qq.com' }, // 兄弟子域
    { url: 'a.b.qq.com' }, // 更深层的同主域子域（同样落 tier 3）
    { url: '' }, // 通用条目：任何档位都可见，不计
    { url: 'evil-qq.com' }, // 前缀碰撞：放宽后也不匹配
  ];

  it('off 档计入通配 / 主域 / 兄弟子域；wildcard 档只数尚未放行的', () => {
    expect(countSameMainDomainCandidates(ENTRIES, CUR, 'off')).toBe(4);
    expect(countSameMainDomainCandidates(ENTRIES, CUR, 'wildcard')).toBe(3);
  });

  it('已处于最宽松档、无域名或本地开发域名时为 0（没有可放宽的空间）', () => {
    expect(countSameMainDomainCandidates(ENTRIES, CUR, 'sameMainDomain')).toBe(0);
    expect(countSameMainDomainCandidates(ENTRIES, '', 'off')).toBe(0);
    expect(countSameMainDomainCandidates(ENTRIES, 'localhost', 'off')).toBe(0);
    expect(countSameMainDomainCandidates([], CUR, 'off')).toBe(0);
  });
});
