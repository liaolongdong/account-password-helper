import { logger } from '@/utils/logger';
import { CHECKBOX_POSITIVE_KEYWORDS, CHECKBOX_NEGATIVE_KEYWORDS } from '@/entrypoints/content/formSelectors';

/**
 * 复选框处理器
 * 负责在登录表单中自动勾选协议/记住密码等复选框，
 * 通过打分算法找到最合适的复选框并尝试多种方式勾选
 */
export class CheckboxHandler {
  /**
   * 自动勾选距离参考字段最近的合适复选框
   * @param checkboxFields - 页面中检测到的复选框列表
   * @param passwordFields - 密码输入框列表
   * @param usernameFields - 用户名输入框列表
   */
  autoCheckNearestCheckbox(
    checkboxFields: HTMLInputElement[],
    passwordFields: HTMLInputElement[],
    usernameFields: HTMLInputElement[],
  ): void {
    if (checkboxFields.length === 0) {
      return;
    }

    const referenceField =
      passwordFields.length > 0 ? passwordFields[0] : usernameFields.length > 0 ? usernameFields[0] : null;

    if (!referenceField) {
      return;
    }

    const targetCheckbox = this.findBestCheckbox(referenceField, checkboxFields);

    if (targetCheckbox && !targetCheckbox.checked) {
      this.checkCheckbox(targetCheckbox);
    }
  }

  /**
   * 根据打分算法找到最合适的复选框
   * @param referenceField - 参考字段（通常是密码或用户名输入框）
   * @param checkboxFields - 候选复选框列表
   * @returns 得分最高的复选框，若无候选则返回 null
   */
  private findBestCheckbox(
    referenceField: HTMLInputElement,
    checkboxFields: HTMLInputElement[],
  ): HTMLInputElement | null {
    let bestCheckbox: HTMLInputElement | null = null;
    let bestScore = -1;

    checkboxFields.forEach(checkbox => {
      const score = this.calculateCheckboxScore(referenceField, checkbox);
      if (score > bestScore) {
        bestScore = score;
        bestCheckbox = checkbox;
      }
    });

    return bestCheckbox;
  }

  /**
   * 计算复选框的综合得分
   * 综合考虑距离、关键词、位置、表单归属和 DOM 层级关系
   * @param referenceField - 参考字段
   * @param checkbox - 待评分的复选框
   * @returns 综合得分
   */
  private calculateCheckboxScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
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
    CHECKBOX_NEGATIVE_KEYWORDS.forEach(keyword => {
      if (labelText.includes(keyword)) {
        keywordScore -= 30;
      }
    });
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
  private calculatePositionScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
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
  private calculateHierarchyScore(referenceField: HTMLInputElement, checkbox: HTMLInputElement): number {
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
   * 获取复选框关联的文本标签
   * 依次尝试：for 属性关联的 label、父级 label、前后兄弟元素、父元素文本
   * @param checkbox - 复选框元素
   * @returns 标签文本
   */
  private getCheckboxLabel(checkbox: HTMLInputElement): string {
    if (checkbox.id) {
      const label = document.querySelector(`label[for="${checkbox.id}"]`);
      if (label) {
        return label.textContent?.trim() || '';
      }
    }

    const parentLabel = checkbox.closest('label');
    if (parentLabel) {
      return parentLabel.textContent?.trim() || '';
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
      const checkboxClone = clone.querySelector('input[type="checkbox"]');
      if (checkboxClone) {
        checkboxClone.remove();
      }
      const text = clone.textContent?.trim();
      if (text) return text;
    }

    return checkbox.name || checkbox.id || checkbox.className || '未知复选框';
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

          const events = [
            new Event('change', { bubbles: true, cancelable: true }),
            new Event('input', { bubbles: true, cancelable: true }),
            new MouseEvent('click', { bubbles: true, cancelable: true }),
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
   * 查找复选框关联的 label 元素
   * @param checkbox - 复选框元素
   * @returns 关联的 label 元素，若无则返回 null
   */
  private findCheckboxLabel(checkbox: HTMLInputElement): HTMLElement | null {
    if (checkbox.id) {
      const label = document.querySelector(`label[for="${checkbox.id}"]`);
      if (label) {
        return label as HTMLElement;
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
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, button: 0 }),
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
