import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendHealthSnapshot,
  buildHealthSnapshot,
  HEALTH_SNAPSHOT_DEDUPE_MS,
  MAX_HEALTH_SNAPSHOTS,
  normalizeHealthHistory,
  recordHealthSnapshot,
  type HealthSnapshot,
} from '@/utils/healthHistory';
import type { HealthReport } from '@/utils/passwordHealth';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/** 只构造趋势用到的字段；其它明细字段不属于快照面 */
const makeReport = (overrides: Partial<HealthReport> = {}): HealthReport =>
  ({
    total: 10,
    score: 80,
    reuseAffectedCount: 2,
    weak: [{ id: 'w1' }],
    breached: [{ id: 'b1' }, { id: 'b2' }],
    stale: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    ...overrides,
  }) as HealthReport;

describe('healthHistory 快照与趋势', () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: undefined })),
          set: vi.fn(async (_value: Record<string, unknown>) => {}),
        },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
  });

  it('快照只包含分数与四类计数，不包含任何条目内容', () => {
    const snapshot = buildHealthSnapshot(makeReport(), 1234);
    expect(snapshot).toEqual({
      at: 1234,
      score: 80,
      total: 10,
      reuse: 2,
      weak: 1,
      breached: 2,
      stale: 3,
    });
    expect(Object.keys(snapshot).sort()).toEqual(['at', 'breached', 'reuse', 'score', 'stale', 'total', 'weak']);
  });

  it('分数越界会收敛到 0-100', () => {
    expect(buildHealthSnapshot(makeReport({ score: 120 }), 1).score).toBe(100);
    expect(buildHealthSnapshot(makeReport({ score: -4 }), 1).score).toBe(0);
  });

  it('同一组计数在一小时内重复打开不追加，变更分数或超过一小时才追加', () => {
    const first = buildHealthSnapshot(makeReport(), 1000);
    let history = appendHealthSnapshot([], first);
    expect(history).toHaveLength(1);

    history = appendHealthSnapshot(history, buildHealthSnapshot(makeReport(), 2000));
    expect(history).toHaveLength(1);

    history = appendHealthSnapshot(history, buildHealthSnapshot(makeReport({ score: 82 }), 3000));
    expect(history).toHaveLength(2);

    history = appendHealthSnapshot(
      history,
      buildHealthSnapshot(makeReport({ score: 82 }), 3000 + HEALTH_SNAPSHOT_DEDUPE_MS),
    );
    expect(history).toHaveLength(3);
  });

  it('最多保留 24 条，保留最近的点', () => {
    let history: HealthSnapshot[] = [];
    for (let index = 0; index < MAX_HEALTH_SNAPSHOTS + 5; index++) {
      history = appendHealthSnapshot(history, buildHealthSnapshot(makeReport({ score: index }), index * 1000));
    }
    expect(history).toHaveLength(MAX_HEALTH_SNAPSHOTS);
    expect(history[history.length - 1].score).toBe(MAX_HEALTH_SNAPSHOTS + 4);
    expect(history[0].score).toBe(5);
  });

  it('storage 里的畸形数据被逐条剔除并按时间升序收敛', () => {
    expect(normalizeHealthHistory(undefined)).toEqual([]);
    expect(normalizeHealthHistory([{ at: 1, score: 80 }])).toEqual([]);
    expect(
      normalizeHealthHistory([
        { at: 3000, score: 81, total: 2, reuse: 0, weak: 1, breached: 0, stale: 0 },
        { at: 1000, score: 70, total: 2, reuse: 1, weak: 2, breached: 0, stale: 1 },
        { at: 'bad', score: 50, total: 1, reuse: 0, weak: 0, breached: 0, stale: 0 },
      ]),
    ).toEqual([
      { at: 1000, score: 70, total: 2, reuse: 1, weak: 2, breached: 0, stale: 1 },
      { at: 3000, score: 81, total: 2, reuse: 0, weak: 1, breached: 0, stale: 0 },
    ]);
  });

  it('recordHealthSnapshot 落盘、去重与空库跳过', async () => {
    const store: Record<string, unknown> = {};
    const get = vi.fn(async (key: string) => ({ [key]: store[key] }));
    const set = vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(store, value);
    });
    (globalThis as any).chrome = { storage: { local: { get, set } } };

    const first = await recordHealthSnapshot(makeReport(), 1000);
    expect(first).toHaveLength(1);
    expect(store[STORAGE_KEYS.HEALTH_HISTORY]).toHaveLength(1);

    const duplicate = await recordHealthSnapshot(makeReport(), 2000);
    expect(duplicate).toHaveLength(1);
    expect(set).toHaveBeenCalledTimes(1);

    const empty = await recordHealthSnapshot(makeReport({ total: 0 }), 3000);
    expect(empty).toHaveLength(1);
    expect(set).toHaveBeenCalledTimes(1);
  });
});
