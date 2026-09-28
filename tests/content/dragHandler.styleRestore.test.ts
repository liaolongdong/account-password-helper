/** @vitest-environment jsdom */

/**
 * 拖拽期间对宿主页面样式覆盖的回收测试（DragHandler）
 *
 * 回归背景：拖拽首帧会覆盖 `document.body` 的 overflow/userSelect/cursor，并把页面上所有
 * iframe 的 pointer-events 置为 none，结束时无条件回写成 `''`。
 * 站点自己的模态框常用 `body{overflow:hidden}` 锁滚动、也常用内联样式固定光标与
 * 禁用选中，写死 `''` 会把站点的设置一并清掉；iframe 一侧本就已在拖拽开始时记录原值，
 * 唯独 body 一侧丢了原值。
 * 另外 `destroy()` 只解绑监听、不回收覆盖：拖拽途中被销毁（配置变更触发的重建）会把页面
 * 永久留在不可滚动、iframe 忽略鼠标的状态。
 *
 * 修复后：覆盖前先快照 body 的内联原值，结束与销毁都按快照回写。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragHandler } from '@/entrypoints/content/floatingButtons/DragHandler';
import type { AnimationController } from '@/entrypoints/content/floatingButtons/AnimationController';

describe('DragHandler 拖拽样式回收', () => {
  let container: HTMLElement;
  let buttonGroup: HTMLElement;
  let dragButton: HTMLElement;
  let snapLeft: HTMLElement;
  let snapRight: HTMLElement;
  let iframe: HTMLIFrameElement;
  let handler: DragHandler;

  const stubAnimation = (): AnimationController =>
    ({
      setDragging: vi.fn(),
      updateDragPosition: vi.fn(),
      resetDragPosition: vi.fn(),
      expand: vi.fn(async () => undefined),
      snapToEdge: vi.fn(async () => undefined),
    }) as unknown as AnimationController;

  /** 越过 10px 阈值起拖，然后在 (x, y) 松手 */
  const dragTo = (x: number, y: number): void => {
    dragButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
  };

  /** endDrag 内部 await 动画控制器，等微任务队列跑完 */
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.cssText = '';
    container = document.createElement('div');
    container.setAttribute('data-position', 'right');
    buttonGroup = document.createElement('div');
    dragButton = document.createElement('div');
    snapLeft = document.createElement('div');
    snapRight = document.createElement('div');
    container.append(buttonGroup, dragButton, snapLeft, snapRight);
    document.body.appendChild(container);

    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    handler = new DragHandler({
      container,
      buttonGroup,
      dragButton,
      animationController: stubAnimation(),
      snapPreviewLeft: snapLeft,
      snapPreviewRight: snapRight,
    });
  });

  afterEach(() => {
    handler.destroy();
    document.body.innerHTML = '';
    document.body.style.cssText = '';
  });

  it('拖拽结束把 body 内联样式还原成站点自己的值，而不是清空', async () => {
    // 站点此处已锁滚动、固定光标、禁用选中（模态框常用组合）
    document.body.style.overflow = 'hidden';
    document.body.style.cursor = 'progress';
    document.body.style.userSelect = 'text';
    iframe.style.pointerEvents = 'none';

    dragButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
    // 拖拽期间仍按覆盖态工作
    expect(document.body.style.cursor).toBe('move');
    expect(document.body.style.overflow).toBe('hidden');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 300, clientY: 300 }));
    await flush();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.cursor).toBe('progress');
    expect(document.body.style.userSelect).toBe('text');
    expect(iframe.style.pointerEvents).toBe('none');
  });

  it('站点未设置内联样式时，拖拽结束恢复为无覆盖', async () => {
    dragTo(300, 300);
    await flush();

    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(iframe.style.pointerEvents).toBe('');
  });

  it('拖拽途中销毁同样回收 body 与 iframe 覆盖', () => {
    document.body.style.overflow = 'hidden';
    document.body.style.userSelect = 'text';
    iframe.style.pointerEvents = 'none';

    dragButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
    expect(handler.isDragging()).toBe(true);

    handler.destroy();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.userSelect).toBe('text');
    expect(iframe.style.pointerEvents).toBe('none');
  });
});
