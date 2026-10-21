/**
 * 卡片标题区点击是否应切换折叠
 *
 * 标题区整行可点，但用户在标题里拖选文字时浏览器仍会补发一次 click；
 * 若照常切换，选字就会把卡片收起。这里只拦「单击 + 选区锚点落在标题内」。
 *
 * 多击选词按连击计数放行规则处理：双击的第二次 click（`detail === 2`）放行，
 * 两次动作相互抵消；三击及以上（如三击选段）继续拦截，避免第三次 click 又把
 * 卡片折回去。`detail === 0` 是脚本/键盘等无连击语义的 click，照常放行。
 *
 * @param detail 鼠标 click 的连击计数
 * @param selection 当前文档选区
 * @param title 触发 click 的标题元素
 * @returns 是否可以执行折叠切换
 */
export function shouldToggleCollapseFromTitleClick(
  detail: number,
  selection: Selection | null,
  title: HTMLElement | null,
): boolean {
  const selectionInsideTitle =
    selection !== null &&
    !selection.isCollapsed &&
    selection.anchorNode !== null &&
    title !== null &&
    title.contains(selection.anchorNode);
  return !selectionInsideTitle || detail === 0 || detail === 2;
}
