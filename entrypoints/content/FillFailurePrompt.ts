/**
 * 填充失败就地诊断提示组件
 *
 * 当 fillPasswordWithResult 返回 reason='no_form' 时，在页面内显示一个轻量气泡，
 * 引导用户指定选择器或启用穿透。点击后打开短文本框，输入 CSS 选择器后写入 SiteRule。
 *
 * 技术实现：复用 FloatingButtonManager 的 closed shadow DOM 注入模式，避免污染宿主样式。
 */
import { tl } from '@/utils/i18n-lite';
import { setSiteRule, getSiteRule } from '@/utils/storage/siteRules';

/** FillFailurePrompt 配置选项 */
interface FillFailurePromptOptions {
  /** 触发填充失败的密码字段元素 */
  passwordField: HTMLInputElement;
  /** 当前域名 */
  domain: string;
}

/** FillFailurePrompt 实例 */
class FillFailurePrompt {
  private shadowHost: HTMLElement;
  private shadowRoot: ShadowRoot;
  private domain: string;
  private isVisible = false;

  constructor(options: FillFailurePromptOptions) {
    this.shadowHost = options.passwordField.closest('form') ?? document.body;
    this.domain = options.domain;

    // 创建 closed shadow root
    if (!this.shadowHost.shadowRoot) {
      this.shadowHost.attachShadow({ mode: 'closed' });
    }
    this.shadowRoot = this.shadowHost.shadowRoot!;

    // 初始化样式
    this.initStyles();
  }

  /** 初始化阴影 DOM 样式 */
  private initStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: inline-block;
        font-family: var(--aph-font-family, system-ui, -apple-system, sans-serif);
        font-size: 13px;
        line-height: 1.5;
        color: var(--aph-text-primary, #fff);
      }
      .prompt-container {
        background: var(--aph-primary, #409eff);
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
        cursor: pointer;
        transition: transform 0.2s ease;
      }
      .prompt-container:hover {
        transform: translateY(-2px);
      }
      .prompt-text {
        margin: 0 0 8px 0;
        font-weight: 500;
      }
      .prompt-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .btn {
        padding: 4px 12px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: opacity 0.2s ease;
      }
      .btn:hover {
        opacity: 0.9;
      }
      .btn-primary {
        background: #fff;
        color: var(--aph-primary, #409eff);
      }
      .btn-secondary {
        background: rgba(255 255 255 / 20%);
        color: #fff;
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  /** 渲染提示气泡 */
  public render(): void {
    if (this.isVisible) return;

    const container = document.createElement('div');
    container.className = 'prompt-container';
    container.innerHTML = `
      <p class="prompt-text">${tl('cs.fd.failurePromptText')}</p>
      <div class="prompt-actions">
        <button class="btn btn-secondary">${tl('cs.fd.failurePromptLater')}</button>
        <button class="btn btn-primary">${tl('cs.fd.failurePromptSpecify')}</button>
      </div>
    `;

    // 绑定事件
    const primaryBtn = container.querySelector('.btn-primary') as HTMLButtonElement;
    const secondaryBtn = container.querySelector('.btn-secondary') as HTMLButtonElement;

    primaryBtn?.addEventListener('click', () => this.handleSpecify());
    secondaryBtn?.addEventListener('click', () => this.hide());

    this.shadowRoot.innerHTML = '';
    this.shadowRoot.appendChild(container);
    this.isVisible = true;
  }

  /** 隐藏提示 */
  public hide(): void {
    if (!this.isVisible) return;
    this.shadowRoot.innerHTML = '';
    this.isVisible = false;
  }

  /** 处理"手动指定选择器"点击 */
  private async handleSpecify(): Promise<void> {
    this.hide();

    // 创建选择器输入对话框
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
      z-index: 9999;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    dialog.innerHTML = `
      <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #333;">${tl('cs.fd.failurePromptDialogTitle')}</h3>
      <p style="margin: 0 0 12px 0; font-size: 13px; color: #666;">${tl('cs.fd.failurePromptDialogHint')}</p>
      <input type="text" id="aph-selector-input" placeholder="input[type=password]" 
        style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 12px;" />
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="aph-cancel" style="padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">取消</button>
        <button id="aph-confirm" style="padding: 6px 12px; background: #409eff; color: #fff; border: none; border-radius: 4px; cursor: pointer;">确定</button>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = dialog.querySelector('#aph-selector-input') as HTMLInputElement;
    const confirmBtn = dialog.querySelector('#aph-confirm') as HTMLButtonElement;
    const cancelBtn = dialog.querySelector('#aph-cancel') as HTMLButtonElement;

    const closeDialog = () => dialog.remove();

    cancelBtn?.addEventListener('click', closeDialog);

    confirmBtn?.addEventListener('click', async () => {
      const selector = input.value.trim();
      if (!selector) {
        alert(tl('cs.fd.failurePromptValidateSelector'));
        return;
      }

      try {
        // 读取现有规则
        const existingRule = await getSiteRule(this.domain);

        // 更新规则
        await setSiteRule(this.domain, {
          customSelectors: {
            username: existingRule?.customSelectors?.username ?? 'input[type=text], input[type=email]',
            password: selector,
          },
          penetrateShadow: existingRule?.penetrateShadow ?? true,
        });

        ElMessage.success(tl('cs.fd.failurePromptSaveSuccess'));
        closeDialog();
      } catch (error) {
        console.error('保存站点规则失败:', error);
        ElMessage.error(tl('cs.fd.failurePromptSaveError'));
        closeDialog();
      }
    });

    // ESC 关闭
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDialog();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }
}

// 全局唯一的 FillFailurePrompt 实例（单例模式）
let instance: FillFailurePrompt | null = null;

/**
 * 显示填充失败提示
 *
 * @param passwordField 密码字段元素
 * @param domain 当前域名
 */
export function showFillFailurePrompt(passwordField: HTMLInputElement, domain: string): void {
  if (instance) return; // 避免重复创建

  instance = new FillFailurePrompt({ passwordField, domain });
  instance.render();
}

/**
 * 隐藏填充失败提示
 */
export function hideFillFailurePrompt(): void {
  instance?.hide();
  instance = null;
}

// 临时引入 ElMessage（实际应通过 WXT auto-import）
declare const ElMessage: {
  success: (msg: string) => void;
  error: (msg: string) => void;
};
