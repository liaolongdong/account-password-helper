/**
 * WebDAV 密文备份编排（WebDAV 规格 §6）
 *
 * 职责：把「取数 → 加密 → 上传 → 版本保留 → 报告」与「列版本 → 下载 →
 * 校验链 → 增量合并 → 报告」串起来，复用任务锁、审计日志、凭证与配置存储。
 *
 * 运行上下文约束：经 WebDavAdapter 依赖 DOMParser（Window API），
 * 本模块仅可在 Options 页面使用，严禁被 background/content 入口 import。
 *
 * 不参与：diff/schema/sanitize/明文快照（WebDAV 仅密文单文件，无行级同步）。
 * 任何分支都不得把凭证、密码、TOTP 或 blob 内容写入日志与报告。
 */
import { getAllPasswords, savePassword, updatePassword } from '@/utils/storage/passwordCrud';
import { getAllGroups, saveGroups } from '@/utils/storage/groupManager';
import { logger } from '@/utils/logger';
import { mergeImportedGroups } from '@/utils/groupTree';
import { patchProviderConfig } from './configStore';
import { buildReport, emptyStats, loadReadyContext } from './runContext';
import { loadEncryptedMeta, saveEncryptedMeta } from './snapshotStore';
import { appendAuditLog, makeAuditEntry } from './auditLog';
import { acquireTaskLock } from './taskLock';
import { encryptToSingleFile, verifyAndDecryptSingleFile } from './cryptoSnapshot';
import { CloudSyncError, isAbortError, toCloudSyncError } from './errors';
import {
  FILE_PREFIX,
  FILE_SUFFIX,
  needsInsecureConfirm,
  normalizeWebDavDirUrl,
  parseSnapshotFileName,
  WebDavAdapter,
} from './adapters/webdav';
import type { RemoteFile } from './adapters/fileStorage';
import type { SyncRunOptions } from './syncEngine';
import type { AdapterOptions, SyncReport, WebDavCredentials, WebDavTarget } from './types';

/** 目标目录准备结果 */
export interface PrepareWebDavResult {
  provider: 'webdav';
  /** 备份目录 URL（UI 展示用） */
  backupDirUrl: string;
  /** 目录是否为本次新建（MKCOL 返回 201）；已存在（405）为 false */
  created: boolean;
  target: WebDavTarget;
}

/** 可恢复的历史版本（UI 版本下拉数据源） */
export interface WebDavVersion {
  /** 文件名 */
  name: string;
  /** 字节数（服务器未返回时为 0） */
  size: number;
  /** 由文件名时间戳解析的导出时间（毫秒）；解析失败为 0 */
  exportedAt: number;
  /** 可直接用于 getFile 的 URL */
  url: string;
}

/**
 * 生成快照文件名：aph-<UTC 紧凑时间戳>-<6 位随机>.aphdav（规格 §5.3）
 *
 * 时间戳必须与 parseSnapshotFileName 的 `^aph-(\d{14})-` 正则严格互逆：
 * 文件名解析失败会导致 exportedAt=0、被版本保留策略误判为最旧而删除。
 */
export function buildSnapshotFileName(now = new Date()): string {
  // toISOString = '2026-09-24T10:15:30.123Z'；去掉全部非数字后取前 14 位
  const compact = now.toISOString().replace(/\D/g, '').slice(0, 14);
  let random = Math.random().toString(36).slice(2, 8);
  while (random.length < 6) random += Math.random().toString(36).slice(2, 3);
  return `${FILE_PREFIX}${compact}-${random}${FILE_SUFFIX}`;
}

/** 构造适配器（凭证与目标从已就绪配置读取） */
function createWebDavAdapter(
  target: WebDavTarget,
  credentials: WebDavCredentials,
  options: AdapterOptions,
): WebDavAdapter {
  if (!target.dirUrl) throw new CloudSyncError('notFound', 'webdav directory not configured');
  return new WebDavAdapter({
    dirUrl: target.dirUrl,
    credentials,
    options,
    allowInsecure: target.allowInsecure,
  });
}

/**
 * 校验凭证、探测目录、按需创建备份子目录，并回写配置
 *
 * 安全门独立重算：`needsInsecureConfirm(dirUrl)` 为 true 且未显式确认时抛错，
 * 不信任 UI 单侧判断（规格 §6.2）。
 */
export async function prepareWebDavTarget(
  credentials: WebDavCredentials,
  dirUrl: string,
  options: AdapterOptions & { allowInsecure?: boolean } = {},
): Promise<PrepareWebDavResult> {
  const allowInsecure = options.allowInsecure === true;
  if (needsInsecureConfirm(dirUrl) && !allowInsecure) {
    throw new CloudSyncError('notFound', 'insecure transport requires explicit confirmation');
  }

  const adapter = new WebDavAdapter({ dirUrl, credentials, options, allowInsecure });
  await adapter.testConnection();
  // ensureDirectory 幂等且返回是否新建：MKCOL 201 → 本次新建；405 → 已存在
  let created: boolean;
  try {
    created = await adapter.ensureDirectory();
  } catch (error) {
    throw toCloudSyncError(error);
  }

  const target: WebDavTarget = {
    dirUrl: normalizeWebDavDirUrl(dirUrl),
    backupDirUrl: adapter.backupDirUrl,
    allowInsecure,
  };
  await patchProviderConfig('webdav', { configured: true, mode: 'encrypted', target });
  await appendAuditLog(makeAuditEntry('webdav', 'encrypted', 'prepareTarget', adapter.backupDirUrl));
  return { provider: 'webdav', backupDirUrl: adapter.backupDirUrl, created, target };
}

/**
 * 密文备份：整库加密 → 单文件上传 → 版本保留（规格 §6.3）
 *
 * 单文件 PUT 原子：失败即整体失败，不产生半成品（不分片的可靠性收益）。
 */
export async function runWebDavBackup(masterPassword: string, options: SyncRunOptions = {}): Promise<SyncReport> {
  const startedAt = Date.now();
  const { config, providerConfig, credentials, docKey } = await loadReadyContext('webdav');
  const target = providerConfig.target as WebDavTarget;

  const lock = await acquireTaskLock(`webdav:${docKey}`);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  const failures: SyncReport['failures'] = [];
  const warnings: SyncReport['warnings'] = [];
  let apiCalls = 0;
  let cancelled = false;

  try {
    const adapter = createWebDavAdapter(target, credentials as WebDavCredentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });

    options.onProgress?.({ phaseKey: 'cloudSync.progress.fetchLocal', current: 0, total: 1 });
    const [entries, groups] = await Promise.all([getAllPasswords(masterPassword), getAllGroups()]);

    await adapter.ensureDirectory();

    options.onProgress?.({ phaseKey: 'cloudSync.progress.encrypt', current: 0, total: 1 });
    const snapshot = await encryptToSingleFile(entries, masterPassword, Date.now(), groups);
    const fileName = buildSnapshotFileName(new Date(snapshot.exportedAt));

    options.onProgress?.({ phaseKey: 'cloudSync.progress.upload', current: 0, total: 1 });
    await adapter.putFile(fileName, JSON.stringify(snapshot));
    stats.created = 1;

    await saveEncryptedMeta({
      provider: 'webdav',
      docKey,
      snapshotGroupId: fileName,
      snapshotHash: snapshot.snapshotHash,
      exportedAt: snapshot.exportedAt,
      totalParts: 1,
    });
    await patchProviderConfig('webdav', { lastSyncAt: Date.now() });

    // 版本保留：删除超出 keepVersions 的旧文件；清理失败不回滚备份，仅记 failures
    const pruned = await pruneOldVersions(adapter, config.keepVersions);
    stats.deleted = pruned.deleted;
    failures.push(...pruned.failures);

    if (target.allowInsecure) warnings.push({ key: 'cloudSync.warning.insecureTransport' });
    const auditOk = await appendAuditLog(makeAuditEntry('webdav', 'encrypted', 'backup', docKey, { stats }));
    if (!auditOk) warnings.push({ key: 'cloudSync.warning.auditLogFailed' });
  } catch (error) {
    if (isAbortError(error)) {
      cancelled = true;
    } else {
      const normalized = toCloudSyncError(error);
      if (stats.failed === 0) stats.failed += 1;
      failures.push({ businessId: '', code: normalized.code ?? normalized.kind, message: normalized.message });
      logger.error('WebDAV 密文备份失败:', normalized);
      throw normalized;
    }
  } finally {
    await lock.handle.release();
  }

  return buildReport('webdav', 'encrypted', docKey, startedAt, stats, [], failures, warnings, [], apiCalls, cancelled);
}

/**
 * 密文恢复：列版本 → 选目标 → 下载 → 校验链 → 按 ID 增量合并（规格 §6.4）
 *
 * **恢复不删除本地任何条目**；本地较新的条目跳过，不覆盖本地新值。
 */
export async function runWebDavRestore(
  masterPassword: string,
  options: SyncRunOptions & { versionName?: string } = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const { providerConfig, credentials, docKey } = await loadReadyContext('webdav');
  const target = providerConfig.target as WebDavTarget;

  const lock = await acquireTaskLock(`webdav:${docKey}`);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  const failures: SyncReport['failures'] = [];
  const warnings: SyncReport['warnings'] = [];
  let apiCalls = 0;
  let cancelled = false;

  try {
    const adapter = createWebDavAdapter(target, credentials as WebDavCredentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });

    options.onProgress?.({ phaseKey: 'cloudSync.progress.download', current: 0, total: 1 });
    const versions = await listVersions(adapter);
    if (versions.length === 0) throw new CloudSyncError('notFound', 'no snapshot found');

    const chosen = await chooseVersion(versions, options.versionName, docKey);

    options.onProgress?.({ phaseKey: 'cloudSync.progress.verify', current: 0, total: 1 });
    const raw = await adapter.getFile(chosen.url, chosen.size || undefined);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new CloudSyncError('schema', 'snapshot verification failed: invalidPayload', 'invalidPayload');
    }
    const verified = await verifyAndDecryptSingleFile(parsed, masterPassword);
    if (!verified.ok) {
      throw new CloudSyncError('schema', `snapshot verification failed: ${verified.reason}`, verified.reason);
    }

    const [localEntries, localGroups] = await Promise.all([getAllPasswords(masterPassword), getAllGroups()]);
    const merged = mergeImportedGroups(verified.payload.groups, localGroups);
    if (merged.groups.length !== localGroups.length) await saveGroups(merged.groups);
    const localGroupCodes = new Set(merged.groups.map(group => group.code));
    const localById = new Map(localEntries.map(entry => [entry.id, entry]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const rejected = 0;

    const now = Date.now();
    for (const remote of verified.payload.entries) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      const local = localById.get(remote.id);
      const groupId =
        (remote.groupId ? merged.codeMap.get(remote.groupId) : undefined) ??
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
    if (target.allowInsecure) warnings.push({ key: 'cloudSync.warning.insecureTransport' });
    await patchProviderConfig('webdav', { lastSyncAt: Date.now() });
    await appendAuditLog(makeAuditEntry('webdav', 'encrypted', 'restore', docKey, { stats }));

    const report = buildReport(
      'webdav',
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
    );
    report.restore = { added, updated, skipped, rejected };
    return report;
  } catch (error) {
    if (isAbortError(error)) {
      cancelled = true;
    } else {
      const normalized = toCloudSyncError(error);
      logger.error('WebDAV 密文恢复失败:', normalized);
      throw normalized;
    }
  } finally {
    await lock.handle.release();
  }

  return buildReport('webdav', 'encrypted', docKey, startedAt, stats, [], failures, warnings, [], apiCalls, cancelled);
}

/**
 * 列出可恢复的历史版本（UI 版本下拉数据源）
 *
 * 按文件名时间戳降序（新→旧）；解析失败（exportedAt=0）排最后，按文件名降序兜底。
 */
export async function listWebDavVersions(): Promise<WebDavVersion[]> {
  const { providerConfig, credentials } = await loadReadyContext('webdav');
  const adapter = createWebDavAdapter(providerConfig.target as WebDavTarget, credentials as WebDavCredentials, {});
  return listVersions(adapter);
}

/**
 * 按保留策略清理云端旧版本（不动本地数据）
 *
 * 无需主密码：只删除云端历史文件。
 */
export async function clearOldWebDavVersions(options: SyncRunOptions = {}): Promise<SyncReport> {
  const startedAt = Date.now();
  const { config, providerConfig, credentials, docKey } = await loadReadyContext('webdav');

  const lock = await acquireTaskLock(`webdav:${docKey}`);
  if (!lock.ok) throw new CloudSyncError('writeConflict', 'sync task already running');

  const stats = emptyStats();
  const failures: SyncReport['failures'] = [];
  let apiCalls = 0;
  let cancelled = false;

  try {
    const adapter = createWebDavAdapter(providerConfig.target as WebDavTarget, credentials as WebDavCredentials, {
      signal: options.signal,
      onApiCall: () => {
        apiCalls += 1;
      },
    });
    const pruned = await pruneOldVersions(adapter, config.keepVersions);
    stats.deleted = pruned.deleted;
    failures.push(...pruned.failures);
    stats.failed = failures.length;
    await appendAuditLog(makeAuditEntry('webdav', 'encrypted', 'clearVersions', docKey, { stats }));
  } catch (error) {
    if (isAbortError(error)) {
      cancelled = true;
    } else {
      throw toCloudSyncError(error);
    }
  } finally {
    await lock.handle.release();
  }

  return buildReport('webdav', 'encrypted', docKey, startedAt, stats, [], failures, [], [], apiCalls, cancelled);
}

// ==================== 内部辅助 ====================

/** 列文件并转换为版本视图（按 exportedAt 降序，同值按文件名降序） */
async function listVersions(adapter: WebDavAdapter): Promise<WebDavVersion[]> {
  const files: RemoteFile[] = await adapter.listFiles();
  return files
    .map(file => ({ name: file.name, size: file.size, exportedAt: parseSnapshotFileName(file.name), url: file.url }))
    .sort((a, b) => b.exportedAt - a.exportedAt || b.name.localeCompare(a.name));
}

/**
 * 选择恢复目标版本（规格 §6.4 第 3 步优先级）
 *
 * versionName 指定 → 精确匹配（不存在抛 notFound）；
 * 未指定 → 本机 meta 记录的文件名匹配优先；
 * meta 缺失或已不在列表 → 取最新。
 */
async function chooseVersion(
  versions: WebDavVersion[],
  versionName: string | undefined,
  docKey: string,
): Promise<WebDavVersion> {
  if (versionName) {
    const chosen = versions.find(version => version.name === versionName);
    if (!chosen) throw new CloudSyncError('notFound', `snapshot version not found: ${versionName}`);
    return chosen;
  }
  const meta = await loadEncryptedMeta('webdav', docKey);
  if (meta) {
    const matched = versions.find(version => version.name === meta.snapshotGroupId);
    if (matched) return matched;
  }
  return versions[0];
}

/** 版本保留：保留最近 keepVersions 个，其余删除；失败逐条记入 failures 不中断 */
async function pruneOldVersions(
  adapter: WebDavAdapter,
  keepVersions: number,
): Promise<{ deleted: number; failures: SyncReport['failures'] }> {
  const versions = await listVersions(adapter);
  const stale = versions.slice(Math.max(1, keepVersions));
  let deleted = 0;
  const failures: SyncReport['failures'] = [];
  for (const version of stale) {
    try {
      await adapter.deleteFile(version.url);
      deleted += 1;
    } catch (error) {
      const normalized = toCloudSyncError(error);
      failures.push({
        businessId: version.name,
        code: normalized.code ?? normalized.kind,
        message: normalized.message,
      });
    }
  }
  return { deleted, failures };
}
