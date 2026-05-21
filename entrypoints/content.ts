import { defineContentScript } from '#imports';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { getFloatingButtonManager, destroyFloatingButtonManager } from '@/entrypoints/content/floatingButtons';
import { logger } from '@/utils/logger';

export default defineContentScript({
  matches: ['<all_urls>'],
  // 注入到所有 frame（含 iframe），让 iframe 内的登录表单也能被检测和填充
  allFrames: true,
  main() {
    // 仅顶层 frame 渲染悬浮按钮，避免每个 iframe 都重复注入 UI 造成重复与定位错乱
    const isTopFrame = window === window.top;

    // 初始化表单检测器（所有 frame 都需要）
    const formDetector = new FormDetector();

    // 仅顶层 frame 初始化悬浮按钮管理器
    if (isTopFrame) {
      const floatingButtonManager = getFloatingButtonManager();
      floatingButtonManager.init().catch(error => {
        logger.error('FloatingButtonManager 初始化失败:', error);
      });
    }

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
      formDetector.destroy();
      if (isTopFrame) {
        destroyFloatingButtonManager();
      }
    });
  },
});
