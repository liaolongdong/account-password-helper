/**
 * 密文快照：整库加密 + 分片 + 双层哈希 + 恢复校验链（设计规格 §5）
 *
 * 数据流：
 * `PasswordEntry[]` → 版本化 JSON → AES-256-GCM 加密（当前主密码派生）→ Base64 →
 * 按阈值切分为多行分片；每片算 `partHash`，整体算 `snapshotHash`。
 *
 * 恢复严格执行串行校验链：分片齐全 → 逐片 `partHash` → 整体 `snapshotHash` →
 * GCM 解密 → 载荷类型校验。任一步失败即拒绝恢复，且**不尝试其他口令、不暴力重试**。
 *
 * 加密仅复用 `utils/encryption.ts` 现有封装（PBKDF2-SHA256 600k + 随机 IV + GCM），
 * 本模块不自创算法、不使用固定 IV。
 */
import type { PasswordEntry, PasswordGroup } from '@/utils/types';
import { deriveEncryptionKey, decryptData, encryptData } from '@/utils/encryption';
import type { CloudSnapshotPayload, RestoreRejectReason, SnapshotChunkRow, SnapshotGroup } from './types';
import { DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE } from './configStore';
import { sha256Hex } from './hash';

/** 快照格式版本号 */
export const SNAPSHOT_FORMAT_VERSION = 1;

/** 生成快照分组 ID（uuidv4，用于跨分片聚合） */
function generateSnapshotGroupId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 组装版本化载荷（`order` 为本地 UX 状态，不参与同步与备份） */
export function buildSnapshotPayload(
  entries: PasswordEntry[],
  exportedAt = Date.now(),
  groups: readonly PasswordGroup[] = [],
): CloudSnapshotPayload {
  return {
    version: SNAPSHOT_FORMAT_VERSION,
    exportedAt,
    count: entries.length,
    entries: entries.map(({ order: _order, ...rest }) => rest),
    groups: groups.map(group => ({ ...group })),
  };
}

/** 把 Base64 串按阈值切分（阈值动态降级由调用方重试） */
export function splitBase64(blob: string, chunkSize: number): string[] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');
  const parts: string[] = [];
  for (let index = 0; index < blob.length; index += chunkSize) parts.push(blob.slice(index, index + chunkSize));
  return parts.length > 0 ? parts : [''];
}

/**
 * 把加密后的 Base64 Blob 组装为分片行
 *
 * 同一快照的所有分片共享 `snapshotGroupId` 与 `snapshotHash`；`partKey` 保证
 * 行级唯一（索引列约束要求行唯一，而分组 ID 在同组分片间重复）。
 */
export async function buildSnapshotChunks(
  blob: string,
  exportedAt: number,
  chunkSize = DEFAULT_CHUNK_SIZE,
  snapshotGroupId = generateSnapshotGroupId(),
): Promise<SnapshotChunkRow[]> {
  const snapshotHash = await sha256Hex(blob);
  const parts = splitBase64(blob, chunkSize);
  const totalParts = parts.length;
  const rows: SnapshotChunkRow[] = [];
  for (let partIndex = 0; partIndex < totalParts; partIndex++) {
    const payload = parts[partIndex];
    rows.push({
      partKey: `${snapshotGroupId}#${partIndex}`,
      snapshotGroupId,
      partIndex,
      totalParts,
      snapshotHash,
      partHash: await sha256Hex(payload),
      payload,
      version: SNAPSHOT_FORMAT_VERSION,
      exportedAt,
    });
  }
  return rows;
}

/**
 * 加密并分片（一步完成，供备份流程调用）
 *
 * **仅接受当前有效主密码**（已由 `promptAndVerifyMasterPassword` 验证），
 * 不允许自定义口令——否则口令记错将导致云端 Blob 永久无法恢复。
 */
export async function encryptAndChunk(
  entries: PasswordEntry[],
  masterPassword: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  exportedAt = Date.now(),
  groups: readonly PasswordGroup[] = [],
): Promise<{ rows: SnapshotChunkRow[]; snapshotGroupId: string; snapshotHash: string; exportedAt: number }> {
  const payload = buildSnapshotPayload(entries, exportedAt, groups);
  const hexKey = await deriveEncryptionKey(masterPassword);
  const blob = await encryptData(JSON.stringify(payload), hexKey);
  const snapshotGroupId = generateSnapshotGroupId();
  const rows = await buildSnapshotChunks(blob, exportedAt, chunkSize, snapshotGroupId);
  return { rows, snapshotGroupId, snapshotHash: rows[0].snapshotHash, exportedAt };
}

/**
 * 把云端全部密文行按 `snapshotGroupId` 聚合为分组
 *
 * 仅做结构聚合与完整性标记，不做哈希校验（校验在恢复时按需执行，
 * 避免每次列表查询都重复计算全部分片哈希）。
 */
export function groupChunks(rows: SnapshotChunkRow[]): SnapshotGroup[] {
  const groups = new Map<string, SnapshotGroup>();
  for (const row of rows) {
    const existing = groups.get(row.snapshotGroupId);
    if (existing) {
      existing.chunks.push(row);
      existing.complete = existing.chunks.length === existing.totalParts;
    } else {
      groups.set(row.snapshotGroupId, {
        snapshotGroupId: row.snapshotGroupId,
        snapshotHash: row.snapshotHash,
        totalParts: row.totalParts,
        version: row.version,
        exportedAt: row.exportedAt,
        chunks: [row],
        recordIds: [],
        complete: row.totalParts === 1,
      });
    }
  }
  for (const group of groups.values()) group.chunks.sort((a, b) => a.partIndex - b.partIndex);
  return [...groups.values()].sort((a, b) => b.exportedAt - a.exportedAt);
}

/** 载荷类型守卫：解密结果是**不可信输入**，逐字段校验后收窄 */
export function parseSnapshotPayload(raw: unknown): CloudSnapshotPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<CloudSnapshotPayload>;
  if (value.version !== SNAPSHOT_FORMAT_VERSION) return null;
  if (typeof value.exportedAt !== 'number' || !Number.isFinite(value.exportedAt)) return null;
  if (typeof value.count !== 'number' || !Array.isArray(value.entries)) return null;

  const entries: PasswordEntry[] = [];
  for (const item of value.entries) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<PasswordEntry>;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    entries.push({
      id: entry.id.slice(0, 128),
      username: typeof entry.username === 'string' ? entry.username : '',
      password: typeof entry.password === 'string' ? entry.password : '',
      url: typeof entry.url === 'string' ? entry.url : '',
      tag: typeof entry.tag === 'string' ? entry.tag : '',
      remark: typeof entry.remark === 'string' ? entry.remark : '',
      totp: typeof entry.totp === 'string' ? entry.totp : '',
      createTime: typeof entry.createTime === 'number' ? entry.createTime : value.exportedAt,
      updateTime: typeof entry.updateTime === 'number' ? entry.updateTime : value.exportedAt,
      order: 0,
      groupId: typeof entry.groupId === 'string' ? entry.groupId.slice(0, 128) : undefined,
    });
  }

  const groups: PasswordGroup[] = [];
  if (Array.isArray(value.groups)) {
    for (const item of value.groups) {
      if (!item || typeof item !== 'object') continue;
      const group = item as Partial<PasswordGroup>;
      if (
        typeof group.code !== 'string' ||
        group.code === '' ||
        typeof group.name !== 'string' ||
        group.name === '' ||
        typeof group.parentCode !== 'string' ||
        typeof group.order !== 'number' ||
        !Number.isFinite(group.order)
      ) {
        continue;
      }
      groups.push({
        code: group.code.slice(0, 128),
        name: group.name.slice(0, 30),
        parentCode: group.parentCode.slice(0, 128),
        order: group.order,
      });
    }
  }

  return { version: SNAPSHOT_FORMAT_VERSION, exportedAt: value.exportedAt, count: entries.length, entries, groups };
}

/** 恢复结果 */
export type RestoreResult = { ok: true; payload: CloudSnapshotPayload } | { ok: false; reason: RestoreRejectReason };

/**
 * 执行恢复校验链并解密
 *
 * 串行顺序（任一失败立即拒绝，设计规格 §5.3）：
 * 分片数量 → 逐片 `partHash` → 整体 `snapshotHash` → GCM 解密 → 载荷类型校验。
 */
export async function verifyAndDecryptSnapshot(group: SnapshotGroup, masterPassword: string): Promise<RestoreResult> {
  if (group.chunks.length === 0) return { ok: false, reason: 'noSnapshot' };
  if (group.chunks.length !== group.totalParts) return { ok: false, reason: 'incomplete' };

  const ordered = [...group.chunks].sort((a, b) => a.partIndex - b.partIndex);
  for (const chunk of ordered) {
    if ((await sha256Hex(chunk.payload)) !== chunk.partHash) return { ok: false, reason: 'partHashMismatch' };
  }

  const blob = ordered.map(chunk => chunk.payload).join('');
  if ((await sha256Hex(blob)) !== group.snapshotHash) return { ok: false, reason: 'snapshotHashMismatch' };

  let plaintext: string;
  try {
    const hexKey = await deriveEncryptionKey(masterPassword);
    plaintext = await decryptData(blob, hexKey);
  } catch {
    // 不记录密文、密钥或明文；GCM 认证失败多为 rekey 或数据损坏
    return { ok: false, reason: 'decryptFailed' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    return { ok: false, reason: 'invalidPayload' };
  }
  const payload = parseSnapshotPayload(parsed);
  return payload ? { ok: true, payload } : { ok: false, reason: 'invalidPayload' };
}

/** 计算下一个更小的分片阈值（动态降级，降到下限仍失败则返回 null） */
export function nextChunkSize(current: number): number | null {
  const next = Math.floor(current / 2);
  return next >= MIN_CHUNK_SIZE ? next : null;
}

/**
 * 选出应保留的历史版本（最近 N 个完整分组）
 *
 * 用于"C 版本保留策略"：返回需要删除的分组 ID 列表，调用方据此清理云端分片。
 */
export function selectVersionsToPrune(groups: SnapshotGroup[], keepVersions: number): string[] {
  const complete = groups.filter(group => group.complete).sort((a, b) => b.exportedAt - a.exportedAt);
  return complete.slice(Math.max(1, keepVersions)).map(group => group.snapshotGroupId);
}

/**
 * 找出超期残缺孤儿分组（分片数 ≠ totalParts 且导出时间超过 7 天）
 *
 * 每次备份前置扫描清理，避免失败中断留下永久垃圾。
 */
export function selectOrphanGroups(
  groups: SnapshotGroup[],
  now = Date.now(),
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): string[] {
  return groups
    .filter(group => !group.complete && now - group.exportedAt > maxAgeMs)
    .map(group => group.snapshotGroupId);
}

// ==================== WebDAV 单文件快照（WebDAV 规格 §5） ====================

/**
 * WebDAV 单文件快照格式（不分片）
 *
 * 文件系统无单元格上限，整库密文作为单个 JSON 文件存储；
 * 保留 `snapshotHash` 完整性校验，恢复校验链与分片版语义一致。
 */
export interface SingleFileSnapshot {
  /** 格式版本，当前恒为 1；不兼容变更时递增并明确拒绝旧/新版本 */
  version: 1;
  /** 导出时间戳（epoch 毫秒） */
  exportedAt: number;
  /** 条目数（供 UI 展示与快速校验，不作为完整性依据） */
  count: number;
  /** `blob` 的 SHA-256（hex），完整性校验 */
  snapshotHash: string;
  /** Base64(IV[12] + AES-256-GCM 密文)，即 encryptData 的输出 */
  blob: string;
}

/**
 * 整库加密为单文件快照
 *
 * 复用既有 PBKDF2-SHA256 600k + 随机 IV + AES-256-GCM 路径，
 * 不自创算法、不用固定 IV（WebDAV 规格 §5.1）。
 */
export async function encryptToSingleFile(
  entries: PasswordEntry[],
  masterPassword: string,
  exportedAt = Date.now(),
  groups: readonly PasswordGroup[] = [],
): Promise<SingleFileSnapshot> {
  const payload = buildSnapshotPayload(entries, exportedAt, groups);
  const hexKey = await deriveEncryptionKey(masterPassword);
  const blob = await encryptData(JSON.stringify(payload), hexKey);
  return {
    version: SNAPSHOT_FORMAT_VERSION,
    exportedAt,
    count: entries.length,
    snapshotHash: await sha256Hex(blob),
    blob,
  };
}

/**
 * 单文件恢复校验链（WebDAV 规格 §5.2，串行，任一失败即拒绝）
 *
 * 结构校验 → snapshotHash → GCM 解密 → 载荷逐条校验。
 * 云端文件是不可信输入：所有字段先做类型收窄再使用；
 * 失败原因不含密文、密钥或明文内容。
 */
export async function verifyAndDecryptSingleFile(raw: unknown, masterPassword: string): Promise<RestoreResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalidPayload' };
  const file = raw as Partial<SingleFileSnapshot>;
  if (file.version !== SNAPSHOT_FORMAT_VERSION) return { ok: false, reason: 'invalidPayload' };
  if (typeof file.blob !== 'string' || file.blob === '') return { ok: false, reason: 'invalidPayload' };
  if (typeof file.exportedAt !== 'number' || !Number.isFinite(file.exportedAt)) {
    return { ok: false, reason: 'invalidPayload' };
  }
  if (typeof file.snapshotHash !== 'string' || (await sha256Hex(file.blob)) !== file.snapshotHash) {
    return { ok: false, reason: 'snapshotHashMismatch' };
  }

  let plaintext: string;
  try {
    const hexKey = await deriveEncryptionKey(masterPassword);
    plaintext = await decryptData(file.blob, hexKey);
  } catch {
    // 不记录密文、密钥或明文；GCM 认证失败多为 rekey 或数据损坏
    return { ok: false, reason: 'decryptFailed' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    return { ok: false, reason: 'invalidPayload' };
  }
  const payload = parseSnapshotPayload(parsed);
  return payload ? { ok: true, payload } : { ok: false, reason: 'invalidPayload' };
}
