/**
 * 云同步统一错误类型
 *
 * 适配器把平台原始错误码归一化为 `CloudErrorKind`，上层据此选择 i18n 文案；
 * 原始码保留在 `detail` 中供排查（不含敏感数据，可安全记录）。
 */
import type { CloudErrorKind } from './types';

/** 云同步领域错误 */
export class CloudSyncError extends Error {
  readonly kind: CloudErrorKind;
  /** 平台原始错误码（HTTP 状态码或业务码） */
  readonly code?: string | number;
  /** 平台原始消息（已确认不含凭证/条目内容） */
  readonly detail?: string;

  constructor(kind: CloudErrorKind, message: string, code?: string | number, detail?: string) {
    super(message);
    this.name = 'CloudSyncError';
    this.kind = kind;
    this.code = code;
    this.detail = detail;
  }
}

/** 判断是否为云同步领域错误 */
export function isCloudSyncError(error: unknown): error is CloudSyncError {
  return error instanceof CloudSyncError;
}

/** 判断是否为用户主动取消（取消不算失败，报告中单独标注） */
export function isAbortError(error: unknown): boolean {
  if (isCloudSyncError(error)) return error.kind === 'aborted';
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * 把任意异常归一化为 CloudSyncError
 *
 * 非领域异常统一映射为 `network`（fetch 失败/超时占多数）或 `unknown`，
 * 保证调用方只需处理一种错误形态。
 */
export function toCloudSyncError(error: unknown): CloudSyncError {
  if (isCloudSyncError(error)) return error;
  if (isAbortError(error)) return new CloudSyncError('aborted', 'aborted');
  const message = error instanceof Error ? error.message : String(error);
  // TypeError 是 fetch 网络层失败的典型形态（DNS/断网/CORS）
  const kind: CloudErrorKind = error instanceof TypeError ? 'network' : 'unknown';
  return new CloudSyncError(kind, message);
}
