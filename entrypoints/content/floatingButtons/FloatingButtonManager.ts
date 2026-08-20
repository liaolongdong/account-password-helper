/**
 * 悬浮按钮管理器 - 核心管理类
 * 负责悬浮按钮的生命周期管理、渲染和事件处理
 */

import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { MessageType } from '@/utils/types';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { applyThemeTokensToHost } from '@/utils/theme';
import { tl, onLiteLocaleChanged } from '@/utils/i18n-lite';
import type { FloatingButtonConfig } from '@/utils/types';
import { floatingButtonStyles, settingsPanelStyles } from '@/entrypoints/content/floatingButtons/styles';
import {
  sidebarOpenIcon,
  passwordIcon,
  settingsIcon,
  dragHandleIcon,
} from '@/entrypoints/content/floatingButtons/icons';
import { AnimationController } from '@/entrypoints/content/floatingButtons/AnimationController';
import { DragHandler } from '@/entrypoints/content/floatingButtons/DragHandler';
import { SettingsPanel } from '@/entrypoints/content/floatingButtons/SettingsPanel';

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
  /** 密码管理按钮点击处理中的标记，防止连点重复触发 */
  private isHandlingOptionsClick: boolean = false;
  /** 语言变更订阅的取消函数（销毁时解除，避免残留回调） */
  private unsubscribeLocale: (() => void) | null = null;

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
      logger.debug('FloatingButtonManager: 初始化完成');
    } catch (error) {
      logger.error('FloatingButtonManager: 初始化失败:', error);
    }
  }

  /**
   * 创建Shadow DOM
   */
  private createShadowDOM(): void {
    // 创建Shadow Host
    this.shadowHost = document.createElement('floating-button-root');
    this.shadowHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    // 写入主题令牌（供 Shadow DOM 内 var(--aph-*) 解析），令悬浮按钮随主题切换
    applyThemeTokensToHost(this.shadowHost, this.config.theme);

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
      <button class="btn btn-sidepanel" data-action="toggle-sidepanel" title="${tl('cs.fab.quickFill')}">
        ${sidebarOpenIcon}
      </button>
      <button class="btn btn-options" data-action="open-options" title="${tl('cs.fab.manage')}">
        ${passwordIcon}
        <span class="drag-handle">${dragHandleIcon}</span>
      </button>
      <button class="btn btn-settings" data-action="open-settings" title="${tl('cs.fab.settings')}">
        ${settingsIcon}
      </button>
    `;

    // 语言切换时就地刷新按钮 tooltip（含初始化异步加载完成后的首次通知）
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = onLiteLocaleChanged(() => this.refreshButtonTitles());

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
   * 按当前语言就地刷新三个按钮的 tooltip（语言切换时调用，无需重建 DOM）
   */
  private refreshButtonTitles(): void {
    if (!this.buttonGroup) return;
    this.buttonGroup.querySelector('.btn-sidepanel')?.setAttribute('title', tl('cs.fab.quickFill'));
    this.buttonGroup.querySelector('.btn-options')?.setAttribute('title', tl('cs.fab.manage'));
    this.buttonGroup.querySelector('.btn-settings')?.setAttribute('title', tl('cs.fab.settings'));
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
        logger.debug('FloatingButtonManager: 设置面板关闭');
      },
    });
  }

  /**
   * 绑定按钮事件
   */
  private bindButtonEvents(): void {
    if (!this.buttonGroup) return;

    // 预唤醒 SW：用户 hover 悬浮按钮时，很可能即将打开侧边栏。
    // 不使用 { once: true }：会话过期后 SW 可能已休眠，需要每次 hover 都能重新唤醒；
    // 高频调用由 preWarmServiceWorker 内部节流去重，不会造成消息风暴。
    this.container?.addEventListener('mouseenter', preWarmServiceWorker);

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
      // 点击即预热：覆盖用户未经 hover/focusin 直接点击的场景，
      // 尽早唤醒可能已休眠的 SW，缩短后续 sidePanel.open() 的冷启动等待
      preWarmServiceWorker();

      const btn = this.buttonGroup?.querySelector('[data-action="toggle-sidepanel"]');
      if (btn) {
        btn.classList.add('loading');
      }

      // 发送消息给background切换侧边栏（clickTs=点击时刻，覆盖「点击 → SW 唤醒」埋点盲区）
      await chrome.runtime.sendMessage({
        type: MessageType.TOGGLE_SIDEPANEL,
        data: { clickTs: Date.now() },
      });

      if (btn) {
        btn.classList.remove('loading');
      }
    } catch (error) {
      logger.error('FloatingButtonManager: 切换侧边栏失败:', error);
      const btn = this.buttonGroup?.querySelector('[data-action="toggle-sidepanel"]');
      if (btn) {
        btn.classList.remove('loading');
      }
    }
  }

  /**
   * 处理密码管理按钮点击
   * - 拖拽中/刚拖拽完忽略
   * - 通过 isHandlingOptionsClick 做客户端级去重，避免连点重复发送消息
   * - 异步期间按钮通过 loading 类被 pointer-events: none 禁用（见 styles.ts）
   */
  private async handleOptionsClick(): Promise<void> {
    // 检查是否正在进行拖拽或刚完成拖拽，如果是则不触发点击
    if (this.dragHandler?.isDragging() || this.dragHandler?.hasDraggedRecently()) {
      logger.debug('FloatingButtonManager: 正在拖拽中或刚完成拖拽，忽略点击事件');
      return;
    }

    // 客户端去重：正在处理中则忽略后续点击
    if (this.isHandlingOptionsClick) {
      logger.debug('FloatingButtonManager: 密码管理按钮点击处理中，忽略重复点击');
      return;
    }
    this.isHandlingOptionsClick = true;

    const btn = this.buttonGroup?.querySelector('[data-action="open-options"]') as HTMLElement | null;
    if (btn) {
      btn.classList.add('loading');
      this.animationController?.buttonClickFeedback(btn);
    }

    try {
      // 发送消息给 background 打开 options 页面（由 background 统一去重并激活已有 tab）
      await chrome.runtime.sendMessage({
        type: MessageType.OPEN_OPTIONS_PAGE,
      });
    } catch (error) {
      logger.error('FloatingButtonManager: 打开密码管理页面失败:', error);
    } finally {
      btn?.classList.remove('loading');
      this.isHandlingOptionsClick = false;
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

      logger.debug('FloatingButtonManager: 位置已保存', { position, offsetY });
    } catch (error) {
      logger.error('FloatingButtonManager: 保存位置失败:', error);
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

      logger.debug('FloatingButtonManager: 配置已保存', config);
    } catch (error) {
      logger.error('FloatingButtonManager: 保存配置失败:', error);
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
        const rawConfig = changes.floating_button_config.newValue as Partial<FloatingButtonConfig> | undefined;
        if (rawConfig) {
          // 合并默认值兜底：升级钩子 freezeLegacyFillDefaults 可能写入部分对象，
          // 避免 visible 等字段缺失时悬浮按钮被误隐藏
          this.handleStorageChange({
            ...StorageUtils.getDefaultFloatingButtonConfig(),
            ...rawConfig,
          });
        }
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.storageListener);
    }
  }

  /**
   * 处理存储变化
   */
  private async handleStorageChange(newConfig: FloatingButtonConfig): Promise<void> {
    const wasVisible = this.config.visible;
    this.config = { ...newConfig };

    // 主题变更时重新写入 shadow host 令牌，实现悬浮按钮实时换肤
    if (this.shadowHost) {
      applyThemeTokensToHost(this.shadowHost, this.config.theme);
    }

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
      try {
        chrome.storage.onChanged.removeListener(this.storageListener);
      } catch {
        // 上下文失效时 removeListener 可能抛错，监听器已被 Chrome 自动清理，忽略
      }
      this.storageListener = null;
    }

    // 解除语言变更订阅
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = null;

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
    logger.debug('FloatingButtonManager: 已销毁');
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
