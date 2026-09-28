import { onScopeDispose, ref } from 'vue';

/**
 * 本地操作守卫的最长武装时间（毫秒）
 *
 * 守卫正常由「本次写入对应的 storage 变更事件到达」解除（见 `consumeLocalOperation`）。
 * 该上限只覆盖没有对应事件的异常路径（写入未落存储、事件被浏览器合并等），
 * 兜底避免守卫长期挂起而持续跳过其他上下文的刷新；取值需同时大于两个下界：
 * 大列表单次重渲染的耗时（慢渲染会把事件推到上限之后，退化成「仍然全量重载」），
 * 以及 SidePanel 元数据写入的 1.5 秒防抖合并窗口（`passwordCrud.ts` 的
 * `METADATA_FLUSH_DELAY_MS`）——收藏/填充的存储写入要等那次 flush 才派发事件。
 */
const LOCAL_OPERATION_ARM_MS = 2000;

/**
 * 本地操作守卫 Composable
 *
 * 提供 `isLocalOperation` 标志与 `runLocalOperation` 包裹函数，
 * 用于防止 storage watcher 在本地操作（收藏/填充/编辑等）期间触发全量 loadPasswords。
 *
 * 原理：本地操作已在 Vue 层就地更新状态，无需 storage watcher 再触发全量重载。
 * 设置 `isLocalOperation` 标志后，storage watcher 会跳过变更回调，避免 loading 闪烁
 * 和全量替换数组引用。
 *
 * 解除时机是这里的唯一难点：`chrome.storage.onChanged` 经浏览器进程派发到本渲染进程，
 * 在本上下文被大列表重渲染占住时可能晚到数十毫秒以上，因此**不能**用固定宏任务清除
 * （旧实现 `setTimeout(0)` 会在事件到达前失效，一次保存仍会触发整表全量重载）。
 * 现改为事件驱动：watcher 因该标志跳过一次密码变更后调用 `consumeLocalOperation` 解除，
 * 并保留 `LOCAL_OPERATION_ARM_MS` 兜底上限。
 *
 * 使用场景：
 * - Options 页面 `usePasswordManagement`（编辑/收藏/删除/批量操作等）
 * - Sidepanel `useSidepanelData`（收藏/填充更新时间戳等）
 *
 * @returns `isLocalOperation` 标志、`runLocalOperation` 包裹函数与 `consumeLocalOperation` 解除函数
 */
export function useLocalOperationGuard() {
  /** 本地操作进行中标志，供 storage watcher 读取以决定是否跳过本轮重载 */
  const isLocalOperation = ref(false);

  /** 兜底解除定时器（每次武装重新计时，解除与作用域销毁时清理） */
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  /** 解除守卫：清定时器并把标志落回 false */
  const consumeLocalOperation = () => {
    clearTimeout(armTimer);
    armTimer = undefined;
    isLocalOperation.value = false;
  };

  /**
   * 包裹本地 storage 写入操作，设置标志位防止 storage watcher 重复触发 loadPasswords
   *
   * 成功后保持武装，交由本次写入对应的 storage 变更事件（或其后的任一事件）解除；
   * 抛错说明没有落存储的写入，立即解除，避免把其他上下文的刷新一并吞掉。
   *
   * @param fn 包含 storage 写入的异步操作
   */
  const runLocalOperation = async (fn: () => Promise<void>) => {
    isLocalOperation.value = true;
    clearTimeout(armTimer);
    armTimer = setTimeout(consumeLocalOperation, LOCAL_OPERATION_ARM_MS);
    try {
      await fn();
    } catch (error) {
      consumeLocalOperation();
      throw error;
    }
  };

  // 作用域销毁时清理兜底定时器，避免向已停用作用域赋值
  onScopeDispose(() => {
    clearTimeout(armTimer);
    armTimer = undefined;
  });

  return { isLocalOperation, runLocalOperation, consumeLocalOperation };
}
