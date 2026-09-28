/**
 * 云端表结构与字段映射（设计规格 §4）
 *
 * 两平台共用同一套**中文字段名**（密文表用英文技术名），使云端文档对人可读，
 * 也让 diff/syncEngine 完全平台无关。平台侧的字段类型枚举差异由适配器翻译。
 *
 * 关键约束：
 * - 索引列（飞书 is_primary）不可隐藏且仅支持部分类型，故明文表首列设为「用户名」、
 *   密文表首列设为 partKey，业务 ID 列置于**末位并隐藏**；
 * - 云端修改时间**不建字段**，从 record 元数据读取（规避系统字段只读不可写的坑）。
 */
import type { CloudSyncMode, LocalSyncEntry, TableFieldSpec } from './types';

/** 明文模式表名约定 */
export const PLAINTEXT_TABLE_NAME = 'APH-Sync-Plaintext';

/** 密文模式表名约定 */
export const ENCRYPTED_TABLE_NAME = 'APH-Sync-Encrypted';

/** 明文表字段名 */
export const PLAINTEXT_FIELDS = {
  username: '用户名',
  password: '密码',
  url: '网址',
  tag: '标签',
  remark: '备注',
  totp: 'TOTP',
  group: '分组',
  localUpdateTime: '本地更新时间',
  id: 'ID',
} as const;

/** 密文表字段名 */
export const ENCRYPTED_FIELDS = {
  partKey: 'partKey',
  snapshotGroupId: 'snapshotGroupId',
  partIndex: 'partIndex',
  totalParts: 'totalParts',
  snapshotHash: 'snapshotHash',
  partHash: 'partHash',
  payload: 'payload',
  version: 'version',
  exportedAt: 'exportedAt',
} as const;

/** 明文表结构规格（顺序即云端列顺序） */
export const PLAINTEXT_TABLE_SPEC: TableFieldSpec[] = [
  { name: PLAINTEXT_FIELDS.username, type: 'text', primary: true },
  { name: PLAINTEXT_FIELDS.password, type: 'text' },
  { name: PLAINTEXT_FIELDS.url, type: 'text' },
  { name: PLAINTEXT_FIELDS.tag, type: 'text' },
  { name: PLAINTEXT_FIELDS.remark, type: 'text' },
  { name: PLAINTEXT_FIELDS.totp, type: 'text' },
  { name: PLAINTEXT_FIELDS.group, type: 'text' },
  { name: PLAINTEXT_FIELDS.localUpdateTime, type: 'number' },
  { name: PLAINTEXT_FIELDS.id, type: 'text', hidden: true },
];

/** 密文表结构规格 */
export const ENCRYPTED_TABLE_SPEC: TableFieldSpec[] = [
  { name: ENCRYPTED_FIELDS.partKey, type: 'text', primary: true },
  { name: ENCRYPTED_FIELDS.snapshotGroupId, type: 'text' },
  { name: ENCRYPTED_FIELDS.partIndex, type: 'number' },
  { name: ENCRYPTED_FIELDS.totalParts, type: 'number' },
  { name: ENCRYPTED_FIELDS.snapshotHash, type: 'text' },
  { name: ENCRYPTED_FIELDS.partHash, type: 'text' },
  { name: ENCRYPTED_FIELDS.payload, type: 'text' },
  { name: ENCRYPTED_FIELDS.version, type: 'text' },
  { name: ENCRYPTED_FIELDS.exportedAt, type: 'number' },
];

/** 按模式取表名 */
export function getTableName(mode: CloudSyncMode): string {
  return mode === 'encrypted' ? ENCRYPTED_TABLE_NAME : PLAINTEXT_TABLE_NAME;
}

/** 按模式取表结构规格 */
export function getTableSpec(mode: CloudSyncMode): TableFieldSpec[] {
  return mode === 'encrypted' ? ENCRYPTED_TABLE_SPEC : PLAINTEXT_TABLE_SPEC;
}

/**
 * 结构校验所需的关键字段名
 *
 * 只校验「缺了就无法同步」的核心字段，允许用户自行追加自定义列
 * （不因多余字段判定结构不符，避免误伤）。
 */
export function getRequiredFieldNames(mode: CloudSyncMode): string[] {
  return mode === 'encrypted'
    ? [
        ENCRYPTED_FIELDS.partKey,
        ENCRYPTED_FIELDS.snapshotGroupId,
        ENCRYPTED_FIELDS.partIndex,
        ENCRYPTED_FIELDS.totalParts,
        ENCRYPTED_FIELDS.snapshotHash,
        ENCRYPTED_FIELDS.partHash,
        ENCRYPTED_FIELDS.payload,
        ENCRYPTED_FIELDS.version,
        ENCRYPTED_FIELDS.exportedAt,
      ]
    : [
        PLAINTEXT_FIELDS.username,
        PLAINTEXT_FIELDS.password,
        PLAINTEXT_FIELDS.url,
        PLAINTEXT_FIELDS.tag,
        PLAINTEXT_FIELDS.remark,
        PLAINTEXT_FIELDS.totp,
        PLAINTEXT_FIELDS.group,
        PLAINTEXT_FIELDS.localUpdateTime,
        PLAINTEXT_FIELDS.id,
      ];
}

/**
 * 参与内容哈希的同步字段（固定顺序）
 *
 * **明确不含 ID、updateTime、云端修改时间**：扩展自身推送会刷新云端 record
 * 修改时间，若混入会导致哈希恒 ≠ 快照，把「刚推完的行」误判为「云端侧变更」。
 * groupPath 参与哈希：分组归属变更需要触发 LWW 同步。
 */
export const SYNCED_TEXT_FIELDS = ['username', 'password', 'url', 'tag', 'remark', 'totp', 'groupPath'] as const;

/** 本地条目 → 云端行字段（明文模式） */
export function entryToFields(entry: LocalSyncEntry): Record<string, string | number> {
  return {
    [PLAINTEXT_FIELDS.username]: entry.username,
    [PLAINTEXT_FIELDS.password]: entry.password,
    [PLAINTEXT_FIELDS.url]: entry.url,
    [PLAINTEXT_FIELDS.tag]: entry.tag,
    [PLAINTEXT_FIELDS.remark]: entry.remark,
    [PLAINTEXT_FIELDS.totp]: entry.totp,
    [PLAINTEXT_FIELDS.group]: entry.groupPath,
    [PLAINTEXT_FIELDS.localUpdateTime]: entry.updateTime,
    [PLAINTEXT_FIELDS.id]: entry.id,
  };
}

/**
 * 云端行字段 → 本地条目投影（明文模式）
 *
 * 云端数据视为**不可信输入**：所有值强制转字符串，缺失字段回退空串，
 * 数字字段（本地更新时间）单独解析并校验有限性。
 */
export function fieldsToEntry(fields: Record<string, string | number>): {
  entry: Omit<LocalSyncEntry, 'updateTime'>;
  updateTime: number;
} {
  const text = (key: string): string => {
    const value = fields[key];
    return typeof value === 'number' ? String(value) : (value ?? '');
  };
  const rawUpdateTime = fields[PLAINTEXT_FIELDS.localUpdateTime];
  const parsedUpdateTime = typeof rawUpdateTime === 'number' ? rawUpdateTime : Number(rawUpdateTime);
  return {
    entry: {
      id: text(PLAINTEXT_FIELDS.id),
      username: text(PLAINTEXT_FIELDS.username),
      password: text(PLAINTEXT_FIELDS.password),
      url: text(PLAINTEXT_FIELDS.url),
      tag: text(PLAINTEXT_FIELDS.tag),
      remark: text(PLAINTEXT_FIELDS.remark),
      totp: text(PLAINTEXT_FIELDS.totp),
      groupPath: text(PLAINTEXT_FIELDS.group),
    },
    updateTime: Number.isFinite(parsedUpdateTime) ? parsedUpdateTime : 0,
  };
}

/** 从云端行读取业务 ID（可能为空串：用户在文档手工新增的行） */
export function readBusinessId(fields: Record<string, string | number>): string {
  const value = fields[PLAINTEXT_FIELDS.id];
  return typeof value === 'string' ? value.trim() : value === undefined ? '' : String(value);
}
