/**
 * 同步任务互斥锁（设计规格 §2.2）
 *
 * 目的：防止连续点击、多个 Options 页面实例并行同步同一张表，造成分片污染、
 * 快照错乱，以及触发飞书 `1254291 Write conflict`。
 *
 * 实现要点：
 * - 锁存于 `chrome.storage.session`（仅内存、跨扩展页面共享、浏览器关闭即清），
 *   内存 Map 锁无法跨页面实例生效，故不使用；
 * - 心跳超 30s 判定为**残留死锁**（页面崩溃/刷新未释放），允许强制抢占；
 * - 释放走 `finally`，无论成功、业务失败、网络异常、手动取消都删除锁条目并停心跳。
 *
 * 已知局限：非分布式锁，无法阻止其他电脑/浏览器操作同一张云端表。
 */
import { logger } from '@/utils/logger';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

/** 心跳刷新间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 10_000;

/** 死锁判定阈值（毫秒）：心跳距今超过此值即可抢占 */
const STALE_LOCK_MS = 30_000;

/** 单个目标的锁条目 */
interface LockEntry {
  acquiredAt: number;
  heartbeatAt: number;
  /** 持锁页面标识，用于避免误释放他人锁 */
  pageId: string;
}

type LockMap = Record<string, LockEntry>;

/** 当前页面标识：同一 JS 上下文内所有锁共用，跨页面天然不同 */
const PAGE_ID = `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 锁句柄：release 幂等，重复调用安全 */
export interface TaskLockHandle {
  targetKey: string;
  release: () => Promise<void>;
}

/** 获取锁失败原因 */
export type LockAcquireResult =
  { ok: true; handle: TaskLockHandle; preempted: boolean } | { ok: false; reason: 'busy'; heartbeatAt: number };

/** 读取全部锁条目（storage.session 不可用时降级为空，不阻断同步） */
async function readLocks(): Promise<LockMap> {
  try {
    const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.CLOUD_SYNC_LOCK);
    const raw = result[SESSION_MEMORY_KEYS.CLOUD_SYNC_LOCK];
    return raw && typeof raw === 'object' ? (raw as LockMap) : {};
  } catch (error) {
    logger.warn('读取云同步任务锁失败，按无锁处理:', error);
    return {};
  }
}

/** 写入全部锁条目 */
async function writeLocks(locks: LockMap): Promise<void> {
  await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.CLOUD_SYNC_LOCK]: locks });
}

/**
 * 尝试获取指定目标的同步锁
 *
 * @param targetKey `${provider}:${docKey}`
 * @returns 成功返回锁句柄（preempted 标记是否为抢占死锁）；被占用返回 busy
 */
export async function acquireTaskLock(targetKey: string): Promise<LockAcquireResult> {
  const now = Date.now();
  const locks = await readLocks();
  const existing = locks[targetKey];

  let preempted = false;
  if (existing) {
    const stale = now - (existing.heartbeatAt ?? 0) >= STALE_LOCK_MS;
    if (!stale) {
      return { ok: false, reason: 'busy', heartbeatAt: existing.heartbeatAt ?? now };
    }
    // 残留死锁：强制抢占（页面崩溃/刷新未释放），由调用方记入审计日志
    preempted = true;
    logger.warn(`云同步任务锁残留，强制抢占: ${targetKey}`);
  }

  locks[targetKey] = { acquiredAt: now, heartbeatAt: now, pageId: PAGE_ID };
  await writeLocks(locks);

  // 心跳定时器：维持锁活性；写入失败不致命（最坏情况被其他页面判定死锁抢占）
  const timer = setInterval(() => {
    void (async () => {
      try {
        const current = await readLocks();
        const entry = current[targetKey];
        // 仅当锁仍属于本页面时续期，避免覆盖抢占者的锁
        if (!entry || entry.pageId !== PAGE_ID) return;
        entry.heartbeatAt = Date.now();
        await writeLocks(current);
      } catch {
        // 心跳失败静默：下次 tick 重试
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);

  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    clearInterval(timer);
    try {
      const current = await readLocks();
      // 只删除自己持有的锁：若已被他人抢占，保留对方锁不动
      if (current[targetKey]?.pageId === PAGE_ID) {
        delete current[targetKey];
        await writeLocks(current);
      }
    } catch (error) {
      logger.warn('释放云同步任务锁失败:', error);
    }
  };

  return { ok: true, handle: { targetKey, release }, preempted };
}

/**
 * 查询目标是否正在同步（UI 置灰按钮用，不获取锁）
 */
export async function isTargetLocked(targetKey: string): Promise<boolean> {
  const locks = await readLocks();
  const entry = locks[targetKey];
  if (!entry) return false;
  return Date.now() - (entry.heartbeatAt ?? 0) < STALE_LOCK_MS;
}
