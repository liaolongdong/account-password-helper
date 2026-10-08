/**
 * 悬浮按钮样式定义
 * 主色使用主题令牌 var(--aph-primary)，由 shadow host 内联写入（见 FloatingButtonManager），
 * 令悬浮按钮随整体主题切换。
 */

import { settingsPanelViewStyles } from '@/entrypoints/content/floatingButtons/settingsPanelView';

// 主色令牌（由 shadow host 提供具体取值）
const THEME_COLOR = 'var(--aph-primary)';

export const floatingButtonStyles = `
/* 重置所有继承样式 */
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

/* 主容器 */
.floating-container {
  position: fixed;
  z-index: 2147483647;
  top: 50%;
  transform: translateY(-50%);
  transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease,
              visibility 0s linear 0s;
  pointer-events: auto;
}

/* 右侧位置 */
.floating-container[data-position="right"] {
  right: 6px;
  left: auto;
}

/* 左侧位置 */
.floating-container[data-position="left"] {
  left: 6px;
  right: auto;
}

/* 按钮组 */
.button-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;
  background: transparent;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 按钮基础样式 - 圆形按钮 */
.btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 50%;
  background: #ffffff;
  color: ${THEME_COLOR};
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.08);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  -webkit-tap-highlight-color: transparent;
  overflow: visible;
}

.btn:hover {
  background: #ffffff;
  color: ${THEME_COLOR};
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 25%), 0 6px 20px rgba(0, 0, 0, 0.1);
  transform: scale(1.08);
}

.btn:active {
  transform: scale(0.95);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.btn svg {
  width: 14px;
  height: 14px;
  transition: transform 0.2s ease;
}

/* 中间按钮（密码管理按钮）- 可拖拽 */
.btn-options {
  cursor: grab;
}

.btn-options:active {
  cursor: grabbing;
}

.btn-options svg {
  width: 18px;
  height: 18px;
}

/* 拖拽手柄 - 隐藏，通过整个按钮拖拽 */
.drag-handle {
  display: none;
}

/* 折叠状态 - 拖拽时其他按钮合并到中间 */
.button-group[data-state="collapsed"] {
  gap: 0;
}

.button-group[data-state="collapsed"] .btn:not(.btn-options) {
  position: absolute;
  opacity: 0;
  transform: scale(0);
  width: 0;
  height: 0;
  pointer-events: none;
  margin: 0;
  padding: 0;
  /* 关键修复：立即隐藏，不等待过渡动画 */
  transition: none !important;
  visibility: hidden;
}

.button-group[data-state="collapsed"] .btn-sidepanel {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
}

.button-group[data-state="collapsed"] .btn-settings {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0);
}

.button-group[data-state="collapsed"] .btn-options {
  position: relative;
  transform: scale(1.15);
  background: ${THEME_COLOR};
  color: #ffffff;
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 40%), 0 6px 20px rgba(0, 0, 0, 0.15);
  z-index: 10;
  cursor: move;
}

/* 拖拽中状态 */
.button-group[data-state="dragging"] {
  gap: 0;
}

.button-group[data-state="dragging"] .btn:not(.btn-options) {
  position: absolute;
  opacity: 0;
  transform: scale(0);
  width: 0;
  height: 0;
  pointer-events: none;
}

.button-group[data-state="dragging"] .btn-options {
  position: relative;
  transform: scale(1.2);
  background: ${THEME_COLOR};
  color: #ffffff;
  box-shadow: 0 6px 18px rgb(var(--aph-primary-rgb) / 45%), 0 9px 27px rgba(0, 0, 0, 0.2);
  cursor: move;
}

/* 展开状态 */
.button-group[data-state="expanded"] {
  gap: 10px;
}

.button-group[data-state="expanded"] .btn {
  position: relative;
  opacity: 1;
  transform: scale(1);
  width: 28px;
  height: 28px;
  pointer-events: auto;
}

/* 吸附预览线 */
.snap-preview {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, transparent 0%, ${THEME_COLOR} 50%, transparent 100%);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  z-index: 2147483646;
}

.snap-preview.left {
  left: 0;
}

.snap-preview.right {
  right: 0;
}

.snap-preview.visible {
  opacity: 0.6;
}

/* 设置面板相关样式已迁移到 settingsPanelView.ts，由 settingsPanelStyles 统一注入 */

/* 按钮loading状态 */
.btn.loading {
  pointer-events: none;
  opacity: 0.6;
}

.btn.loading::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 按钮提示 */
.btn[title]::before {
  content: attr(title);
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  padding: 6px 10px;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  pointer-events: none;
  z-index: 1;
}

.floating-container[data-position="right"] .btn[title]::before {
  right: calc(100% + 8px);
}

.floating-container[data-position="left"] .btn[title]::before {
  left: calc(100% + 8px);
}

.btn[title]:hover::before {
  opacity: 1;
  visibility: visible;
}

/* 折叠和拖拽状态下禁用 hover 提示 */
.button-group[data-state="collapsed"] .btn[title]::before,
.button-group[data-state="dragging"] .btn[title]::before {
  display: none !important;
}

/* 隐藏状态 */
.floating-container.hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-50%) translateX(200px);
  transition: opacity 0.3s ease,
              visibility 0s linear 0.3s,
              transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.floating-container[data-position="left"].hidden {
  transform: translateY(-50%) translateX(-200px);
}

/*
 * 降级动效：只撤缩放与滑出位移，颜色、阴影、透明度与 visibility 照旧。
 * - .btn:hover / .btn:active 的 scale 是纯装饰反馈，底色与阴影已经承担「可点 / 按下」提示；
 * - .floating-container.hidden 的 translateX(±200px) 是滑出位移，而同一行的 translateY(-50%)
 *   是**垂直居中定位**，必须保留——写成 transform: none 会让整组按钮跳出中线，看起来像控件坏了；
 * - 折叠 / 拖拽态里的 scale(0) 与 translate(-50%, -50%) 同样属于"隐藏 + 定位"，不参与降级。
 * 基态 .btn 用的是 transition: all，撤掉位移后仍在过渡的是颜色与阴影，因此不必收窄。
 * loading 态的 spin 关键帧不在这里关：它是「正在处理」的唯一反馈（AnimationController 只加
 * loading 类，没有别的文字或图标变化），关掉等于把状态整个藏起来，比留着 0.8s 旋转更糟；
 * 要减弱它得先补一个非运动的态提示，属独立改动。
 */
@media (prefers-reduced-motion: reduce) {
  .btn:hover,
  .btn:active {
    transform: none;
  }

  .floating-container.hidden {
    transform: translateY(-50%);
  }

  .floating-container[data-position="left"].hidden {
    transform: translateY(-50%);
  }
}
`;

/**
 * 设置面板样式
 * 各控件样式已由 settingsPanelView.ts 统一维护，供侧边栏与悬浮按钮共用。
 * 此处仅保留悬浮按钮 Shadow DOM 专有的额外组封装样式（如分组/分组标题等），
 * 并追加共用模块的完整样式字符串。
 */
export const settingsPanelStyles = `
${settingsPanelViewStyles}
`;
