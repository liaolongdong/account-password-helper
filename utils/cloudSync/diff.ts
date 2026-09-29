/**
 * 明文模式三方 diff（设计规格 §6.2、§6.3）
 *
 * **纯函数**：不做网络、不碰存储、不读时钟，输入本地条目 / 云端行 / 本地快照，
 * 输出可审查的执行计划。可独立测试，也便于在 UI 预览里先展示再执行。
 *
 * 匹配优先级（§6.2）：
 * 1. 快照记录的 `recordId` → 直接比内容哈希；
 * 2. `recordId` 未命中但业务 ID 一致 → 判定 `recordId` 迁移，改绑后正常比对；
 * 3. 同一 `recordId` 但业务 ID 变了 → 用户手改主键，人工冲突；
 * 4. 云端行无业务 ID → 回退 `url + username` 判重。
 *
 * 三方比对规则见 §6.3 表格；冲突按 LWW（本地 `updateTime` vs 云端 record 修改时间）。
 * 云端数据一律视为**不可信输入**，非法行跳过并计入 `rejectedRows`。
 */
import type { CloudRow, DiffPlanItem, DiffResult, LocalSyncEntry, SyncSnapshot } from './types';
import { entryToFields, fieldsToEntry, readBusinessId } from './schema';
import { computeEntryHash } from './hash';

/** diff 输入 */
export interface DiffInput {
  local: LocalSyncEntry[];
  cloud: CloudRow[];
  /** 快照缺失（首次同步或损坏降级）时传 null */
  snapshot: SyncSnapshot | null;
}

/** 云端行的去除空白后的 `url+username` 判重键 */
function fallbackKey(url: string, username: string): string {
  return `${url.trim().toLowerCase()}\u0000${username.trim().toLowerCase()}`;
}

/** 判断云端行是否通过不可信输入校验 */
function isValidCloudRow(row: CloudRow): boolean {
  const { entry } = fieldsToEntry(row.fields);
  // 三条字段全空的行没有同步意义，且可能是平台侧的半成品记录
  return Boolean(entry.username || entry.password || entry.url);
}

/**
 * 计算三方 diff
 */
export async function computeDiff(input: DiffInput): Promise<DiffResult> {
  const plan: DiffPlanItem[] = [];
  const rejectedRows: { recordId: string; reason: string }[] = [];
  const snapshotEntries = input.snapshot?.entries ?? {};
  const snapshotDegraded = input.snapshot === null;

  // 本地条目哈希（异步计算，先整体算好再比对）
  const localHashes = new Map<string, string>();
  for (const entry of input.local) localHashes.set(entry.id, await computeEntryHash(entry));

  // 云端行：先做输入校验，再计算哈希与索引
  const validCloudRows: { row: CloudRow; entry: LocalSyncEntry; hash: string; businessId: string }[] = [];
  for (const row of input.cloud) {
    if (!isValidCloudRow(row)) {
      rejectedRows.push({ recordId: row.recordId, reason: 'empty-or-invalid-row' });
      continue;
    }
    const { entry, updateTime } = fieldsToEntry(row.fields);
    const businessId = readBusinessId(row.fields);
    validCloudRows.push({
      row,
      entry: { ...entry, updateTime },
      hash: await computeEntryHash(entry),
      businessId,
    });
  }

  const cloudByRecordId = new Map(validCloudRows.map(item => [item.row.recordId, item]));
  const cloudByBusinessId = new Map<string, (typeof validCloudRows)[number]>();
  for (const item of validCloudRows) if (item.businessId) cloudByBusinessId.set(item.businessId, item);

  const matchedRecordIds = new Set<string>();
  const localById = new Map(input.local.map(entry => [entry.id, entry]));

  // 无业务 ID 的云端行（用户在文档手工新增）按 url+username 建立回退索引。
  // 仅用于给「本地尚无快照绑定」的条目采纳 recordId，避免在快照降级时
  // 同时 pushCreate 与 skip，导致云端出现重复记录。
  const snapshotRecordIds = new Set(Object.values(snapshotEntries).map(entry => entry.recordId));
  const unboundFallback = new Map<string, (typeof validCloudRows)[number]>();
  for (const item of validCloudRows) {
    if (item.businessId || snapshotRecordIds.has(item.row.recordId)) continue;
    const key = fallbackKey(item.entry.url, item.entry.username);
    if (!unboundFallback.has(key)) unboundFallback.set(key, item);
  }

  for (const localEntry of input.local) {
    const localHash = localHashes.get(localEntry.id)!;
    const snapshotEntry = snapshotEntries[localEntry.id];
    let cloud = snapshotEntry ? cloudByRecordId.get(snapshotEntry.recordId) : undefined;

    // 规则 1：优先 recordId 命中；未命中但业务 ID 一致 → recordId 迁移
    if (cloud) {
      if (cloud.businessId && cloud.businessId !== localEntry.id) {
        // 同一 recordId 但业务 ID 变了：用户手改主键，禁止自动覆盖
        matchedRecordIds.add(cloud.row.recordId);
        plan.push({
          kind: 'manualConflict',
          reason: 'primaryKeyChanged',
          businessId: localEntry.id,
          recordId: cloud.row.recordId,
          row: cloud.row,
        });
        continue;
      }
    } else {
      const byBusinessId = cloudByBusinessId.get(localEntry.id);
      if (byBusinessId) {
        cloud = byBusinessId;
        if (snapshotEntry && snapshotEntry.recordId !== byBusinessId.row.recordId) {
          plan.push({ kind: 'rebindRecordId', businessId: localEntry.id, recordId: byBusinessId.row.recordId });
        }
      }
    }

    if (!cloud) {
      // 规则 4：快照存在但云端已无该行
      if (snapshotEntry) {
        if (localHash !== snapshotEntry.hash) {
          // 本地在云端删除后又改过：不可静默进回收站，交人工裁决
          plan.push({
            kind: 'manualConflict',
            reason: 'localModifiedCloudDeleted',
            businessId: localEntry.id,
            recordId: snapshotEntry.recordId,
          });
        } else {
          plan.push({ kind: 'trashLocal', businessId: localEntry.id });
        }
        continue;
      }

      // 快照缺失但云端有同 url+username 的手工行：采纳其 recordId，视为同一账号
      const candidate = unboundFallback.get(fallbackKey(localEntry.url, localEntry.username));
      if (candidate) {
        cloud = candidate;
        matchedRecordIds.add(candidate.row.recordId);
        plan.push({ kind: 'rebindRecordId', businessId: localEntry.id, recordId: candidate.row.recordId });
      } else {
        // 规则 7：本地新增
        plan.push({ kind: 'pushCreate', entry: localEntry });
        continue;
      }
    }

    matchedRecordIds.add(cloud.row.recordId);
    const localChanged = snapshotEntry ? localHash !== snapshotEntry.hash : null;
    const cloudChanged = snapshotEntry ? cloud.hash !== snapshotEntry.hash : null;

    if (snapshotDegraded || !snapshotEntry || localChanged === null || cloudChanged === null) {
      // 降级路径：无基线时全量比对 + 时间戳 LWW
      if (localHash === cloud.hash) {
        plan.push({ kind: 'baseline', businessId: localEntry.id, recordId: cloud.row.recordId });
      } else if (localEntry.updateTime >= cloud.row.cloudModifiedAt) {
        plan.push({
          kind: 'conflict',
          businessId: localEntry.id,
          recordId: cloud.row.recordId,
          entry: localEntry,
          row: cloud.row,
          winner: 'local',
        });
      } else {
        plan.push({
          kind: 'conflict',
          businessId: localEntry.id,
          recordId: cloud.row.recordId,
          entry: localEntry,
          row: cloud.row,
          winner: 'cloud',
        });
      }
      continue;
    }

    if (localChanged && !cloudChanged) {
      plan.push({ kind: 'pushUpdate', entry: localEntry, recordId: cloud.row.recordId });
    } else if (!localChanged && cloudChanged) {
      plan.push({ kind: 'pullUpdate', row: cloud.row, businessId: localEntry.id });
    } else if (localChanged && cloudChanged) {
      const winner = localEntry.updateTime >= cloud.row.cloudModifiedAt ? 'local' : 'cloud';
      plan.push({
        kind: 'conflict',
        businessId: localEntry.id,
        recordId: cloud.row.recordId,
        entry: localEntry,
        row: cloud.row,
        winner,
      });
    } else {
      plan.push({ kind: 'baseline', businessId: localEntry.id, recordId: cloud.row.recordId });
    }
  }

  // 未被本地条目匹配的云端行
  const localFallbackKeys = new Set(input.local.map(entry => fallbackKey(entry.url, entry.username)));
  const pulledBusinessIds = new Set<string>();
  for (const item of validCloudRows) {
    if (matchedRecordIds.has(item.row.recordId)) continue;
    const snapshotKnown =
      Boolean(item.businessId && snapshotEntries[item.businessId]) ||
      Object.values(snapshotEntries).some(entry => entry.recordId === item.row.recordId);

    if (snapshotKnown) {
      // 规则 6：本地删除 → 删除云端行
      plan.push({ kind: 'deleteCloudRow', recordId: item.row.recordId, businessId: item.businessId });
      continue;
    }

    if (item.businessId) {
      if (localById.has(item.businessId) || pulledBusinessIds.has(item.businessId)) {
        plan.push({ kind: 'skip', businessId: item.row.recordId, reason: 'duplicate-business-id' });
        continue;
      }
      // 云端带业务 ID 且本地/快照均未见过：这是其他设备写入的新增项。
      // 必须保留原业务 ID 拉取，否则下一轮仍会被判成新的外部业务 ID。
      pulledBusinessIds.add(item.businessId);
      plan.push({ kind: 'pullCreateWithId', row: item.row, businessId: item.businessId });
      continue;
    }

    // 规则 5：用户在文档手工新增（无业务 ID）→ 回退 url+username 判重
    const key = fallbackKey(item.entry.url, item.entry.username);
    if (localFallbackKeys.has(key) || localById.has(item.row.recordId)) {
      plan.push({ kind: 'skip', businessId: item.row.recordId, reason: 'duplicate-url-username' });
      continue;
    }
    plan.push({ kind: 'pullCreate', row: item.row });
  }

  return { plan, rejectedRows, snapshotDegraded };
}

/** 把本地条目投影为参与同步的字段（体积裁剪 + 明文转换，供推送复用） */
export function toCloudFields(entry: LocalSyncEntry): Record<string, string | number> {
  return entryToFields(entry);
}
