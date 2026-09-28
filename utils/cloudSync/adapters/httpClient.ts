/**
 * 云同步适配器公共 HTTP 层
 *
 * 统一承载两个平台共有、且与业务无关的请求语义（设计规格 §3.3）：
 * - 单请求 15s 超时（`AbortController`），外部取消信号可透传；
 * - 网络层重试 ≤2 次，仅针对 5xx / 超时 / 429 / 平台限流与写冲突码；
 * - 429 优先读 `Retry-After`，其余 2s 起指数退避；
 * - 每次真实 HTTP 请求回调一次，供上层本地估算配额（仅预警，不硬阻断）。
 *
 * 本模块**不**解析平台响应结构，也不做错误码到领域错误的映射——那属于各适配器
 * 的职责，因为两平台的重试判定所依赖的错误码不同。
 */
import { CloudSyncError } from '../errors';
import type { AdapterOptions } from '../types';

/** 单请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = 15_000;

/** 网络层最大重试次数（不含首次请求） */
export const MAX_RETRIES = 2;

/** 退避基数（毫秒）：2s、4s */
const BACKOFF_BASE_MS = 2_000;

/** 重试判定上下文 */
export interface RetryContext {
  /** HTTP 状态码；网络异常/超时为 0 */
  status: number;
  /** 平台业务错误码（若响应体可解析） */
  code?: string | number;
  /** 是否为网络异常或超时 */
  networkError: boolean;
}

/** 请求参数 */
export interface RequestOptions extends AdapterOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 平台适配器提供的重试判定 */
  shouldRetry: (context: RetryContext) => boolean;
  /** 每次重试前的回调（用于记录重试原因，不含敏感数据） */
  onRetry?: (attempt: number, context: RetryContext) => void;
}

/** 解析 `Retry-After` 响应头（秒或 HTTP 日期），失败返回 null */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  return null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CloudSyncError('aborted', 'aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CloudSyncError('aborted', 'aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 单次 fetch（含超时与外部取消信号的组合） */
async function fetchOnce(url: string, options: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 带重试的请求
 *
 * 返回原始 `Response` 与已解析的 JSON（解析失败时为 null），由适配器决定如何
 * 解读业务错误码。网络异常与超时统一抛出 `network` 类别错误（重试耗尽后）。
 */
export async function requestWithRetry(
  url: string,
  options: RequestOptions,
): Promise<{ response: Response; json: unknown }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    let json: unknown;

    try {
      options.onApiCall?.();
      response = await fetchOnce(url, options);
      try {
        json = await response.clone().json();
      } catch {
        json = null;
      }
    } catch (error) {
      if (options.signal?.aborted) throw new CloudSyncError('aborted', 'aborted');
      lastError = error;
      const context: RetryContext = { status: 0, networkError: true };
      if (attempt < MAX_RETRIES && options.shouldRetry(context)) {
        options.onRetry?.(attempt + 1, context);
        await delay(BACKOFF_BASE_MS * 2 ** attempt, options.signal);
        continue;
      }
      throw new CloudSyncError('network', 'network request failed', undefined, (error as Error)?.message);
    }

    const code = extractCode(json);
    const context: RetryContext = { status: response.status, code, networkError: false };
    if (options.shouldRetry(context) && attempt < MAX_RETRIES) {
      options.onRetry?.(attempt + 1, context);
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
      await delay(retryAfter ?? BACKOFF_BASE_MS * 2 ** attempt, options.signal);
      continue;
    }

    return { response, json };
  }

  throw new CloudSyncError('unknown', 'retry exhausted', undefined, String(lastError));
}

/** 从平台响应体中提取业务错误码（结构不同故做宽松提取） */
function extractCode(json: unknown): string | number | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const record = json as Record<string, unknown>;
  const code = record.code ?? record.ret;
  return typeof code === 'number' || typeof code === 'string' ? code : undefined;
}

/**
 * 把一批数据按平台上限切分
 *
 * 批间由调用方串行执行（规避飞书 `1254291` 同表并发写冲突）。
 */
export function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** 5xx 与网络异常的通用重试判定（两平台共用部分） */
export function isTransientStatus(status: number, networkError: boolean): boolean {
  return networkError || status === 429 || status >= 500;
}
