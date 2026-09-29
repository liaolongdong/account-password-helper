/**
 * 云文档同步领域类型
 *
 * 设计规格：docs/superpowers/specs/2026-09-23-cloud-doc-sync-design.md
 * 本文件只承载类型契约，不含运行时逻辑。平台差异（值格式、分页、批量上限、
 * 错误码）一律由 `adapters/` 屏蔽，`diff.ts` 与 `syncEngine.ts` 只面向
 * `CloudRow` / `BatchResult` 编程。
 */
import type { PasswordEntry, PasswordGroup } from '@/utils/types';

// ==================== 基础枚举 ====================

/** 支持的云端平台 */
export type CloudProvider = 'feishu' | 'tencent' | 'webdav';

/** 同步模式：密文快照备份（单向 + 手动恢复）/ 明文行级双向同步 */
export type CloudSyncMode = 'encrypted' | 'plaintext';

/**
 * 归一化错误类别
 *
 * UI 依据该类别选择 i18n 文案，平台原始错误码保留在 `CloudSyncError.detail`
 * 中供排查（原始码不含敏感数据，可安全记录）。
 */
export type CloudErrorKind =
  /** 凭证缺失/失效/不匹配 */
  | 'invalidCredential'
  /** 应用未被授予目标文档权限 */
  | 'permission'
  /** 文档或数据表不存在 */
  | 'notFound'
  /** 云端表结构被外部篡改（字段缺失/类型不符） */
  | 'schema'
  /** 单元格内容超出平台上限 */
  | 'tooLarge'
  /** 请求过快（限流） */
  | 'rateLimit'
  /** 同表并发写冲突 */
  | 'writeConflict'
  /** 配额/容量超限 */
  | 'quota'
  /** 网络不可达、超时、DNS 等 */
  | 'network'
  /** 用户主动取消 */
  | 'aborted'
  | 'unknown';

// ==================== 配置与凭证 ====================

/** 飞书目标：多维表格 Base */
export interface FeishuTarget {
  /** Base 的 app_token */
  appToken: string | null;
  /** 数据表 table_id */
  tableId: string | null;
  /** 用户粘贴的原始文档 URL（便于回显与重新解析） */
  fileUrl: string | null;
  /**
   * 开放平台 API 地址（私有化部署用，形如 `https://open.example.com`，可带网关路径前缀）
   *
   * `null` 表示官方 SaaS（`https://open.feishu.cn`），旧配置缺该字段时按 `null` 处理。
   * 不参与 docKey：换服务器必然换文档链接与 app_token，沿用既有键不会与旧快照/任务锁串台，
   * 也避免改动已有用户的快照键名。
   */
  baseUrl: string | null;
  /** 用户已显式确认允许 HTTP 明文传输 */
  allowInsecure: boolean;
}

/** 腾讯目标：智能表文件 */
export interface TencentTarget {
  /** 智能表 fileID */
  fileId: string | null;
  /** 子表 sheetID */
  sheetId: string | null;
  /** 用户粘贴的原始文档 URL */
  fileUrl: string | null;
  /** 开放平台 API 地址；`null` 表示官方 `https://docs.qq.com` */
  baseUrl: string | null;
  /** 用户已显式确认允许 HTTP 明文传输 */
  allowInsecure: boolean;
}

/** WebDAV 目标：用户自选服务器上的备份目录（WebDAV 规格 §3.1） */
export interface WebDavTarget {
  /** 用户填写的远程目录 URL（原样保存，便于回显与重新校验） */
  dirUrl: string | null;
  /** 实际备份子目录 URL（= 归一化 dirUrl + 'aph-backup/'），快照隔离键与锁 targetKey 组成部分 */
  backupDirUrl: string | null;
  /**
   * 用户已显式确认允许 HTTP 明文传输（WebDAV 规格 §4.4）
   *
   * 仅当 dirUrl 为 http 且 host 非 localhost 时可为 true。持久化此标记是为了
   * 让「每次备份都带警告」成为可能，而非仅配置时提示一次。
   */
  allowInsecure: boolean;
}

/** provider → 目标结构映射（新增平台时在此登记） */
export interface ProviderTargetMap {
  feishu: FeishuTarget;
  tencent: TencentTarget;
  webdav: WebDavTarget;
}

/** 单平台同步配置（非敏感，存 chrome.storage.local） */
export interface CloudSyncProviderConfig<P extends CloudProvider = CloudProvider> {
  /** 凭证与目标是否均已就绪 */
  configured: boolean;
  mode: CloudSyncMode;
  target: ProviderTargetMap[P];
  /** 密文分片阈值（字符数），动态降级成功后回写，避免重复试探 */
  chunkSize: number;
  /** 上次同步完成时间（epoch 毫秒），从未同步为 null */
  lastSyncAt: number | null;
}

/** 云同步总配置 */
export interface CloudSyncConfig {
  /** 功能总开关（默认关闭，用户显式开启后才允许外传数据） */
  enabled: boolean;
  /** 密文快照保留版本数 */
  keepVersions: number;
  providers: {
    feishu: CloudSyncProviderConfig<'feishu'>;
    tencent: CloudSyncProviderConfig<'tencent'>;
    webdav: CloudSyncProviderConfig<'webdav'>;
  };
}

/** 飞书自建应用凭证 */
export interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

/** 腾讯文档开放平台凭证（用户手动生成，无换取接口，需持久化） */
export interface TencentCredentials {
  clientId: string;
  openId: string;
  accessToken: string;
}

/** WebDAV 凭证：Basic 为主，Bearer 可选（非空则优先，WebDAV 规格 §3.1） */
export interface WebDavCredentials {
  username: string;
  password: string;
  /** 可选；非空时使用 `Authorization: Bearer`，忽略 username/password */
  bearerToken?: string;
}

/** provider → 凭证结构映射 */
export interface ProviderCredentialMap {
  feishu: FeishuCredentials;
  tencent: TencentCredentials;
  webdav: WebDavCredentials;
}

/** 凭证读取结果（区分「未配置」「会话锁定」「密文损坏/rekey 后不可解」） */
export type CredentialLoadResult<P extends CloudProvider> =
  | { status: 'ok'; credentials: ProviderCredentialMap[P] }
  | { status: 'empty' }
  | { status: 'locked' }
  | { status: 'corrupted' };

// ==================== 适配器契约 ====================

/** 归一化后的云端行（屏蔽平台值格式差异） */
export interface CloudRow {
  recordId: string;
  /** 扁平键值：字段名 → 文本或数字 */
  fields: Record<string, string | number>;
  /** 云端最后修改时间（epoch 毫秒），来自 record 元数据而非表字段 */
  cloudModifiedAt: number;
}

/** 表字段规格（建表用，平台无关） */
export interface TableFieldSpec {
  name: string;
  type: 'text' | 'number';
  /** 索引列/首列（飞书 is_primary；不可隐藏） */
  primary?: boolean;
  /** 隐藏列（飞书 is_hidden；腾讯能力未明确，适配器自行降级） */
  hidden?: boolean;
}

/** 建表规格 */
export interface TableSpec {
  name: string;
  fields: TableFieldSpec[];
}

/** 云端数据表元信息 */
export interface TableMeta {
  id: string;
  name: string;
}

/** 待写入行：recordId 为空串表示新增 */
export interface UpsertRow {
  recordId: string;
  /** 业务主键（PasswordEntry.id），用于把平台响应映射回本地条目 */
  businessId: string;
  fields: Record<string, string | number>;
}

/** 批量操作结果（部分成功可表达） */
export interface BatchResult {
  succeeded: { recordId: string; businessId: string }[];
  failed: { businessId: string; code: string | number; message: string }[];
}

/** 表结构校验结果 */
export type SchemaCheckResult = { ok: true } | { ok: false; missingFields: string[] };

/** 适配器运行期选项 */
export interface AdapterOptions {
  /** 取消信号：abort 后所有进行中请求立即终止 */
  signal?: AbortSignal;
  /** 每发起一次 HTTP 请求回调（用于本地配额预估） */
  onApiCall?: () => void;
}

/**
 * 云端表格统一抽象
 *
 * 实现方负责：鉴权、分页遍历、按平台上限分批、值格式双向转换、错误码归一化。
 * 上层（diff/syncEngine）不得感知任何平台细节。
 */
export interface TableAdapter {
  readonly provider: CloudProvider;
  /** 校验凭证有效性（不触碰目标表） */
  testConnection(): Promise<void>;
  /** 列出文档下全部数据表 */
  listTables(): Promise<TableMeta[]>;
  /** 创建数据表（含全部字段） */
  createTable(spec: TableSpec): Promise<TableMeta>;
  /** 校验既有表结构是否满足同步要求 */
  checkTableSchema(requiredFields: TableFieldSpec[]): Promise<SchemaCheckResult>;
  /** 全量读取行（内部分页遍历） */
  getRows(): Promise<CloudRow[]>;
  /** 批量新增/更新（内部按平台上限分批，批间串行） */
  batchUpsert(rows: UpsertRow[]): Promise<BatchResult>;
  /** 批量删除（recordId 不存在视为业务成功） */
  batchDelete(recordIds: string[]): Promise<BatchResult>;
}

// ==================== 快照与 Diff ====================

/** 明文模式本地快照条目 */
export interface SnapshotEntry {
  /** 7 个同步字段的内容哈希（不含 ID / updateTime / 云端时间） */
  hash: string;
  recordId: string;
  /** 上次同步完成时间（epoch 毫秒） */
  syncedAt: number;
}

/** 明文模式本地快照（可重建缓存，丢失时降级为全量比对 + LWW） */
export interface SyncSnapshot {
  provider: CloudProvider;
  /** 飞书 `${appToken}:${tableId}`；腾讯 `${fileId}:${sheetId}` */
  docKey: string;
  /** 业务 ID → 快照条目 */
  entries: Record<string, SnapshotEntry>;
}

/** 参与同步的本地条目投影（仅 7 个同步字段 + LWW 所需元数据） */
export interface LocalSyncEntry {
  id: string;
  username: string;
  password: string;
  url: string;
  tag: string;
  remark: string;
  totp: string;
  /**
   * 分组全路径（`/` 拼接，未分组为空串）
   *
   * 云端以路径为分组交换格式（云端表无 code 概念）；syncEngine 组装本投影时
   * 用 getGroupPath(entry.groupId, groups) 计算，拉取方向用 ensureGroupByPath 还原。
   */
  groupPath: string;
  updateTime: number;
}

/** 人工冲突原因（需用户在预览中逐条裁决，系统不自动合并） */
export type ManualConflictReason =
  /** 云端行的业务 ID 与快照记录不一致（用户手改主键） */
  | 'primaryKeyChanged'
  /** 本地已改 + 云端已删 */
  | 'localModifiedCloudDeleted';

/** 三方 diff 产出的执行计划项 */
export type DiffPlanItem =
  | { kind: 'pushCreate'; entry: LocalSyncEntry }
  | { kind: 'pushUpdate'; entry: LocalSyncEntry; recordId: string }
  | { kind: 'pullCreate'; row: CloudRow }
  | { kind: 'pullCreateWithId'; row: CloudRow; businessId: string }
  | { kind: 'pullUpdate'; row: CloudRow; businessId: string }
  | { kind: 'deleteCloudRow'; recordId: string; businessId: string }
  | { kind: 'trashLocal'; businessId: string }
  | { kind: 'dropSnapshot'; businessId: string }
  | { kind: 'rebindRecordId'; businessId: string; recordId: string }
  /** 本地与云端一致（或首次建立基线）：无数据动作，仅把映射与哈希写回快照 */
  | { kind: 'baseline'; businessId: string; recordId: string }
  | {
      kind: 'conflict';
      businessId: string;
      recordId: string;
      entry: LocalSyncEntry;
      row: CloudRow;
      winner: 'local' | 'cloud';
    }
  | { kind: 'manualConflict'; reason: ManualConflictReason; businessId: string; recordId: string; row?: CloudRow }
  | { kind: 'skip'; businessId: string; reason: string };

/** diff 结果 */
export interface DiffResult {
  plan: DiffPlanItem[];
  /** 云端行按不可信输入校验后被丢弃的行数与原因 */
  rejectedRows: { recordId: string; reason: string }[];
  /** 快照缺失/损坏，已降级为全量比对 */
  snapshotDegraded: boolean;
}

// ==================== 密文快照 ====================

/** 密文快照载荷（与 .aph 备份同源，但保留 id 以支持按 ID 增量合并） */
export interface CloudSnapshotPayload {
  version: 1;
  exportedAt: number;
  count: number;
  entries: Omit<PasswordEntry, 'order'>[];
  /** 与 .aph v2 同口径的分组树；旧快照缺失时按空数组兼容 */
  groups: PasswordGroup[];
}

/** 单个分片行（写入云端表的一行） */
export interface SnapshotChunkRow {
  /** 行级唯一索引：`${snapshotGroupId}#${partIndex}` */
  partKey: string;
  snapshotGroupId: string;
  partIndex: number;
  totalParts: number;
  /** 完整密文 Blob 的 SHA-256 */
  snapshotHash: string;
  /** 当前分片 Base64 串的 SHA-256 */
  partHash: string;
  payload: string;
  version: number;
  exportedAt: number;
}

/** 云端聚合出的快照分组 */
export interface SnapshotGroup {
  snapshotGroupId: string;
  snapshotHash: string;
  totalParts: number;
  version: number;
  exportedAt: number;
  /** 按 partIndex 升序 */
  chunks: SnapshotChunkRow[];
  recordIds: string[];
  /** 分片数是否等于 totalParts */
  complete: boolean;
}

/** 密文快照本地元数据（仅记录版本标识与哈希，绝不记录 Blob 内容） */
export interface EncryptedSnapshotMeta {
  provider: CloudProvider;
  docKey: string;
  snapshotGroupId: string;
  snapshotHash: string;
  exportedAt: number;
  totalParts: number;
}

/** 恢复校验失败原因 */
export type RestoreRejectReason =
  'noSnapshot' | 'incomplete' | 'partHashMismatch' | 'snapshotHashMismatch' | 'decryptFailed' | 'invalidPayload';

// ==================== 报告与审计 ====================

/** 文本截断事件（绝不记录原始内容） */
export interface TruncationEvent {
  field: string;
  originalLength: number;
  truncatedLength: number;
}

/** 报告中的告警项（key 为 i18n key，由 UI 翻译） */
export interface ReportWarning {
  key: string;
  params?: Record<string, string | number>;
}

/** 同步操作统计 */
export interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  pulled: number;
  trashed: number;
  conflicts: number;
  skipped: number;
  failed: number;
}

/** 冲突明细（仅用户名 + 网址，绝不含密码） */
export interface ConflictDetail {
  businessId: string;
  username: string;
  url: string;
  winner: 'local' | 'cloud';
}

/** 结构化同步报告 */
export interface SyncReport {
  provider: CloudProvider;
  mode: CloudSyncMode;
  /** 目标表展示名 */
  targetLabel: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  stats: SyncStats;
  conflictDetails: ConflictDetail[];
  failures: { businessId: string; code: string | number; message: string }[];
  warnings: ReportWarning[];
  truncated: TruncationEvent[];
  /** 本次预估消耗 API 次数（仅本地估算） */
  apiCalls: number;
  cancelled: boolean;
  /** 密文模式：分片动态降级次数 */
  chunkDowngrades: number;
  /** 恢复模式专用统计 */
  restore?: { added: number; updated: number; skipped: number; rejected: number };
}

/** 审计日志操作类型 */
export type AuditAction =
  'backup' | 'restore' | 'sync' | 'rebuild' | 'clearVersions' | 'clearLog' | 'prepareTarget' | 'lockPreempted';

/**
 * 审计日志条目
 *
 * 字段白名单为安全硬约束：仅允许时间戳、provider、模式、操作类型、业务 ID、
 * 数据哈希、云端 recordId、统计数字、冲突标记与「错误码 + 平台消息」。
 * 禁止出现明文密码、TOTP、用户名、网址、备注、完整 payload、token/secret。
 */
export interface AuditEntry {
  at: number;
  provider: CloudProvider;
  mode: CloudSyncMode;
  action: AuditAction;
  /** 目标表标识（docKey），非敏感 */
  docKey: string;
  stats?: Partial<SyncStats>;
  /** 涉及的云端 recordId 列表（截断至前 20 个，避免日志膨胀） */
  recordIds?: string[];
  /** 冲突条目业务 ID */
  conflictIds?: string[];
  /** 异常简要信息：错误码 + 平台消息 */
  error?: { kind: CloudErrorKind; code?: string | number; message?: string };
}

/** 同步进度回调载荷 */
export interface SyncProgress {
  /** i18n key */
  phaseKey: string;
  current: number;
  total: number;
}
