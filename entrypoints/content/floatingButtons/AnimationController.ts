/**
 * 动画控制器 - 管理悬浮按钮的动画效果
 */

export type AnimationState = 'expanded' | 'collapsed';

export interface AnimationOptions {
  duration?: number;
  easing?: string;
  onComplete?: () => void;
}

export class AnimationController {
  private buttonGroup: HTMLElement;
  private container: HTMLElement;
  private currentState: AnimationState = 'expanded';
  private animationFrame: number | null = null;

  constructor(buttonGroup: HTMLElement, container: HTMLElement) {
    this.buttonGroup = buttonGroup;
    this.container = container;
  }

  /**
   * 获取当前动画状态
   */
  getState(): AnimationState {
    return this.currentState;
  }

  /**
   * 折叠按钮组（拖拽开始时调用）
   * 其他按钮淡出缩小，只保留中间的密码管理按钮
   */
  collapse(options: AnimationOptions = {}): Promise<void> {
    return new Promise(resolve => {
      const { duration = 200, onComplete } = options;

      this.currentState = 'collapsed';
      this.buttonGroup.setAttribute('data-state', 'collapsed');

      // 使用CSS过渡动画
      setTimeout(() => {
        onComplete?.();
        resolve();
      }, duration);
    });
  }

  /**
   * 展开按钮组（拖拽结束后调用）
   * 其他按钮淡入放大恢复
   */
  expand(options: AnimationOptions = {}): Promise<void> {
    return new Promise(resolve => {
      const { duration = 250, onComplete } = options;

      this.currentState = 'expanded';
      this.buttonGroup.setAttribute('data-state', 'expanded');

      setTimeout(() => {
        onComplete?.();
        resolve();
      }, duration);
    });
  }

  /**
   * 设置拖拽状态（现在统一使用collapsed状态）
   */
  setDragging(isDragging: boolean): void {
    if (isDragging) {
      this.currentState = 'collapsed';
      this.buttonGroup.setAttribute('data-state', 'collapsed');
    }
  }

  /**
   * 吸附到边缘动画
   */
  snapToEdge(targetPosition: 'left' | 'right', targetY: number, options: AnimationOptions = {}): Promise<void> {
    return new Promise(resolve => {
      const { duration = 300, onComplete } = options;

      // 清除之前的变换
      this.container.style.transform = '';

      // 设置位置属性
      this.container.setAttribute('data-position', targetPosition);

      // 设置垂直偏移
      this.container.style.top = `calc(50% + ${targetY}px)`;

      // 等待动画完成
      setTimeout(() => {
        onComplete?.();
        resolve();
      }, duration);
    });
  }

  /**
   * 更新拖拽位置（使用transform实现平滑拖拽）
   */
  updateDragPosition(deltaX: number, deltaY: number): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.animationFrame = requestAnimationFrame(() => {
      this.container.style.transform = `translateY(-50%) translate(${deltaX}px, ${deltaY}px)`;
    });
  }

  /**
   * 重置拖拽位置
   */
  resetDragPosition(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.container.style.transform = 'translateY(-50%)';
  }

  /**
   * 按钮点击反馈动画
   */
  buttonClickFeedback(button: HTMLElement): void {
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
      button.style.transform = '';
    }, 100);
  }

  /**
   * 显示悬浮按钮（带动画）
   */
  show(options: AnimationOptions = {}): Promise<void> {
    return new Promise(resolve => {
      const { duration = 300, onComplete } = options;

      this.container.classList.remove('hidden');

      setTimeout(() => {
        onComplete?.();
        resolve();
      }, duration);
    });
  }

  /**
   * 隐藏悬浮按钮（带动画）
   */
  hide(options: AnimationOptions = {}): Promise<void> {
    return new Promise(resolve => {
      const { duration = 300, onComplete } = options;

      this.container.classList.add('hidden');

      setTimeout(() => {
        onComplete?.();
        resolve();
      }, duration);
    });
  }

  /**
   * 设置透明度
   */
  setOpacity(opacity: number): void {
    this.container.style.opacity = String(opacity);
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
}
