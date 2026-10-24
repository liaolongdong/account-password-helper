import { onBeforeUnmount, shallowRef, watch } from 'vue';
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
