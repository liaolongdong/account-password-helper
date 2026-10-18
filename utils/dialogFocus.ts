/**
 * Element Plus 弹窗内的自动聚焦时序
 *
 * 弹窗打开时，focus-trap 会在微任务里把焦点移到 `.el-dialog` 容器（实测 activeElement
 * 落在 `div.el-dialog`），同一 tick 内的 `nextTick` 聚焦会被覆盖，用户必须先点一下输入框。
 * 延后到宏任务执行，确保晚于 focus-trap 接管。
 *
 * @param focus 聚焦动作，例如 `() => inputRef.value?.focus()`
 */
export function focusAfterDialogOpen(focus: () => void): void {
  setTimeout(focus, 0);
}
