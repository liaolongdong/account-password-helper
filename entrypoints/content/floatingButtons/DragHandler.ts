/**
 * 拖拽处理器 - 处理悬浮按钮的拖拽交互
 */

import { AnimationController } from './AnimationController';

export interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  initialPosition: 'left' | 'right';
  initialOffsetY: number;
}

export interface DragHandlerOptions {
  container: HTMLElement;
  buttonGroup: HTMLElement;
  dragButton: HTMLElement;
  animationController: AnimationController;
  snapPreviewLeft: HTMLElement;
  snapPreviewRight: HTMLElement;
  onDragEnd?: (position: 'left' | 'right', offsetY: number) => void;
  dragThreshold?: number;
}

export class DragHandler {
  private container: HTMLElement;
  private buttonGroup: HTMLElement;
  private dragButton: HTMLElement;
  private animationController: AnimationController;
  private snapPreviewLeft: HTMLElement;
  private snapPreviewRight: HTMLElement;
  private onDragEndCallback?: (position: 'left' | 'right', offsetY: number) => void;
  private dragThreshold: number;

  private state: DragState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    initialPosition: 'right',
    initialOffsetY: 0,
  };

  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;
  private boundHandleTouchMove: (e: TouchEvent) => void;
  private boundHandleTouchEnd: (e: TouchEvent) => void;

  constructor(options: DragHandlerOptions) {
    this.container = options.container;
    this.buttonGroup = options.buttonGroup;
    this.dragButton = options.dragButton;
    this.animationController = options.animationController;
    this.snapPreviewLeft = options.snapPreviewLeft;
    this.snapPreviewRight = options.snapPreviewRight;
    this.onDragEndCallback = options.onDragEnd;
    this.dragThreshold = options.dragThreshold ?? 5;

    // 绑定事件处理函数
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    this.boundHandleTouchMove = this.handleTouchMove.bind(this);
    this.boundHandleTouchEnd = this.handleTouchEnd.bind(this);

    this.init();
  }

  /**
   * 初始化拖拽事件监听
   */
  private init(): void {
    // 鼠标事件
    this.dragButton.addEventListener('mousedown', this.handleMouseDown.bind(this));

    // 触摸事件
    this.dragButton.addEventListener('touchstart', this.handleTouchStart.bind(this), {
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
  }

  /**
   * 开始拖拽
   */
  private startDrag(x: number, y: number): void {
    this.state.startX = x;
    this.state.startY = y;
    this.state.currentX = x;
    this.state.currentY = y;
    this.state.initialPosition = this.getCurrentPosition();

    // 获取当前容器的位置
    const rect = this.container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    this.state.initialOffsetY = rect.top + rect.height / 2 - viewportHeight / 2;
  }

  /**
   * 更新拖拽
   */
  private async updateDrag(x: number, y: number): Promise<void> {
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

      // 触发折叠动画
      await this.animationController.collapse();
      this.animationController.setDragging(true);

      // 禁用页面滚动
      document.body.style.overflow = 'hidden';
      document.body.style.userSelect = 'none';
    }

    this.state.currentX = x;
    this.state.currentY = y;

    // 更新按钮位置
    this.animationController.updateDragPosition(deltaX, deltaY + this.state.initialOffsetY);

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

    // 恢复页面滚动
    document.body.style.overflow = '';
    document.body.style.userSelect = '';

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
    const centerY = viewportHeight / 2;
    const buttonGroupHeight = this.buttonGroup.offsetHeight;

    // 计算新的偏移量
    let offsetY = this.state.currentY - centerY;

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
   * 检查是否正在拖拽
   */
  isDragging(): boolean {
    return this.state.isDragging;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.dragButton.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    this.dragButton.removeEventListener('touchstart', this.handleTouchStart.bind(this));
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('touchmove', this.boundHandleTouchMove);
    document.removeEventListener('touchend', this.boundHandleTouchEnd);
  }
}
