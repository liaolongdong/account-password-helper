/**
 * 云同步审计日志（设计规格 §8）
 *
 * 安全硬约束——**字段白名单**：
 * - 允许：时间戳、provider、模式、操作类型、业务 ID、数据哈希、云端 recordId、
 *   统计数字、冲突标记、异常简要信息（错误码 + 平台消息）；
 * - 禁止：明文密码、TOTP 密钥、用户名、网址、备注、完整 payload、token/secret。
 *
 * 白名单在写入前强制执行（sanitizeEntry），即使调用方误传敏感字段也会被剥离，
 * 使「日志不含可还原明文」成为模块级不变量而非调用方约定。
 *
 * 滚动策略：最多 100 条，FIFO 淘汰最早记录。写入失败不阻断同步主流程。
 */
import type { AuditEntry, CloudProvider, CloudSyncMode } from './types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/** 最大保留条数 */
export const AUDIT_LOG_MAX_ENTRIES = 100;

/** recordId 列表截断上限（避免单条日志膨胀） */
const MAX_RECORD_IDS = 20;

/** 允许出现在 error.message 中的最大长度（平台消息可能很长） */
const MAX_ERROR_MESSAGE_LENGTH = 200;

/** 合法 provider 白名单：非法值回退 'feishu'（安全默认），合法值原样保留 */
const ALLOWED_PROVIDERS = new Set<string>(['feishu', 'tencent', 'webdav']);

/** 统计字段白名单（数字类型，逐一显式拷贝而非展开对象） */
const ALLOWED_STAT_KEYS = [
  'created',
  'updated',
  'deleted',
  'pulled',
  'trashed',
  'conflicts',
  'skipped',
  'failed',
] as const;

/**
 * 按白名单重建审计条目
 *
 * 显式逐字段拷贝：新增字段必须在此登记，杜绝「顺手 spread 整个上下文对象」
 * 把敏感数据带进持久化日志。
 */
export function sanitizeEntry(entry: AuditEntry): AuditEntry {
  const clean: AuditEntry = {
    at: Number.isFinite(entry.at) ? entry.at : Date.now(),
    provider: ALLOWED_PROVIDERS.has(entry.provider) ? entry.provider : 'feishu',
    mode: entry.mode === 'plaintext' ? 'plaintext' : 'encrypted',
    action: entry.action,
    docKey: typeof entry.docKey === 'string' ? entry.docKey.slice(0, 200) : '',
  };

  if (entry.stats) {
    const stats: Partial<Record<(typeof ALLOWED_STAT_KEYS)[number], number>> = {};
    for (const key of ALLOWED_STAT_KEYS) {
      const value = entry.stats[key];
      if (typeof value === 'number' && Number.isFinite(value)) stats[key] = value;
    }
    if (Object.keys(stats).length > 0) clean.stats = stats;
  }

  if (Array.isArray(entry.recordIds)) {
    clean.recordIds = entry.recordIds.filter(id => typeof id === 'string').slice(0, MAX_RECORD_IDS);
  }

  if (Array.isArray(entry.conflictIds)) {
    // 业务 ID 为本地生成的 uuid，不含用户数据，允许记录
    clean.conflictIds = entry.conflictIds.filter(id => typeof id === 'string').slice(0, MAX_RECORD_IDS);
  }

  if (entry.error) {
    clean.error = {
      kind: entry.error.kind,
      ...(entry.error.code !== undefined ? { code: entry.error.code } : {}),
      ...(typeof entry.error.message === 'string'
        ? { message: entry.error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) }
        : {}),
    };
  }

  return clean;
}

/** 读取审计日志（失败降级为空数组：日志属可丢弃数据） */
export async function getAuditLog(): Promise<AuditEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG);
    const raw = result[STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG];
    return Array.isArray(raw) ? (raw as AuditEntry[]) : [];
  } catch (error) {
    logger.error('读取云同步审计日志失败:', error);
    return [];
  }
}

/**
 * 追加一条审计日志
 *
 * @returns 写入是否成功（失败不抛错，由调用方在报告中提示「审计日志写入失败」）
 */
export async function appendAuditLog(entry: AuditEntry): Promise<boolean> {
  try {
    const log = await getAuditLog();
    log.push(sanitizeEntry(entry));
    // FIFO 淘汰最早记录
    const trimmed = log.length > AUDIT_LOG_MAX_ENTRIES ? log.slice(log.length - AUDIT_LOG_MAX_ENTRIES) : log;
    await chrome.storage.local.set({ [STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG]: trimmed });
    return true;
  } catch (error) {
    logger.error('写入云同步审计日志失败:', error);
    return false;
  }
}

/** 清空审计日志（UI 提供手动入口） */
export async function clearAuditLog(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.CLOUD_SYNC_AUDIT_LOG);
  } catch (error) {
    logger.error('清空云同步审计日志失败:', error);
    throw error;
  }
}

/** 构造审计条目的便捷工厂（减少调用方样板） */
export function makeAuditEntry(
  provider: CloudProvider,
  mode: CloudSyncMode,
  action: AuditEntry['action'],
  docKey: string,
  extra: Partial<AuditEntry> = {},
): AuditEntry {
  return sanitizeEntry({ at: Date.now(), provider, mode, action, docKey, ...extra });
}
