/** @vitest-environment jsdom */

/**
 * 密码历史读取的代际守卫回归测试（composables/usePasswordHistory.ts）
 *
 * 弹窗会来回开关，也会在旧读取还没回来时就换到另一条条目。此前 `loadHistory`
 * 没有任何"我还是不是最新一次"的判断，晚完成的旧读取会照常提交，于是：
 * 当前条目的历史被上一条目的结果盖掉，被取代的那次还会顺手熄灭新读取的加载遮罩，
 * 关闭弹窗后晚到的结果又把列表填回已关闭的界面。
 *
 * 本文件钉住五条：最新者胜、异常同样受序、resetHistory 作废在飞读取、
 * 空 id 短路既不发起读取也不留遮罩、以及**空闲快路径不退化**（守卫不能把正常的单次读取也拦掉）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePasswordHistory } from '@/composables/usePasswordHistory';
import { getPasswordHistory } from '@/utils/storage/passwordHistory';
import { logger } from '@/utils/logger';

vi.mock('@/utils/storage/passwordHistory', () => ({ getPasswordHistory: vi.fn() }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

/** 手动可控的 promise，用来把「读取在飞」这个时间窗摊开到断言之间 */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** 造一条历史记录（只关心 changedAt 的可辨认性） */
const record = (changedAt: number) => ({ password: `cipher-${changedAt}`, changedAt }) as never;

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('usePasswordHistory 的读取代际', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('最新一次读取落地，被取代的旧读取既不盖结果也不熄灯', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    vi.mocked(getPasswordHistory)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);

    const { historyList, historyLoading, loadHistory } = usePasswordHistory();
    void loadHistory('a');
    void loadHistory('b');
    await flush();

    expect(historyLoading.value).toBe(true);

    // 先回答新的一次（b），再让旧的一次（a）迟到完成
    second.resolve([record(2)]);
    await flush();
    expect(historyList.value.map(item => item.changedAt)).toEqual([2]);
    expect(historyLoading.value).toBe(false);

    first.resolve([record(1)]);
    await flush();
    expect(historyList.value.map(item => item.changedAt)).toEqual([2]);
    expect(historyLoading.value).toBe(false);
  });

  it('被取代的旧读取即使失败，也不写列表、不记日志', async () => {
    const first = deferred<unknown[]>();
    vi.mocked(getPasswordHistory)
      .mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce([record(9)] as never);

    const { historyList, loadHistory } = usePasswordHistory();
    void loadHistory('a');
    await loadHistory('b');
    first.reject(new Error('存储读挂了'));
    await flush();

    expect(historyList.value.map(item => item.changedAt)).toEqual([9]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('resetHistory 清空列表并作废在飞读取', async () => {
    const pending = deferred<unknown[]>();
    vi.mocked(getPasswordHistory).mockReturnValueOnce(pending.promise as never);

    const { historyList, historyLoading, loadHistory, resetHistory } = usePasswordHistory();
    void loadHistory('a');
    await flush();
    expect(historyLoading.value).toBe(true);

    resetHistory();
    expect(historyList.value).toEqual([]);
    expect(historyLoading.value).toBe(false);

    pending.resolve([record(1)]);
    await flush();
    expect(historyList.value).toEqual([]);
    expect(historyLoading.value).toBe(false);
  });

  it('空 id 短路不发起读取，并熄掉被取代的在飞读取的遮罩', async () => {
    const pending = deferred<unknown[]>();
    vi.mocked(getPasswordHistory).mockReturnValueOnce(pending.promise as never);

    const { historyList, historyLoading, loadHistory } = usePasswordHistory();
    void loadHistory('a');
    await flush();
    expect(historyLoading.value).toBe(true);

    await loadHistory('');
    expect(historyList.value).toEqual([]);
    // 空 id 这一路已是最新一次：它不熄灯的话，遮罩就永久停在这（被取代的在飞读取
    // 再也不会走自己的 finally）
    expect(historyLoading.value).toBe(false);
    // 空 id 只推进序号，不该真的去读存储
    expect(getPasswordHistory).toHaveBeenCalledTimes(1);

    pending.resolve([record(7)]);
    await flush();
    expect(historyList.value).toEqual([]);
    expect(historyLoading.value).toBe(false);
  });

  it('单次正常读取照常落地（守卫不得把快路径也拦掉）', async () => {
    vi.mocked(getPasswordHistory).mockResolvedValue([record(3), record(4)] as never);
    const { historyList, historyLoading, loadHistory } = usePasswordHistory();

    await loadHistory('a');
    expect(historyList.value.map(item => item.changedAt)).toEqual([3, 4]);
    expect(historyList.value.every(item => !item.loading)).toBe(true);
    expect(historyLoading.value).toBe(false);
  });

  it('最新一次读取失败时清空列表并记日志', async () => {
    vi.mocked(getPasswordHistory).mockRejectedValueOnce(new Error('读挂了'));
    const { historyList, historyLoading, loadHistory } = usePasswordHistory();

    await loadHistory('a');
    expect(historyList.value).toEqual([]);
    expect(historyLoading.value).toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
