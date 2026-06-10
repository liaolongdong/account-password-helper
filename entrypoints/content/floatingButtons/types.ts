/**
 * 悬浮按钮模块类型定义
 * 集中管理动画控制器、拖拽处理器、设置面板等模块的 TypeScript 类型
 */

import type { FloatingButtonConfig } from '@/utils/types';
import type { AnimationController } from '@/entrypoints/content/floatingButtons/AnimationController';

// ── AnimationController 相关 ──

/**
 * 动画状态类型
 */
export type AnimationState = 'expanded' | 'collapsed';

/**
 * 动画配置选项
 */
export interface AnimationOptions {
  /** 动画持续时间（毫秒） */
  duration?: number;
  /** 缓动函数 */
  easing?: string;
  /** 动画完成回调 */
  onComplete?: () => void;
}

// ── DragHandler 相关 ──

/**
 * 拖拽状态接口
 */
export interface DragState {
  /** 是否正在拖拽 */
  isDragging: boolean;
  /** 拖拽起始 X 坐标 */
  startX: number;
  /** 拖拽起始 Y 坐标 */
  startY: number;
  /** 当前 X 坐标 */
  currentX: number;
  /** 当前 Y 坐标 */
  currentY: number;
  /** 初始吸附位置 */
  initialPosition: 'left' | 'right';
  /** 初始垂直偏移量 */
  initialOffsetY: number;
  /** 鼠标点击位置与按钮中心的 X 偏移量 */
  mouseOffsetX: number;
  /** 鼠标点击位置与按钮中心的 Y 偏移量 */
  mouseOffsetY: number;
}

/**
 * 拖拽处理器配置选项
 */
export interface DragHandlerOptions {
  /** 悬浮按钮容器元素 */
  container: HTMLElement;
  /** 按钮组元素 */
  buttonGroup: HTMLElement;
  /** 拖拽触发按钮 */
  dragButton: HTMLElement;
  /** 动画控制器实例 */
  animationController: AnimationController;
  /** 左侧吸附预览线 */
  snapPreviewLeft: HTMLElement;
  /** 右侧吸附预览线 */
  snapPreviewRight: HTMLElement;
  /** 拖拽结束回调 */
  onDragEnd?: (position: 'left' | 'right', offsetY: number) => void;
  /** 拖拽触发阈值（像素），默认 10px */
  dragThreshold?: number;
}

// ── SettingsPanel 相关 ──

/**
 * 设置面板初始化选项
 */
export interface SettingsPanelOptions {
  /** Shadow DOM 根节点 */
  shadowRoot: ShadowRoot;
  /** 悬浮按钮配置 */
  config: FloatingButtonConfig;
  /** 配置变更回调 */
  onConfigChange: (config: Partial<FloatingButtonConfig>) => void;
  /** 关闭回调 */
  onClose: () => void;
}

// ── settingsPanelView 相关 ──

/**
 * 设置面板视图绑定选项
 */
export interface SettingsPanelViewOptions {
  /** 任一配置字段变更时回调 */
  onConfigChange: (patch: Partial<FloatingButtonConfig>) => void;
  /** 点击关闭按钮或遮罩时回调（可选） */
  onClose?: () => void;
}

/**
 * 设置面板视图操作句柄
 */
export interface SettingsPanelViewHandle {
  /** 根据新配置刷新视图（开关状态、滑块位置） */
  updateConfig(config: FloatingButtonConfig): void;
  /** 解绑所有事件（DOM 由调用方移除） */
  destroy(): void;
}
