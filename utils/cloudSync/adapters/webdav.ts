/**
 * WebDAV 文件存储适配器（WebDAV 规格 §4）
 *
 * 运行上下文约束：`DOMParser` 是 Window API，Service Worker 中不存在。
 * 本模块仅可在 **Options 页面**使用（云同步的执行位置），严禁被
 * background / content 入口 import。CloudSyncDialog 经 defineAsyncComponent
 * 懒加载，本模块只落入 Options 页面 chunk。
 *
 * 协议要点：
 * - 鉴权：Basic（用户名/密码，UTF-8 安全 base64）或 Bearer Token（可选，优先）；
 * - PROPFIND 响应按 `localName` 解析（各服务器命名空间前缀 D:/d:/默认均有实测差异）；
 * - 仅操作 `aph-*.aphdav` 文件，绝不误列/误删用户目录下的其他文件；
 * - 文件 URL 由适配器以 `backupDirUrl + encodeURIComponent(name)` 重建，
 *   不信任服务器返回 href 的绝对性/编码；
 * - MKCOL 201/405 均视为成功（幂等）；DELETE 404 视为业务成功；
 * - 复用 httpClient 的超时/重试/取消/配额计数；423 Locked 不重试（需人工介入）。
 */
import { CloudSyncError } from '../errors';
import type { AdapterOptions, WebDavCredentials } from '../types';
import type { FileStorageAdapter, RemoteFile } from './fileStorage';
import { isTransientStatus, requestWithRetry } from './httpClient';

/** 下载响应体上限（云端文件是不可信输入，防恶意/损坏文件吃光内存） */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** 备份子目录名（在用户指定目录下创建） */
export const BACKUP_DIR_NAME = 'aph-backup/';

/** 快照文件名前缀/后缀（PROPFIND 过滤依据，避免误列用户其他文件） */
export const FILE_PREFIX = 'aph-';
export const FILE_SUFFIX = '.aphdav';

/** PROPFIND 最小请求体：只要 resourcetype 与 getcontentlength */
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';

/** http 免确认的本地 host（开发场景） */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 构造 Basic 认证头（TextEncoder 保证非 ASCII 用户名/密码正确编码） */
export function buildBasicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/**
 * 归一化目录 URL：去首尾空白 + 补尾斜杠
 *
 * 路径段原样保留（不二次编码），用户填的 `/remote.php/dav/files/张三/` 必须可用。
 * 非法 URL 或非 http(s) 协议抛 `notFound`。
 */
export function normalizeWebDavDirUrl(dirUrl: string): string {
  let url: URL;
  try {
    url = new URL(dirUrl.trim());
  } catch {
    throw new CloudSyncError('notFound', 'invalid WebDAV directory url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CloudSyncError('notFound', `unsupported protocol: ${url.protocol}`);
  }
  return url.pathname.endsWith('/') ? url.toString() : `${url.toString()}/`;
}

/**
 * 判断目录 URL 是否需要用户显式确认明文传输（WebDAV 规格 §4.4）
 *
 * https → false；http + localhost → false（本地开发）；http 其他 → true；
 * 非 http(s) 协议抛 notFound。
 */
export function needsInsecureConfirm(dirUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(dirUrl.trim());
  } catch {
    throw new CloudSyncError('notFound', 'invalid WebDAV directory url');
  }
  if (url.protocol === 'https:') return false;
  if (url.protocol !== 'http:') throw new CloudSyncError('notFound', `unsupported protocol: ${url.protocol}`);
  return !LOCAL_HOSTS.has(url.hostname);
}

/** HTTP 状态码 → 领域错误（WebDAV 无业务码，全看状态码；规格 §4.3） */
export function mapWebDavStatus(status: number, message: string): CloudSyncError {
  switch (status) {
    case 401:
      return new CloudSyncError('invalidCredential', message, status);
    case 403:
    case 407:
      return new CloudSyncError('permission', message, status);
    case 404:
    case 409:
      return new CloudSyncError('notFound', message, status);
    case 413:
      return new CloudSyncError('tooLarge', message, status);
    case 423:
      return new CloudSyncError('writeConflict', message, status);
    case 429:
      return new CloudSyncError('rateLimit', message, status);
    case 507:
      return new CloudSyncError('quota', message, status);
    default:
      if (status >= 500) return new CloudSyncError('network', message, status);
      return new CloudSyncError('unknown', message, status);
  }
}

/**
 * 从快照文件名解析导出时间（UTC 紧凑时间戳 → epoch 毫秒）
 *
 * 不依赖 PROPFIND 的 getlastmodified（各服务器时区行为不一致）。
 * 非法文件名或非法时间字段返回 0（UI 展示回退为文件名本身）。
 */
export function parseSnapshotFileName(name: string): number {
  const match = /^aph-(\d{14})-/.exec(name);
  if (!match) return 0;
  const digits = match[1];
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  const second = Number(digits.slice(12, 14));
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
  if (hour > 23 || minute > 59 || second > 59) return 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isFinite(ms) ? ms : 0;
}

/** 构造参数 */
export interface WebDavAdapterInit {
  /** 用户填写的远程目录 URL */
  dirUrl: string;
  credentials: WebDavCredentials;
  options?: AdapterOptions;
  /** http 非 localhost 时必须为 true（用户已显式确认），否则构造即抛错 */
  allowInsecure?: boolean;
  /** 下载上限（测试接缝；默认 MAX_DOWNLOAD_BYTES） */
  maxDownloadBytes?: number;
}

/** WebDAV 适配器 */
export class WebDavAdapter implements FileStorageAdapter {
  readonly provider = 'webdav' as const;

  /** 归一化后的用户目录 URL（尾斜杠） */
  readonly dirUrl: string;
  /** 备份子目录 URL（= dirUrl + 'aph-backup/'） */
  readonly backupDirUrl: string;

  private readonly credentials: WebDavCredentials;
  private readonly options: AdapterOptions;
  private readonly maxDownloadBytes: number;

  constructor(init: WebDavAdapterInit) {
    // 安全门在适配器内独立执行，不信任调用方（UI）单侧判断（规格 §6.2）
    if (needsInsecureConfirm(init.dirUrl) && init.allowInsecure !== true) {
      throw new CloudSyncError('notFound', 'insecure transport requires explicit confirmation');
    }
    this.dirUrl = normalizeWebDavDirUrl(init.dirUrl);
    this.backupDirUrl = `${this.dirUrl}${BACKUP_DIR_NAME}`;
    this.credentials = init.credentials;
    this.options = init.options ?? {};
    this.maxDownloadBytes = init.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
  }

  /** 认证头：bearerToken 非空优先，否则 Basic */
  private authHeader(): string {
    const token = this.credentials.bearerToken;
    if (typeof token === 'string' && token !== '') return `Bearer ${token}`;
    return buildBasicAuthHeader(this.credentials.username, this.credentials.password);
  }

  /**
   * 统一请求入口：注入鉴权头、复用 httpClient 重试、按 okStatuses 判定成败
   *
   * 423 Locked 不重试（isTransientStatus 不含 423）；重试仅针对网络异常/429/5xx。
   */
  private async request(
    method: string,
    url: string,
    init: { body?: string; headers?: Record<string, string>; okStatuses: number[] },
  ): Promise<Response> {
    if (this.options.signal?.aborted) throw new CloudSyncError('aborted', 'aborted');
    const { response } = await requestWithRetry(url, {
      method,
      headers: { Authorization: this.authHeader(), ...init.headers },
      body: init.body,
      signal: this.options.signal,
      onApiCall: this.options.onApiCall,
      // 507（容量不足）虽属 5xx 但重试无意义，排除；423 本就不在 isTransientStatus 内
      shouldRetry: context => context.status !== 507 && isTransientStatus(context.status, context.networkError),
    });
    if (!init.okStatuses.includes(response.status)) {
      throw mapWebDavStatus(response.status, `${method} failed with HTTP ${response.status}`);
    }
    return response;
  }

  /** PROPFIND（depth 0 探活 / depth 1 列目录） */
  private async propfind(url: string, depth: '0' | '1'): Promise<Response> {
    return this.request('PROPFIND', url, {
      body: PROPFIND_BODY,
      headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
      okStatuses: [207],
    });
  }

  /**
   * 探活 + 鉴权校验
   *
   * 备份目录 404 时降级探测父目录：父目录可达即视为连接成功
   * （备份子目录将在 ensureDirectory 时创建）。
   */
  async testConnection(): Promise<void> {
    try {
      await this.propfind(this.backupDirUrl, '0');
    } catch (error) {
      if (error instanceof CloudSyncError && error.code === 404) {
        await this.propfind(this.dirUrl, '0');
        return;
      }
      throw error;
    }
  }

  /**
   * 确保备份子目录存在（MKCOL 幂等）
   *
   * @returns 201 → 本次新建（true）；405 → 已存在（false）
   */
  async ensureDirectory(): Promise<boolean> {
    const response = await this.request('MKCOL', this.backupDirUrl, { okStatuses: [201, 405] });
    return response.status === 201;
  }

  /** 列出备份目录下的快照文件（仅 aph-*.aphdav，过滤集合与其他文件） */
  async listFiles(): Promise<RemoteFile[]> {
    const response = await this.propfind(this.backupDirUrl, '1');
    const xml = await response.text();
    return this.parsePropfindXml(xml);
  }

  /** 解析 PROPFIND multistatus（按 localName 匹配，不依赖命名空间前缀） */
  private parsePropfindXml(xml: string): RemoteFile[] {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new CloudSyncError('unknown', 'unparsable PROPFIND response');
    }
    const files: RemoteFile[] = [];
    const responses = doc.getElementsByTagNameNS('*', 'response');
    for (let i = 0; i < responses.length; i++) {
      const responseEl = responses[i];
      // 集合（目录）自身跳过
      const resourceType = responseEl.getElementsByTagNameNS('*', 'resourcetype')[0];
      if (resourceType && resourceType.getElementsByTagNameNS('*', 'collection').length > 0) continue;

      const href = responseEl.getElementsByTagNameNS('*', 'href')[0]?.textContent ?? '';
      const name = basenameFromHref(href);
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;

      const lengthText = responseEl.getElementsByTagNameNS('*', 'getcontentlength')[0]?.textContent;
      const size = lengthText !== undefined && Number.isFinite(Number(lengthText)) ? Number(lengthText) : 0;
      // url 由适配器重建，不信任服务器 href 的绝对性/编码
      files.push({ name, url: `${this.backupDirUrl}${encodeURIComponent(name)}`, size });
    }
    return files;
  }

  /** 上传文件（PUT 整体覆盖） */
  async putFile(name: string, content: string): Promise<void> {
    await this.request('PUT', `${this.backupDirUrl}${encodeURIComponent(name)}`, {
      body: content,
      headers: { 'Content-Type': 'application/octet-stream' },
      okStatuses: [200, 201, 204],
    });
  }

  /**
   * 下载文件内容
   *
   * 双重上限校验：expectedSize（PROPFIND 所得）超限则不发请求；
   * size 未知（0）时读取后按内容长度二次校验。
   */
  async getFile(url: string, expectedSize?: number): Promise<string> {
    if (expectedSize !== undefined && expectedSize > this.maxDownloadBytes) {
      throw new CloudSyncError('tooLarge', `remote file exceeds ${this.maxDownloadBytes} bytes`);
    }
    const response = await this.request('GET', url, { okStatuses: [200] });
    const text = await response.text();
    if (text.length > this.maxDownloadBytes) {
      throw new CloudSyncError('tooLarge', `remote file exceeds ${this.maxDownloadBytes} bytes`);
    }
    return text;
  }

  /** 删除文件（404 视为业务成功：目标状态已达成） */
  async deleteFile(url: string): Promise<void> {
    await this.request('DELETE', url, { okStatuses: [200, 204, 404] });
  }
}

/** 从 href 提取文件名（去尾斜杠 → 取最后一段 → decodeURIComponent，失败用原值） */
function basenameFromHref(href: string): string {
  const trimmed = href.replace(/\/+$/, '');
  const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}
