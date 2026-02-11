/**
 * 悬浮按钮管理器 - 核心管理类
 * 负责悬浮按钮的生命周期管理、渲染和事件处理
 */

import { StorageUtils } from '@/utils/storage';
import { MessageType } from '@/utils/types';
import type { FloatingButtonConfig } from '@/utils/types';
import { floatingButtonStyles, settingsPanelStyles } from './styles';
import { sidebarOpenIcon, passwordIcon, settingsIcon, dragHandleIcon } from './icons';
import { AnimationController } from './AnimationController';
import { DragHandler } from './DragHandler';
import { SettingsPanel } from './SettingsPanel';

export class FloatingButtonManager {
  private shadowHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private container: HTMLElement | null = null;
  private buttonGroup: HTMLElement | null = null;
  private config: FloatingButtonConfig;

  private animationController: AnimationController | null = null;
  private dragHandler: DragHandler | null = null;
  private settingsPanel: SettingsPanel | null = null;

  private isInitialized: boolean = false;
  private storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;

  constructor() {
    this.config = StorageUtils.getDefaultFloatingButtonConfig();
  }

  /**
   * 初始化悬浮按钮
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 加载配置
      this.config = await StorageUtils.getFloatingButtonConfig();

      // 如果配置为不显示，则不创建元素
      if (!this.config.visible) {
        this.setupStorageListener();
        this.isInitialized = true;
        return;
      }

      // 创建Shadow DOM
      this.createShadowDOM();

      // 渲染按钮
      this.renderButtons();

      // 初始化动画控制器
      this.initAnimationController();

      // 初始化拖拽处理器
      this.initDragHandler();

      // 初始化设置面板
      this.initSettingsPanel();

      // 绑定按钮事件
      this.bindButtonEvents();

      // 应用配置
      this.applyConfig();

      // 监听存储变化
      this.setupStorageListener();

      this.isInitialized = true;
      console.log('FloatingButtonManager: 初始化完成');
    } catch (error) {
      console.error('FloatingButtonManager: 初始化失败:', error);
    }
  }

  /**
   * 创建Shadow DOM
   */
  private createShadowDOM(): void {
    // 创建Shadow Host
    this.shadowHost = document.createElement('floating-button-root');
    this.shadowHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

    // 创建Shadow Root（使用closed模式增强隔离）
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'closed' });

    // 注入样式
    const styleElement = document.createElement('style');
    styleElement.textContent = floatingButtonStyles + settingsPanelStyles;
    this.shadowRoot.appendChild(styleElement);

    // 挂载到页面
    document.body.appendChild(this.shadowHost);
  }

  /**
   * 渲染按钮
   */
  private renderButtons(): void {
    if (!this.shadowRoot) return;

    // 创建主容器
    this.container = document.createElement('div');
    this.container.className = 'floating-container';
    this.container.setAttribute('data-position', this.config.position);

    // 创建按钮组
    this.buttonGroup = document.createElement('div');
    this.buttonGroup.className = 'button-group';
    this.buttonGroup.setAttribute('data-state', 'expanded');

    // 创建按钮
    this.buttonGroup.innerHTML = `
      <button class="btn btn-sidepanel" data-action="toggle-sidepanel" title="快速填充">
        ${sidebarOpenIcon}
      </button>
      <button class="btn btn-options" data-action="open-options" title="密码管理">
        ${passwordIcon}
        <span class="drag-handle">${dragHandleIcon}</span>
      </button>
      <button class="btn btn-settings" data-action="open-settings" title="设置">
        ${settingsIcon}
      </button>
    `;

    this.container.appendChild(this.buttonGroup);

    // 创建吸附预览线
    const snapPreviewLeft = document.createElement('div');
    snapPreviewLeft.className = 'snap-preview left';

    const snapPreviewRight = document.createElement('div');
    snapPreviewRight.className = 'snap-preview right';

    this.shadowRoot.appendChild(this.container);
    this.shadowRoot.appendChild(snapPreviewLeft);
    this.shadowRoot.appendChild(snapPreviewRight);
  }

  /**
   * 初始化动画控制器
   */
  private initAnimationController(): void {
    if (!this.buttonGroup || !this.container) return;

    this.animationController = new AnimationController(this.buttonGroup, this.container);
  }

  /**
   * 初始化拖拽处理器
   */
  private initDragHandler(): void {
    if (!this.shadowRoot || !this.container || !this.buttonGroup || !this.animationController) return;

    const dragButton = this.buttonGroup.querySelector('.btn-options') as HTMLElement;
    const snapPreviewLeft = this.shadowRoot.querySelector('.snap-preview.left') as HTMLElement;
    const snapPreviewRight = this.shadowRoot.querySelector('.snap-preview.right') as HTMLElement;

    if (!dragButton || !snapPreviewLeft || !snapPreviewRight) return;

    this.dragHandler = new DragHandler({
      container: this.container,
      buttonGroup: this.buttonGroup,
      dragButton,
      animationController: this.animationController,
      snapPreviewLeft,
      snapPreviewRight,
      onDragEnd: this.handleDragEnd.bind(this),
    });
  }

  /**
   * 初始化设置面板
   */
  private initSettingsPanel(): void {
    if (!this.shadowRoot) return;

    this.settingsPanel = new SettingsPanel({
      shadowRoot: this.shadowRoot,
      config: this.config,
      onConfigChange: this.handleConfigChange.bind(this),
      onClose: () => {
        console.log('FloatingButtonManager: 设置面板关闭');
      },
    });
  }

  /**
   * 绑定按钮事件
   */
  private bindButtonEvents(): void {
    if (!this.buttonGroup) return;

    // 侧边栏按钮
    const sidepanelBtn = this.buttonGroup.querySelector('[data-action="toggle-sidepanel"]');
    sidepanelBtn?.addEventListener('click', e => {
      e.stopPropagation();
      this.handleSidepanelClick();
    });

    // 密码管理按钮（点击事件，拖拽由DragHandler处理）
    const optionsBtn = this.buttonGroup.querySelector('[data-action="open-options"]');
    optionsBtn?.addEventListener('click', e => {
      e.stopPropagation();
      // 如果正在拖拽，不触发点击
      if (this.dragHandler?.isDragging()) return;
      this.handleOptionsClick();
    });

    // 设置按钮
    const settingsBtn = this.buttonGroup.querySelector('[data-action="open-settings"]');
    settingsBtn?.addEventListener('click', e => {
      e.stopPropagation();
      this.handleSettingsClick();
    });
  }

  /**
   * 处理侧边栏按钮点击
   */
  private async handleSidepanelClick(): Promise<void> {
    try {
      const btn = this.buttonGroup?.querySelector('[data-action="toggle-sidepanel"]');
      if (btn) {
        btn.classList.add('loading');
      }

      // 发送消息给background切换侧边栏
      await chrome.runtime.sendMessage({
        type: MessageType.TOGGLE_SIDEPANEL,
      });

      if (btn) {
        btn.classList.remove('loading');
      }
    } catch (error) {
      console.error('FloatingButtonManager: 切换侧边栏失败:', error);
      const btn = this.buttonGroup?.querySelector('[data-action="toggle-sidepanel"]');
      if (btn) {
        btn.classList.remove('loading');
      }
    }
  }

  /**
   * 处理密码管理按钮点击
   */
  private async handleOptionsClick(): Promise<void> {
    // 检查是否正在进行拖拽，如果是则不触发点击
    if (this.dragHandler?.isDragging()) {
      console.log('FloatingButtonManager: 正在拖拽中，忽略点击事件');
      return;
    }
    
    try {
      const btn = this.buttonGroup?.querySelector('[data-action="open-options"]');
      if (btn) {
        btn.classList.add('loading');
        this.animationController?.buttonClickFeedback(btn as HTMLElement);
      }

      // 发送消息给background打开options页面
      await chrome.runtime.sendMessage({
        type: MessageType.OPEN_OPTIONS_PAGE,
      });

      if (btn) {
        btn.classList.remove('loading');
      }
    } catch (error) {
      console.error('FloatingButtonManager: 打开密码管理页面失败:', error);
      const btn = this.buttonGroup?.querySelector('[data-action="open-options"]');
      if (btn) {
        btn.classList.remove('loading');
      }
    }
  }

  /**
   * 处理设置按钮点击
   */
  private handleSettingsClick(): void {
    this.settingsPanel?.show();
  }

  /**
   * 处理拖拽结束
   */
  private async handleDragEnd(position: 'left' | 'right', offsetY: number): Promise<void> {
    try {
      // 更新配置
      this.config.position = position;
      this.config.offsetY = offsetY;

      // 保存到存储
      await StorageUtils.saveFloatingButtonConfig({
        position,
        offsetY,
      });

      console.log('FloatingButtonManager: 位置已保存', { position, offsetY });
    } catch (error) {
      console.error('FloatingButtonManager: 保存位置失败:', error);
    }
  }

  /**
   * 处理配置变化
   */
  private async handleConfigChange(config: Partial<FloatingButtonConfig>): Promise<void> {
    try {
      // 更新本地配置
      Object.assign(this.config, config);

      // 应用配置
      this.applyConfig();

      // 保存到存储
      await StorageUtils.saveFloatingButtonConfig(config);

      console.log('FloatingButtonManager: 配置已保存', config);
    } catch (error) {
      console.error('FloatingButtonManager: 保存配置失败:', error);
    }
  }

  /**
   * 应用配置
   */
  private applyConfig(): void {
    if (!this.container || !this.animationController) return;

    // 应用位置
    this.container.setAttribute('data-position', this.config.position);

    // 应用垂直偏移
    this.container.style.top = `calc(50% + ${this.config.offsetY}px)`;

    // 应用透明度
    this.animationController.setOpacity(this.config.opacity);

    // 应用显示状态
    if (this.config.visible) {
      this.container.classList.remove('hidden');
    } else {
      this.container.classList.add('hidden');
    }
  }

  /**
   * 设置存储监听器
   */
  private setupStorageListener(): void {
    this.storageListener = changes => {
      if (changes.floating_button_config) {
        const newConfig = changes.floating_button_config.newValue as FloatingButtonConfig;
        if (newConfig) {
          this.handleStorageChange(newConfig);
        }
      }
    };

    chrome.storage.onChanged.addListener(this.storageListener);
  }

  /**
   * 处理存储变化
   */
  private async handleStorageChange(newConfig: FloatingButtonConfig): Promise<void> {
    const wasVisible = this.config.visible;
    this.config = { ...newConfig };

    // 如果从隐藏变为显示，需要创建元素
    if (!wasVisible && newConfig.visible && !this.container) {
      this.createShadowDOM();
      this.renderButtons();
      this.initAnimationController();
      this.initDragHandler();
      this.initSettingsPanel();
      this.bindButtonEvents();
    }

    // 更新设置面板配置
    this.settingsPanel?.updateConfig(this.config);

    // 应用配置
    this.applyConfig();
  }

  /**
   * 显示悬浮按钮
   */
  async show(): Promise<void> {
    if (!this.container) {
      // 如果元素未创建，重新初始化
      this.config.visible = true;
      await StorageUtils.saveFloatingButtonConfig({ visible: true });

      if (!this.shadowRoot) {
        this.createShadowDOM();
        this.renderButtons();
        this.initAnimationController();
        this.initDragHandler();
        this.initSettingsPanel();
        this.bindButtonEvents();
      }
    }

    this.config.visible = true;
    this.applyConfig();
    await this.animationController?.show();
  }

  /**
   * 隐藏悬浮按钮
   */
  async hide(): Promise<void> {
    this.config.visible = false;
    await this.animationController?.hide();
  }

  /**
   * 切换显示状态
   */
  async toggle(): Promise<void> {
    if (this.config.visible) {
      await this.hide();
    } else {
      await this.show();
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): FloatingButtonConfig {
    return { ...this.config };
  }

  /**
   * 销毁悬浮按钮
   */
  destroy(): void {
    // 移除存储监听器
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }

    // 销毁子组件
    this.animationController?.destroy();
    this.dragHandler?.destroy();
    this.settingsPanel?.destroy();

    // 移除DOM元素
    this.shadowHost?.remove();

    // 清空引用
    this.shadowHost = null;
    this.shadowRoot = null;
    this.container = null;
    this.buttonGroup = null;
    this.animationController = null;
    this.dragHandler = null;
    this.settingsPanel = null;

    this.isInitialized = false;
    console.log('FloatingButtonManager: 已销毁');
  }
}

// 导出单例实例
let floatingButtonManagerInstance: FloatingButtonManager | null = null;

export function getFloatingButtonManager(): FloatingButtonManager {
  if (!floatingButtonManagerInstance) {
    floatingButtonManagerInstance = new FloatingButtonManager();
  }
  return floatingButtonManagerInstance;
}

export function destroyFloatingButtonManager(): void {
  if (floatingButtonManagerInstance) {
    floatingButtonManagerInstance.destroy();
    floatingButtonManagerInstance = null;
  }
}
