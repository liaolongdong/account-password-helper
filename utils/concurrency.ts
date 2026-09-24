/**
 * 受限并发批处理工具
 *
 * 只服务一类场景：「一次要处理整库条目」的异步循环。串行 `for … await` 会把每次
 * 约 25～30 µs 的 `crypto.subtle` 固定调用开销乘上条目数堆成秒级（实测 N=2000
 * 整库重加密 705.0 ms，条目级并行 396.3 ms，约 1.8×，见
 * `docs/PERF_ISSUE89_DATA_LAYER_EVALUATION.md` 3.3），而一次性全并行又会在超大库上
 * 同时压入数千个任务。分批（批间串行、批内并行）是两者之间的折中。
 *
 * 纯工具，不依赖 Vue 生命周期与 Chrome API。
 *
 * @module utils/concurrency
 */

/**
 * 批内并发上限
 *
 * 64 为调参值：足以让 Web Crypto 的原生异步队列吃满（收益已接近全并行的实测值），
 * 又把同时存活的 Promise 与中间缓冲控制在常数级别。与条目字段数（5）相乘后
 * 单批在途的底层调用不超过 ~320 个。
 */
export const CONCURRENCY_BATCH_SIZE = 64;

/**
 * 以受限并发映射数组，并保持输入顺序与串行失败语义
 *
 * 与 `for (const x of items) out.push(await fn(x))` 的可观察行为等价：
 * - 输出顺序严格等于输入顺序（不随完成先后变化）；
 * - 任一元素失败即中止，抛出的是**已启动批次中下标最小**的失败原因，后续批次不再启动；
 * - 失败前的批次不产生副作用（本函数不落盘，副作用由调用方的单次写入承担）。
 *
 * 用 `allSettled` 而非 `Promise.all` 收集批内结果：后者在某一个失败后立即抛出，
 * 同批其余 rejection 便成了未处理的 Promise rejection（Node/Vitest 会报
 * `UnhandledPromiseRejection`，浏览器控制台同样噪音），而下标更小的失败原因反而可能被覆盖。
 *
 * @param items      待处理元素（只读，不被修改）
 * @param mapper     单元素异步处理函数，第二参数为其在 `items` 中的全局下标
 * @param concurrency 批内并发上限，默认 `CONCURRENCY_BATCH_SIZE`；小于 1 时按 1 处理（退化为串行）
 * @returns 与 `items` 等长、同序的结果数组
 * @throws mapper 抛出的第一个（按输入下标）错误
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number = CONCURRENCY_BATCH_SIZE,
): Promise<R[]> {
  const size = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array<R>(items.length);

  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, Math.min(start + size, items.length));
    const settled = await Promise.allSettled(batch.map((item, i) => mapper(item, start + i)));

    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failed) throw failed.reason;

    settled.forEach((s, i) => {
      results[start + i] = (s as PromiseFulfilledResult<R>).value;
    });
  }

  return results;
}
