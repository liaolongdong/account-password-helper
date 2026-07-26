import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markSidepanelOpenRequested, recordSidepanelOpenMetrics } from '@/utils/perfMetrics';
import type { SidepanelOpenMetrics } from '@/utils/perfMetrics';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

/**
 * perfMetrics.ts 单元测试
 *
 * 重点锁住「打开请求」记录的存储格式升级兼容行为（number → { at, trigger }）：
 * - markSidepanelOpenRequested：写入新格式 { at, trigger } 及缺省回退；
 * - consumeOpenRequest（私有，经 recordSidepanelOpenMetrics 的环形日志输出观察）：
 *   新格式 / 旧版纯 number 格式 / 畸形对象 / 无记录 / 超时间窗口的降级路径，
 *   以及「读后即删」防止陈旧值污染下次记录；
 * - 环形缓冲：写入后截断至最近 20 条。
 *
 * 说明：环境为 node，全局 chrome 由 WxtVitest 的 fakeBrowser 注入
 * （storage.session 同为内存桩）；recordSidepanelOpenMetrics 的存储写入为
 * fire-and-forget，经 vi.waitFor 轮询环形日志收敛。
 */

/** 打开请求记录的 session 存储键 */
const OPEN_KEY = SESSION_MEMORY_KEYS.SIDEPANEL_OPEN_REQUESTED_AT;

/** 环形日志存储键 */
const LOG_KEY = STORAGE_KEYS.SIDEPANEL_PERF_LOG;

/** 最小化的初始化元信息（其余维度与本测试无关） */
const BASE_META = { raceWinner: null, sessionValid: true };

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

/** 读取环形日志（无记录时返回空数组） */
async function getPerfLog(): Promise<SidepanelOpenMetrics[]> {
  const result = await chrome.storage.local.get(LOG_KEY);
  return (result[LOG_KEY] as SidepanelOpenMetrics[] | undefined) ?? [];
}

/** 触发一次记录并等待 fire-and-forget 写入收敛，返回最新一条记录 */
async function recordAndGetLatest(): Promise<SidepanelOpenMetrics> {
  const before = (await getPerfLog()).length;
  recordSidepanelOpenMetrics(BASE_META);
  await vi.waitFor(async () => {
    expect((await getPerfLog()).length).toBeGreaterThan(before);
  });
  const log = await getPerfLog();
  return log[log.length - 1];
}

describe('markSidepanelOpenRequested', () => {
  it('写入新格式 { at, trigger }（携带内容脚本侧点击时刻与触发源）', async () => {
    markSidepanelOpenRequested({ clickTs: 12345, trigger: 'float' });

    await vi.waitFor(async () => {
      const result = await chrome.storage.session.get(OPEN_KEY);
      expect(result[OPEN_KEY]).toEqual({ at: 12345, trigger: 'float' });
    });
  });

  it('缺省 meta 时回退为当前时刻 + trigger null', async () => {
    const before = Date.now();
    markSidepanelOpenRequested();

    await vi.waitFor(async () => {
      const result = await chrome.storage.session.get(OPEN_KEY);
      const raw = result[OPEN_KEY] as { at: number; trigger: string | null };
      expect(raw.trigger).toBeNull();
      expect(raw.at).toBeGreaterThanOrEqual(before);
      expect(raw.at).toBeLessThanOrEqual(Date.now());
    });
  });
});

describe('consumeOpenRequest 格式兼容（经 recordSidepanelOpenMetrics 观察）', () => {
  it('新格式 { at, trigger }：正确计算 clickToDocMs 并归因触发源', async () => {
    // at 早于 timeOrigin 100ms，落在 [0, 60s) 有效窗口内
    await chrome.storage.session.set({
      [OPEN_KEY]: { at: performance.timeOrigin - 100, trigger: 'shortcut' },
    });

    const record = await recordAndGetLatest();

    expect(record.trigger).toBe('shortcut');
    expect(record.clickToDocMs).toBeGreaterThanOrEqual(0);
    expect(record.clickToDocMs).toBeLessThan(60000);
  });

  it('旧版纯 number 格式：clickToDocMs 可算，trigger 为 null（升级瞬间残留兼容）', async () => {
    await chrome.storage.session.set({ [OPEN_KEY]: performance.timeOrigin - 50 });

    const record = await recordAndGetLatest();

    expect(record.trigger).toBeNull();
    expect(record.clickToDocMs).toBeGreaterThanOrEqual(0);
    expect(record.clickToDocMs).toBeLessThan(60000);
  });

  it('超出 60s 窗口的陈旧记录：clickToDocMs 判定无效为 null，trigger 仍归因', async () => {
    await chrome.storage.session.set({
      [OPEN_KEY]: { at: performance.timeOrigin - 120000, trigger: 'popup' },
    });

    const record = await recordAndGetLatest();

    expect(record.clickToDocMs).toBeNull();
    expect(record.trigger).toBe('popup');
  });

  it('未来时间戳（负 delta）：clickToDocMs 为 null', async () => {
    await chrome.storage.session.set({
      [OPEN_KEY]: { at: performance.timeOrigin + 5000, trigger: 'content' },
    });

    const record = await recordAndGetLatest();

    expect(record.clickToDocMs).toBeNull();
  });

  it('畸形对象（缺 at 字段）：安全降级为 null/null，不产生 NaN', async () => {
    await chrome.storage.session.set({ [OPEN_KEY]: { trigger: 'float' } });

    const record = await recordAndGetLatest();

    expect(record.clickToDocMs).toBeNull();
    expect(record.trigger).toBeNull();
  });

  it('无打开请求记录（直接刷新侧边栏）：clickToDocMs 与 trigger 均为 null', async () => {
    const record = await recordAndGetLatest();

    expect(record.clickToDocMs).toBeNull();
    expect(record.trigger).toBeNull();
  });

  it('读后即删：记录被消耗后 session 键清除，下次打开不受陈旧值污染', async () => {
    await chrome.storage.session.set({
      [OPEN_KEY]: { at: performance.timeOrigin - 100, trigger: 'float' },
    });

    await recordAndGetLatest();

    await vi.waitFor(async () => {
      const result = await chrome.storage.session.get(OPEN_KEY);
      expect(result[OPEN_KEY]).toBeUndefined();
    });

    // 第二次记录不再携带上一次的触发源
    const second = await recordAndGetLatest();
    expect(second.trigger).toBeNull();
    expect(second.clickToDocMs).toBeNull();
  });
});

describe('recordSidepanelOpenMetrics 环形缓冲', () => {
  it('写入后截断至最近 20 条（最新记录保留在尾部，淘汰最旧一条）', async () => {
    // 预置 20 条占位记录（ts=0..19，仅需 ts 字段参与断言），已达上限
    const stale = Array.from({ length: 20 }, (_, i) => ({ ts: i }) as SidepanelOpenMetrics);
    await chrome.storage.local.set({ [LOG_KEY]: stale });

    const before = Date.now();
    recordSidepanelOpenMetrics(BASE_META);

    // 长度恒为 20（push 后截断），改为等待尾部出现真实时间戳记录
    await vi.waitFor(async () => {
      const log = await getPerfLog();
      expect(log[log.length - 1].ts).toBeGreaterThanOrEqual(before);
    });

    const log = await getPerfLog();
    expect(log).toHaveLength(20);
    // 最旧一条（ts=0）被淘汰
    expect(log[0].ts).toBe(1);
  });
});
