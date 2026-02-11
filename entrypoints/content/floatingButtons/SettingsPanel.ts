/**
 * 设置面板 - 悬浮按钮设置界面
 */

import { closeIcon } from './icons';
import type { FloatingButtonConfig } from '@/utils/types';

export interface SettingsPanelOptions {
  shadowRoot: ShadowRoot;
  config: FloatingButtonConfig;
  onConfigChange: (config: Partial<FloatingButtonConfig>) => void;
  onClose: () => void;
}

export class SettingsPanel {
  private shadowRoot: ShadowRoot;
  private config: FloatingButtonConfig;
  private onConfigChange: (config: Partial<FloatingButtonConfig>) => void;
  private onClose: () => void;

  private overlay: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private isVisible: boolean = false;

  constructor(options: SettingsPanelOptions) {
    this.shadowRoot = options.shadowRoot;
    this.config = { ...options.config };
    this.onConfigChange = options.onConfigChange;
    this.onClose = options.onClose;

    this.createElements();
  }

  /**
   * 创建设置面板元素
   */
  private createElements(): void {
    // 创建遮罩
    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-overlay';
    this.overlay.addEventListener('click', () => this.hide());

    // 创建面板
    this.panel = document.createElement('div');
    this.panel.className = 'settings-panel';
    this.panel.innerHTML = this.getPanelHTML();

    // 添加到Shadow DOM
    this.shadowRoot.appendChild(this.overlay);
    this.shadowRoot.appendChild(this.panel);

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 获取面板HTML
   */
  private getPanelHTML(): string {
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
          <div class="switch ${this.config.visible ? 'active' : ''}" data-setting="visible">
            <div class="switch-handle"></div>
          </div>
        </div>
        
        <div class="setting-item">
          <span class="setting-label">按钮透明度</span>
          <div class="slider-container">
            <div class="slider" data-setting="opacity">
              <div class="slider-fill" style="width: ${this.config.opacity * 100}%"></div>
              <div class="slider-thumb" style="left: ${this.config.opacity * 100}%"></div>
            </div>
            <span class="slider-value">${Math.round(this.config.opacity * 100)}%</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    if (!this.panel) return;

    // 关闭按钮
    const closeBtn = this.panel.querySelector('[data-action="close"]');
    closeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      this.hide();
    });

    // 显示开关
    const visibleSwitch = this.panel.querySelector('[data-setting="visible"]');
    visibleSwitch?.addEventListener('click', () => {
      this.config.visible = !this.config.visible;
      visibleSwitch.classList.toggle('active', this.config.visible);
      this.onConfigChange({ visible: this.config.visible });
    });

    // 透明度滑块
    const opacitySlider = this.panel.querySelector('[data-setting="opacity"]') as HTMLElement;
    if (opacitySlider) {
      this.initSlider(opacitySlider, 'opacity');
    }

    // 阻止面板点击事件冒泡
    this.panel.addEventListener('click', e => {
      e.stopPropagation();
    });
  }

  /**
   * 初始化滑块
   */
  private initSlider(sliderElement: HTMLElement, setting: 'opacity'): void {
    const fill = sliderElement.querySelector('.slider-fill') as HTMLElement;
    const thumb = sliderElement.querySelector('.slider-thumb') as HTMLElement;
    const valueDisplay = sliderElement.parentElement?.querySelector('.slider-value');

    let isDragging = false;

    const updateSlider = (clientX: number) => {
      const rect = sliderElement.getBoundingClientRect();
      let percentage = (clientX - rect.left) / rect.width;
      percentage = Math.max(0.1, Math.min(1, percentage)); // 最小10%，最大100%

      fill.style.width = `${percentage * 100}%`;
      thumb.style.left = `${percentage * 100}%`;

      if (valueDisplay) {
        valueDisplay.textContent = `${Math.round(percentage * 100)}%`;
      }

      this.config[setting] = percentage;
      this.onConfigChange({ [setting]: percentage });
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

    sliderElement.addEventListener('mousedown', e => {
      isDragging = true;
      updateSlider(e.clientX);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
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

    sliderElement.addEventListener(
      'touchstart',
      e => {
        if (e.touches.length !== 1) return;
        isDragging = true;
        updateSlider(e.touches[0].clientX);
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);
      },
      { passive: false },
    );
  }

  /**
   * 显示设置面板
   */
  show(): void {
    if (this.isVisible) return;
    this.isVisible = true;

    this.overlay?.classList.add('visible');
    this.panel?.classList.add('visible');
  }

  /**
   * 隐藏设置面板
   */
  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;

    this.overlay?.classList.remove('visible');
    this.panel?.classList.remove('visible');

    this.onClose();
  }

  /**
   * 更新配置
   */
  updateConfig(config: FloatingButtonConfig): void {
    this.config = { ...config };

    if (!this.panel) return;

    // 更新显示开关
    const visibleSwitch = this.panel.querySelector('[data-setting="visible"]');
    visibleSwitch?.classList.toggle('active', this.config.visible);

    // 更新透明度滑块
    const opacitySlider = this.panel.querySelector('[data-setting="opacity"]');
    if (opacitySlider) {
      const fill = opacitySlider.querySelector('.slider-fill') as HTMLElement;
      const thumb = opacitySlider.querySelector('.slider-thumb') as HTMLElement;
      const valueDisplay = opacitySlider.parentElement?.querySelector('.slider-value');

      if (fill) fill.style.width = `${this.config.opacity * 100}%`;
      if (thumb) thumb.style.left = `${this.config.opacity * 100}%`;
      if (valueDisplay) valueDisplay.textContent = `${Math.round(this.config.opacity * 100)}%`;
    }
  }

  /**
   * 检查是否可见
   */
  isOpen(): boolean {
    return this.isVisible;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.overlay?.remove();
    this.panel?.remove();
    this.overlay = null;
    this.panel = null;
  }
}
