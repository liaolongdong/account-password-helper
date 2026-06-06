import { isDev } from '@/utils/env';

/**
 * 日志工具类
 * 根据环境自动控制日志输出，生产环境禁用调试日志
 */
class Logger {
  private isDev: boolean;

  constructor() {
    // 统一从 utils/env 读取环境标识，Vite 会在构建期静态替换
    this.isDev = isDev;
  }

  /**
   * 调试日志 - 仅开发环境输出
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.isDev) {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * 信息日志 - 仅开发环境输出
   */
  info(message: string, ...args: unknown[]): void {
    if (this.isDev) {
      // eslint-disable-next-line no-console
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * 警告日志 - 始终输出
   */
  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  /**
   * 错误日志 - 始终输出
   */
  error(message: string, error?: unknown): void {
    console.error(`[ERROR] ${message}`, error);
  }

  /**
   * 分组日志 - 仅开发环境输出
   */
  group(label: string): void {
    if (this.isDev) {
      // eslint-disable-next-line no-console
      console.group(label);
    }
  }

  /**
   * 结束分组日志
   */
  groupEnd(): void {
    if (this.isDev) {
      // eslint-disable-next-line no-console
      console.groupEnd();
    }
  }
}

// 导出单例实例
export const logger = new Logger();
