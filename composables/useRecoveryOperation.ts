import { onBeforeUnmount, shallowRef, watch } from 'vue';
import type { RecoveryStatus } from '@/utils/storage/recoveryTypes';
import { recoveryErrorMessage } from '@/utils/recoveryUi';

/**
 * 恢复对话框的异步边界。关闭/锁定卸载/pagehide 均清理敏感状态并作废迟到结果。
 * Web Crypto 无法中止；调用方须在每次 await 后、下一次写入前检查 isCurrent。
 *
 * @param isOpen 弹窗/视图是否仍打开，关闭后迟到结果一律丢弃
 * @param clearSecrets 清除明文输入与草稿的回调
 * @param presentError 自定义失败呈现。默认把本地化文案写进 `error`（内联告警）；
 *   改密弹窗传入自己的 toast 分流，因为那里的失败反馈口径早于恢复功能存在，
 *   换成内联文案会改变既有交互。
 */
export function useRecoveryOperation(
  isOpen: () => boolean,
  clearSecrets: () => void,
  presentError?: (cause: unknown) => void,
) {
  const busy = shallowRef(false);
  const error = shallowRef('');
  let epoch = 0;
  let disposed = false;

  const reportError = (cause: unknown): void => {
    if (presentError) {
      presentError(cause);
      return;
    }
    error.value = recoveryErrorMessage(cause);
  };

  const invalidate = (): void => {
    epoch++;
    error.value = '';
    clearSecrets();
  };

  const run = async (operation: (isCurrent: () => boolean) => Promise<void>): Promise<void> => {
    if (busy.value || disposed || !isOpen()) return;
    const token = epoch;
    const isCurrent = () => !disposed && isOpen() && token === epoch;
    busy.value = true;
    error.value = '';
    try {
      await operation(isCurrent);
    } catch (cause: unknown) {
      if (isCurrent()) reportError(cause);
    } finally {
      busy.value = false;
    }
  };

  watch(
    isOpen,
    open => {
      if (!open) invalidate();
    },
    { flush: 'sync' },
  );
  window.addEventListener('pagehide', invalidate);
  onBeforeUnmount(() => {
    disposed = true;
    invalidate();
    window.removeEventListener('pagehide', invalidate);
  });
  return { busy, error, run, invalidate };
}

/** `useRecoveryOperation().run` 的签名，供下面的读取入口按类型接住 */
export type RecoveryRun = (operation: (isCurrent: () => boolean) => Promise<void>) => Promise<void>;

/**
 * 读取「当前离线恢复套件状态」——恢复设置弹窗与找回重置弹窗的入口都要先知道有没有启用、有没有坏记录。
 *
 * 抽出来的不是那四行排版，而是 `await import()` **前后各一次** `isCurrent()` 这道双闸：动态 import
 * 本身是一段可观的等待，少了后面那道，弹窗已经关闭或重新打开之后，上一轮读数仍会写进这只 ref，
 * 界面便按过期状态渲染（`enabled` 与 `corrupted` 直接决定入口按钮的文案与去向）。
 * 两处拷贝各自演化时最容易丢的就是它，所以收进一个函数并由单测钉住，而不是靠人记住。
 *
 * 状态所有权仍归调用方组件：这里只接管「怎么读」，不接管「读到的东西放哪」。
 *
 * @param run 调用方自己的 `run`，按钮禁用、错误呈现与迟到作废口径随各弹窗，不在此统一
 * @param target 状态落点（组件里那只 `shallowRef`）
 */
export function loadRecoveryStatus(run: RecoveryRun, target: { value: RecoveryStatus | null }): Promise<void> {
  return run(async isCurrent => {
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent()) return;
    const result = await api.getRecoveryStatus();
    if (isCurrent()) target.value = result;
  });
}
