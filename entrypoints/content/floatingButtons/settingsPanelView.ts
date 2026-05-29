/**
 * 悬浮按钮设置弹窗 - 共用视图模块
 *
 * 共用目标：
 * 1. 悬浮按钮（content script Shadow DOM）通过 SettingsPanel.ts 使用
 * 2. 侧边栏（sidepanel App.vue）也复用同一份 HTML/CSS/事件逻辑
 *
 * 因此以纯函数 + 命令式 API 形式导出，避免引入 Vue 到 content script。
 */

import { closeIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { FloatingButtonConfig } from '@/utils/types';

const THEME_COLOR = '#409eff';

/**
 * 设置弹窗共用样式
 * 注入到：悬浮按钮的 Shadow DOM（由 SettingsPanel 使用）/ 侧边栏的 document head
 */
export const settingsPanelViewStyles = `
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  box-sizing: border-box;
}

.settings-panel.visible {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, -50%) scale(1);
}

.settings-panel *,
.settings-panel *::before,
.settings-panel *::after {
  box-sizing: border-box;
}

/* 设置面板头部 */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
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
  padding: 16px 20px;
}

/* 设置项 */
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
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

/* 设置提示文字 */
.setting-tip {
  font-size: 12px;
  color: #999;
  padding: 4px 0 10px;
  line-height: 1.4;
  border-bottom: 1px solid #f0f0f0;
}
`;

/**
 * 生成设置面板内部 HTML（不含外层 .settings-panel 容器本身，由调用方提供容器）
 */
export function getSettingsPanelHTML(config: FloatingButtonConfig): string {
  const opacityPct = Math.round(config.opacity * 100);
  return `
    <div class="settings-header">
      <h3 class="settings-title">悬浮按钮设置</h3>
      <button class="settings-close" data-action="close" title="关闭">
        ${closeIcon}
      </button>
    </div>
    <div class="settings-content">
      <div class="setting-item">
        <span class="setting-label">显示悬浮按钮</span>
        <div class="switch ${config.visible ? 'active' : ''}" data-setting="visible">
          <div class="switch-handle"></div>
        </div>
      </div>

      <div class="setting-item">
        <span class="setting-label">自动展示侧边栏</span>
        <div class="switch ${config.autoShowSidepanel ? 'active' : ''}" data-setting="autoShowSidepanel">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip">开启后，登录输入框获取焦点时自动展示快速填充侧边栏</div>

      <div class="setting-item">
        <span class="setting-label">自动触发登录</span>
        <div class="switch ${config.autoTriggerLogin ? 'active' : ''}" data-setting="autoTriggerLogin">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip">开启后，在侧边栏点击快速填充密码成功后将自动点击登录按钮（仅账号密码场景）</div>

      <div class="setting-item">
        <span class="setting-label">密码显示切换</span>
        <div class="switch ${config.passwordVisibilityToggle ? 'active' : ''}" data-setting="passwordVisibilityToggle">
          <div class="switch-handle"></div>
        </div>
      </div>
      <div class="setting-tip">开启后，密码输入框内将显示眼睛图标按钮，点击可切换密码明文/密文（页面自带切换按钮时自动跳过）</div>

      <div class="setting-item">
        <span class="setting-label">按钮透明度</span>
        <div class="slider-container">
          <div class="slider" data-setting="opacity">
            <div class="slider-fill" style="width: ${opacityPct}%"></div>
            <div class="slider-thumb" style="left: ${opacityPct}%"></div>
          </div>
          <span class="slider-value">${opacityPct}%</span>
        </div>
      </div>
    </div>
  `;
}

export interface SettingsPanelViewOptions {
  /** 任一配置字段变更时回调 */
  onConfigChange: (patch: Partial<FloatingButtonConfig>) => void;
  /** 点击关闭按钮或遮罩时回调（可选） */
  onClose?: () => void;
}

export interface SettingsPanelViewHandle {
  /** 根据新配置刷新视图（开关状态、滑块位置） */
  updateConfig(config: FloatingButtonConfig): void;
  /** 解绑所有事件（DOM 由调用方移除） */
  destroy(): void;
}

/**
 * 绑定事件：close、overlay 点击、switch、slider 拖拽
 *
 * @param panelRoot 面板根元素（.settings-panel）
 * @param overlayEl 遮罩元素（.settings-overlay），可为 null
 * @param initialConfig 初始配置（内部维护一份副本用于事件处理）
 * @param options 回调集合
 */
export function bindSettingsPanelView(
  panelRoot: HTMLElement,
  overlayEl: HTMLElement | null,
  initialConfig: FloatingButtonConfig,
  options: SettingsPanelViewOptions,
): SettingsPanelViewHandle {
  const config: FloatingButtonConfig = { ...initialConfig };
  const cleanups: Array<() => void> = [];

  // 关闭按钮
  const closeBtn = panelRoot.querySelector('[data-action="close"]') as HTMLElement | null;
  const onCloseClick = (e: Event) => {
    e.stopPropagation();
    options.onClose?.();
  };
  closeBtn?.addEventListener('click', onCloseClick);
  cleanups.push(() => closeBtn?.removeEventListener('click', onCloseClick));

  // overlay 点击关闭
  const onOverlayClick = () => options.onClose?.();
  overlayEl?.addEventListener('click', onOverlayClick);
  cleanups.push(() => overlayEl?.removeEventListener('click', onOverlayClick));

  // 阻止面板点击事件冒泡到 overlay
  const onPanelClick = (e: Event) => e.stopPropagation();
  panelRoot.addEventListener('click', onPanelClick);
  cleanups.push(() => panelRoot.removeEventListener('click', onPanelClick));

  // 四个 switch
  const switchKeys: Array<'visible' | 'autoShowSidepanel' | 'autoTriggerLogin' | 'passwordVisibilityToggle'> = [
    'visible',
    'autoShowSidepanel',
    'autoTriggerLogin',
    'passwordVisibilityToggle',
  ];
  switchKeys.forEach(key => {
    const el = panelRoot.querySelector(`[data-setting="${key}"]`) as HTMLElement | null;
    if (!el) return;
    const onClick = () => {
      const next = !config[key];
      config[key] = next;
      el.classList.toggle('active', next);
      options.onConfigChange({ [key]: next } as Partial<FloatingButtonConfig>);
    };
    el.addEventListener('click', onClick);
    cleanups.push(() => el.removeEventListener('click', onClick));
  });

  // 透明度滑块
  const opacitySlider = panelRoot.querySelector('[data-setting="opacity"]') as HTMLElement | null;
  if (opacitySlider) {
    const fill = opacitySlider.querySelector('.slider-fill') as HTMLElement | null;
    const thumb = opacitySlider.querySelector('.slider-thumb') as HTMLElement | null;
    const valueDisplay = opacitySlider.parentElement?.querySelector('.slider-value') as HTMLElement | null;

    let isDragging = false;

    const updateSlider = (clientX: number) => {
      const rect = opacitySlider.getBoundingClientRect();
      let percentage = (clientX - rect.left) / rect.width;
      percentage = Math.max(0.1, Math.min(1, percentage));

      if (fill) fill.style.width = `${percentage * 100}%`;
      if (thumb) thumb.style.left = `${percentage * 100}%`;
      if (valueDisplay) valueDisplay.textContent = `${Math.round(percentage * 100)}%`;

      config.opacity = percentage;
      options.onConfigChange({ opacity: percentage });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      updateSlider(e.clientX);
    };
    const handleMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      updateSlider(e.clientX);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
    opacitySlider.addEventListener('mousedown', onMouseDown);
    cleanups.push(() => {
      opacitySlider.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    });

    // 触摸事件
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      e.preventDefault();
      updateSlider(e.touches[0].clientX);
    };
    const handleTouchEnd = () => {
      isDragging = false;
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      isDragging = true;
      updateSlider(e.touches[0].clientX);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
    };
    opacitySlider.addEventListener('touchstart', onTouchStart, { passive: false });
    cleanups.push(() => {
      opacitySlider.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    });
  }

  const updateConfig = (newConfig: FloatingButtonConfig) => {
    Object.assign(config, newConfig);

    // 更新四个 switch
    switchKeys.forEach(key => {
      const el = panelRoot.querySelector(`[data-setting="${key}"]`);
      el?.classList.toggle('active', !!config[key]);
    });

    // 更新滑块
    const slider = panelRoot.querySelector('[data-setting="opacity"]');
    if (slider) {
      const fill = slider.querySelector('.slider-fill') as HTMLElement | null;
      const thumb = slider.querySelector('.slider-thumb') as HTMLElement | null;
      const valueDisplay = slider.parentElement?.querySelector('.slider-value') as HTMLElement | null;
      const pct = Math.round(config.opacity * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;
      if (valueDisplay) valueDisplay.textContent = `${pct}%`;
    }
  };

  const destroy = () => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  };

  return { updateConfig, destroy };
}
