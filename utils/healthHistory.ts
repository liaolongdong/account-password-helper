import { logger } from './logger';
import { STORAGE_KEYS } from './storageKeys';
import type { HealthReport } from './passwordHealth';

/**
 * 健康评分趋势快照
 *
 * 只记录分数与四类问题的计数，不记录条目 ID、账号、密码或任何可还原条目的内容。
 * 数据保存在本机 `chrome.storage.local`，不参与备份，也不发起任何网络请求。
 */
export interface HealthSnapshot {
  /** 记录时间（epoch 毫秒） */
  at: number;
  /** 综合评分 0-100 */
  score: number;
  /** 参与统计的条目总数 */
  total: number;
  /** 受密码复用影响的条目数 */
  reuse: number;
  /** 弱密码条目数 */
  weak: number;
  /** 命中常见泄露字典的条目数 */
  breached: number;
  /** 长时间未更新条目数 */
  stale: number;
}

/** 最多保留的快照数：足够画出 24 次变化，又不会让 storage 键无限增长 */
export const MAX_HEALTH_SNAPSHOTS = 24;

/** 同一组计数在一小时内重复打开体检时不再追加新点，避免趋势被短时间重复点击拉平 */
export const HEALTH_SNAPSHOT_DEDUPE_MS = 60 * 60 * 1000;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 从体检报告生成快照；只取计数，不触碰条目内容 */
export function buildHealthSnapshot(report: HealthReport, now: number = Date.now()): HealthSnapshot {
  return {
    at: now,
    score: Math.max(0, Math.min(100, Math.round(report.score))),
    total: report.total,
    reuse: report.reuseAffectedCount,
    weak: report.weak.length,
    breached: report.breached.length,
    stale: report.stale.length,
  };
}

/** 把 storage 里的不可信数据收敛为合法快照数组（按时间升序，最多 24 条） */
export function normalizeHealthHistory(value: unknown): HealthSnapshot[] {
  if (!Array.isArray(value)) return [];
  const snapshots: HealthSnapshot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const { at, score, total, reuse, weak, breached, stale } = record;
    if (
      !isFiniteNumber(at) ||
      !isFiniteNumber(score) ||
      !isFiniteNumber(total) ||
      !isFiniteNumber(reuse) ||
      !isFiniteNumber(weak) ||
      !isFiniteNumber(breached) ||
      !isFiniteNumber(stale)
    ) {
      continue;
    }
    if (score < 0 || score > 100 || total < 0 || reuse < 0 || weak < 0 || breached < 0 || stale < 0) continue;
    snapshots.push({
      at,
      score: Math.round(score),
      total: Math.round(total),
      reuse: Math.round(reuse),
      weak: Math.round(weak),
      breached: Math.round(breached),
      stale: Math.round(stale),
    });
  }
  return snapshots.sort((a, b) => a.at - b.at).slice(-MAX_HEALTH_SNAPSHOTS);
}

/** 判断两份快照的计数是否完全一致（不含时间） */
function sameCounts(a: HealthSnapshot, b: HealthSnapshot): boolean {
  return (
    a.score === b.score &&
    a.total === b.total &&
    a.reuse === b.reuse &&
    a.weak === b.weak &&
    a.breached === b.breached &&
    a.stale === b.stale
  );
}

/**
 * 追加快照
 *
 * - 计数与上一条完全相同且距上一条不足一小时：返回原数组（同一引用，调用方可据此跳过写入）
 * - 超过上限：保留最近 24 条
 */
export function appendHealthSnapshot(history: HealthSnapshot[], snapshot: HealthSnapshot): HealthSnapshot[] {
  const last = history[history.length - 1];
  if (last && sameCounts(last, snapshot) && snapshot.at - last.at < HEALTH_SNAPSHOT_DEDUPE_MS) return history;
  return [...history, snapshot].sort((a, b) => a.at - b.at).slice(-MAX_HEALTH_SNAPSHOTS);
}

/** 读取本机趋势；读取或解析失败降级为空数组，不影响体检主流程 */
export async function readHealthHistory(): Promise<HealthSnapshot[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.HEALTH_HISTORY);
    return normalizeHealthHistory(result[STORAGE_KEYS.HEALTH_HISTORY]);
  } catch (error) {
    logger.error('读取体检趋势失败:', error);
    return [];
  }
}

/**
 * 记录一次体检快照并返回最新趋势
 *
 * 空库不记录；重复计数在同一小时内不重复落盘；写失败时返回旧数组，不阻塞弹窗。
 */
export async function recordHealthSnapshot(report: HealthReport, now: number = Date.now()): Promise<HealthSnapshot[]> {
  const history = await readHealthHistory();
  if (report.total <= 0) return history;
  const next = appendHealthSnapshot(history, buildHealthSnapshot(report, now));
  if (next === history) return history;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.HEALTH_HISTORY]: next });
  } catch (error) {
    logger.error('保存体检趋势失败:', error);
    return history;
  }
  return next;
}
