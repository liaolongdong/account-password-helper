/**
 * 域名工具函数
 *
 * 提供主域名提取、跨子域名同主域名校验等工具方法，
 * 支持 com.cn / co.uk 等两段式国家顶级域名（ccTLD）的识别。
 */

// ── 两段式 ccTLD 后缀 ──

/**
 * 已知的两段式国家顶级域名后缀集合
 *
 * 部分 ccTLD 由两段组成（如 .com.cn、.co.uk），
 * 提取主域名时需将最后 3 段作为整体处理。
 *
 * 覆盖中国、英国、香港、台湾、日本、韩国、澳大利亚、新加坡等常见区域。
 */
const KNOWN_TWO_PART_TLDS = new Set([
  // 中国
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  // 英国
  'co.uk',
  'ac.uk',
  'gov.uk',
  'org.uk',
  // 香港
  'com.hk',
  'net.hk',
  'org.hk',
  // 台湾
  'com.tw',
  'net.tw',
  'org.tw',
  // 日本
  'co.jp',
  'ne.jp',
  'or.jp',
  // 韩国
  'co.kr',
  'ne.kr',
  'or.kr',
  // 澳大利亚
  'com.au',
  'net.au',
  'org.au',
  // 新加坡
  'com.sg',
  'net.sg',
  'org.sg',
]);

/**
 * 常见两段式 ccTLD 的二级注册标签集合
 *
 * 许多国家/地区采用「二级标签.两字母国家码」形式的公共后缀（如 com.br、co.in、com.mx），
 * KNOWN_TWO_PART_TLDS 无法穷举所有国家。此集合配合「末段为两字母国家码」的判断，
 * 兜底识别未显式收录的两段式 ccTLD，避免把不同注册主体的域名
 * （如 bank.com.br 与 evil.com.br）误判为同一主域名而向跨域 iframe 泄露凭证。
 */
const CCTLD_SECOND_LEVEL_LABELS = new Set([
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'co',
  'ac',
  'ne',
  'or',
  'gob',
  'go',
  'mil',
]);

/** 两字母国家码（ccTLD）正则，如 cn / uk / br / in */
const TWO_LETTER_CCTLD_RE = /^[a-z]{2}$/;

// ── postMessage 跨 frame 通信 ──

/**
 * postMessage 通信消息类型常量
 * 用于 iframe 与顶层 frame 之间的保存弹窗委托通信
 */
export const PostMessageType = {
  /** iframe → 顶层 frame：委托显示保存确认弹窗 */
  SHOW_SAVE_PROMPT: 'APH_SHOW_SAVE_PROMPT',
  /** 顶层 frame → iframe：回传用户操作结果 */
  SAVE_PROMPT_RESULT: 'APH_SAVE_PROMPT_RESULT',
  /** iframe → 顶层 frame：委托显示通知（跨域回退场景） */
  SHOW_NOTIFICATION: 'APH_SHOW_NOTIFICATION',
} as const;

// ── 主域名提取 ──

/**
 * 提取 hostname 的主域名
 *
 * 对普通域名取最后两段（如 sub.example.com → example.com），
 * 对两段式 ccTLD 取最后三段（如 login.example.com.cn → example.com.cn）。
 * IP 地址、localhost 等单段 hostname 直接返回原值。
 *
 * @param hostname - 完整主机名
 * @returns 主域名字符串
 *
 * @example
 * getMainDomain('login.example.com')    // → 'example.com'
 * getMainDomain('app.example.com.cn')   // → 'example.com.cn'
 * getMainDomain('mail.example.co.uk')   // → 'example.co.uk'
 * getMainDomain('shop.example.com.br')  // → 'example.com.br'（启发式识别未收录 ccTLD）
 * getMainDomain('localhost')            // → 'localhost'
 * getMainDomain('192.168.1.1')          // → '192.168.1.1'
 */
export function getMainDomain(hostname: string): string {
  // IP 地址或 localhost 等单段 hostname，直接返回
  if (!hostname.includes('.') || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return hostname;
  }

  const parts = hostname.split('.');

  // 检查最后两段是否为已知的两段式 ccTLD（如 com.cn、co.uk）
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (KNOWN_TWO_PART_TLDS.has(lastTwo)) {
      return parts.slice(-3).join('.'); // 如 example.com.cn
    }

    // 兜底：末段为两字母国家码且二级为常见注册标签（com/co/net…）时，
    // 视为未显式收录的两段式 ccTLD，取最后三段（如 example.com.br）。
    // 该分支只会让主域名更「具体」（三段而非两段），仅收窄匹配、绝不新增误匹配，
    // 因此对 isSameMainDomain 等安全判定始终更保守。
    const tld = parts[parts.length - 1];
    const secondLevel = parts[parts.length - 2];
    if (TWO_LETTER_CCTLD_RE.test(tld) && CCTLD_SECOND_LEVEL_LABELS.has(secondLevel)) {
      return parts.slice(-3).join('.');
    }
  }

  // 普通域名：取最后两段作为主域名
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

// ── 本地开发域名判断 ──

/**
 * 判断是否为本地开发环境域名
 *
 * 命中该判定的域名改走 {@link matchesPortForLocalDev} 的端口过滤（而非精确 host 匹配），
 * 方便开发人员在多个本地项目间快速填充密码，同时避免不同端口的本地账号互相混淆。
 *
 * @param domain - 当前页面域名（hostname）
 * @returns 是否为本地开发域名
 *
 * @example
 * isLocalDevDomain('localhost')       // → true
 * isLocalDevDomain('127.0.0.1')       // → true
 * isLocalDevDomain('example.com')     // → false
 */
export function isLocalDevDomain(domain: string): boolean {
  return domain === 'localhost' || domain === '127.0.0.1';
}

// ── 同主域名校验 ──

/**
 * 判断两个 origin 是否属于同一主域名
 *
 * 支持跨子域名的 iframe 委托场景（如 login.example.com 与 app.example.com），
 * 同时正确处理两段式 ccTLD（如 a.example.com.cn 与 b.example.com.cn）。
 * 对于 IP 地址或单段 hostname（如 localhost），直接比较完整 hostname。
 *
 * @param originA - 第一个 origin（如 https://sub.example.com）
 * @param originB - 第二个 origin（如 https://app.example.com）
 * @returns 是否属于同一主域名
 */
export function isSameMainDomain(originA: string, originB: string): boolean {
  try {
    const hostA = new URL(originA).hostname;
    const hostB = new URL(originB).hostname;
    return getMainDomain(hostA) === getMainDomain(hostB);
  } catch {
    return false;
  }
}

// ── 密码条目域名匹配 ──

/**
 * 从 URL 或域名字符串中提取端口号
 *
 * 兼容多种格式：完整 URL（https://localhost:3000/path）、
 * 带端口域名（localhost:3000）、纯域名（example.com，无端口返回空串）。
 *
 * @param value - 原始 URL 或域名:端口字符串
 * @returns 端口号字符串；无端口或解析失败返回空串
 *
 * @example
 * extractPort('https://localhost:3000/path')  // → '3000'
 * extractPort('localhost:8080')               // → '8080'
 * extractPort('example.com')                 // → ''
 * extractPort('https://example.com/login')   // → ''
 */
export function extractPort(value: string): string {
  const s = value.trim();
  if (!s) return '';
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).port;
  } catch {
    // 回退：手动解析 host:port 格式
    const host = s.split('/')[0].split('?')[0].split('#')[0];
    const colonIdx = host.lastIndexOf(':');
    if (colonIdx > 0) {
      const portPart = host.substring(colonIdx + 1);
      if (/^\d+$/.test(portPart)) return portPart;
    }
    return '';
  }
}

/**
 * 本地开发场景下判断密码条目的 URL 是否与当前页面端口匹配
 *
 * 匹配规则（仅适用于 isLocalDevDomain 为 true 的域名）：
 * - 当前页面无端口（如纯 localhost）→ 始终匹配（保持原有行为，展示全部）
 * - 条目 URL 为空 → 始终匹配（无 URL 条目始终展示）
 * - 条目 URL 无端口 → 匹配（通用条目不限端口）
 * - 条目 URL 有端口 → 仅当端口与当前页面端口一致时匹配
 *
 * @param storedUrl 密码条目中存储的 URL（可能为空、纯域名或完整 URL）
 * @param currentPort 当前页面的端口号（空串表示无端口）
 * @returns 是否匹配
 */
export function matchesPortForLocalDev(storedUrl: string | undefined | null, currentPort: string): boolean {
  // 当前页面无端口 → 展示全部（保持原有行为）
  if (!currentPort) return true;
  // 条目 URL 为空 → 始终展示
  if (!storedUrl || storedUrl.trim() === '') return true;
  const storedPort = extractPort(storedUrl);
  // 存储的 URL 无端口（通用条目）或端口匹配当前页面端口
  return !storedPort || storedPort === currentPort;
}

/** 通配条目前缀（写在 `PasswordEntry.url` 里，形如 `*.qq.com`） */
const WILDCARD_PREFIX = '*.';

/**
 * 还原 URL 解析器编码掉的通配标记
 *
 * `*` 不是合法的 host 码点，各解析器处理方式不一致：Chrome 把
 * `new URL('https://*.qq.com').hostname` 给出 `%2A.qq.com`（且不会把 `%2A` 解回 `*`），
 * Node 则原样保留 `*`。通配条目的档位判定必须在两端都成立，所以统一把开头的
 * `%2A.` 还原为 `*.`——否则 `wildcard` 档在真机上永远匹配不到任何条目。
 */
function restoreWildcardMarker(host: string): string {
  return host.slice(0, 4).toLowerCase() === '%2a.' ? `${WILDCARD_PREFIX}${host.slice(4)}` : host;
}

/**
 * 将 URL 或域名规范化为 hostname
 *
 * 兼容存储中可能出现的多种格式：完整 URL（https://example.com/login）、
 * 带端口（example.com:8080）、纯域名（example.com）、localhost / IP。
 * 无 scheme 时补 `https://` 以便 URL 解析；解析失败则回退为去除路径/查询/锚点后的首段。
 *
 * @param value - 原始 URL 或域名字符串
 * @returns 规范化后的 hostname（小写）；空输入返回空串
 *
 * @example
 * normalizeToHostname('https://example.com/login') // → 'example.com'
 * normalizeToHostname('example.com')               // → 'example.com'
 * normalizeToHostname('localhost:3000')            // → 'localhost'
 * normalizeToHostname('*.qq.com')                  // → '*.qq.com'（通配标记不被解析器改写）
 */
export function normalizeToHostname(value: string): string {
  const s = value.toLowerCase().trim();
  if (!s) return s;
  try {
    return restoreWildcardMarker(new URL(s.includes('://') ? s : `https://${s}`).hostname);
  } catch {
    return restoreWildcardMarker(s.split('/')[0].split('?')[0].split('#')[0]);
  }
}

/**
 * 将 URL 或域名规范化为 host:port 格式
 *
 * 保留端口号信息，用于存储和展示场景。
 * 与 normalizeToHostname 的区别：本函数返回 host（含端口），后者仅返回 hostname。
 *
 * @param value - 原始 URL 或域名字符串
 * @returns 规范化后的 host:port（无端口时仅 hostname）；空输入返回空串
 *
 * @example
 * normalizeToHostAndPort('https://localhost:3000/path')  // → 'localhost:3000'
 * normalizeToHostAndPort('example.com:8080')              // → 'example.com:8080'
 * normalizeToHostAndPort('example.com')                   // → 'example.com'
 * normalizeToHostAndPort('192.168.1.1:9090')              // → '192.168.1.1:9090'
 */
export function normalizeToHostAndPort(value: string): string {
  const s = value.trim();
  if (!s) return s;
  try {
    const url = new URL(s.includes('://') ? s : `https://${s}`);
    const host = restoreWildcardMarker(url.hostname);
    return url.port ? `${host}:${url.port}` : host;
  } catch {
    // 回退：去除路径/查询/锚点
    return restoreWildcardMarker(s.split('/')[0].split('?')[0].split('#')[0].toLowerCase());
  }
}

/**
 * 判断当前页面域名是否与密码条目中存储的 URL 精确匹配（仅比较完整 hostname）
 *
 * 匹配策略：
 * 0. 先将两侧规范化为 hostname（兼容完整 URL / 带端口 / 纯域名，忽略大小写）
 * 1. 仅当两侧 hostname 完全相同时才匹配
 *
 * 不做子域名或主域名模糊匹配，确保多测试环境账号严格隔离：
 * 如 fat.example.com 页面不会展示 uat.example.com 或 example.com 的条目。
 * URL 为空的条目不受此函数影响（由调用方处理"空 URL 始终展示"逻辑）。
 *
 * @param currentDomain - 当前页面的 hostname
 * @param storedUrl - 密码条目中存储的 URL/域名
 * @returns 是否精确匹配
 *
 * @example
 * isExactHostMatch('fat.example.com', 'fat.example.com')    // → true（精确匹配）
 * isExactHostMatch('fat.example.com', 'uat.example.com')    // → false（不同子域名）
 * isExactHostMatch('fat.example.com', 'example.com')        // → false（主域名也不跨环境匹配）
 * isExactHostMatch('example.com', 'https://example.com/login') // → true（规范化后精确匹配）
 */
export function isExactHostMatch(currentDomain: string, storedUrl: string): boolean {
  if (!currentDomain || !storedUrl) return false;

  const a = normalizeToHostname(currentDomain);
  const b = normalizeToHostname(storedUrl);
  if (!a || !b) return false;

  return a === b;
}

// ── 跨子域分层匹配 ──

/**
 * 跨子域匹配档位
 *
 * 档位是包含关系（`sameMainDomain` ⊃ `wildcard` ⊃ `off`），默认 `off`：
 * 2026-07 为多测试环境隔离引入的精确 host 口径始终是缺省行为，放宽必须由用户显式选择。
 *
 * - `off`：仅精确 host 匹配（迁移前口径）
 * - `wildcard`：额外纳入用户显式写成 `*.qq.com` 的通配条目，逐条由用户决定适用范围
 * - `sameMainDomain`：再纳入同主域下的 apex 条目与其他子域条目，宽松度最高
 */
export type DomainMatchMode = 'off' | 'wildcard' | 'sameMainDomain';

/** 档位合法性判定（storage 回读时收窄类型） */
export function isDomainMatchMode(value: unknown): value is DomainMatchMode {
  return value === 'off' || value === 'wildcard' || value === 'sameMainDomain';
}

/**
 * 匹配层级：数字即排序权重，越小越靠前
 *
 * - 0 精确 host
 * - 1 通配条目（`*.qq.com`）
 * - 2 同主域 apex 条目（`qq.com`）
 * - 3 同主域其他子域（`music.qq.com`）
 * - 4 URL 为空的通用条目
 *
 * `off` 档下只可能返回 0、4 或 -1，与迁移前的二值优先级（0/1）等价。
 */
export type MatchTier = 0 | 1 | 2 | 3 | 4;

/** 主域名记忆化容量上限（键为 hostname，超出即整体清空，避免无界增长） */
const MAIN_DOMAIN_CACHE_MAX = 2000;

const _mainDomainCache = new Map<string, string>();

/**
 * `getMainDomain` 的记忆化包装
 *
 * 分层匹配要逐条求主域名，数百条目 × 多次查询下重复解析同一 hostname 的成本可观；
 * 结果纯函数确定性，可安全缓存。
 */
function memoizedMainDomain(hostname: string): string {
  if (!hostname) return hostname;
  const hit = _mainDomainCache.get(hostname);
  if (hit !== undefined) return hit;
  const main = getMainDomain(hostname);
  if (_mainDomainCache.size >= MAIN_DOMAIN_CACHE_MAX) _mainDomainCache.clear();
  _mainDomainCache.set(hostname, main);
  return main;
}

/**
 * 解析条目网址相对当前域名的匹配层级
 *
 * 站点可见性与填充可行性的唯一判据：侧边栏本站范围、内联下拉、一键填充、右键菜单与
 * Popup 计数全部经它，杜绝「下拉里有、侧边栏没有」或两处排序分歧。
 *
 * 前置约束：`localhost` / `127.0.0.1` 的端口过滤与「当前页无域名」两条特殊路径由调用方
 * 在调用本函数**之前**处理，本函数不参与本地开发端口语义。
 *
 * 通配命中刻意不使用 `endsWith('.qq.com')`（会被 `evil-qq.com` 之类前缀碰撞绕过），
 * 而是复用既有的可信边界「主域名相等」，与跨域 iframe 委托同一口径，
 * 并自动继承 `getMainDomain` 的两段式 ccTLD 全部规则。
 *
 * @param currentHost - 当前页面 hostname（空串时除通用条目外一律不匹配）
 * @param storedUrl - 密码条目存储的 URL/域名
 * @param mode - 匹配档位，缺省 `off`（与迁移前行为一致）
 * @returns 匹配层级；不匹配返回 -1
 *
 * @example
 * resolveMatchTier('mail.qq.com', 'mail.qq.com', 'off')     // → 0
 * resolveMatchTier('mail.qq.com', 'qq.com', 'off')          // → -1（默认仍严格隔离）
 * resolveMatchTier('mail.qq.com', '*.qq.com', 'wildcard')   // → 1
 * resolveMatchTier('mail.qq.com', 'music.qq.com', 'sameMainDomain') // → 3
 * resolveMatchTier('mail.qq.com', 'evil-qq.com', 'sameMainDomain')  // → -1
 */
export function resolveMatchTier(
  currentHost: string,
  storedUrl: string | undefined,
  mode: DomainMatchMode = 'off',
): MatchTier | -1 {
  const raw = storedUrl?.trim();
  // 空 URL 条目不限站点，始终纳入（排在所有带网址条目之后）
  if (!raw) return 4;
  if (!currentHost) return -1;

  const storedHost = normalizeToHostname(raw);
  if (!storedHost) return -1;
  const host = normalizeToHostname(currentHost);
  if (storedHost === host) return 0;

  if (storedHost.startsWith(WILDCARD_PREFIX)) {
    if (mode === 'off') return -1;
    const base = storedHost.slice(WILDCARD_PREFIX.length);
    if (!base) return -1;
    return memoizedMainDomain(host) === memoizedMainDomain(base) ? 1 : -1;
  }

  if (mode !== 'sameMainDomain') return -1;
  const currentMain = memoizedMainDomain(host);
  if (!currentMain || currentMain !== memoizedMainDomain(storedHost)) return -1;
  return storedHost === currentMain ? 2 : 3;
}

/**
 * 判定匹配层级是否属于「跨子域命中」
 *
 * 通配（1）/ 同主域 apex（2）/ 同主域其他子域（3）共同回答「这条为什么出现在别的子域」，
 * 侧边栏徽章、内联下拉来源 chip、空态引导计数与自动保存去向提示四处必须同口径，
 * 否则会呈现「侧边栏带徽章、内联下拉不带 chip」这类自相矛盾。空态计数读的是同一区间的
 * 另一侧：落在区间内即「只有放宽才会被带出」，因此两端天然共用这一个判据。
 *
 * 0（精确）与 4（无网址通用条目）不属于：前者就是本站；后者在任何档位下都可见，
 * 不是放宽带出来的，给它标来源等于报错。
 *
 * @param tier - `resolveMatchTier` 的返回值（含未匹配的 -1）
 * @returns 是否为跨子域层级
 */
export function isCrossSubdomainTier(tier: MatchTier | -1): boolean {
  return tier >= 1 && tier <= 3;
}

/**
 * 统计「放宽到同主域名档」后可额外带出的条目数（跨子域匹配的空态引导计数）
 *
 * 只数真正会被档位改变的条目：当前档位下不匹配、但在 `sameMainDomain` 档下命中
 * 通配 / 主域 / 兄弟子域任一层级。空 URL 通用条目不计（它在任何档位下都可见）；
 * 已处于最宽松档时没有可放宽空间，恒为 0。本地开发域名按端口口径过滤，同样恒为 0。
 *
 * 侧边栏与内联下拉共用本函数，避免两处各自演化出分歧的引导计数。
 *
 * @param entries - 仅需携带 `url` 字段的条目集合（全库，非过滤后的子集）
 * @param currentHost - 当前页面 hostname，空串表示无域名场景
 * @param mode - 用户当前所选档位
 * @returns 可被放宽带出的条目数
 */
export function countSameMainDomainCandidates(
  entries: readonly { url?: string }[],
  currentHost: string,
  mode: DomainMatchMode,
): number {
  if (!currentHost || mode === 'sameMainDomain' || isLocalDevDomain(currentHost)) return 0;
  let count = 0;
  for (const entry of entries) {
    const widened = resolveMatchTier(currentHost, entry.url, 'sameMainDomain');
    if (!isCrossSubdomainTier(widened)) continue;
    if (resolveMatchTier(currentHost, entry.url, mode) === -1) count += 1;
  }
  return count;
}

/**
 * 剥离网址最左侧的通配段
 *
 * `*.qq.com` 表达的是「适用范围」而非可导航主机：直接补协议会得到 `https://*.qq.com/`
 * 这类必然解析失败的主机名。导航与图标两条派生路径都先经本函数还原为可访问主机。
 *
 * @param value - 原始 URL 或域名字符串
 * @returns 去掉最左 `*.` 后的字符串；非通配输入原样返回（仅首尾空白被去除）
 *
 * @example
 * stripWildcardPrefix('*.qq.com')                 // → 'qq.com'
 * stripWildcardPrefix('https://*.qq.com/login')    // → 'https://qq.com/login'
 * stripWildcardPrefix('mail.qq.com')               // → 'mail.qq.com'
 */
export function stripWildcardPrefix(value: string | undefined | null): string {
  const raw = value?.trim();
  if (!raw) return '';
  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/)\*\./i.exec(raw);
  if (schemeMatch) return `${schemeMatch[1]}${raw.slice(schemeMatch[0].length)}`;
  return splitWildcardHost(raw).rest;
}

/**
 * 拆出最左侧的通配段，供录入校验与匹配复用同一前缀口径
 *
 * 刻意只提供「拆分」而不给「是否合法通配主机」的判定：录入校验只需剥掉最左 `*.`，
 * 再拿**既有**域名正则去判剩余部分，非法形态（`*.`、`*.*.x`、`a.*.x`）天然被该正则拒掉，
 * 避免为通配条目另立第二套域名口径。
 *
 * @param value - 已去除首尾空白的主机字符串
 * @returns `wildcard` 是否以最左 `*.` 开头；`rest` 为剥掉通配段后的主机（非通配输入即原值）
 *
 * @example
 * splitWildcardHost('*.qq.com')      // → { wildcard: true,  rest: 'qq.com' }
 * splitWildcardHost('*.*.qq.com')    // → { wildcard: true,  rest: '*.qq.com' }
 * splitWildcardHost('mail.qq.com')   // → { wildcard: false, rest: 'mail.qq.com' }
 */
export function splitWildcardHost(value: string): { wildcard: boolean; rest: string } {
  if (!value.startsWith(WILDCARD_PREFIX)) return { wildcard: false, rest: value };
  return { wildcard: true, rest: value.slice(WILDCARD_PREFIX.length) };
}

// ── 可导航 URL ──

/** 允许导航的协议白名单：仅 http/https，杜绝 javascript: / chrome: / file: / data: 等注入 */
const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:']);

/** 带层级路径的 scheme（如 https://、chrome://），命中时按原样解析后走白名单校验 */
const HIERARCHICAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** host:port 形式（端口为纯数字），需与 `javascript:` 等非层级 scheme 区分，避免误判为已带协议 */
const HOST_PORT_RE = /^[^:/?#]+:\d+/;

/** 非层级 scheme（如 javascript:、data:、mailto:），一律拒绝导航 */
const OPAQUE_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** IPv4 字面量：本地/内网服务通常无 TLS 证书，补协议时走 http */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 推断补全协议时应使用的 scheme
 *
 * 本地开发域名（localhost / 127.0.0.1）与 IP 字面量走 http（通常无证书），
 * 其余走 https。
 *
 * @param value - 不含协议的原始 URL 或域名字符串
 * @returns 'http' 或 'https'
 */
function inferDefaultScheme(value: string): 'http' | 'https' {
  const host = normalizeToHostname(value);
  return isLocalDevDomain(host) || IPV4_RE.test(host) ? 'http' : 'https';
}

/**
 * 将密码条目中存储的 URL 转为可安全导航的 http(s) URL
 *
 * 条目 URL 属用户可控输入，直接交给 `chrome.tabs.create` / `window.open` 存在协议注入风险，
 * 故本函数作为导航前的唯一安全边界：
 * - 最左通配段先经 {@link stripWildcardPrefix} 还原为可访问主机（适用范围不等于可打开的地址）；
 * - 无协议时按 {@link inferDefaultScheme} 补全（`example.com/login` → `https://example.com/login`）；
 * - 已带协议时按原样解析，仅放行 http/https；
 * - `javascript:` / `data:` / `mailto:` 等非层级 scheme 显式拒绝，不进入补协议分支
 *   （否则可能被拼接成形似合法的 https URL）；
 * - 解析失败、无 hostname 时同样拒绝。
 *
 * @param storedUrl - 密码条目中存储的 URL/域名（可能为空、纯域名或完整 URL）
 * @returns 可导航的完整 URL；输入为空、协议不允许或解析失败时返回 null
 *
 * @example
 * toNavigableUrl('https://example.com/login')  // → 'https://example.com/login'
 * toNavigableUrl('example.com')                // → 'https://example.com/'
 * toNavigableUrl('*.qq.com')                   // → 'https://qq.com/'（通配段还原为 apex）
 * toNavigableUrl('localhost:3000/admin')       // → 'http://localhost:3000/admin'
 * toNavigableUrl('javascript:alert(1)')        // → null（协议拒绝）
 * toNavigableUrl('')                           // → null
 */
export function toNavigableUrl(storedUrl: string | undefined | null): string | null {
  const raw = stripWildcardPrefix(storedUrl);
  if (!raw) return null;

  let candidate: string;
  if (HIERARCHICAL_SCHEME_RE.test(raw)) {
    candidate = raw;
  } else if (HOST_PORT_RE.test(raw) || !OPAQUE_SCHEME_RE.test(raw)) {
    candidate = `${inferDefaultScheme(raw)}://${raw}`;
  } else {
    // 非层级 scheme（javascript: / data: / mailto: 等）：显式拒绝，不做补协议兜底
    return null;
  }

  try {
    const url = new URL(candidate);
    if (!NAVIGABLE_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}
