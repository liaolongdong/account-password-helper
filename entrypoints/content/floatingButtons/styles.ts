/**
 * 悬浮按钮样式定义
 * 主题色：浅蓝 #409eff（与项目 Element Plus 主色一致）
 */

// 主题色定义
const THEME_COLOR = '#409eff';
const THEME_COLOR_LIGHT = 'rgba(64, 158, 255, 0.1)';
const THEME_COLOR_HOVER = 'rgba(64, 158, 255, 0.15)';

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
  right: 12px;
  left: auto;
}

/* 左侧位置 */
.floating-container[data-position="left"] {
  left: 12px;
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
  width: 48px;
  height: 48px;
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
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.25), 0 6px 20px rgba(0, 0, 0, 0.1);
  transform: scale(1.08);
}

.btn:active {
  transform: scale(0.95);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.btn svg {
  width: 22px;
  height: 22px;
  transition: transform 0.2s ease;
}

/* 中间按钮（密码管理按钮）- 可拖拽 */
.btn-options {
  cursor: grab;
}

.btn-options:active {
  cursor: grabbing;
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
  box-shadow: 0 6px 20px rgba(64, 158, 255, 0.4), 0 8px 28px rgba(0, 0, 0, 0.15);
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
  box-shadow: 0 8px 24px rgba(64, 158, 255, 0.45), 0 12px 36px rgba(0, 0, 0, 0.2);
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
  width: 48px;
  height: 48px;
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

/* 设置面板遮罩 */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 2147483646;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}

.settings-overlay.visible {
  opacity: 1;
  visibility: visible;
}

/* 设置面板 */
.settings-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.9);
  width: 320px;
  max-width: 90vw;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  z-index: 2147483647;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.settings-panel.visible {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, -50%) scale(1);
}

/* 设置面板头部 */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.settings-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #999;
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-close:hover {
  background: #f5f5f5;
  color: #666;
}

/* 设置面板内容 */
.settings-content {
  padding: 20px;
}

/* 设置项 */
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 14px;
  color: #333;
}

/* 开关样式 */
.switch {
  position: relative;
  width: 44px;
  height: 24px;
  background: #dcdfe6;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.3s ease;
}

.switch.active {
  background: ${THEME_COLOR};
}

.switch-handle {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.switch.active .switch-handle {
  transform: translateX(20px);
}

/* 滑块样式 */
.slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slider {
  width: 100px;
  height: 4px;
  background: #e4e7ed;
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.slider-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: ${THEME_COLOR};
  border-radius: 2px;
  transition: width 0.1s ease;
}

.slider-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  background: #fff;
  border: 2px solid ${THEME_COLOR};
  border-radius: 50%;
  cursor: grab;
  transition: transform 0.1s ease;
}

.slider-thumb:hover {
  transform: translate(-50%, -50%) scale(1.1);
}

.slider-thumb:active {
  cursor: grabbing;
}

.slider-value {
  font-size: 13px;
  color: #666;
  min-width: 36px;
  text-align: right;
}

/* 按钮loading状态 */
.btn.loading {
  pointer-events: none;
  opacity: 0.6;
}

.btn.loading::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
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
`;

/**
 * 设置面板样式（额外样式）
 */
export const settingsPanelStyles = `
/* 设置分组 */
.setting-group {
  margin-bottom: 16px;
}

.setting-group-title {
  font-size: 13px;
  font-weight: 500;
  color: #666;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}
`;
