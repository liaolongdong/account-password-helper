import { logger } from '@/utils/logger';
import { CHECKBOX_POSITIVE_KEYWORDS, CHECKBOX_NEGATIVE_KEYWORDS } from '@/entrypoints/content/formSelectors';

/**
 * 复选框处理器
 * 负责在登录表单中自动勾选协议/记住密码等复选框，
 * 通过打分算法找到最合适的复选框并尝试多种方式勾选。
 * 支持两种载体：原生 input[type=checkbox] 与现代组件库
 * （Radix/shadcn 等）用 role="checkbox" 按钮模拟的复选框。
 */
export class CheckboxHandler {
  /**
   * 已发出程序化点击、等待页面回写 aria-checked 的模拟复选框集合
   *
   * aria-checked 由页面 JS（React/Radix）异步回写，不是点击的同步默认动作：
   * 短窗口内重复触发（快速重复填充、多通道双发）若读到陈旧的 false 会再点一次，
   * 把刚勾上的状态又翻回去。点击后置入、复检落地后清除，窗口内的重复调用直接跳过。
   */
  private readonly ariaClickPending = new WeakSet<HTMLElement>();

  /**
   * 自动勾选距离参考字段最近的合适复选框
   * @param checkboxFields - 页面中检测到的复选框列表（原生 input 或 role="checkbox" 模拟复选框）
   * @param passwordFields - 密码输入框列表
   * @param usernameFields - 用户名输入框列表
   * @param mobileFields - 手机号输入框列表（账号密码字段均缺失时的兜底参照，如手机号+验证码登录页）
   */
  autoCheckNearestCheckbox(
    checkboxFields: HTMLElement[],
    passwordFields: HTMLInputElement[],
    usernameFields: HTMLInputElement[],
    mobileFields: HTMLInputElement[] = [],
  ): void {
    if (checkboxFields.length === 0) {
      return;
    }

    const referenceField =
      passwordFields.length > 0
        ? passwordFields[0]
        : usernameFields.length > 0
          ? usernameFields[0]
          : (mobileFields[0] ?? null);

    if (!referenceField) {
      return;
    }

    const targetCheckbox = this.findBestCheckbox(referenceField, checkboxFields);

    if (targetCheckbox && !this.isCheckboxChecked(targetCheckbox)) {
      if (targetCheckbox instanceof HTMLInputElement) {
        this.checkCheckbox(targetCheckbox);
      } else {
        this.checkAriaCheckbox(targetCheckbox);
      }
    }
  }

  /**
   * 自动勾选的最低相关性得分
   *
   * `role="checkbox"` 在 SPA 中被大量复用为非「同意/记住」语义的控件（显示密码切换、
   * 筛选标签、Cookie 项等），而程序化 `click()` 会驱动这些页面自有组件、副作用不可枚举。
   * 无阈值时「只要存在候选就取最优」，一个远离凭证框、无任何关联信号的自定义组件也可能被
   * 点中。这里给准入设一条下限：距离分（0-100，>800px 即跌破 60）为主，命中正向关键词或
   * 与参考字段同表单/近层级可补足，低于该线一律不勾选，宁可漏勾也不误点。
   */
  private static readonly CHECKBOX_MIN_SCORE = 60;

  /**
   * 根据打分算法找到最合适的复选框
   *
   * 得分低于 {@link CheckboxHandler.CHECKBOX_MIN_SCORE} 的候选视为「与登录表单无足够关联」，
   * 返回 null（不勾选），避免对页面自定义 `role="checkbox"` 组件发出无谓的程序化点击。
   * @param referenceField - 参考字段（通常是密码或用户名输入框）
   * @param checkboxFields - 候选复选框列表
   * @returns 得分最高且达到准入下限的复选框，若无则返回 null
   */
  private findBestCheckbox(referenceField: HTMLElement, checkboxFields: HTMLElement[]): HTMLElement | null {
    let bestCheckbox: HTMLElement | null = null;
    let bestScore = -1;

    checkboxFields.forEach(checkbox => {
      const score = this.calculateCheckboxScore(referenceField, checkbox);
      if (score > bestScore) {
        bestScore = score;
        bestCheckbox = checkbox;
      }
    });

    if (bestScore < CheckboxHandler.CHECKBOX_MIN_SCORE) {
      return null;
    }

    return bestCheckbox;
  }

  /**
   * 计算复选框的综合得分
   * 综合考虑距离、关键词、位置、表单归属和 DOM 层级关系
   * @param referenceField - 参考字段
   * @param checkbox - 待评分的复选框
   * @returns 综合得分
   */
  private calculateCheckboxScore(referenceField: HTMLElement, checkbox: HTMLElement): number {
    let score = 0;

    const distance = this.calculateAccurateDistance(referenceField, checkbox);
    const maxDistance = 2000;
    const distanceScore = Math.max(0, (maxDistance - distance) / maxDistance) * 100;
    score += distanceScore;

    const labelText = this.getCheckboxLabel(checkbox).toLowerCase();

    let keywordScore = 0;
    CHECKBOX_POSITIVE_KEYWORDS.forEach(keyword => {
      if (labelText.includes(keyword)) {
        keywordScore += 50;
      }
    });
    // 命中负向关键词（订阅/营销/通知等）的复选框与「记住我/同意条款」无关，
    // 点它会订阅邮件、开启推送等——直接判负淘汰，而不是仅按 -30 扣分后再被距离分拉回。
    const hasNegativeKeyword = CHECKBOX_NEGATIVE_KEYWORDS.some(keyword => labelText.includes(keyword));
    if (hasNegativeKeyword) {
      return Number.NEGATIVE_INFINITY;
    }
    score += keywordScore;

    score += this.calculatePositionScore(referenceField, checkbox);

    const refForm = referenceField.closest('form');
    const checkboxForm = checkbox.closest('form');
    if (refForm && checkboxForm && refForm === checkboxForm) {
      score += 30;
    }

    score += this.calculateHierarchyScore(referenceField, checkbox);

    return score;
  }

  /**
   * 计算两个元素之间的精确像素距离
   * @param elem1 - 元素1
   * @param elem2 - 元素2
   * @returns 两元素边界之间的欧几里得距离
   */
  private calculateAccurateDistance(elem1: HTMLElement, elem2: HTMLElement): number {
    const rect1 = elem1.getBoundingClientRect();
    const rect2 = elem2.getBoundingClientRect();

    let dx = 0;
    let dy = 0;

    if (rect1.right < rect2.left) {
      dx = rect2.left - rect1.right;
    } else if (rect2.right < rect1.left) {
      dx = rect1.left - rect2.right;
    }

    if (rect1.bottom < rect2.top) {
      dy = rect2.top - rect1.bottom;
    } else if (rect2.bottom < rect1.top) {
      dy = rect1.top - rect2.bottom;
    }

    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 根据复选框相对于参考字段的位置计算得分
   * 在参考字段下方且水平对齐的复选框得分更高
   * @param referenceField - 参考字段
   * @param checkbox - 复选框
   * @returns 位置得分
   */
  private calculatePositionScore(referenceField: HTMLElement, checkbox: HTMLElement): number {
    const refRect = referenceField.getBoundingClientRect();
    const checkboxRect = checkbox.getBoundingClientRect();
    let score = 0;

    if (checkboxRect.top > refRect.bottom) {
      const verticalDistance = checkboxRect.top - refRect.bottom;
      if (verticalDistance < 100) {
        score += 40;
      } else if (verticalDistance < 200) {
        score += 20;
      }
    }

    const horizontalOverlap = Math.min(refRect.right, checkboxRect.right) - Math.max(refRect.left, checkboxRect.left);
    if (horizontalOverlap > 0) {
      score += 15;
    }

    return score;
  }

  /**
   * 根据 DOM 层级关系计算得分
   * 公共祖先越近得分越高
   * @param referenceField - 参考字段
   * @param checkbox - 复选框
   * @returns 层级得分
   */
  private calculateHierarchyScore(referenceField: HTMLElement, checkbox: HTMLElement): number {
    let score = 0;
    const commonAncestor = this.findCommonAncestor(referenceField, checkbox);
    if (commonAncestor) {
      const refDepth = this.getDepthFromAncestor(referenceField, commonAncestor);
      const checkboxDepth = this.getDepthFromAncestor(checkbox, commonAncestor);
      const totalDepth = refDepth + checkboxDepth;
      if (totalDepth <= 4) {
        score += 25;
      } else if (totalDepth <= 8) {
        score += 15;
      } else if (totalDepth <= 12) {
        score += 5;
      }
    }
    return score;
  }

  /**
   * 查找两个元素的最近公共祖先
   * @param elem1 - 元素1
   * @param elem2 - 元素2
   * @returns 最近公共祖先，若无则返回 null
   */
  private findCommonAncestor(elem1: HTMLElement, elem2: HTMLElement): HTMLElement | null {
    const ancestors1: HTMLElement[] = [];
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

  /**
   * 计算元素到指定祖先的 DOM 深度
   * @param elem - 目标元素
   * @param ancestor - 祖先元素
   * @returns 深度值
   */
  private getDepthFromAncestor(elem: HTMLElement, ancestor: HTMLElement): number {
    let depth = 0;
    let current = elem.parentElement;
    while (current && current !== ancestor) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  /**
   * 按 `for` 属性查找复选框关联的 label
   *
   * id 来自宿主页面、属不可信输入：裸插值遇到含引号/反斜杠的 id 会抛 DOMException
   * （调用点多在检测路径上，异常会被上层吞掉，表现为「记住我」判定莫名失效），
   * 故统一走 CSS.escape 后再拼选择器。
   * @param checkbox - 复选框元素
   * @returns 命中的 label 元素，未命中或 id 为空时返回 null
   */
  private queryLabelByFor(checkbox: HTMLInputElement): HTMLElement | null {
    if (!checkbox.id) return null;
    return document.querySelector<HTMLElement>(`label[for=${CSS.escape(checkbox.id)}]`);
  }

  /**
   * 获取复选框关联的文本标签
   * 原生 input 依次尝试：for 属性关联的 label、父级 label、前后兄弟元素、父元素文本；
   * role="checkbox" 模拟复选框依次尝试：aria-label、aria-labelledby、前后兄弟元素、父元素文本
   * @param checkbox - 复选框元素
   * @returns 标签文本
   */
  private getCheckboxLabel(checkbox: HTMLElement): string {
    if (checkbox instanceof HTMLInputElement) {
      if (checkbox.id) {
        const label = this.queryLabelByFor(checkbox);
        if (label) {
          return label.textContent?.trim() || '';
        }
      }

      const parentLabel = checkbox.closest('label');
      if (parentLabel) {
        return parentLabel.textContent?.trim() || '';
      }
    } else {
      const ariaLabel = checkbox.getAttribute('aria-label')?.trim();
      if (ariaLabel) {
        return ariaLabel;
      }
      const labelledBy = checkbox.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        if (text) {
          return text;
        }
      }
    }

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

    const parent = checkbox.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true) as HTMLElement;
      // 两种载体都要从副本中剔除控件自身，避免其内部文本（如图标）混入标签
      clone.querySelectorAll('input[type="checkbox"], [role="checkbox"]').forEach(node => node.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }

    const fallbackName = checkbox instanceof HTMLInputElement ? checkbox.name : '';
    return fallbackName || checkbox.id || checkbox.className || '未知复选框';
  }

  /**
   * 判断复选框是否处于勾选态
   * 原生 input 读 checked；role="checkbox" 模拟复选框读 aria-checked
   * （'true' 与 'mixed' 均视为已勾选：mixed 是不确定态，单击会翻到对侧而非期望的勾选）
   * @param checkbox - 复选框元素
   * @returns 是否已勾选
   */
  private isCheckboxChecked(checkbox: HTMLElement): boolean {
    if (checkbox instanceof HTMLInputElement) {
      return checkbox.checked;
    }
    const ariaChecked = checkbox.getAttribute('aria-checked');
    return ariaChecked === 'true' || ariaChecked === 'mixed';
  }

  /**
   * 尝试多种方式勾选复选框
   * 依次尝试：直接 click、设置 checked 属性 + 事件、点击 label、模拟鼠标交互
   * @param checkbox - 要勾选的复选框
   */
  private checkCheckbox(checkbox: HTMLInputElement): void {
    try {
      if (checkbox.disabled) {
        return;
      }

      checkbox.click();

      setTimeout(() => {
        if (!checkbox.checked) {
          checkbox.checked = true;

          // 刻意不派发合成 click：click 的默认动作就是再切一次 checked，站点监听器读到
          // true 之后浏览器立刻翻回 false，兜底反而取消了上一步的强制勾选。真实 click
          // 已在第一层 `checkbox.click()` 给过，这里只补齐 change/input 通知。
          const events = [
            new Event('change', { bubbles: true, cancelable: true }),
            new Event('input', { bubbles: true, cancelable: true }),
            new Event('focus', { bubbles: true }),
            new Event('blur', { bubbles: true }),
          ];

          events.forEach(event => {
            try {
              checkbox.dispatchEvent(event);
            } catch (_e) {
              // 触发事件失败，忽略
            }
          });

          setTimeout(() => {
            if (!checkbox.checked) {
              const label = this.findCheckboxLabel(checkbox);
              if (label) {
                label.click();
                setTimeout(() => {
                  if (!checkbox.checked) {
                    this.simulateUserInteraction(checkbox);
                  }
                }, 100);
              } else {
                this.simulateUserInteraction(checkbox);
              }
            }
          }, 100);
        }
      }, 100);
    } catch (error) {
      logger.error('勾选复选框失败:', error);
    }
  }

  /**
   * 尝试勾选 role="checkbox" 模拟复选框
   *
   * 受控组件（Radix 等）的勾选态由页面 JS 从 state 同步到 aria-checked，没有可强设的
   * 原生 checked：自行改写 aria-checked 只会骗过复检（页面下次渲染即覆盖），真实状态
   * 并未变化。因此真实的程序化点击是唯一可靠路径；失败不重试——盲发第二次点击会把
   * 已勾上的状态又翻回去，150ms 后复检未生效仅记录告警（不含页面数据）。
   * @param checkbox - 模拟复选框元素
   */
  private checkAriaCheckbox(checkbox: HTMLElement): void {
    // SPA 重渲染后的陈旧节点：点击是静默空操作，且复检读到的永远是旧属性，
    // 提前退出避免把「节点已失效」误报成「页面未响应程序化点击」
    if (!checkbox.isConnected) {
      return;
    }
    // 页面回写落地前的重复调用直接跳过：第二次点击会把刚勾上的状态翻回未勾选
    if (this.ariaClickPending.has(checkbox)) {
      return;
    }
    this.ariaClickPending.add(checkbox);

    try {
      checkbox.click();

      setTimeout(() => {
        this.ariaClickPending.delete(checkbox);
        if (checkbox.isConnected && !this.isCheckboxChecked(checkbox)) {
          logger.warn('自动勾选 role="checkbox" 模拟复选框未生效（页面可能未响应程序化点击）');
        }
      }, 150);
    } catch (error) {
      this.ariaClickPending.delete(checkbox);
      logger.error('勾选模拟复选框失败:', error);
    }
  }

  /**
   * 查找复选框关联的 label 元素
   * @param checkbox - 复选框元素
   * @returns 关联的 label 元素，若无则返回 null
   */
  private findCheckboxLabel(checkbox: HTMLInputElement): HTMLElement | null {
    if (checkbox.id) {
      const label = this.queryLabelByFor(checkbox);
      if (label) {
        return label;
      }
    }

    const parentLabel = checkbox.closest('label');
    if (parentLabel) {
      return parentLabel;
    }

    const container = checkbox.parentElement;
    if (container) {
      const containerLabels = container.querySelectorAll('label');
      if (containerLabels.length === 1) {
        return containerLabels[0] as HTMLElement;
      }
    }

    return null;
  }

  /**
   * 模拟用户鼠标交互来勾选复选框（最后手段）
   *
   * 只派发 mousedown/mouseup 与 change/input，不派发 click：理由同 `checkCheckbox`，
   * click 的默认动作会把刚强制置位的 checked 再翻回去。
   * @param checkbox - 复选框元素
   */
  private simulateUserInteraction(checkbox: HTMLInputElement): void {
    try {
      const rect = checkbox.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const mouseEvents = [
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, button: 0 }),
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, button: 0 }),
      ];

      const originalValue = checkbox.checked;
      checkbox.checked = !originalValue;

      mouseEvents.forEach(event => {
        checkbox.dispatchEvent(event);
      });

      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      logger.error('模拟交互失败:', error);
    }
  }
}
