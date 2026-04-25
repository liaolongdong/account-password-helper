import { FillStrategy } from '../../utils/types';
import { logger } from '../../utils/logger';

/**
 * 输入填充结果
 */
export interface InputFillResult {
  /** 是否成功填充 */
  filled: boolean;
  /** 填充值是否与预期一致 */
  verified: boolean;
  /** 使用的填充策略 */
  strategy: FillStrategy;
}

/**
 * 输入框填充器
 * 提供多种策略来填充表单输入框的值，依次尝试直到成功：
 * 1. 原生 setter + 完整事件序列
 * 2. execCommand 模拟用户输入
 * 3. 逐字符模拟输入
 */
export class InputFiller {
  /**
   * 使用多种策略依次尝试填充输入框
   * @param input - 目标输入框元素
   * @param value - 要填充的值
   * @returns 填充结果，包含是否成功、是否验证通过及使用的策略
   */
  async setInputValueWithStrategies(input: HTMLInputElement, value: string): Promise<InputFillResult> {
    // 策略1: 原生setter + 完整事件序列
    this.setInputValueNative(input, value);
    await this.delay(50);
    if (input.value === value) {
      return { filled: true, verified: true, strategy: 'native' };
    }

    // 策略2: execCommand模拟用户输入
    this.setInputValueExecCommand(input, value);
    await this.delay(50);
    if (input.value === value) {
      return { filled: true, verified: true, strategy: 'execCommand' };
    }

    // 策略3: 模拟逐字符输入
    await this.setInputValueSimulate(input, value);
    await this.delay(50);
    if (input.value === value) {
      return { filled: true, verified: true, strategy: 'simulate' };
    }

    const filled = input.value.length > 0;
    return { filled, verified: input.value === value, strategy: 'native' };
  }

  /**
   * 使用原生 value setter 和完整事件序列填充输入框
   * @param input - 目标输入框元素
   * @param value - 要填充的值
   */
  setInputValueNative(input: HTMLInputElement, value: string): void {
    try {
      input.focus();
      input.select();
      document.execCommand('selectAll');
      document.execCommand('delete');

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
      } else {
        input.value = value;
      }

      const events = [
        new Event('focus', { bubbles: true }),
        new Event('input', { bubbles: true, cancelable: true }),
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: 'insertText',
        }),
        new Event('change', { bubbles: true, cancelable: true }),
      ];

      events.forEach(event => {
        try {
          input.dispatchEvent(event);
        } catch (_e) {
          // 事件分发失败，忽略
        }
      });

      setTimeout(() => {
        try {
          input.blur();
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch (_e) {
          // blur事件失败，忽略
        }
      }, 100);
    } catch (error) {
      logger.error('原生策略填充失败:', error);
      input.value = value;
    }
  }

  /**
   * 使用 execCommand 方式填充输入框
   * @param input - 目标输入框元素
   * @param value - 要填充的值
   */
  private setInputValueExecCommand(input: HTMLInputElement, value: string): void {
    try {
      input.focus();
      input.select();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_error) {
      // execCommand策略失败，忽略
    }
  }

  /**
   * 逐字符模拟用户键盘输入
   * @param input - 目标输入框元素
   * @param value - 要填充的值
   */
  private async setInputValueSimulate(input: HTMLInputElement, value: string): Promise<void> {
    try {
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      for (const char of value) {
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }));
        input.value += char;
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, cancelable: true, data: char, inputType: 'insertText' }),
        );
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
        await this.delay(10);
      }

      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_error) {
      // 模拟输入策略失败，忽略
    }
  }

  /**
   * 延迟指定毫秒数
   * @param ms - 延迟时间（毫秒）
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
