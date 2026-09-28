/**
 * 云同步编排共享基元（WebDAV 规格 §6.1）
 *
 * 从 `syncEngine.ts` 纯搬迁的三个无状态函数，供表格编排（syncEngine）与
 * 文件编排（webdavSync）共用：
 * - `loadReadyContext`：读配置 → 凭证四态检查 → 算 docKey 的统一前置校验；
 * - `emptyStats`：空白统计；
 * - `buildReport`：结构化报告组装。
 *
 * 搬迁为零行为变化，由既有测试守卫。复制粘贴这类前置校验逻辑是真正会随
 * 时间漂移的重复，故收敛到单一来源。
 */
import { getCloudSyncConfig, getDocKey } from './configStore';
import { loadCredentials } from './credentialStore';
import { CloudSyncError } from './errors';
import type {
  CloudProvider,
  CloudSyncConfig,
  CloudSyncMode,
  CloudSyncProviderConfig,
  ProviderCredentialMap,
  SyncReport,
  SyncStats,
} from './types';

/** 空白统计 */
export function emptyStats(): SyncStats {
  return { created: 0, updated: 0, deleted: 0, pulled: 0, trashed: 0, conflicts: 0, skipped: 0, failed: 0 };
}

/** 读取已就绪的配置 + 凭证（任一缺失即抛领域错误，由 UI 引导补齐） */
export async function loadReadyContext(provider: CloudProvider): Promise<{
  config: CloudSyncConfig;
  providerConfig: CloudSyncProviderConfig;
  credentials: ProviderCredentialMap[CloudProvider];
  docKey: string;
}> {
  const config = await getCloudSyncConfig();
  const providerConfig = config.providers[provider];
  const credentialResult = await loadCredentials(provider);
  if (credentialResult.status === 'empty') throw new CloudSyncError('invalidCredential', 'credentials not configured');
  if (credentialResult.status === 'locked') throw new CloudSyncError('invalidCredential', 'session locked');
  if (credentialResult.status === 'corrupted')
    throw new CloudSyncError('invalidCredential', 'credentials unreadable after rekey');

  const docKey = getDocKey(provider, providerConfig.target);
  if (!providerConfig.configured || !docKey) throw new CloudSyncError('notFound', 'target not configured');
  return { config, providerConfig, credentials: credentialResult.credentials, docKey };
}

/** 组装结构化报告 */
export function buildReport(
  provider: CloudProvider,
  mode: CloudSyncMode,
  targetLabel: string,
  startedAt: number,
  stats: SyncStats,
  conflictDetails: SyncReport['conflictDetails'],
  failures: SyncReport['failures'],
  warnings: SyncReport['warnings'],
  truncated: SyncReport['truncated'],
  apiCalls: number,
  cancelled: boolean,
  chunkDowngrades = 0,
): SyncReport {
  const finishedAt = Date.now();
  return {
    provider,
    mode,
    targetLabel,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    stats,
    conflictDetails,
    failures,
    warnings,
    truncated,
    apiCalls,
    cancelled,
    chunkDowngrades,
  };
}
