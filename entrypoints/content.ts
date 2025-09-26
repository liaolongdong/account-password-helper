import { defineContentScript } from 'wxt/sandbox';
import type { Message, MessageType } from '../utils/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('Account Password Helper content script loaded');

    // 表单检测器
    class FormDetector {
      private passwordFields: HTMLInputElement[] = [];
      private usernameFields: HTMLInputElement[] = [];
      private mobileFields: HTMLInputElement[] = [];
      private verifyCodeFields: HTMLInputElement[] = [];
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

        // 定时重新检测表单（针对动态加载的表单）
        setInterval(() => {
          this.detectForms();
        }, 3000); // 每3秒检测一次

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
                    element.querySelector('input[type="text"]') ||
                    element.querySelector('input[type="tel"]') ||
                    element.querySelector('input[type="number"]'))
                ) {
                  shouldRedetect = true;
                }
              }
            });
          });

          if (shouldRedetect) {
            console.log('检测到新表单字段，重新检测表单');
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
        this.mobileFields = [];
        this.verifyCodeFields = [];
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

        // 检测手机号码字段
        const mobileSelectors = [
          'input[type="tel"]',
          'input[type="text"][name*="phone"]',
          'input[type="text"][name*="mobile"]',
          'input[type="text"][id*="phone"]',
          'input[type="text"][id*="mobile"]',
          'input[type="text"][placeholder*="手机"]',
          'input[type="text"][placeholder*="电话"]',
          'input[type="text"][placeholder*="phone"]',
          'input[type="text"][placeholder*="mobile"]',
          'input[type="number"][name*="phone"]',
          'input[type="number"][name*="mobile"]',
          'input[type="number"][placeholder*="手机"]',
          'input[type="number"][placeholder*="电话"]',
          // 新增更多选择器
          'input[name*="phoneNumber"]',
          'input[name*="mobilePhone"]',
          'input[id*="phoneNumber"]',
          'input[id*="mobilePhone"]',
          'input[class*="phone"]',
          'input[class*="mobile"]',
          'input[placeholder*="请输入手机号"]',
          'input[placeholder*="请输入电话号码"]'
        ];

        mobileSelectors.forEach(selector => {
          const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
          Array.from(inputs).forEach(input => {
            if (this.isVisible(input) && !this.mobileFields.includes(input) && !this.usernameFields.includes(input)) {
              console.log('发现手机号码字段:', selector, input.type, input.name || input.id);
              this.mobileFields.push(input);
            }
          });
        });

        // 检测验证码字段
        const verifyCodeSelectors = [
          'input[type="text"][name*="code"]',
          'input[type="text"][name*="captcha"]',
          'input[type="text"][name*="verify"]',
          'input[type="text"][id*="code"]',
          'input[type="text"][id*="captcha"]',
          'input[type="text"][id*="verify"]',
          'input[type="text"][placeholder*="验证码"]',
          'input[type="text"][placeholder*="验证"]',
          'input[type="text"][placeholder*="code"]',
          'input[type="text"][placeholder*="captcha"]',
          'input[type="number"][name*="code"]',
          'input[type="number"][name*="captcha"]',
          'input[type="number"][placeholder*="验证码"]',
          // 新增更多选择器
          'input[name*="verifyCode"]',
          'input[name*="authCode"]',
          'input[name*="checkCode"]',
          'input[name*="smsCode"]',
          'input[id*="verifyCode"]',
          'input[id*="authCode"]',
          'input[id*="checkCode"]',
          'input[id*="smsCode"]',
          'input[class*="code"]',
          'input[class*="verify"]',
          'input[placeholder*="请输入验证码"]',
          'input[placeholder*="短信验证码"]',
          'input[placeholder*="请输入短信验证码"]'
        ];

        verifyCodeSelectors.forEach(selector => {
          const inputs = document.querySelectorAll(selector) as NodeListOf<HTMLInputElement>;
          Array.from(inputs).forEach(input => {
            if (
              this.isVisible(input) &&
              !this.verifyCodeFields.includes(input) &&
              !this.usernameFields.includes(input) &&
              !this.mobileFields.includes(input)
            ) {
              console.log('发现验证码字段:', selector, input.type, input.name || input.id);
              this.verifyCodeFields.push(input);
            }
          });
        });

        // 检测复选框（包括隐藏的和可见的）
        const checkboxInputs = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
        this.checkboxFields = Array.from(checkboxInputs).filter(input => {
          // 只过滤那些完全不可交互的复选框
          const style = window.getComputedStyle(input);
          const isInteractable =
            style.display !== 'none' && style.visibility !== 'hidden' && input.offsetParent !== null; // 检查是否在DOM中可见

          console.log('复选框检测:', {
            element: input,
            id: input.id,
            name: input.name,
            className: input.className,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            offsetParent: input.offsetParent,
            isInteractable: isInteractable,
            label: this.getCheckboxLabel(input)
          });

          return isInteractable;
        });

        // 为表单字段添加焦点监听器
        this.addFormListeners();

        console.log('表单检测完成:', {
          passwordFields: this.passwordFields.length,
          usernameFields: this.usernameFields.length,
          mobileFields: this.mobileFields.length,
          verifyCodeFields: this.verifyCodeFields.length,
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
          })),
          mobileFieldDetails: this.mobileFields.map(f => ({
            type: f.type,
            name: f.name,
            id: f.id,
            className: f.className
          })),
          verifyCodeFieldDetails: this.verifyCodeFields.map(f => ({
            type: f.type,
            name: f.name,
            id: f.id,
            className: f.className
          })),
          checkboxFieldDetails: this.checkboxFields.map(f => ({
            id: f.id,
            name: f.name,
            className: f.className,
            checked: f.checked,
            disabled: f.disabled,
            label: this.getCheckboxLabel(f)
          }))
        });

        // 如果找到了表单字段，发送通知
        if (
          this.passwordFields.length > 0 ||
          this.usernameFields.length > 0 ||
          this.mobileFields.length > 0 ||
          this.verifyCodeFields.length > 0
        ) {
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
        [...this.passwordFields, ...this.usernameFields, ...this.mobileFields, ...this.verifyCodeFields].forEach(
          field => {
            // 移除可能存在的旧监听器
            field.removeEventListener('focus', this.handleFieldFocus);
            field.removeEventListener('click', this.handleFieldFocus);
            field.removeEventListener('input', this.handleFieldFocus);
            field.removeEventListener('mousedown', this.handleFieldFocus);
            field.removeEventListener('keydown', this.handleFieldFocus);
          }
        );

        // 为所有表单字段添加多种事件监听器，确保能够触发
        [...this.passwordFields, ...this.usernameFields, ...this.mobileFields, ...this.verifyCodeFields].forEach(
          field => {
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

            const fieldType = this.getFieldType(field);
            console.log('添加监听器到字段:', fieldType, field.name || field.id || field.className || 'unnamed');
          }
        );

        // 添加全局监听器作为备选方案
        document.addEventListener('focusin', this.handleGlobalFocus);
        document.addEventListener('click', this.handleGlobalClick);
      }

      private getFieldType(field: HTMLInputElement): string {
        if (this.passwordFields.includes(field)) return '密码字段';
        if (this.usernameFields.includes(field)) return '用户名字段';
        if (this.mobileFields.includes(field)) return '手机号码字段';
        if (this.verifyCodeFields.includes(field)) return '验证码字段';
        return '未知字段';
      }

      private handleFieldFocus = (event?: Event) => {
        const target = event?.target as HTMLInputElement;
        const fieldType = target ? this.getFieldType(target) : '未知';
        console.log('表单字段获得焦点，显示侧边栏', {
          eventType: event?.type,
          fieldType,
          element: target,
          name: target?.name,
          id: target?.id,
          placeholder: target?.placeholder
        });

        // 立即显示侧边栏，不等待
        this.showSidePanel();
      };

      private handleGlobalFocus = (event: FocusEvent) => {
        const target = event.target as HTMLElement;
        if (target && target.tagName === 'INPUT') {
          const input = target as HTMLInputElement;
          const isPasswordField = this.passwordFields.includes(input);
          const isUsernameField = this.usernameFields.includes(input);
          const isMobileField = this.mobileFields.includes(input);
          const isVerifyCodeField = this.verifyCodeFields.includes(input);

          if (isPasswordField || isUsernameField || isMobileField || isVerifyCodeField) {
            const fieldType = this.getFieldType(input);
            console.log('全局焦点检测到表单字段:', fieldType);
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
          const isMobileField = this.mobileFields.includes(input);
          const isVerifyCodeField = this.verifyCodeFields.includes(input);

          if (isPasswordField || isUsernameField || isMobileField || isVerifyCodeField) {
            const fieldType = this.getFieldType(input);
            console.log('全局点击检测到表单字段:', fieldType);
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
        if (this.checkboxFields.length === 0) {
          console.log('没有找到复选框');
          return;
        }

        console.log('开始自动勾选复选框，找到', this.checkboxFields.length, '个复选框');

        // 获取参考元素（优先使用密码框，其次是用户名框）
        const referenceField =
          this.passwordFields.length > 0
            ? this.passwordFields[0]
            : this.usernameFields.length > 0
              ? this.usernameFields[0]
              : null;

        if (!referenceField) {
          console.log('没有找到参考元素');
          return;
        }

        console.log('使用参考元素:', referenceField.type, referenceField.name || referenceField.id || '无名');

        // 找到最合适的复选框
        const targetCheckbox = this.findBestCheckbox(referenceField);

        if (targetCheckbox && !targetCheckbox.checked) {
          console.log('找到目标复选框，准备勾选:', {
            id: targetCheckbox.id,
            name: targetCheckbox.name,
            className: targetCheckbox.className,
            labelText: this.getCheckboxLabel(targetCheckbox)
          });

          // 勾选复选框
          this.checkCheckbox(targetCheckbox);
        } else if (targetCheckbox?.checked) {
          console.log('目标复选框已经被勾选');
        } else {
          console.log('没有找到合适的复选框');
        }
      }

      private findBestCheckbox(referenceField: HTMLInputElement): HTMLInputElement | null {
        let bestCheckbox: HTMLInputElement | null = null;
        let bestScore = -1;

        this.checkboxFields.forEach(checkbox => {
          const score = this.calculateCheckboxScore(referenceField, checkbox);
          console.log('复选框评分:', {
            id: checkbox.id,
            name: checkbox.name,
            label: this.getCheckboxLabel(checkbox),
            score: score
          });

          if (score > bestScore) {
            bestScore = score;
            bestCheckbox = checkbox;
          }
        });

        return bestCheckbox;
      }

      private calculateCheckboxScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
        let score = 0;

        // 使用更准确的距离计算
        const distance = this.calculateAccurateDistance(referenceField, checkbox);
        const maxDistance = 2000; // 增加最大有效距离
        const distanceScore = Math.max(0, (maxDistance - distance) / maxDistance) * 100;
        score += distanceScore;

        console.log('复选框距离计算:', {
          checkboxId: checkbox.id || checkbox.name || '无ID',
          distance: distance.toFixed(2),
          distanceScore: distanceScore.toFixed(2)
        });

        // 获取复选框的标签文本
        const labelText = this.getCheckboxLabel(checkbox).toLowerCase();

        // 标签内容分数（相关关键词加分）
        const positiveKeywords = [
          '记住',
          '记住我',
          'remember',
          'remember me',
          '同意',
          '已阅读',
          '接受',
          '确认',
          'agree',
          'accept',
          'confirm',
          'read',
          '自动登录',
          '保持登录',
          'auto',
          'stay',
          'keep',
          '服务条款',
          '隐私政策',
          '用户协议',
          'terms',
          'privacy',
          'policy',
          'agreement'
        ];

        const negativeKeywords = [
          '发送',
          '订阅',
          '推送',
          '通知',
          'send',
          'subscribe',
          'newsletter',
          'notification',
          '广告',
          '营销',
          'marketing',
          'ads',
          'promotion'
        ];

        // 正向关键词加分
        let keywordScore = 0;
        positiveKeywords.forEach(keyword => {
          if (labelText.includes(keyword)) {
            keywordScore += 50;
          }
        });

        // 负向关键词减分
        negativeKeywords.forEach(keyword => {
          if (labelText.includes(keyword)) {
            keywordScore -= 30;
          }
        });

        score += keywordScore;

        // 位置关系分数
        const positionScore = this.calculatePositionScore(referenceField, checkbox);
        score += positionScore;

        // 同一表单内的复选框加分
        const refForm = referenceField.closest('form');
        const checkboxForm = checkbox.closest('form');
        if (refForm && checkboxForm && refForm === checkboxForm) {
          score += 30;
        }

        // DOM层级关系加分
        const hierarchyScore = this.calculateHierarchyScore(referenceField, checkbox);
        score += hierarchyScore;

        console.log('复选框综合评分:', {
          checkboxId: checkbox.id || checkbox.name || '无ID',
          labelText: labelText.substring(0, 30),
          distanceScore: distanceScore.toFixed(2),
          keywordScore,
          positionScore,
          hierarchyScore,
          totalScore: score.toFixed(2)
        });

        return score;
      }

      // 更准确的距离计算（考虑不同层级）
      private calculateAccurateDistance(elem1: HTMLElement, elem2: HTMLElement): number {
        const rect1 = elem1.getBoundingClientRect();
        const rect2 = elem2.getBoundingClientRect();

        // 使用边缘距离而不是中心距离
        const left1 = rect1.left;
        const right1 = rect1.right;
        const top1 = rect1.top;
        const bottom1 = rect1.bottom;

        const left2 = rect2.left;
        const right2 = rect2.right;
        const top2 = rect2.top;
        const bottom2 = rect2.bottom;

        // 计算最短距离
        let dx = 0;
        let dy = 0;

        if (right1 < left2) {
          dx = left2 - right1; // elem1在elem2左侧
        } else if (right2 < left1) {
          dx = left1 - right2; // elem1在elem2右侧
        }
        // 否则x轴有重叠，dx = 0

        if (bottom1 < top2) {
          dy = top2 - bottom1; // elem1在elem2上方
        } else if (bottom2 < top1) {
          dy = top1 - bottom2; // elem1在elem2下方
        }
        // 否则y轴有重叠，dy = 0

        return Math.sqrt(dx * dx + dy * dy);
      }

      // 位置关系评分
      private calculatePositionScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
        const refRect = referenceField.getBoundingClientRect();
        const checkboxRect = checkbox.getBoundingClientRect();
        let score = 0;

        // 在密码框下方的复选框加分（更符合常见布局）
        if (checkboxRect.top > refRect.bottom) {
          const verticalDistance = checkboxRect.top - refRect.bottom;
          if (verticalDistance < 100) {
            score += 40; // 非常近的下方元素
          } else if (verticalDistance < 200) {
            score += 20; // 较近的下方元素
          }
        }

        // 水平对齐加分
        const horizontalOverlap =
          Math.min(refRect.right, checkboxRect.right) - Math.max(refRect.left, checkboxRect.left);
        if (horizontalOverlap > 0) {
          score += 15; // 水平有重叠
        }

        return score;
      }

      // DOM层级关系评分
      private calculateHierarchyScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
        let score = 0;

        // 查找共同祖先元素
        const commonAncestor = this.findCommonAncestor(referenceField, checkbox);
        if (commonAncestor) {
          // 计算到共同祖先的距离
          const refDepth = this.getDepthFromAncestor(referenceField, commonAncestor);
          const checkboxDepth = this.getDepthFromAncestor(checkbox, commonAncestor);

          // 层级距离越近分数越高
          const totalDepth = refDepth + checkboxDepth;
          if (totalDepth <= 4) {
            score += 25; // 非常近的层级关系
          } else if (totalDepth <= 8) {
            score += 15; // 较近的层级关系
          } else if (totalDepth <= 12) {
            score += 5; // 较远的层级关系
          }
        }

        return score;
      }

      // 查找共同祖先元素
      private findCommonAncestor(elem1: HTMLElement, elem2: HTMLElement): HTMLElement | null {
        const ancestors1 = [];
        let current = elem1.parentElement;
        while (current) {
          ancestors1.push(current);
          current = current.parentElement;
        }

        current = elem2.parentElement;
        while (current) {
          if (ancestors1.includes(current)) {
            return current;
          }
          current = current.parentElement;
        }

        return null;
      }

      // 计算到祖先元素的深度
      private getDepthFromAncestor(elem: HTMLElement, ancestor: HTMLElement): number {
        let depth = 0;
        let current = elem.parentElement;

        while (current && current !== ancestor) {
          depth++;
          current = current.parentElement;
        }

        return depth;
      }

      private getCheckboxLabel(checkbox: HTMLInputElement): string {
        // 尝试多种方式获取复选框的标签文本

        // 1. 通过 label 元素
        if (checkbox.id) {
          const label = document.querySelector(`label[for="${checkbox.id}"]`);
          if (label) {
            return label.textContent?.trim() || '';
          }
        }

        // 2. 父级 label 元素
        const parentLabel = checkbox.closest('label');
        if (parentLabel) {
          return parentLabel.textContent?.trim() || '';
        }

        // 3. 相邻元素的文本
        const nextSibling = checkbox.nextElementSibling;
        if (nextSibling) {
          const text = nextSibling.textContent?.trim();
          if (text) return text;
        }

        const prevSibling = checkbox.previousElementSibling;
        if (prevSibling) {
          const text = prevSibling.textContent?.trim();
          if (text) return text;
        }

        // 4. 父元素的文本（排除复选框本身）
        const parent = checkbox.parentElement;
        if (parent) {
          const clone = parent.cloneNode(true) as HTMLElement;
          const checkboxClone = clone.querySelector('input[type="checkbox"]');
          if (checkboxClone) {
            checkboxClone.remove();
          }
          const text = clone.textContent?.trim();
          if (text) return text;
        }

        // 5. 使用属性值
        return checkbox.name || checkbox.id || checkbox.className || '未知复选框';
      }

      private checkCheckbox(checkbox: HTMLInputElement) {
        try {
          console.log('正在勾选复选框...', {
            element: checkbox,
            id: checkbox.id,
            name: checkbox.name,
            className: checkbox.className,
            currentChecked: checkbox.checked,
            disabled: checkbox.disabled,
            label: this.getCheckboxLabel(checkbox)
          });

          // 检查是否禁用
          if (checkbox.disabled) {
            console.log('复选框被禁用，跳过');
            return;
          }

          // 尝试多种方式勾选

          // 方式1: 直接点击复选框
          console.log('尝试方式1: 直接点击复选框');
          checkbox.click();

          // 等待一下看是否生效
          setTimeout(() => {
            console.log('方式1结果:', checkbox.checked);

            if (!checkbox.checked) {
              // 方式2: 设置值 + 触发事件
              console.log('尝试方式2: 设置值 + 触发事件');
              checkbox.checked = true;

              // 触发多种事件
              const events = [
                new Event('change', { bubbles: true, cancelable: true }),
                new Event('input', { bubbles: true, cancelable: true }),
                new MouseEvent('click', { bubbles: true, cancelable: true }),
                new Event('focus', { bubbles: true }),
                new Event('blur', { bubbles: true })
              ];

              events.forEach(event => {
                try {
                  checkbox.dispatchEvent(event);
                  console.log('触发事件:', event.type);
                } catch (e) {
                  console.error('触发事件失败:', event.type, e);
                }
              });

              setTimeout(() => {
                console.log('方式2结果:', checkbox.checked);

                if (!checkbox.checked) {
                  // 方式3: 通过 label 点击
                  console.log('尝试方式3: 通过 label 点击');
                  const label = this.findCheckboxLabel(checkbox);
                  if (label) {
                    console.log('找到关联的 label，尝试点击:', label);
                    label.click();

                    setTimeout(() => {
                      console.log('方式3结果:', checkbox.checked);

                      if (!checkbox.checked) {
                        // 方式4: 模拟用户交互
                        console.log('尝试方式4: 模拟用户交互');
                        this.simulateUserInteraction(checkbox);
                      } else {
                        console.log('复选框勾选成功（方式3）');
                      }
                    }, 100);
                  } else {
                    console.log('未找到关联的 label');
                    // 直接尝试方式4
                    this.simulateUserInteraction(checkbox);
                  }
                } else {
                  console.log('复选框勾选成功（方式2）');
                }
              }, 100);
            } else {
              console.log('复选框勾选成功（方式1）');
            }
          }, 100);
        } catch (error) {
          console.error('勾选复选框失败:', error);
        }
      }

      private findCheckboxLabel(checkbox: HTMLInputElement): HTMLElement | null {
        // 查找与复选框关联的 label 元素

        // 1. 通过 for 属性关联
        if (checkbox.id) {
          const label = document.querySelector(`label[for="${checkbox.id}"]`);
          if (label) {
            console.log('通过 for 属性找到 label:', label);
            return label as HTMLElement;
          }
        }

        // 2. 父级 label 元素
        const parentLabel = checkbox.closest('label');
        if (parentLabel) {
          console.log('找到父级 label:', parentLabel);
          return parentLabel;
        }

        // 3. 查找与复选框在同一容器内的 label
        const container = checkbox.parentElement;
        if (container) {
          const containerLabels = container.querySelectorAll('label');
          if (containerLabels.length === 1) {
            console.log('找到同一容器内的 label:', containerLabels[0]);
            return containerLabels[0] as HTMLElement;
          }
        }

        return null;
      }

      private simulateUserInteraction(checkbox: HTMLInputElement) {
        console.log('模拟用户交互...');

        try {
          // 模拟鼠标事件序列
          const rect = checkbox.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          const mouseEvents = [
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: centerX,
              clientY: centerY,
              button: 0
            }),
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              clientX: centerX,
              clientY: centerY,
              button: 0
            }),
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: centerX,
              clientY: centerY,
              button: 0
            })
          ];

          // 设置值
          const originalValue = checkbox.checked;
          checkbox.checked = !originalValue;

          // 触发鼠标事件
          mouseEvents.forEach(event => {
            checkbox.dispatchEvent(event);
          });

          // 触发表单事件
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          checkbox.dispatchEvent(new Event('input', { bubbles: true }));

          console.log('模拟交互完成，结果:', checkbox.checked);
        } catch (error) {
          console.error('模拟交互失败:', error);
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
