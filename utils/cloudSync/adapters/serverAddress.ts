/**
 * 表格平台（飞书多维表格 / 腾讯文档智能表）自定义服务地址
 *
 * 私有化部署与自建网关都是「把平台 API 换到自己域名」，归一化与 HTTP 明文风险门
 * 规则完全一致，故集中在此：飞书与腾讯适配器各自只保留一层薄封装（默认地址不同）。
 * WebDAV 的目录 URL 语义不同（需补尾斜杠、路径段原样保留），仍用 `adapters/webdav.ts`
 * 自己的实现，不并入本模块。
 */
import { CloudSyncError } from '../errors';

/** http 免确认的本机 host（仅联调；其他 http 地址一律需显式确认明文传输） */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function tryParseUrl(input: string | null | undefined): URL | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/**
 * 判断地址是否必须由用户显式确认明文传输（UI 用它决定是否显示确认框）
 *
 * https → false；http + 本机 → false（联调）；http 其他 → true。
 * 空值与无法解析的输入返回 false：由 `resolveServerBaseUrl` 在提交时统一报错，
 * 避免用户还在输入的过程中就弹出确认框。
 */
export function needsServerInsecureConfirm(baseUrl: string | null | undefined): boolean {
  const url = tryParseUrl(baseUrl);
  if (!url || url.protocol === 'https:') return false;
  return url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname);
}

/**
 * 归一化自定义 API 地址
 *
 * - 空值 → 平台官方默认地址，既有行为不变；
 * - 合法地址 → `origin + 路径前缀`（去掉末尾斜杠），兼容网关把开放平台挂在子路径的部署；
 * - 非法地址、非 https（本机 http 除外）、或 http 非本机但未显式确认 → 抛 `notFound`。
 *
 * 宁可显式失败也不回退官方域名：静默回退会把私有化凭证发往公网端点。
 */
export function resolveServerBaseUrl(
  input: string | null | undefined,
  defaultBaseUrl: string,
  allowInsecure: boolean,
): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return defaultBaseUrl;

  const url = tryParseUrl(trimmed);
  if (!url) throw new CloudSyncError('notFound', 'invalid server base url');

  const isLoopback = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !isLoopback) {
    if (url.protocol !== 'http:') throw new CloudSyncError('notFound', `unsupported protocol: ${url.protocol}`);
    if (!allowInsecure) throw new CloudSyncError('notFound', 'insecure transport requires explicit confirmation');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * 把用户填写的地址归一为**可入库形态**（写入 target 的 `baseUrl`）
 *
 * 与 `resolveServerBaseUrl` 的差别：空值与平台官方地址都归一为 `null`（语义即「用官方地址」），
 * 避免把默认值写进配置产生无意义差异；非法地址与未确认的 http 同样抛 `notFound`。
 */
export function normalizeServerBaseUrl(
  input: string | null | undefined,
  defaultBaseUrl: string,
  allowInsecure: boolean,
): string | null {
  const resolved = resolveServerBaseUrl(input, defaultBaseUrl, allowInsecure);
  return resolved === defaultBaseUrl ? null : resolved;
}
