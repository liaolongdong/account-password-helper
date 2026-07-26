/**
 * 设置面板 - 悬浮按钮设置界面（薄层 wrapper）
 *
 * 真正的 HTML 模板、样式、事件绑定逻辑在 settingsPanelView.ts 中，
 * 本类仅负责：
 * - 在 Shadow DOM 中创建 overlay + panel 容器
 * - 委托 bindSettingsPanelView 绑定事件
 * - show()/hide() 通过切换 visible 类控制显隐
 */

import type { FloatingButtonConfig } from '@/utils/types';
import type { SettingsPanelOptions, SettingsPanelViewHandle } from '@/entrypoints/content/floatingButtons/types';
import {
  getSettingsPanelHTML,
  bindSettingsPanelView,
  getStoredPanelLocale,
} from '@/entrypoints/content/floatingButtons/settingsPanelView';

export class SettingsPanel {
  private shadowRoot: ShadowRoot;
  private onConfigChange: (config: Partial<FloatingButtonConfig>) => void;
  private onClose: () => void;

  private overlay: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private viewHandle: SettingsPanelViewHandle | null = null;
  private isVisible: boolean = false;

  constructor(options: SettingsPanelOptions) {
    this.shadowRoot = options.shadowRoot;
    this.onConfigChange = options.onConfigChange;
    this.onClose = options.onClose;

    this.createElements(options.config);
  }

  /**
   * 创建设置面板元素
   */
  private createElements(config: FloatingButtonConfig): void {
    // 创建遮罩
    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-overlay';

    // 创建面板
    this.panel = document.createElement('div');
    this.panel.className = 'settings-panel';
    this.panel.innerHTML = getSettingsPanelHTML(config);

    // 添加到 Shadow DOM
    this.shadowRoot.appendChild(this.overlay);
    this.shadowRoot.appendChild(this.panel);

    // 绑定共用视图事件
    this.viewHandle = bindSettingsPanelView(this.panel, this.overlay, config, {
      onConfigChange: patch => this.onConfigChange(patch),
      onClose: () => this.hide(),
    });

    // 异步读取用户语言偏好并应用（构造期默认中文渲染，storage 读取通常在面板展示前完成）
    void getStoredPanelLocale().then(locale => this.viewHandle?.setLocale(locale));
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
    this.viewHandle?.updateConfig(config);
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
    this.viewHandle?.destroy();
    this.viewHandle = null;
    this.overlay?.remove();
    this.panel?.remove();
    this.overlay = null;
    this.panel = null;
  }
}
