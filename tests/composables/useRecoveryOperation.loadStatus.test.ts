/**
 * `loadRecoveryStatus` 的迟到作废判据
 *
 * 两个恢复弹窗（设置 / 找回重置）此前各写一份完全相同的读取逻辑，2026-10-26 收成为这一个函数。
 * 值得钉住的不是「读到了就写进 ref」，而是**两段等待各自后面那道 `isCurrent()`**：
 * `import()` 与 `getRecoveryStatus()` 都是可观的异步窗口，用户在此期间关掉弹窗、或弹窗关闭后重开，
 * 上一轮的读数如果还能落进这只 ref，界面就会按过期状态渲染——而 `enabled` / `corrupted`
 * 直接决定入口按钮的文案与去向（创建 / 换发 / 走重置）。
 *
 * 口径边界：这里的 `run` 是替身，只负责把「是否仍然当前」传进来；真实的按钮禁用、错误呈现与
 * epoch 递增仍由 `useRecoveryOperation` 自己的用例覆盖（`tests/components/recoveryFlow.dom.test.ts`）。
 * 反向取证：删掉任一道 `isCurrent()`，对应的「迟到」用例必须变红。
 */
import { describe, expect, it, vi } from 'vitest';
import type { RecoveryStatus } from '@/utils/storage/recoveryTypes';
import { loadRecoveryStatus, type RecoveryRun } from '@/composables/useRecoveryOperation';

vi.mock('@/utils/storage/recovery', () => ({
  getRecoveryStatus: vi.fn(),
}));

const { getRecoveryStatus } = await import('@/utils/storage/recovery');

/** 一条「当前仍有效」的可控开关：置为 false 等价于弹窗在这两段等待之间被关闭 */
function controllableRun(): { run: RecoveryRun; invalidate: () => void } {
  let current = true;
  return {
    run: async operation => {
      await operation(() => current);
    },
    invalidate: () => {
      current = false;
    },
  };
}

const STATUS: RecoveryStatus = { enabled: true, corrupted: false, config: null };

describe('loadRecoveryStatus 的迟到作废', () => {
  it('仍在当前会话内：读到的状态写进落点', async () => {
    vi.mocked(getRecoveryStatus).mockResolvedValueOnce(STATUS);
    const { run } = controllableRun();
    const target: { value: RecoveryStatus | null } = { value: null };

    await loadRecoveryStatus(run, target);

    expect(target.value).toEqual(STATUS);
  });

  it('动态 import 期间失效：连解密入口都不碰', async () => {
    vi.mocked(getRecoveryStatus).mockClear();
    const { run, invalidate } = controllableRun();
    const target: { value: RecoveryStatus | null } = { value: null };
    // import() 之后、取状态之前翻掉「当前」标记
    const load = loadRecoveryStatus(run, target);
    invalidate();
    await load;

    expect(getRecoveryStatus).not.toHaveBeenCalled();
    expect(target.value).toBeNull();
  });

  /**
   * 这一条是两份拷贝最容易各丢一半的地方：状态已经取到手，但等待期间弹窗被关过。
   * 少了取回之后的那道 `isCurrent()`，过期读数照样落进 ref，界面上「已启用 / 已损坏」按旧值渲染。
   */
  it('取到状态之后才失效：过期读数不得写进落点', async () => {
    const { run, invalidate } = controllableRun();
    let settle!: (value: RecoveryStatus) => void;
    vi.mocked(getRecoveryStatus).mockImplementationOnce(
      () => new Promise<RecoveryStatus>(resolve => (settle = resolve)),
    );
    const target: { value: RecoveryStatus | null } = { value: null };

    const load = loadRecoveryStatus(run, target);
    await vi.waitFor(() => expect(getRecoveryStatus).toHaveBeenCalledTimes(1));
    invalidate();
    settle(STATUS);
    await load;

    expect(target.value, '弹窗已失效，读数仍被写进去——恢复入口会按过期状态渲染').toBeNull();
  });

  it('同一只 ref 可被再次读取覆盖（重开弹窗后按最新读数渲染）', async () => {
    const { run } = controllableRun();
    const target: { value: RecoveryStatus | null } = { value: null };
    vi.mocked(getRecoveryStatus).mockResolvedValueOnce(STATUS);
    await loadRecoveryStatus(run, target);
    const refreshed: RecoveryStatus = { enabled: false, corrupted: true, config: null };
    vi.mocked(getRecoveryStatus).mockResolvedValueOnce(refreshed);

    await loadRecoveryStatus(run, target);

    expect(target.value).toEqual(refreshed);
  });
});
