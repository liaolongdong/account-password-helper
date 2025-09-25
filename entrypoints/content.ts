import type { Message, MessageType } from '../utils/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('Account Password Helper content script loaded');

    // 表单检测器
    class FormDetector {
      private passwordFields: HTMLInputElement[] = [];
      private usernameFields: HTMLInputElement[] = [];
      private checkboxFields: HTMLInputElement[] = [];
      private observer: MutationObserver;

      constructor() {
        this.init();
        this.observer = this.createMutationObserver();
      }

      private init() {
        // 页面加载完成后检测表单
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => this.detectForms(), 1000); // 延迟检测确保动态内容加载
          });
        } else {
          setTimeout(() => this.detectForms(), 1000);
        }

        // 监听消息
        chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
          this.handleMessage(message, sender, sendResponse);
          return true; // 保持消息通道开放
        });
      }

      private createMutationObserver(): MutationObserver {
        const observer = new MutationObserver(mutations => {
          let shouldRedetect = false;

          mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (
                  element.querySelector &&
                  (element.querySelector('input[type="password"]') ||
                    element.querySelector('input[type="email"]') ||
                    element.querySelector('input[type="text"]'))
                ) {
                  shouldRedetect = true;
                }
              }
            });
          });

          if (shouldRedetect) {
            setTimeout(() => this.detectForms(), 500);
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        return observer;
      }

      private detectForms() {
        // 清空之前的检测结果
        this.passwordFields = [];
        this.usernameFields = [];
        this.checkboxFields = [];

        // 检测密码字段
        const passwordInputs = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
        this.passwordFields = Array.from(passwordInputs).filter(input => this.isVisible(input));

        // 检测用户名字段
        const usernameSelectors = [
          'input[type="email"]',
          'input[type="text"][name*="user"]',
          'input[type="text"][name*="email"]',
          'input[type="text"][name*="login"]',
          'input[type="text"][id*="user"]',
          'input[type="text"][id*="email"]',
          'input[type="text"][id*="login"]',
          'input[type="text"][placeholder*="用户"]',
          'input[type="text"][placeholder*="邮箱"]',
          'input[type="text"][placeholder*="账号"]',
          'input[type="text"][placeholder*="username"]',
          'input[type="text"][placeholder*="email"]'
        ];

        usernameSelectors.forEach(selector => {
          const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
          Array.from(inputs).forEach(input => {
            if (this.isVisible(input) && !this.usernameFields.includes(input)) {
              this.usernameFields.push(input);
            }
          });
        });

        // 检测复选框
        const checkboxInputs = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
        this.checkboxFields = Array.from(checkboxInputs).filter(input => this.isVisible(input));

        // 为表单字段添加焦点监听器
        this.addFormListeners();

        console.log('表单检测完成:', {
          passwordFields: this.passwordFields.length,
          usernameFields: this.usernameFields.length,
          checkboxFields: this.checkboxFields.length,
          passwordFieldDetails: this.passwordFields.map(f => ({
            type: f.type,
            name: f.name,
            id: f.id,
            className: f.className
          })),
          usernameFieldDetails: this.usernameFields.map(f => ({
            type: f.type,
            name: f.name,
            id: f.id,
            className: f.className
          }))
        });

        // 如果找到了表单字段，发送通知
        if (this.passwordFields.length > 0 || this.usernameFields.length > 0) {
          console.log('检测到登录表单，可以使用密码填充功能');
        }
      }

      private isVisible(element: HTMLElement): boolean {
        const style = window.getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          element.offsetWidth > 0 &&
          element.offsetHeight > 0
        );
      }

      private addFormListeners() {
        // 移除之前的监听器避免重复
        [...this.passwordFields, ...this.usernameFields].forEach(field => {
          // 移除可能存在的旧监听器
          field.removeEventListener('focus', this.handleFieldFocus);
          field.removeEventListener('click', this.handleFieldFocus);
          field.removeEventListener('input', this.handleFieldFocus);
          field.removeEventListener('mousedown', this.handleFieldFocus);
          field.removeEventListener('keydown', this.handleFieldFocus);
        });

        // 为密码和用户名字段添加多种事件监听器，确保能够触发
        [...this.passwordFields, ...this.usernameFields].forEach(field => {
          // 使用捕获阶段确保事件能被捕获
          field.addEventListener('focus', this.handleFieldFocus, { capture: true });
          field.addEventListener('click', this.handleFieldFocus, { capture: true });
          field.addEventListener('input', this.handleFieldFocus, { capture: true });
          field.addEventListener('mousedown', this.handleFieldFocus, { capture: true });
          field.addEventListener('keydown', this.handleFieldFocus, { capture: true });

          // 添加额外的监听器到父元素以防事件被阻止
          if (field.parentElement) {
            field.parentElement.addEventListener('click', this.handleFieldFocus);
          }

          console.log('添加监听器到字段:', field.type, field.name || field.id || field.className || 'unnamed');
        });

        // 添加全局监听器作为备选方案
        document.addEventListener('focusin', this.handleGlobalFocus);
        document.addEventListener('click', this.handleGlobalClick);
      }

      private handleFieldFocus = (event?: Event) => {
        console.log('表单字段获得焦点，显示侧边栏', event?.type, event?.target);
        this.showSidePanel();
      };

      private handleGlobalFocus = (event: FocusEvent) => {
        const target = event.target as HTMLElement;
        if (target && target.tagName === 'INPUT') {
          const input = target as HTMLInputElement;
          const isPasswordField = this.passwordFields.includes(input);
          const isUsernameField = this.usernameFields.includes(input);

          if (isPasswordField || isUsernameField) {
            console.log('全局焦点检测到表单字段:', input.type);
            this.showSidePanel();
          }
        }
      };

      private handleGlobalClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (target && target.tagName === 'INPUT') {
          const input = target as HTMLInputElement;
          const isPasswordField = this.passwordFields.includes(input);
          const isUsernameField = this.usernameFields.includes(input);

          if (isPasswordField || isUsernameField) {
            console.log('全局点击检测到表单字段:', input.type);
            this.showSidePanel();
          }
        }
      };

      private async showSidePanel() {
        try {
          console.log('尝试显示侧边栏...');
          // 通知background script显示侧边栏
          const response = await chrome.runtime.sendMessage({
            type: 'SHOW_SIDEPANEL'
          });
          console.log('侧边栏显示请求已发送:', response);
        } catch (error) {
          console.error('显示侧边栏失败:', error);
        }
      }

      private handleMessage(message: any, sender: any, sendResponse: Function) {
        console.log('Content script收到消息:', message);
        switch (message.type) {
          case 'PING':
            sendResponse({ success: true, message: 'content script is ready' });
            break;
          case 'FILL_PASSWORD':
            this.fillPassword(message.data);
            sendResponse({ success: true, message: '填充完成' });
            break;
          default:
            console.log('未知消息类型:', message.type);
            sendResponse({ success: false, message: '未知消息类型' });
            break;
        }
      }

      private fillPassword(data: { username: string; password: string }) {
        try {
          console.log('开始填充密码:', {
            hasUsername: !!data.username,
            hasPassword: !!data.password,
            usernameFieldsCount: this.usernameFields.length,
            passwordFieldsCount: this.passwordFields.length
          });

          // 填充用户名
          if (data.username && this.usernameFields.length > 0) {
            const usernameField = this.usernameFields[0];
            console.log('填充用户名到字段:', usernameField.type, usernameField.name || usernameField.id);
            this.setInputValue(usernameField, data.username);
          }

          // 填充密码
          if (data.password && this.passwordFields.length > 0) {
            const passwordField = this.passwordFields[0];
            console.log('填充密码到字段:', passwordField.type, passwordField.name || passwordField.id);
            this.setInputValue(passwordField, data.password);
          }

          // 自动勾选最近的复选框
          this.autoCheckNearestCheckbox();

          console.log('密码填充完成');
        } catch (error) {
          console.error('填充密码失败:', error);
        }
      }

      private setInputValue(input: HTMLInputElement, value: string) {
        console.log('设置输入框值:', input.type, value);

        try {
          // 先聚焦输入框
          input.focus();

          // 选中所有文本
          input.select();

          // 模拟用户删除现有内容
          document.execCommand('selectAll');
          document.execCommand('delete');

          // 使用原生方法设置值
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, value);
          } else {
            input.value = value;
          }

          // 触发全套事件序列
          const events = [
            new Event('focus', { bubbles: true }),
            new Event('input', { bubbles: true, cancelable: true }),
            new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              data: value,
              inputType: 'insertText'
            }),
            new Event('change', { bubbles: true, cancelable: true }),
            new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
            new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })
          ];

          events.forEach(event => {
            try {
              input.dispatchEvent(event);
            } catch (e) {
              console.warn('事件分发失败:', e);
            }
          });

          // 延迟失去焦点
          setTimeout(() => {
            try {
              input.blur();
              const blurEvent = new Event('blur', { bubbles: true });
              input.dispatchEvent(blurEvent);
            } catch (e) {
              console.warn('blur事件失败:', e);
            }
          }, 200);

          console.log('输入框值设置完成:', input.value);
        } catch (error) {
          console.error('设置输入框值失败:', error);
          // 备用方案
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      private autoCheckNearestCheckbox() {
        if (this.checkboxFields.length === 0 || this.passwordFields.length === 0) return;

        const passwordField = this.passwordFields[0];
        let nearestCheckbox: HTMLInputElement | null = null;
        let minDistance = Infinity;

        // 找到距离密码框最近的复选框
        this.checkboxFields.forEach(checkbox => {
          const distance = this.calculateDistance(passwordField, checkbox);
          if (distance < minDistance) {
            minDistance = distance;
            nearestCheckbox = checkbox;
          }
        });

        // 自动勾选最近的复选框
        if (nearestCheckbox && !nearestCheckbox.checked) {
          nearestCheckbox.checked = true;
          nearestCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('自动勾选了复选框');
        }
      }

      private calculateDistance(elem1: HTMLElement, elem2: HTMLElement): number {
        const rect1 = elem1.getBoundingClientRect();
        const rect2 = elem2.getBoundingClientRect();

        const centerX1 = rect1.left + rect1.width / 2;
        const centerY1 = rect1.top + rect1.height / 2;
        const centerX2 = rect2.left + rect2.width / 2;
        const centerY2 = rect2.top + rect2.height / 2;

        return Math.sqrt(Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2));
      }

      public destroy() {
        if (this.observer) {
          this.observer.disconnect();
        }
        // 清理全局监听器
        document.removeEventListener('focusin', this.handleGlobalFocus);
        document.removeEventListener('click', this.handleGlobalClick);
      }
    }

    // 初始化表单检测器
    const formDetector = new FormDetector();

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
      formDetector.destroy();
    });
  }
});
