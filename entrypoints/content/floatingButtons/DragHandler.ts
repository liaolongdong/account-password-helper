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
  // 鼠标点击位置与按钮中心的偏移量
  mouseOffsetX: number;
  mouseOffsetY: number;
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

    // 获取当前容器的位置，计算鼠标相对按钮中心的偏移
    const rect = this.container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    this.state.initialOffsetY = rect.top + rect.height / 2 - viewportHeight / 2;

    // 计算鼠标点击位置与按钮中心的偏移（用于保持鼠标在按钮中心）
    const buttonRect = this.dragButton.getBoundingClientRect();
    this.state.mouseOffsetX = x - (buttonRect.left + buttonRect.width / 2);
    this.state.mouseOffsetY = y - (buttonRect.top + buttonRect.height / 2);
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

      // 禁用页面滚动，设置拖拽光标
      document.body.style.overflow = 'hidden';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'move';
    }

    this.state.currentX = x;
    this.state.currentY = y;

    // 使用鼠标偏移修正，确保按钮中心跟随鼠标
    const correctedDeltaX = deltaX - this.state.mouseOffsetX;
    const correctedDeltaY = deltaY - this.state.mouseOffsetY;

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
      console.log('FloatingButtonManager: 拖拽距离过小，视为点击');
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

    // 新偏移 = 初始偏移 + 鼠标Y轴变化量
    let offsetY = this.state.initialOffsetY + (this.state.currentY - this.state.startY);

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
    this.dragButton.removeEventListener('mousedown', this.boundHandleMouseDown);
    this.dragButton.removeEventListener('touchstart', this.boundHandleTouchStart);
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('touchmove', this.boundHandleTouchMove);
    document.removeEventListener('touchend', this.boundHandleTouchEnd);
  }
}
