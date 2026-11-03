/**
 * 动画控制器 - 管理悬浮按钮的动画效果
 */

import { prefersReducedMotion } from '@/utils/a11y';
import type { AnimationState, AnimationOptions } from '@/entrypoints/content/floatingButtons/types';

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
   *
   * 旧实现是「内联写 `transform: scale(0.95)` + 100ms 后清掉」：`.btn` 的过渡是 0.25s，
   * 100ms 时缩放才走到一半就被撤掉，按压读起来像一次抖动；而内联样式还会盖住
   * `.btn:hover` 的放大。现在只负责加类，播放与复位都交给 styles.ts 里的 `btn-press`
   * 关键帧（动画结束后元素本就回到当前状态，类无需清理）。
   *
   * 减弱档下直接返回：媒体查询已把该动画设为 `none`，此时摘类再强制一次布局是纯开销。
   * 结果不落缓存，用户中途在系统设置里切换也会在下一次点击跟随。
   *
   * @param button 被点击的按钮
   */
  buttonClickFeedback(button: HTMLElement): void {
    if (prefersReducedMotion()) return;
    // 动画还在播时重复加同名类不会重播，先摘类并读一次布局属性强制重排以重启动画
    button.classList.remove('click-feedback');
    void button.offsetWidth;
    button.classList.add('click-feedback');
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
