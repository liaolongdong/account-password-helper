import { describe, it, expect, vi } from 'vitest';
import { CONCURRENCY_BATCH_SIZE, mapWithConcurrency } from '@/utils/concurrency';

/**
 * `mapWithConcurrency` 特征化测试
 *
 * 这个助手替掉了「整库加解密」里的串行 `for … await`，因此必须锁住它承诺的
 * 三条等价性：输出顺序、失败原因选取（下标最小者）、后续批次不启动；
 * 以及它新引入的能力：批内并发受上限约束。
 *
 * @module tests/utils/concurrency
 */

/** 让每个任务按给定延时表完成，制造「后启动先完成」的乱序场景 */
function delayed(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Node 进程句柄
 *
 * tsconfig 的 `types` 只含 chrome/wxt，全局 `process` 不带类型，故按需窄化取用；
 * 运行环境为 Node（vitest 配置 `environment: 'node'`），正常情况下必然存在。
 */
interface NodeProcessLike {
  on(event: 'unhandledRejection', handler: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', handler: (reason: unknown) => void): void;
}
const nodeProcess = (globalThis as unknown as { process?: NodeProcessLike }).process;

describe('mapWithConcurrency', () => {
  it('输出顺序严格等于输入顺序（与完成先后无关）', async () => {
    const inputs = [1, 2, 3, 4, 5];
    // 第一个最慢、最后一个最快：若按完成顺序收集，结果会是逆序
    const delays = [50, 40, 30, 10, 0];

    const out = await mapWithConcurrency(
      inputs,
      async (n, i) => {
        await delayed(delays[i]);
        return n * 10;
      },
      5,
    );

    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('批内并发不超过上限，且所有元素都被处理一次', async () => {
    const inputs = Array.from({ length: 20 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];

    const out = await mapWithConcurrency(
      inputs,
      async n => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        seen.push(n);
        await delayed(1);
        inFlight -= 1;
        return n;
      },
      4,
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toEqual(inputs);
    expect(seen.sort((a, b) => a - b)).toEqual(inputs);
  });

  it('默认上限为 CONCURRENCY_BATCH_SIZE（不传参时仍受限）', async () => {
    const inputs = Array.from({ length: CONCURRENCY_BATCH_SIZE * 2 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(inputs, async n => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delayed(0);
      inFlight -= 1;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(CONCURRENCY_BATCH_SIZE);
    expect(peak).toBeGreaterThan(1);
  });

  it('同批多个失败时抛出下标最小的那个（串行 for…await 的报错口径）', async () => {
    // 若实现用 `Promise.all`（或按完成先后抛错），这里会误报 boom-2：
    // n=2 立即失败，n=1 延时后才失败，而串行版本必然先撞上 n=1。
    const mapper = vi.fn(async (n: number) => {
      await delayed(n === 1 ? 20 : 0);
      if (n === 1 || n === 2) throw new Error(`boom-${n}`);
      return n;
    });

    await expect(mapWithConcurrency([0, 1, 2], mapper, 3)).rejects.toThrow('boom-1');
  });

  it('失败后不再启动后续批次', async () => {
    const calls: number[] = [];
    const mapper = vi.fn(async (n: number) => {
      calls.push(n);
      if (n === 0) throw new Error('first-batch-failure');
      return n;
    });

    await expect(
      mapWithConcurrency(
        Array.from({ length: 10 }, (_, i) => i),
        mapper,
        3,
      ),
    ).rejects.toThrow('first-batch-failure');
    // 只跑了第一批 3 个（0/1/2），第 4 个起不应被调用
    expect(calls).toEqual([0, 1, 2]);
  });

  it('同批其余失败不会变成未处理的 Promise rejection', async () => {
    // `Promise.all` 版本在第一个失败抛出后，同批其余 rejection 无人接收，
    // Node 会发 `unhandledRejection`（Vitest 与浏览器控制台都会报噪音）。
    // 本实现用 allSettled 收齐，故监听器应一次都不触发。
    if (!nodeProcess) return;
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    nodeProcess.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        mapWithConcurrency(
          [0, 1, 2],
          async (n: number) => {
            await delayed(n === 0 ? 0 : 10);
            throw new Error(`boom-${n}`);
          },
          3,
        ),
      ).rejects.toThrow('boom-0');
      // 给 unhandledRejection 事件一个冒泡窗口
      await delayed(30);
    } finally {
      nodeProcess.off('unhandledRejection', onUnhandled);
    }
    expect(seen).toEqual([]);
  });

  it('空输入返回空数组且不调用 mapper', async () => {
    const mapper = vi.fn(async (n: number) => n);
    await expect(mapWithConcurrency<number, number>([], mapper)).resolves.toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it('上限小于 1 时退化为串行（逐个await，顺序即调用顺序）', async () => {
    const calls: number[] = [];
    const out = await mapWithConcurrency(
      [3, 1, 2],
      async n => {
        calls.push(n);
        return n * 2;
      },
      0,
    );

    expect(calls).toEqual([3, 1, 2]);
    expect(out).toEqual([6, 2, 4]);
  });

  it('不修改入参数组', async () => {
    const inputs = [5, 4, 3];
    await mapWithConcurrency(inputs, async n => n + 1);
    expect(inputs).toEqual([5, 4, 3]);
  });
});
