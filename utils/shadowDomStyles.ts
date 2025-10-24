/**
 * Shadow DOM 样式注入工具
 * 用于修改浏览器原生组件中的 shadow DOM 元素样式
 */

export class ShadowDomStyler {
  /**
   * 查找并修改 cr-dialog 样式
   * @param targetWidth 目标宽度，如 '1000px'
   */
  static modifyCrDialogStyle(targetWidth: string = '1000px') {
    // 查找所有可能的 shadow DOM 宿主元素
    const shadowHosts = document.querySelectorAll('*');

    shadowHosts.forEach(host => {
      if (host.shadowRoot) {
        const crDialog = host.shadowRoot.querySelector('#dialog[id="dialog"]') as HTMLElement;
        if (crDialog) {
          // 直接修改样式
          crDialog.style.width = targetWidth;
          crDialog.style.maxWidth = 'calc(100vw - 40px)';
          crDialog.style.minWidth = '600px';

          // 或者注入 CSS 样式表
          this.injectStyleToShadowRoot(host.shadowRoot, targetWidth);
        }
      }
    });
  }

  /**
   * 向 shadow DOM 注入 CSS 样式
   * @param shadowRoot Shadow DOM 根节点
   * @param targetWidth 目标宽度
   */
  static injectStyleToShadowRoot(shadowRoot: ShadowRoot, targetWidth: string) {
    // 检查是否已经注入过样式
    if (shadowRoot.querySelector('#custom-cr-dialog-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'custom-cr-dialog-styles';
    style.textContent = `
      cr-dialog#dialog {
        width: ${targetWidth} !important;
        max-width: calc(100vw - 40px) !important;
        min-width: 600px !important;
        margin: 20px auto !important;
        border-radius: 8px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
      }

      /* 响应式适配 */
      @media (max-width: 1040px) {
        cr-dialog#dialog {
          width: calc(100vw - 40px) !important;
          margin: 20px !important;
        }
      }

      @media (max-width: 768px) {
        cr-dialog#dialog {
          width: calc(100vw - 20px) !important;
          margin: 10px !important;
          min-width: auto !important;
        }
      }
    `;

    shadowRoot.appendChild(style);
  }

  /**
   * 监听 DOM 变化，自动处理新出现的 shadow DOM 元素
   * @param targetWidth 目标宽度
   */
  static observeShadowDomChanges(targetWidth: string = '1000px') {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;

            // 检查新添加的元素是否有 shadow DOM
            if (element.shadowRoot) {
              this.modifyCrDialogInShadowRoot(element.shadowRoot, targetWidth);
            }

            // 检查新添加元素的子元素中是否有 shadow DOM
            const shadowHosts = element.querySelectorAll('*');
            shadowHosts.forEach(host => {
              if (host.shadowRoot) {
                this.modifyCrDialogInShadowRoot(host.shadowRoot, targetWidth);
              }
            });
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }

  /**
   * 在指定的 shadow DOM 中查找并修改 cr-dialog
   * @param shadowRoot Shadow DOM 根节点
   * @param targetWidth 目标宽度
   */
  static modifyCrDialogInShadowRoot(shadowRoot: ShadowRoot, targetWidth: string) {
    const crDialog = shadowRoot.querySelector('cr-dialog#dialog') as HTMLElement;
    if (crDialog) {
      // 直接修改样式
      crDialog.style.width = targetWidth;
      crDialog.style.maxWidth = 'calc(100vw - 40px)';
      crDialog.style.minWidth = '600px';

      // 注入样式表
      this.injectStyleToShadowRoot(shadowRoot, targetWidth);
    }
  }

  /**
   * 初始化 shadow DOM 样式修改器
   * @param targetWidth 目标宽度，默认 1000px
   */
  static init(targetWidth: string = '1000px') {
    // 立即处理现有的 shadow DOM
    this.modifyCrDialogStyle(targetWidth);

    // 监听新的 shadow DOM 元素
    const observer = this.observeShadowDomChanges(targetWidth);

    // 页面加载完成后再次检查
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.modifyCrDialogStyle(targetWidth), 100);
      });
    } else {
      setTimeout(() => this.modifyCrDialogStyle(targetWidth), 100);
    }

    return observer;
  }
}

// 自动执行样式修改（如果在浏览器环境中）
if (typeof window !== 'undefined') {
  // 延迟执行，确保页面内容加载完成
  setTimeout(() => {
    ShadowDomStyler.init('1000px');
  }, 1000);
}
