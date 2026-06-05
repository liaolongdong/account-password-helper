import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';

/**
 * 全局会话管理器
 */
class SessionManager {
  private static instance: SessionManager;
  private sessionCheckInterval: number | null = null;

  private constructor() {
    // 构造函数保持空实现
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * 启动会话检查
   */
  startSessionCheck(): void {
    // 如果已经存在检查间隔，先清除
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }

    // 每分钟检查一次会话状态
    this.sessionCheckInterval = window.setInterval(async () => {
      try {
        const isSessionValid = await StorageUtils.isSessionValid();
        if (!isSessionValid) {
          // 会话已过期，触发过期事件
          this.handleSessionExpired();
        }
      } catch (error) {
        logger.error('SessionManager: 会话检查失败:', error);
      }
    }, 60000); // 每分钟检查一次
  }

  /**
   * 停止会话检查
   */
  stopSessionCheck(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
  }

  /**
   * 处理会话过期
   */
  private async handleSessionExpired(): Promise<void> {
    // 先加密存储密码，再通知 UI
    await StorageUtils.clearSession();
    window.dispatchEvent(new CustomEvent('sessionExpired'));
  }

  /**
   * 初始化会话管理器
   */
  init(): void {
    // 启动会话检查
    this.startSessionCheck();

    // 监听页面卸载事件，清除会话
    window.addEventListener('beforeunload', () => {
      this.stopSessionCheck();
    });
  }
}

// 创建并导出单例实例
export const sessionManager = SessionManager.getInstance();

// 默认初始化会话管理器
sessionManager.init();
