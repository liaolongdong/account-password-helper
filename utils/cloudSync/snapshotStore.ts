/**
 * 明文模式本地快照存取（设计规格 §6.1）
 *
 * 快照是**可重建缓存**而非事实来源：丢失/损坏时降级为「全量比对 + 时间戳 LWW」，
 * 不致命；UI 提供【全量拉取云端重建本地快照】用于修复不一致。
 *
 * 多文档隔离：键名含 provider + docKey，飞书与腾讯、不同目标文档各自独立，
 * 切换互不覆盖。同 provider 换目标文档视为全新同步链路，旧快照保留不自动迁移。
 */
import type { CloudProvider, EncryptedSnapshotMeta, SnapshotEntry, SyncSnapshot } from './types';
import { logger } from '@/utils/logger';
import { cloudSyncSnapshotKey } from '@/utils/storageKeys';

/** 读取快照；不存在或损坏时返回 null（调用方据此降级） */
export async function loadSnapshot(provider: CloudProvider, docKey: string): Promise<SyncSnapshot | null> {
  try {
    const key = cloudSyncSnapshotKey(provider, docKey);
    const result = await chrome.storage.local.get(key);
    const raw = result[key] as SyncSnapshot | undefined;
    if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') return null;
    return raw;
  } catch (error) {
    logger.error('读取云同步快照失败:', error);
    return null;
  }
}

/**
 * 写入快照
 *
 * 写入失败**向上抛出**：云端已写入而本地快照未保存会造成不一致窗口，
 * 同步引擎据此终止本轮并告警，引导用户重建快照（设计规格 §6.4 风险兜底）。
 */
export async function saveSnapshot(snapshot: SyncSnapshot): Promise<void> {
  const key = cloudSyncSnapshotKey(snapshot.provider, snapshot.docKey);
  await chrome.storage.local.set({ [key]: snapshot });
}

/** 删除快照（换目标文档时的手动清理入口） */
export async function removeSnapshot(provider: CloudProvider, docKey: string): Promise<void> {
  try {
    await chrome.storage.local.remove(cloudSyncSnapshotKey(provider, docKey));
  } catch (error) {
    logger.error('删除云同步快照失败:', error);
  }
}

/** 创建空快照 */
export function createEmptySnapshot(provider: CloudProvider, docKey: string): SyncSnapshot {
  return { provider, docKey, entries: {} };
}

/**
 * 增量更新快照条目（每批云端操作成功后立即调用，而非全部完成后一次性写入）
 *
 * 降低中途失败导致的不一致窗口。返回新对象，不修改入参（便于调用方持有旧值回滚）。
 */
export function withEntries(snapshot: SyncSnapshot, updates: Record<string, SnapshotEntry | null>): SyncSnapshot {
  const entries = { ...snapshot.entries };
  for (const [businessId, value] of Object.entries(updates)) {
    if (value === null) delete entries[businessId];
    else entries[businessId] = value;
  }
  return { ...snapshot, entries };
}

/**
 * 列出本机全部云同步快照键（供「清理旧链路快照」入口展示）
 *
 * 通过 storage.local.get(null) 全量读取后按键前缀过滤；快照体积有限
 * （仅哈希与 recordId），不会造成明显开销。
 */
export async function listSnapshotKeys(): Promise<string[]> {
  try {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter(key => key.startsWith('cloud_sync_snapshot_'));
  } catch (error) {
    logger.error('枚举云同步快照失败:', error);
    return [];
  }
}

/**
 * 密文快照元数据键名
 *
 * 与明文快照分离：密文模式只记录"s上次推送了哪个分组、整体哈希是多少"，
 * **绝不记录 Blob 内容或分片明文**。
 */
function encryptedMetaKey(provider: CloudProvider, docKey: string): string {
  return `cloud_sync_encrypted_meta_${provider}_${docKey}`;
}

/** 读取密文快照元数据（不存在时返回 null） */
export async function loadEncryptedMeta(
  provider: CloudProvider,
  docKey: string,
): Promise<EncryptedSnapshotMeta | null> {
  try {
    const key = encryptedMetaKey(provider, docKey);
    const result = await chrome.storage.local.get(key);
    const raw = result[key] as EncryptedSnapshotMeta | undefined;
    if (!raw || typeof raw !== 'object' || typeof raw.snapshotGroupId !== 'string') return null;
    return raw;
  } catch (error) {
    logger.error('读取密文快照元数据失败:', error);
    return null;
  }
}

/** 写入密文快照元数据（仅元信息，写入失败向上抛出） */
export async function saveEncryptedMeta(meta: EncryptedSnapshotMeta): Promise<void> {
  await chrome.storage.local.set({ [encryptedMetaKey(meta.provider, meta.docKey)]: meta });
}
