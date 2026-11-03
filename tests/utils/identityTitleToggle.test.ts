/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { shouldToggleCollapseFromTitleClick } from '@/utils/identity/titleToggle';

/** 造一个标题节点并挂进文档，让 Selection 的 anchorNode 有真实容器可选 */
function makeTitle(text: string): HTMLElement {
  const title = document.createElement('div');
  title.textContent = text;
  document.body.appendChild(title);
  return title;
}

/** 把选区锚点放进指定元素 */
function selectInside(element: HTMLElement): Selection {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (!selection) throw new Error('jsdom 没有 Selection，选区判据无从载体');
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('shouldToggleCollapseFromTitleClick', () => {
  it('普通单击（选区折叠）放行', () => {
    const title = makeTitle('张三');
    expect(shouldToggleCollapseFromTitleClick(1, window.getSelection(), title)).toBe(true);
  });

  it('单击且选区落在标题内时拦截，避免拖选文字把卡片收起', () => {
    const title = makeTitle('张三');
    const selection = selectInside(title);
    expect(shouldToggleCollapseFromTitleClick(1, selection, title)).toBe(false);
  });

  it('选区落在标题外时不被误拦', () => {
    const title = makeTitle('张三');
    const other = makeTitle('另一个节点');
    const selection = selectInside(other);
    expect(shouldToggleCollapseFromTitleClick(1, selection, title)).toBe(true);
  });

  it('双击的第二次 click 放行：第一次折叠、第二次切回，净状态不变', () => {
    const title = makeTitle('张三');
    const selection = selectInside(title);
    expect(shouldToggleCollapseFromTitleClick(2, selection, title)).toBe(true);
  });

  it('三击选段继续拦截：前两次已互相抵消，第三次不得把卡片折回去', () => {
    const title = makeTitle('张三');
    const selection = selectInside(title);
    expect(shouldToggleCollapseFromTitleClick(3, selection, title)).toBe(false);
  });

  it('无连击语义的 click（detail 0）放行', () => {
    const title = makeTitle('张三');
    const selection = selectInside(title);
    expect(shouldToggleCollapseFromTitleClick(0, selection, title)).toBe(true);
  });

  it('取不到选区或标题节点时安全放行，不让增强交互把主操作卡死', () => {
    expect(shouldToggleCollapseFromTitleClick(1, null, makeTitle('张三'))).toBe(true);
    expect(shouldToggleCollapseFromTitleClick(1, selectInside(makeTitle('张三')), null)).toBe(true);
  });
});
