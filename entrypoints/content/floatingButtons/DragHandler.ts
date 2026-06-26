/**
 * 拖拽处理器 - 处理悬浮按钮的拖拽交互
 */

import { AnimationController } from '@/entrypoints/content/floatingButtons/AnimationController';
import type { DragState, DragHandlerOptions } from '@/entrypoints/content/floatingButtons/types';
import { logger } from '@/utils/logger';

export class DragHandler {
  private container: HTMLElement;
  private buttonGroup: HTMLElement;
  private dragButton: HTMLElement;
  private animationController: AnimationController;
  private snapPreviewLeft: HTMLElement;
  private snapPreviewRight: HTMLElement;
  private onDragEndCallback?: (position: 'left' | 'right', offsetY: number) => void;
  private dragThreshold: number;

  // 标记本次操作是否真正发生了拖拽，用于防止拖拽结束后误触发点击
  private hasDragged: boolean = false;

  /** 拖拽期间保存的 iframe 原始 pointer-events 值，用于拖拽结束后恢复 */
  private iframePointerEvents: Map<HTMLIFrameElement, string> = new Map();

  private state: DragState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    initialPosition: 'right',
    initialOffsetY: 0,
    mouseOffsetX: 0,
    mouseOffsetY: 0,
  };

  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;
  private boundHandleTouchMove: (e: TouchEvent) => void;
  private boundHandleTouchEnd: (e: TouchEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleTouchStart: (e: TouchEvent) => void;

  constructor(options: DragHandlerOptions) {
    this.container = options.container;
    this.buttonGroup = options.buttonGroup;
    this.dragButton = options.dragButton;
    this.animationController = options.animationController;
    this.snapPreviewLeft = options.snapPreviewLeft;
    this.snapPreviewRight = options.snapPreviewRight;
    this.onDragEndCallback = options.onDragEnd;
    // 增加拖拽阈值到10px，避免误触
    this.dragThreshold = options.dragThreshold ?? 10;

    // 绑定事件处理函数
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    this.boundHandleTouchMove = this.handleTouchMove.bind(this);
    this.boundHandleTouchEnd = this.handleTouchEnd.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleTouchStart = this.handleTouchStart.bind(this);

    this.init();
  }

  /**
   * 初始化拖拽事件监听
   */
  private init(): void {
    // 鼠标事件
    this.dragButton.addEventListener('mousedown', this.boundHandleMouseDown);

    // 触摸事件
    this.dragButton.addEventListener('touchstart', this.boundHandleTouchStart, {
      passive: false,
    });
  }

  /**
   * 获取当前位置
   */
  getCurrentPosition(): 'left' | 'right' {
    return (this.container.getAttribute('data-position') as 'left' | 'right') || 'right';
  }

  /**
   * 设置初始偏移量
   */
  setInitialOffsetY(offsetY: number): void {
    this.state.initialOffsetY = offsetY;
  }

  /**
   * 处理鼠标按下
   */
  private handleMouseDown(e: MouseEvent): void {
    // 阻止默认行为和冒泡
    e.preventDefault();
    e.stopPropagation();

    this.startDrag(e.clientX, e.clientY);

    // 添加全局事件监听
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
  }

  /**
   * 处理鼠标移动
   */
  private handleMouseMove(e: MouseEvent): void {
    e.preventDefault();
    this.updateDrag(e.clientX, e.clientY);
  }

  /**
   * 处理鼠标释放
   */
  private handleMouseUp(e: MouseEvent): void {
    e.preventDefault();
    this.endDrag();

    // 移除全局事件监听
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);

    // 无论是否实际拖拽（包括点击后未移动的情况），都需恢复 iframe pointer-events
    this.restoreIframePointerEvents();
  }

  /**
   * 处理触摸开始
   */
  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;

    e.preventDefault();
    const touch = e.touches[0];
    this.startDrag(touch.clientX, touch.clientY);

    // 添加全局事件监听
    document.addEventListener('touchmove', this.boundHandleTouchMove, { passive: false });
    document.addEventListener('touchend', this.boundHandleTouchEnd);
  }

  /**
   * 处理触摸移动
   */
  private handleTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 1) return;

    e.preventDefault();
    const touch = e.touches[0];
    this.updateDrag(touch.clientX, touch.clientY);
  }

  /**
   * 处理触摸结束
   */
  private handleTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this.endDrag();

    // 移除全局事件监听
    document.removeEventListener('touchmove', this.boundHandleTouchMove);
    document.removeEventListener('touchend', this.boundHandleTouchEnd);

    // 无论是否实际拖拽，都需恢复 iframe pointer-events
    this.restoreIframePointerEvents();
  }

  /**
   * 开始拖拽
   */
  private startDrag(x: number, y: number): void {
    // 重置拖拽标记
    this.hasDragged = false;

    this.state.startX = x;
    this.state.startY = y;
    this.state.currentX = x;
    this.state.currentY = y;
    this.state.initialPosition = this.getCurrentPosition();

    // 获取当前容器的位置，计算鼠标相对按钮中心的偏移
    const rect = this.container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    this.state.initialOffsetY = rect.top + rect.height / 2 - viewportHeight / 2;

    // 计算鼠标点击位置与按钮中心的偏移（用于保持鼠标在按钮中心）
    const buttonRect = this.dragButton.getBoundingClientRect();
    this.state.mouseOffsetX = x - (buttonRect.left + buttonRect.width / 2);
    this.state.mouseOffsetY = y - (buttonRect.top + buttonRect.height / 2);

    // 立即禁用页面中所有 iframe 的 pointer-events，防止 iframe 捕获后续 mousemove 事件
    // 必须在 mousedown 阶段就执行，否则鼠标一旦移入 iframe 区域，
    // 顶层 document 的 mousemove 事件就停止触发，导致阈值永远达不到、拖拽卡死
    this.disableIframePointerEvents();
  }

  /**
   * 更新拖拽
   */
  private updateDrag(x: number, y: number): void {
    const deltaX = x - this.state.startX;
    const deltaY = y - this.state.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 检查是否超过拖拽阈值
    if (!this.state.isDragging && distance < this.dragThreshold) {
      return;
    }

    // 首次超过阈值，开始拖拽
    if (!this.state.isDragging) {
      this.state.isDragging = true;
      // 标记已发生拖拽，用于防止拖拽结束后误触发点击
      this.hasDragged = true;

      // 关键修复：同步设置拖拽状态，立即隐藏其他按钮
      // 不使用 await，确保 CSS 状态立即生效
      this.animationController.setDragging(true);

      // 禁用页面滚动，设置拖拽光标
      document.body.style.overflow = 'hidden';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'move';
    }

    this.state.currentX = x;
    this.state.currentY = y;

    // 让按钮中心跟随鼠标：把点击时与中心的偏移量补偿回去
    const correctedDeltaX = deltaX + this.state.mouseOffsetX;
    const correctedDeltaY = deltaY + this.state.mouseOffsetY;

    // 更新按钮位置（仅使用鼠标移动的差值，不叠加初始偏移）
    this.animationController.updateDragPosition(correctedDeltaX, correctedDeltaY);

    // 更新吸附预览
    this.updateSnapPreview(x);
  }

  /**
   * 结束拖拽
   */
  private async endDrag(): Promise<void> {
    if (!this.state.isDragging) {
      return;
    }

    this.state.isDragging = false;

    // 隐藏吸附预览
    this.hideSnapPreview();

    // 恢复页面滚动和光标
    document.body.style.overflow = '';
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    // 计算拖拽距离
    const deltaX = this.state.currentX - this.state.startX;
    const deltaY = this.state.currentY - this.state.startY;
    const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 如果拖拽距离太小，视为点击而非拖拽
    if (dragDistance < this.dragThreshold) {
      logger.debug('FloatingButtonManager: 拖拽距离过小，视为点击');
      // 不执行吸附动画，直接展开按钮组
      this.animationController.resetDragPosition();
      await this.animationController.expand();
      return;
    }

    // 计算目标位置
    const targetPosition = this.calculateSnapTarget();
    const targetOffsetY = this.calculateTargetOffsetY();

    // 执行吸附动画
    this.animationController.resetDragPosition();
    await this.animationController.snapToEdge(targetPosition, targetOffsetY);

    // 展开按钮组
    await this.animationController.expand();

    // 触发回调
    this.onDragEndCallback?.(targetPosition, targetOffsetY);

    // 延时重置拖拽标记，防止拖拽结束后立即触发点击事件
    setTimeout(() => {
      this.hasDragged = false;
    }, 200);
  }

  /**
   * 计算吸附目标
   */
  private calculateSnapTarget(): 'left' | 'right' {
    const viewportWidth = window.innerWidth;
    const centerX = this.state.currentX;

    return centerX < viewportWidth / 2 ? 'left' : 'right';
  }

  /**
   * 计算目标垂直偏移
   */
  private calculateTargetOffsetY(): number {
    const viewportHeight = window.innerHeight;
    const buttonGroupHeight = this.buttonGroup.offsetHeight;

    // 吸附后按钮中心应落在松手时的鼠标 Y，同样需补偿 mouseOffsetY
    let offsetY = this.state.initialOffsetY + (this.state.currentY - this.state.startY) + this.state.mouseOffsetY;

    // 限制在可视范围内
    const maxOffset = (viewportHeight - buttonGroupHeight) / 2 - 20;
    offsetY = Math.max(-maxOffset, Math.min(maxOffset, offsetY));

    return offsetY;
  }

  /**
   * 更新吸附预览
   */
  private updateSnapPreview(x: number): void {
    const viewportWidth = window.innerWidth;

    if (x < viewportWidth / 2) {
      this.snapPreviewLeft.classList.add('visible');
      this.snapPreviewRight.classList.remove('visible');
    } else {
      this.snapPreviewLeft.classList.remove('visible');
      this.snapPreviewRight.classList.add('visible');
    }
  }

  /**
   * 隐藏吸附预览
   */
  private hideSnapPreview(): void {
    this.snapPreviewLeft.classList.remove('visible');
    this.snapPreviewRight.classList.remove('visible');
  }

  /**
   * 拖拽期间禁用页面中所有 iframe 的 pointer-events
   * 防止 iframe 捕获鼠标事件导致拖拽卡顿/按钮偏离鼠标
   */
  private disableIframePointerEvents(): void {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      this.iframePointerEvents.set(iframe, iframe.style.pointerEvents);
      iframe.style.pointerEvents = 'none';
    });
  }

  /**
   * 拖拽结束后恢复所有 iframe 的原始 pointer-events 值
   */
  private restoreIframePointerEvents(): void {
    this.iframePointerEvents.forEach((original, iframe) => {
      iframe.style.pointerEvents = original;
    });
    this.iframePointerEvents.clear();
  }

  /**
   * 检查是否正在拖拽
   */
  isDragging(): boolean {
    return this.state.isDragging;
  }

  /**
   * 检查是否刚完成拖拽（用于防止拖拽结束后误触发点击）
   */
  hasDraggedRecently(): boolean {
    return this.hasDragged;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.dragButton.removeEventListener('mousedown', this.boundHandleMouseDown);
    this.dragButton.removeEventListener('touchstart', this.boundHandleTouchStart);
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('touchmove', this.boundHandleTouchMove);
    document.removeEventListener('touchend', this.boundHandleTouchEnd);
  }
}
