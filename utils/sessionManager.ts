import { StorageUtils } from './storage';

/**
 * 全局会话管理器
 */
class SessionManager {
  private static instance: SessionManager;
  private sessionCheckInterval: number | null = null;

  private constructor() {
    console.log('SessionManager: 构造函数');
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SessionManager {
    console.log('SessionManager: 获取单例实例');
    if (!SessionManager.instance) {
      console.log('SessionManager: 创建新实例');
      SessionManager.instance = new SessionManager();
    }
    console.log('SessionManager: 返回实例');
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

    console.log('SessionManager: 启动会话检查');
    // 每分钟检查一次会话状态
    this.sessionCheckInterval = window.setInterval(async () => {
      try {
        console.log('SessionManager: 开始检查会话状态');
        const isSessionValid = await StorageUtils.isSessionValid();
        console.log('SessionManager: 会话检查结果', isSessionValid);
        if (!isSessionValid) {
          // 会话已过期，触发过期事件
          console.log('SessionManager: 会话已过期，触发过期事件');
          this.handleSessionExpired();
        }
      } catch (error) {
        console.error('SessionManager: 会话检查失败:', error);
      }
    }, 60000); // 每分钟检查一次
    console.log('SessionManager: 会话检查启动完成');
  }

  /**
   * 停止会话检查
   */
  stopSessionCheck(): void {
    console.log('SessionManager: 停止会话检查');
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
      console.log('SessionManager: 会话检查已停止');
    }
  }

  /**
   * 处理会话过期
   */
  private handleSessionExpired(): void {
    console.log('SessionManager: 处理会话过期');
    // 触发自定义事件，通知其他组件会话已过期
    window.dispatchEvent(new CustomEvent('sessionExpired'));
    
    // 清除会话
    StorageUtils.clearSession();
    console.log('SessionManager: 会话过期处理完成');
  }

  /**
   * 初始化会话管理器
   */
  init(): void {
    console.log('SessionManager: 初始化会话管理器');
    // 启动会话检查
    this.startSessionCheck();
    
    // 监听页面卸载事件，清除会话
    window.addEventListener('beforeunload', () => {
      console.log('SessionManager: 页面卸载，停止会话检查');
      this.stopSessionCheck();
    });
    console.log('SessionManager: 会话管理器初始化完成');
  }
}

// 创建并导出单例实例
export const sessionManager = SessionManager.getInstance();

// 默认初始化会话管理器
sessionManager.init();