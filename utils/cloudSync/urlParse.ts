/**
 * 云文档 URL 解析（设计规格 §4.3）
 *
 * 用户粘贴文档链接后，从中提取平台侧的文件标识与子表标识，避免手工录入。
 * 解析失败返回 `null`，由 UI 提示"链接格式无法识别"，不做模糊兜底猜测。
 */
import type { CloudProvider } from './types';

/** 解析结果 */
export interface ParsedCloudTarget {
  provider: CloudProvider;
  /** 飞书 app_token / 腾讯 fileID */
  fileKey: string;
  /** 查询参数里的子表标识（可能为空：由后续探测补全） */
  subKey: string | null;
}

/** 链接解析选项（表格平台私有化部署需要） */
export interface CloudUrlParseOptions {
  /**
   * 飞书私有化部署的开放平台地址；非空时放宽文档链接的域名白名单（见 `parseFeishuUrl`）。
   * 官方 SaaS 场景留空，行为与既往一致。
   */
  feishuBaseUrl?: string | null;
  /**
   * 腾讯文档私有化部署的开放平台地址；非空时放宽文档链接的域名白名单（见 `parseTencentUrl`）。
   * 官方 SaaS 场景留空，行为与既往一致。
   */
  tencentBaseUrl?: string | null;
}

/**
 * 解析飞书多维表格链接
 *
 * 支持两类形态：
 * - `https://<host>/base/<appToken>?table=<tableId>`
 * - `https://<host>/wiki/<nodeToken>?table=<tableId>`（wiki 需另行解析 node，暂按 base 处理）
 */
export function parseFeishuUrl(input: string, options: CloudUrlParseOptions = {}): ParsedCloudTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // 私有化部署的文档域名由客户自持，且常与开放平台域名不同，无法用白名单枚举：
  // 用户已显式配置自定义 API 地址即视为选择私有化，跳过域名校验，仅保留 http(s) 与路径形态约束。
  // 安全面不变——解析出的 fileKey 只拼到已配置的 API 地址上，不会向文档域名发任何请求。
  if (options.feishuBaseUrl?.trim()) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  } else if (!/(^|\.)feishu\.cn$/.test(url.hostname) && !/(^|\.)larksuite\.com$/.test(url.hostname)) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const kindIndex = segments.findIndex(segment => segment === 'base' || segment === 'wiki');
  if (kindIndex === -1 || kindIndex + 1 >= segments.length) return null;
  const fileKey = segments[kindIndex + 1];
  if (!fileKey || fileKey.length > 200) return null;
  const table = url.searchParams.get('table');
  return { provider: 'feishu', fileKey, subKey: table && table.length <= 200 ? table : null };
}

/**
 * 解析腾讯文档智能表链接
 *
 * 支持 `https://docs.qq.com/sheet/<fileID>?tab=<sheetID>` 与
 * `https://docs.qq.com/smartsheet/<fileID>?tab=<sheetID>`。
 */
export function parseTencentUrl(input: string, options: CloudUrlParseOptions = {}): ParsedCloudTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // 私有化部署的文档域名由客户自持；仅在用户显式配置自定义 API 地址时放宽白名单，
  // 解析出的 fileId 仍只会拼到该 API 地址上，不会向文档域名发请求。
  if (options.tencentBaseUrl?.trim()) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  } else if (!/(^|\.)docs\.qq\.com$/.test(url.hostname)) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const kindIndex = segments.findIndex(segment => segment === 'sheet' || segment === 'smartsheet');
  if (kindIndex === -1 || kindIndex + 1 >= segments.length) return null;
  const fileKey = decodeURIComponent(segments[kindIndex + 1]);
  if (!fileKey || fileKey.length > 200) return null;
  const tab = url.searchParams.get('tab');
  return { provider: 'tencent', fileKey, subKey: tab && tab.length <= 200 ? tab : null };
}

/**
 * 按平台解析链接
 *
 * 穷尽式 switch + never 兜底（WebDAV 规格 §2.2）：WebDAV 使用目录 URL
 * 而非文档链接，不走本函数；误调用时显式抛错而非静默落入腾讯解析。
 */
export function parseCloudUrl(
  provider: CloudProvider,
  input: string,
  options: CloudUrlParseOptions = {},
): ParsedCloudTarget | null {
  switch (provider) {
    case 'feishu':
      return parseFeishuUrl(input, options);
    case 'tencent':
      return parseTencentUrl(input, options);
    case 'webdav':
      // WebDAV 使用目录 URL（webdavSync.prepareWebDavTarget 直接校验），不走文档链接解析
      throw new Error('webdav does not use document url parsing');
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}
