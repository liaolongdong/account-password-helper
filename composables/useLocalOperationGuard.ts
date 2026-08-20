import { ref } from 'vue';

/**
 * 本地操作守卫 Composable
 *
 * 提供 `isLocalOperation` 标志与 `runLocalOperation` 包裹函数，
 * 用于防止 storage watcher 在本地操作（收藏/填充/编辑等）期间触发全量 loadPasswords。
 *
 * 原理：本地操作已在 Vue 层就地更新状态，无需 storage watcher 再触发全量重载。
 * 设置 `isLocalOperation` 标志后，storage watcher 会跳过变更回调，避免 loading 闪烁
 * 和全量替换数组引用。延迟清除标志使用 `setTimeout(0)` 确保覆盖 `chrome.storage.onChanged`
 * 的异步派发时序。
 *
 * 使用场景：
 * - Options 页面 `usePasswordManagement`（编辑/收藏/删除/批量操作等）
 * - Sidepanel `useSidepanelData`（收藏/填充更新时间戳等）
 *
 * @returns `isLocalOperation` 只读标志与 `runLocalOperation` 包裹函数
 */
export function useLocalOperationGuard() {
  /** 本地操作进行中标志，供 storage watcher 读取以决定是否跳过本轮重载 */
  const isLocalOperation = ref(false);

  /**
   * 包裹本地 storage 写入操作，设置标志位防止 storage watcher 重复触发 loadPasswords
   *
   * 延迟清除标志使用 `setTimeout(0)` 确保覆盖 `chrome.storage.onChanged` 的异步派发时序：
   * `chrome.storage.onChanged` 在当前微任务之后派发，`setTimeout(0)` 将清除推迟到下一个宏任务，
   * 确保事件处理时标志仍为 true。
   *
   * @param fn 包含 storage 写入的异步操作
   */
  const runLocalOperation = async (fn: () => Promise<void>) => {
    isLocalOperation.value = true;
    try {
      await fn();
    } finally {
      // 延迟清除标志：chrome.storage.onChanged 在当前微任务之后派发，
      // setTimeout(0) 将清除推迟到下一个宏任务，确保事件处理时标志仍为 true
      setTimeout(() => {
        isLocalOperation.value = false;
      }, 0);
    }
  };

  return { isLocalOperation, runLocalOperation };
}
