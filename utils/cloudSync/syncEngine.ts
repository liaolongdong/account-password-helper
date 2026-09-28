/**
 * 云同步编排（设计规格 §2、§5、§6）
 *
 * 职责：把"取数 → diff → 批量执行 → 增量更新快照 → 生成报告"串起来，并对
 * 任务锁、审计日志、取消信号与部分失败做统一处理。
 *
 * 平台细节全部封装在 `adapters/`；本模块只面向 `CloudRow` / `BatchResult` 编程。
 * 任何分支都不得把 token、密码、TOTP 或完整 payload 写入日志与报告。
 */
import type { PasswordEntry, PasswordGroup } from '@/utils/types';
import { UNGROUPED_CODE } from '@/utils/types';
import { getAllPasswords, savePassword, updatePassword } from '@/utils/storage/passwordCrud';
import { getAllGroups, saveGroups } from '@/utils/storage/groupManager';
import { moveToTrash } from '@/utils/storage/trashManager';
import { logger } from '@/utils/logger';
import { buildGroupPathMap, ensureGroupByPath, mergeImportedGroups } from '@/utils/groupTree';
import { patchProviderConfig } from './configStore';
import { buildReport, emptyStats, loadReadyContext } from './runContext';
import {
  createEmptySnapshot,
  loadEncryptedMeta,
  loadSnapshot,
  saveEncryptedMeta,
  saveSnapshot,
  withEntries,
} from './snapshotStore';
import { appendAuditLog, makeAuditEntry } from './auditLog';
import { acquireTaskLock } from './taskLock';
import { computeDiff } from './diff';
import { computeEntryHash } from './hash';
import {
  encryptAndChunk,
  groupChunks,
  nextChunkSize,
  selectOrphanGroups,
  selectVersionsToPrune,
  verifyAndDecryptSnapshot,
} from './cryptoSnapshot';
import {
  ENCRYPTED_FIELDS,
  PLAINTEXT_FIELDS,
  entryToFields,
  getTableName,
  getTableSpec,
  readBusinessId,
} from './schema';
import { sanitizeFields } from './sanitize';
import { CloudSyncError, isAbortError, toCloudSyncError } from './errors';
import { FeishuAdapter } from './adapters/feishu';
import { TencentAdapter } from './adapters/tencent';
import { parseCloudUrl } from './urlParse';
import type {
  AdapterOptions,
  BatchResult,
  CloudProvider,
  CloudSyncMode,
  CloudRow,
  DiffPlanItem,
  EncryptedSnapshotMeta,
  LocalSyncEntry,
  ProviderCredentialMap,
  ProviderTargetMap,
  SnapshotChunkRow,
  SyncProgress,
  SyncReport,
  TableAdapter,
  UpsertRow,
} from './types';

/** 运行期选项 */
export interface SyncRunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

/** 目标表准备结果 */
export interface PrepareTargetResult {
  provider: CloudProvider;
  tableName: string;
  created: boolean;
  target: ProviderTargetMap[CloudProvider];
}

/** 本地条目 → 同步投影（`order` 等本地 UX 状态不参与同步） */
function toLocalSyncEntry(entry: PasswordEntry, groupPaths: ReadonlyMap<string, string>): LocalSyncEntry {
  return {
    id: entry.id,
    username: entry.username ?? '',
    password: entry.password ?? '',
    url: entry.url ?? '',
    tag: entry.tag ?? '',
    remark: entry.remark ?? '',
    totp: entry.totp ?? '',
    groupPath: entry.groupId ? (groupPaths.get(entry.groupId) ?? '') : '',
    updateTime: entry.updateTime ?? 0,
  };
}

/** 云端行 → 同步投影（不可信输入，字段已在 diff 中校验） */
function cloudRowToLocal(row: CloudRow): LocalSyncEntry {
  const text = (key: string): string => {
    const value = row.fields[key];
    return typeof value === 'number' ? String(value) : (value ?? '');
  };
  const rawUpdate = row.fields[PLAINTEXT_LOCAL_UPDATE_TIME];
  return {
    id: readBusinessId(row.fields),
    username: text(PLAINTEXT_USERNAME),
    password: text(PLAINTEXT_PASSWORD),
    url: text(PLAINTEXT_URL),
    tag: text(PLAINTEXT_TAG),
    remark: text(PLAINTEXT_REMARK),
    totp: text(PLAINTEXT_TOTP),
    groupPath: text(PLAINTEXT_GROUP),
    updateTime: Number(rawUpdate) || 0,
  };
}

// 字段名统一取自 schema，避免与表结构规格漂移
const {
  username: PLAINTEXT_USERNAME,
  password: PLAINTEXT_PASSWORD,
  url: PLAINTEXT_URL,
  tag: PLAINTEXT_TAG,
  remark: PLAINTEXT_REMARK,
  totp: PLAINTEXT_TOTP,
  group: PLAINTEXT_GROUP,
  localUpdateTime: PLAINTEXT_LOCAL_UPDATE_TIME,
} = PLAINTEXT_FIELDS;

/** 云端分组路径 → 本地 groupId；缺失路径按未分组处理，创建的分组立即持久化。 */
async function resolveCloudGroupId(
  groupPath: string,
  groups: PasswordGroup[],
  resolvedPaths: Map<string, string | undefined>,
): Promise<string | undefined> {
  const normalizedPath = groupPath.trim();
  if (!normalizedPath) return undefined;
  if (resolvedPaths.has(normalizedPath)) return resolvedPaths.get(normalizedPath);

  const resolved = ensureGroupByPath(normalizedPath, groups);
  if (resolved.created.length > 0) {
    groups.push(...resolved.created);
    await saveGroups(groups);
  }
  const groupId = resolved.code === UNGROUPED_CODE ? undefined : resolved.code;
  resolvedPaths.set(normalizedPath, groupId);
  return groupId;
}

/** 把快照携带的分组树按“同名同级复用”合并到本地，并返回远端 code → 本地 code。 */
async function mergeSnapshotGroups(
  imported: readonly PasswordGroup[],
  existing: readonly PasswordGroup[],
): Promise<{ groups: PasswordGroup[]; codeMap: Map<string, string> }> {
  const merged = mergeImportedGroups(imported, existing);
  if (merged.groups.length !== existing.length) await saveGroups(merged.groups);
  return merged;
}

/**
 * 按平台构造表格适配器
 *
 * 穷尽式 switch + never 兜底（WebDAV 规格 §2.2）：webdav 走 FileStorageAdapter
 * （见 webdavSync.ts），误入本函数时显式抛领域错误而非静默构造错误适配器。
 */
function createAdapter(
  provider: CloudProvider,
  target: ProviderTargetMap[CloudProvider],
  credentials: ProviderCredentialMap[CloudProvider],
  options: AdapterOptions,
): TableAdapter {
  switch (provider) {
    case 'feishu': {
      const t = target as ProviderTargetMap['feishu'];
      const c = credentials as ProviderCredentialMap['feishu'];
      return new FeishuAdapter({ appToken: t.appToken ?? '', tableId: t.tableId, credentials: c, options });
    }
    case 'tencent': {
      const t = target as ProviderTargetMap['tencent'];
      const c = credentials as ProviderCredentialMap['tencent'];
      return new TencentAdapter({ fileId: t.fileId ?? '', sheetId: t.sheetId, credentials: c, options });
    }
    case 'webdav':
      throw new CloudSyncError('unknown', 'webdav uses FileStorageAdapter (see webdavSync.ts)');
    default: {
      const _exhaustive: never = provider;
      throw new CloudSyncError('unknown', `provider does not use TableAdapter: ${String(_exhaustive)}`);
    }
  }
}

/** 审计写入失败不阻断主流程，仅在报告里提示 */
async function audit(entry: Parameters<typeof appendAuditLog>[0]): Promise<boolean> {
  return appendAuditLog(entry);
}

// ==================== 目标表准备 ====================

/**
 * 校验凭证、探测目标文档、按需建表，并把目标回写配置
 *
 * 表结构不匹配时终止并提示，**不自动修改云端表结构**（防误删用户自定义字段）。
 */
export async function prepareProviderTarget<P extends CloudProvider>(
  provider: P,
  credentials: ProviderCredentialMap[P],
  fileUrl: string,
  mode: CloudSyncMode,
  options: AdapterOptions = {},
): Promise<PrepareTargetResult> {
  const parsed = parseCloudUrl(provider, fileUrl);
  if (!parsed) throw new CloudSyncError('notFound', 'unrecognized document url');

  const tableName = getTableName(mode);
  const requiredFields = getTableSpec(mode);

  // 先以「仅有文件标识」构造适配器完成探测与建表，再回填子表标识
  const target = buildTarget(provider, parsed.fileKey, parsed.subKey, fileUrl);
  const adapter = createAdapter(provider, target, credentials, options);
  await adapter.testConnection();

  const tables = await adapter.listTables();
  const existing = tables.find(table => table.name === tableName);
  let created = false;

  if (existing) {
    applySubKey(adapter, provider, existing.id);
    const check = await adapter.checkTableSchema(requiredFields);
    if (!check.ok) {
      throw new CloudSyncError('schema', `table schema mismatch: ${check.missingFields.join(', ')}`);
    }
  } else {
    const meta = await adapter.createTable({ name: tableName, fields: requiredFields });
    applySubKey(adapter, provider, meta.id);
    created = true;
  }

  const subKey = readSubKey(adapter, provider);
  const resolvedTarget = buildTarget(provider, parsed.fileKey, subKey, fileUrl);
  await patchProviderConfig(provider, { configured: true, mode, target: resolvedTarget });
  await audit(makeAuditEntry(provider, mode, 'prepareTarget', `${parsed.fileKey}:${subKey ?? ''}`));

  return { provider, tableName, created, target: resolvedTarget };
}

/** 构造平台目标对象（仅表格平台；webdav 目标由 webdavSync.prepareWebDavTarget 构造） */
function buildTarget<P extends CloudProvider>(
  provider: P,
  fileKey: string,
  subKey: string | null,
  fileUrl: string,
): ProviderTargetMap[P] {
  switch (provider) {
    case 'feishu':
      return { appToken: fileKey, tableId: subKey, fileUrl } as ProviderTargetMap[P];
    case 'tencent':
      return { fileId: fileKey, sheetId: subKey, fileUrl } as ProviderTargetMap[P];
    case 'webdav':
      throw new CloudSyncError('unknown', 'webdav target is built by prepareWebDavTarget');
    default: {
      const _exhaustive: never = provider;
      throw new CloudSyncError('unknown', `provider does not use document target: ${String(_exhaustive)}`);
    }
  }
}

/** 把探测/建表得到的子表标识回填适配器实例（仅表格平台；穷尽 switch 防新 provider 静默走错分支） */
function applySubKey(adapter: TableAdapter, provider: CloudProvider, subKey: string): void {
  switch (provider) {
    case 'feishu':
      (adapter as FeishuAdapter).setTableId(subKey);
      break;
    case 'tencent':
      (adapter as TencentAdapter).setSheetId(subKey);
      break;
    case 'webdav':
      throw new CloudSyncError('unknown', 'webdav uses FileStorageAdapter (see webdavSync.ts)');
    default: {
      const _exhaustive: never = provider;
      throw new CloudSyncError('unknown', `provider does not use TableAdapter: ${String(_exhaustive)}`);
    }
  }
}

/** 读取适配器当前的子表标识（仅表格平台） */
function readSubKey(adapter: TableAdapter, provider: CloudProvider): string | null {
  switch (provider) {
    case 'feishu':
      return (adapter as unknown as { tableId: string | null }).tableId;
    case 'tencent':
      return (adapter as unknown as { sheetId: string | null }).sheetId;
    case 'webdav':
      throw new CloudSyncError('unknown', 'webdav uses FileStorageAdapter (see webdavSync.ts)');
    default: {
      const _exhaustive: never = provider;
      throw new CloudSyncError('unknown', `provider does not use TableAdapter: ${String(_exhaustive)}`);
    }
  }
}

// ==================== 明文双向同步 ====================

/**
 * 执行明文双向同步
 *
 * 需先由调用方通过 `promptAndVerifyMasterPassword` 取得主密码（本地加解密需要），
 * UI 必须同时展示"明文密码将上传第三方云端"的红字警告。
 */
export async function runPlaintextSync(
  provider: CloudProvider,
  masterPassword: string,
  options: SyncRunOptions = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const { providerConfig, credentials, docKey } = await loadReadyContext(provider);
  if (providerConfig.mode !== 'plaintext') throw new CloudSyncError('unknown', 'provider not in plaintext mode');

  const targetKey = `${provider}:${docKey}`;
  const lock = await acquireTaskLock(targetKey);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');
  if (lock.preempted) {
    await audit(makeAuditEntry(provider, 'plaintext', 'lockPreempted', docKey));
  }

  const stats = emptyStats();
  const failures: SyncReport['failures'] = [];
  const conflictDetails: SyncReport['conflictDetails'] = [];
  const warnings: SyncReport['warnings'] = [];
  const truncated: SyncReport['truncated'] = [];
  let apiCalls = 0;
  let cancelled = false;
  let snapshotDegraded: boolean;
  let auditFailed: boolean;

  try {
    const adapter = createAdapter(provider, providerConfig.target, credentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });

    options.onProgress?.({ phaseKey: 'cloudSync.progress.fetchLocal', current: 0, total: 1 });
    const [passwords, initialGroups] = await Promise.all([getAllPasswords(masterPassword), getAllGroups()]);
    const groups = [...initialGroups];
    const localEntries = passwords.map(entry => toLocalSyncEntry(entry, buildGroupPathMap(groups)));
    const resolvedCloudGroupIds = new Map<string, string | undefined>();

    options.onProgress?.({ phaseKey: 'cloudSync.progress.fetchCloud', current: 0, total: 1 });
    const cloudRows = await adapter.getRows();

    const snapshot = (await loadSnapshot(provider, docKey)) ?? createEmptySnapshot(provider, docKey);
    const diff = await computeDiff({
      local: localEntries,
      cloud: cloudRows,
      snapshot: await loadSnapshot(provider, docKey),
    });
    snapshotDegraded = diff.snapshotDegraded;
    for (const rejected of diff.rejectedRows) {
      stats.skipped += 1;
      failures.push({ businessId: rejected.recordId, code: 'invalid-row', message: rejected.reason });
    }

    let working = createEmptySnapshot(provider, docKey);
    working = { ...working, entries: snapshot.entries };

    const now = Date.now();
    const createItems: Extract<DiffPlanItem, { kind: 'pushCreate' }>[] = [];
    const updateItems: Extract<DiffPlanItem, { kind: 'pushUpdate' }>[] = [];
    const deleteRecordIds: string[] = [];

    options.onProgress?.({ phaseKey: 'cloudSync.progress.apply', current: 0, total: diff.plan.length });
    let processed = 0;

    for (const item of diff.plan) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      processed += 1;

      switch (item.kind) {
        case 'pushCreate':
          createItems.push(item);
          break;
        case 'pushUpdate':
          updateItems.push(item);
          break;
        case 'deleteCloudRow':
          deleteRecordIds.push(item.recordId);
          break;
        case 'pullCreate': {
          const entry = cloudRowToLocal(item.row);
          const groupId = await resolveCloudGroupId(entry.groupPath, groups, resolvedCloudGroupIds);
          const saved = await savePassword(
            {
              username: entry.username,
              password: entry.password,
              url: entry.url,
              tag: entry.tag,
              remark: entry.remark,
              totp: entry.totp,
              createTime: now,
              updateTime: entry.updateTime || now,
              groupId,
            },
            masterPassword,
          );
          stats.pulled += 1;
          working = withEntries(working, {
            [saved.id]: { hash: await computeEntryHash(entry), recordId: item.row.recordId, syncedAt: now },
          });
          break;
        }
        case 'pullUpdate': {
          const entry = cloudRowToLocal(item.row);
          const groupId = await resolveCloudGroupId(entry.groupPath, groups, resolvedCloudGroupIds);
          await updatePassword(
            item.businessId,
            {
              username: entry.username,
              password: entry.password,
              url: entry.url,
              tag: entry.tag,
              remark: entry.remark,
              totp: entry.totp,
              updateTime: entry.updateTime || now,
              groupId,
            },
            masterPassword,
          );
          stats.pulled += 1;
          working = withEntries(working, {
            [item.businessId]: { hash: await computeEntryHash(entry), recordId: item.row.recordId, syncedAt: now },
          });
          break;
        }
        case 'trashLocal': {
          await moveToTrash([item.businessId]);
          stats.trashed += 1;
          working = withEntries(working, { [item.businessId]: null });
          break;
        }
        case 'dropSnapshot': {
          working = withEntries(working, { [item.businessId]: null });
          break;
        }
        case 'rebindRecordId': {
          const existing = working.entries[item.businessId];
          if (existing) {
            working = withEntries(working, {
              [item.businessId]: { ...existing, recordId: item.recordId, syncedAt: now },
            });
          }
          break;
        }
        case 'baseline': {
          const entry = localEntries.find(local => local.id === item.businessId);
          if (entry) {
            working = withEntries(working, {
              [item.businessId]: { hash: await computeEntryHash(entry), recordId: item.recordId, syncedAt: now },
            });
          }
          break;
        }
        case 'conflict': {
          stats.conflicts += 1;
          conflictDetails.push({
            businessId: item.businessId,
            username: item.entry.username,
            url: item.entry.url,
            winner: item.winner,
          });
          if (item.winner === 'local') {
            updateItems.push({ kind: 'pushUpdate', entry: item.entry, recordId: item.recordId });
          } else {
            const cloudEntry = cloudRowToLocal(item.row);
            const groupId = await resolveCloudGroupId(cloudEntry.groupPath, groups, resolvedCloudGroupIds);
            await updatePassword(
              item.businessId,
              {
                username: cloudEntry.username,
                password: cloudEntry.password,
                url: cloudEntry.url,
                tag: cloudEntry.tag,
                remark: cloudEntry.remark,
                totp: cloudEntry.totp,
                updateTime: cloudEntry.updateTime || now,
                groupId,
              },
              masterPassword,
            );
            stats.pulled += 1;
            working = withEntries(working, {
              [item.businessId]: { hash: await computeEntryHash(cloudEntry), recordId: item.recordId, syncedAt: now },
            });
          }
          break;
        }
        case 'manualConflict': {
          stats.conflicts += 1;
          warnings.push({ key: 'cloudSync.warning.manualConflict', params: { reason: item.reason } });
          break;
        }
        case 'skip': {
          stats.skipped += 1;
          break;
        }
      }
      options.onProgress?.({ phaseKey: 'cloudSync.progress.apply', current: processed, total: diff.plan.length });
    }

    // 批量推送：新增与更新合并为一次调用，内部按平台上限分批
    const upsertRows: UpsertRow[] = [];
    for (const item of createItems) {
      const sanitized = sanitizeFields(entryToFields(item.entry));
      truncated.push(...sanitized.truncated);
      upsertRows.push({ recordId: '', businessId: item.entry.id, fields: sanitized.fields });
    }
    for (const item of updateItems) {
      const sanitized = sanitizeFields(entryToFields(item.entry));
      truncated.push(...sanitized.truncated);
      upsertRows.push({ recordId: item.recordId, businessId: item.entry.id, fields: sanitized.fields });
    }

    if (upsertRows.length > 0) {
      const result = await runBatch(() => adapter.batchUpsert(upsertRows));
      const succeededIds = new Set(result.succeeded.map(item => item.businessId));
      for (const item of result.succeeded) {
        const entry = upsertRows.find(row => row.businessId === item.businessId);
        if (!entry) continue;
        const local = [...createItems, ...updateItems].find(candidate => candidate.entry.id === item.businessId);
        if (!local) continue;
        if (local.kind === 'pushCreate') stats.created += 1;
        else stats.updated += 1;
        working = withEntries(working, {
          [item.businessId]: { hash: await computeEntryHash(local.entry), recordId: item.recordId, syncedAt: now },
        });
      }
      for (const item of result.failed) {
        stats.failed += 1;
        failures.push({ businessId: item.businessId, code: item.code, message: item.message });
      }
      for (const row of upsertRows) {
        if (!succeededIds.has(row.businessId) && !result.failed.some(f => f.businessId === row.businessId)) {
          stats.failed += 1;
          failures.push({ businessId: row.businessId, code: 'missing-result', message: 'batch result missing' });
        }
      }
    }

    if (deleteRecordIds.length > 0) {
      const result = await runBatch(() => adapter.batchDelete(deleteRecordIds));
      stats.deleted += result.succeeded.length;
      stats.failed += result.failed.length;
      failures.push(...result.failed);
    }

    await saveSnapshot(working);
    await patchProviderConfig(provider, { lastSyncAt: Date.now() });
    auditFailed = !(await audit(
      makeAuditEntry(provider, 'plaintext', 'sync', docKey, {
        stats,
        recordIds: Object.values(working.entries)
          .map(entry => entry.recordId)
          .slice(0, 20),
        conflictIds: conflictDetails.map(detail => detail.businessId),
      }),
    ));
    if (auditFailed) warnings.push({ key: 'cloudSync.warning.auditLogFailed' });
    if (snapshotDegraded) warnings.push({ key: 'cloudSync.warning.snapshotDegraded' });
  } catch (error) {
    if (isAbortError(error)) {
      cancelled = true;
    } else {
      const normalized = toCloudSyncError(error);
      stats.failed += 1;
      failures.push({ businessId: '', code: normalized.code ?? normalized.kind, message: normalized.message });
      logger.error('云同步明文同步失败:', normalized);
      throw normalized;
    }
  } finally {
    await lock.handle.release();
  }

  return buildReport(
    provider,
    'plaintext',
    docKey,
    startedAt,
    stats,
    conflictDetails,
    failures,
    warnings,
    truncated,
    apiCalls,
    cancelled,
  );
}

/** 批量执行包装：把平台错误转换为失败明细，避免整个流程中断 */
async function runBatch(action: () => Promise<BatchResult>): Promise<BatchResult> {
  try {
    return await action();
  } catch (error) {
    const normalized = toCloudSyncError(error);
    return {
      succeeded: [],
      failed: [{ businessId: '', code: normalized.code ?? normalized.kind, message: normalized.message }],
    };
  }
}

// ==================== 密文备份与恢复 ====================

/** cipher 行 → 分片结构（云端数据不可信，逐字段强制转换并校验） */
export function rowsToChunks(rows: CloudRow[]): SnapshotChunkRow[] {
  const chunks: SnapshotChunkRow[] = [];
  for (const row of rows) {
    const text = (key: string): string => {
      const value = row.fields[key];
      return typeof value === 'number' ? String(value) : (value ?? '');
    };
    const partKey = text(ENCRYPTED_FIELDS.partKey);
    const snapshotGroupId = text(ENCRYPTED_FIELDS.snapshotGroupId);
    const payload = text(ENCRYPTED_FIELDS.payload);
    if (!snapshotGroupId || !partKey || !payload) continue;
    chunks.push({
      partKey,
      snapshotGroupId,
      partIndex: Number(row.fields[ENCRYPTED_FIELDS.partIndex]) || 0,
      totalParts: Number(row.fields[ENCRYPTED_FIELDS.totalParts]) || 1,
      snapshotHash: text(ENCRYPTED_FIELDS.snapshotHash),
      partHash: text(ENCRYPTED_FIELDS.partHash),
      payload,
      version: Number(row.fields[ENCRYPTED_FIELDS.version]) || 1,
      exportedAt: Number(row.fields[ENCRYPTED_FIELDS.exportedAt]) || 0,
    });
  }
  return chunks;
}

/** 分片结构 → 待写入行 */
export function chunksToUpsertRows(chunks: SnapshotChunkRow[]): UpsertRow[] {
  return chunks.map(chunk => ({
    recordId: '',
    businessId: chunk.partKey,
    fields: {
      [ENCRYPTED_FIELDS.partKey]: chunk.partKey,
      [ENCRYPTED_FIELDS.snapshotGroupId]: chunk.snapshotGroupId,
      [ENCRYPTED_FIELDS.partIndex]: chunk.partIndex,
      [ENCRYPTED_FIELDS.totalParts]: chunk.totalParts,
      [ENCRYPTED_FIELDS.snapshotHash]: chunk.snapshotHash,
      [ENCRYPTED_FIELDS.partHash]: chunk.partHash,
      [ENCRYPTED_FIELDS.payload]: chunk.payload,
      [ENCRYPTED_FIELDS.version]: chunk.version,
      [ENCRYPTED_FIELDS.exportedAt]: chunk.exportedAt,
    },
  }));
}

/**
 * 密文备份：全量加密 + 分片写入 + 版本保留
 *
 * 任一分片写入失败即清理该分组的已写入分片，并报告失败原因；**全部分片成功**
 * 才更新本地元数据。
 */
export async function runEncryptedBackup(
  provider: CloudProvider,
  masterPassword: string,
  options: SyncRunOptions = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const { config, providerConfig, credentials, docKey } = await loadReadyContext(provider);
  if (providerConfig.mode !== 'encrypted') throw new CloudSyncError('unknown', 'provider not in encrypted mode');

  const targetKey = `${provider}:${docKey}`;
  const lock = await acquireTaskLock(targetKey);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  const failures: SyncReport['failures'] = [];
  const warnings: SyncReport['warnings'] = [];
  let apiCalls = 0;
  let cancelled = false;
  let chunkDowngrades = 0;

  try {
    const adapter = createAdapter(provider, providerConfig.target, credentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });

    const [entries, groups] = await Promise.all([getAllPasswords(masterPassword), getAllGroups()]);
    options.onProgress?.({ phaseKey: 'cloudSync.progress.encrypt', current: 0, total: 1 });

    // 前置清理：超期残缺孤儿分组（失败中断留下的半成品），避免云端垃圾累积
    const existingRows = await adapter.getRows();
    const existingChunks = rowsToChunks(existingRows);
    const orphanGroups = selectOrphanGroups(groupChunks(existingChunks));
    for (const groupId of orphanGroups) {
      const recordIds = existingRows
        .filter(row => row.fields[ENCRYPTED_FIELDS.snapshotGroupId] === groupId)
        .map(row => row.recordId);
      if (recordIds.length > 0) await runBatch(() => adapter.batchDelete(recordIds));
    }

    let chunkSize = providerConfig.chunkSize;
    let result = await encryptAndChunk(entries, masterPassword, chunkSize, Date.now(), groups);
    let written = false;

    for (;;) {
      options.onProgress?.({ phaseKey: 'cloudSync.progress.upload', current: 0, total: 1 });
      const batch = await runBatch(() => adapter.batchUpsert(chunksToUpsertRows(result.rows)));
      const allFailed = batch.failed.find(item => item.code === 'tooLarge' || item.code === 1254130);
      if (allFailed && batch.succeeded.length === 0) {
        const smaller = nextChunkSize(chunkSize);
        if (smaller === null) {
          throw new CloudSyncError('tooLarge', 'platform rejects chunk size below minimum', allFailed.code);
        }
        chunkDowngrades += 1;
        chunkSize = smaller;
        result = await encryptAndChunk(entries, masterPassword, chunkSize, Date.now(), groups);
        continue;
      }
      if (batch.failed.length > 0 || batch.succeeded.length !== result.rows.length) {
        // 部分失败：清理该分组已写入分片，避免留下半成品
        await runBatch(() => adapter.batchDelete(batch.succeeded.map(item => item.recordId)));
        failures.push(...batch.failed);
        stats.failed += batch.failed.length || 1;
        throw new CloudSyncError('unknown', 'partial chunk write failed');
      }
      written = true;
      stats.created += batch.succeeded.length;
      break;
    }

    if (written) {
      await patchProviderConfig(provider, {
        chunkSize,
        lastSyncAt: Date.now(),
      });
      const meta: EncryptedSnapshotMeta = {
        provider,
        docKey,
        snapshotGroupId: result.snapshotGroupId,
        snapshotHash: result.snapshotHash,
        exportedAt: result.exportedAt,
        totalParts: result.rows.length,
      };
      await saveEncryptedMeta(meta);

      // 版本保留策略：删除超出保留数的旧分组（默认保留最近 3 个完整版本）
      const allRows = await adapter.getRows();
      const allChunks = rowsToChunks(allRows);
      const groups = groupChunks(allChunks);
      const pruneGroups = selectVersionsToPrune(groups, config.keepVersions);
      for (const groupId of pruneGroups) {
        const recordIds = allRows
          .filter(row => row.fields[ENCRYPTED_FIELDS.snapshotGroupId] === groupId)
          .map(row => row.recordId);
        if (recordIds.length > 0) await runBatch(() => adapter.batchDelete(recordIds));
      }
      await audit(makeAuditEntry(provider, 'encrypted', 'backup', docKey, { stats }));
    }
  } catch (error) {
    if (isAbortError(error)) {
      cancelled = true;
    } else {
      const normalized = toCloudSyncError(error);
      if (stats.failed === 0) stats.failed += 1;
      failures.push({ businessId: '', code: normalized.code ?? normalized.kind, message: normalized.message });
      logger.error('云同步密文备份失败:', normalized);
      throw normalized;
    }
  } finally {
    await lock.handle.release();
  }

  return buildReport(
    provider,
    'encrypted',
    docKey,
    startedAt,
    stats,
    [],
    failures,
    warnings,
    [],
    apiCalls,
    cancelled,
    chunkDowngrades,
  );
}

/**
 * 密文恢复：读取云端分片 → 校验链 → 解密 → 按 ID 增量合并
 *
 * **恢复不删除本地任何条目**；本地较新的条目跳过，不覆盖本地新值。
 */
export async function runEncryptedRestore(
  provider: CloudProvider,
  masterPassword: string,
  options: SyncRunOptions = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const { providerConfig, credentials, docKey } = await loadReadyContext(provider);

  const targetKey = `${provider}:${docKey}`;
  const lock = await acquireTaskLock(targetKey);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  const failures: SyncReport['failures'] = [];
  const warnings: ReportWarnings = [];
  let apiCalls = 0;

  try {
    const adapter = createAdapter(provider, providerConfig.target, credentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });

    options.onProgress?.({ phaseKey: 'cloudSync.progress.download', current: 0, total: 1 });
    const chunks = rowsToChunks(await adapter.getRows());
    const groups = groupChunks(chunks);
    const meta = await loadEncryptedMeta(provider, docKey);

    const candidates = meta ? groups.filter(group => group.snapshotGroupId === meta.snapshotGroupId) : groups;
    const group = candidates.find(candidate => candidate.complete) ?? groups.find(candidate => candidate.complete);
    if (!group) {
      throw new CloudSyncError('notFound', 'no complete snapshot found');
    }

    options.onProgress?.({ phaseKey: 'cloudSync.progress.verify', current: 0, total: 1 });
    const verified = await verifyAndDecryptSnapshot(group, masterPassword);
    if (!verified.ok) {
      throw new CloudSyncError('schema', `snapshot verification failed: ${verified.reason}`, verified.reason);
    }

    const [localEntries, localGroups] = await Promise.all([getAllPasswords(masterPassword), getAllGroups()]);
    const { groups: mergedGroups, codeMap } = await mergeSnapshotGroups(verified.payload.groups, localGroups);
    const localGroupCodes = new Set(mergedGroups.map(group => group.code));
    const localById = new Map(localEntries.map(entry => [entry.id, entry]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const rejected = 0;

    const now = Date.now();
    for (const remote of verified.payload.entries) {
      if (options.signal?.aborted) break;
      const local = localById.get(remote.id);
      const groupId =
        (remote.groupId ? codeMap.get(remote.groupId) : undefined) ??
        (remote.groupId && localGroupCodes.has(remote.groupId) ? remote.groupId : undefined);
      if (!local) {
        await savePassword(
          {
            username: remote.username,
            password: remote.password,
            url: remote.url,
            tag: remote.tag,
            remark: remote.remark,
            totp: remote.totp,
            createTime: remote.createTime || now,
            updateTime: remote.updateTime || now,
            groupId,
          },
          masterPassword,
        );
        added += 1;
      } else if ((remote.updateTime || 0) > (local.updateTime || 0)) {
        await updatePassword(
          local.id,
          {
            username: remote.username,
            password: remote.password,
            url: remote.url,
            tag: remote.tag,
            remark: remote.remark,
            totp: remote.totp,
            updateTime: remote.updateTime || now,
            groupId,
          },
          masterPassword,
        );
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    stats.pulled = added + updated;
    stats.skipped = skipped;
    stats.failed = rejected;
    await patchProviderConfig(provider, { lastSyncAt: Date.now() });
    await audit(makeAuditEntry(provider, 'encrypted', 'restore', docKey, { stats }));

    const report = buildReport(
      provider,
      'encrypted',
      docKey,
      startedAt,
      stats,
      [],
      failures,
      warnings,
      [],
      apiCalls,
      false,
    );
    report.restore = { added, updated, skipped, rejected };
    return report;
  } catch (error) {
    const normalized = toCloudSyncError(error);
    logger.error('云同步密文恢复失败:', normalized);
    throw normalized;
  } finally {
    await lock.handle.release();
  }
}

/** 警告列表类型别名（避免重复书写）。 */
type ReportWarnings = SyncReport['warnings'];

/**
 * 明文模式：全量拉取云端重建本地快照（修复快照丢失/不一致）
 */
export async function rebuildSnapshot(
  provider: CloudProvider,
  masterPassword: string,
  options: SyncRunOptions = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const { providerConfig, credentials, docKey } = await loadReadyContext(provider);
  const targetKey = `${provider}:${docKey}`;
  const lock = await acquireTaskLock(targetKey);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  let apiCalls = 0;

  try {
    const adapter = createAdapter(provider, providerConfig.target, credentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });
    const cloudRows = await adapter.getRows();
    const [localPasswords, localGroups] = await Promise.all([getAllPasswords(masterPassword), getAllGroups()]);
    const localEntries = localPasswords.map(entry => toLocalSyncEntry(entry, buildGroupPathMap(localGroups)));
    const localById = new Map(localEntries.map(entry => [entry.id, entry]));
    const now = Date.now();

    let snapshot = createEmptySnapshot(provider, docKey);
    for (const row of cloudRows) {
      const businessId = readBusinessId(row.fields);
      if (!businessId || !localById.has(businessId)) continue;
      const entry = localById.get(businessId)!;
      snapshot = withEntries(snapshot, {
        [businessId]: { hash: await computeEntryHash(entry), recordId: row.recordId, syncedAt: now },
      });
    }
    await saveSnapshot(snapshot);
    await audit(makeAuditEntry(provider, 'plaintext', 'rebuild', docKey, { stats }));
  } finally {
    await lock.handle.release();
  }

  return buildReport(provider, 'plaintext', docKey, startedAt, stats, [], [], [], [], apiCalls, false);
}

/**
 * 密文模式：按保留策略清理云端旧版本分组（不动本地）
 */
export async function clearOldSnapshotVersions(
  provider: CloudProvider,
  options: SyncRunOptions = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const { config, providerConfig, credentials, docKey } = await loadReadyContext(provider);
  const targetKey = `${provider}:${docKey}`;
  const lock = await acquireTaskLock(targetKey);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  let apiCalls = 0;

  try {
    const adapter = createAdapter(provider, providerConfig.target, credentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });
    const rows = await adapter.getRows();
    const chunks = rowsToChunks(rows);
    const groups = groupChunks(chunks);
    const pruneIds = selectVersionsToPrune(groups, config.keepVersions);
    for (const groupId of pruneIds) {
      const recordIds = rows
        .filter(row => row.fields[ENCRYPTED_FIELDS.snapshotGroupId] === groupId)
        .map(row => row.recordId);
      if (recordIds.length === 0) continue;
      const result = await runBatch(() => adapter.batchDelete(recordIds));
      stats.deleted += result.succeeded.length;
      stats.failed += result.failed.length;
    }
    await audit(makeAuditEntry(provider, 'encrypted', 'clearVersions', docKey, { stats }));
  } finally {
    await lock.handle.release();
  }

  return buildReport(provider, 'encrypted', docKey, startedAt, stats, [], [], [], [], apiCalls, false);
}
