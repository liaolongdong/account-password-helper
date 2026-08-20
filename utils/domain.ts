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
 * 针对 localhost 和 127.0.0.1 域名，默认匹配所有账号密码，
 * 方便开发人员在不同本地项目间快速填充密码。
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
 */
export function normalizeToHostname(value: string): string {
  const s = value.toLowerCase().trim();
  if (!s) return s;
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).hostname;
  } catch {
    return s.split('/')[0].split('?')[0].split('#')[0];
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
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    // 回退：去除路径/查询/锚点
    return s.split('/')[0].split('?')[0].split('#')[0].toLowerCase();
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
