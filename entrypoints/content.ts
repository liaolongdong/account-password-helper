import { defineContentScript } from '#imports';
import { FormDetector } from './content/FormDetector';
import { getFloatingButtonManager, destroyFloatingButtonManager } from './content/floatingButtons';
import { logger } from '../utils/logger';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // 初始化表单检测器
    const formDetector = new FormDetector();

    // 初始化悬浮按钮管理器
    const floatingButtonManager = getFloatingButtonManager();
    floatingButtonManager.init().catch(error => {
      logger.error('FloatingButtonManager 初始化失败:', error);
    });

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
      formDetector.destroy();
      destroyFloatingButtonManager();
    });
  },
});
