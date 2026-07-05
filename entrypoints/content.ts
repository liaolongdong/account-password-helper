import { defineContentScript } from '#imports';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { LoginAutoSave } from '@/entrypoints/content/LoginAutoSave';
import { getFloatingButtonManager, destroyFloatingButtonManager } from '@/entrypoints/content/floatingButtons';
import { showSavePasswordPrompt } from '@/entrypoints/content/SavePasswordPrompt';
import type { SavePromptData, SavePromptEditedData, NotificationType } from '@/entrypoints/content/types';
import { showNativeNotification } from '@/entrypoints/content/NativeNotification';
import { PostMessageType, isSameMainDomain } from '@/utils/domain';
import { logger } from '@/utils/logger';
import { preWarmServiceWorker } from '@/utils/preWarmSw';

export default defineContentScript({
  matches: ['<all_urls>'],
  // 注入到所有 frame（含 iframe），让 iframe 内的登录表单也能被检测和填充
  allFrames: true,
  main() {
    // 仅顶层 frame 渲染悬浮按钮，避免每个 iframe 都重复注入 UI 造成重复与定位错乱
    const isTopFrame = window === window.top;

    // 初始化表单检测器（所有 frame 都需要）
    const formDetector = new FormDetector();

    // 初始化登录自动保存（所有 frame 都需要，以便捕获 iframe 内的登录表单）
    const loginAutoSave = new LoginAutoSave();

    // 预唤醒 SW：用户聚焦表单输入框时，很可能即将使用侧边栏快速填充
    // 提前发送消息唤醒 SW，与用户操作并行，消除后续 sidePanel.open() 的冷启动延迟
    document.addEventListener(
      'focusin',
      e => {
        const target = e.target as HTMLElement;
        if (
          target instanceof HTMLInputElement &&
          (target.type === 'password' || target.type === 'text' || target.type === 'email' || target.type === 'tel')
        ) {
          preWarmServiceWorker();
        }
      },
      { capture: true },
    );

    // 仅顶层 frame 初始化悬浮按钮管理器
    if (isTopFrame) {
      const floatingButtonManager = getFloatingButtonManager();
      floatingButtonManager.init().catch(error => {
        logger.error('FloatingButtonManager 初始化失败:', error);
      });

      // 监听来自 iframe 的保存弹窗委托请求
      // iframe 中的 LoginAutoSave 捕获凭证后，通过 postMessage 委托顶层 frame 渲染弹窗，
      // 确保弹窗出现在整个页面右上角而非被限制在 iframe 小视口内
      window.addEventListener('message', event => {
        // 处理来自 iframe 的通知委托（无需同主域名校验，跨域场景也需要通知）
        if (event.data?.type === PostMessageType.SHOW_NOTIFICATION) {
          const { message, type } = event.data.data as { message: string; type: NotificationType };
          showNativeNotification(message, type);
          return;
        }

        // 安全校验：仅接受同主域名 iframe 的委托请求
        if (!isSameMainDomain(event.origin, location.origin)) return;
        if (event.data?.type !== PostMessageType.SHOW_SAVE_PROMPT) return;

        const { requestId, data } = event.data as {
          requestId: string;
          data: SavePromptData;
        };
        const source = event.source as Window | null;
        if (!source) return;

        showSavePasswordPrompt(
          data,
          // onSave：回传编辑后的标签和备注
          (editedData: SavePromptEditedData) => {
            source.postMessage(
              { type: PostMessageType.SAVE_PROMPT_RESULT, requestId, action: 'save', editedData },
              { targetOrigin: event.origin },
            );
          },
          // onDismiss
          () => {
            source.postMessage(
              { type: PostMessageType.SAVE_PROMPT_RESULT, requestId, action: 'dismiss' },
              { targetOrigin: event.origin },
            );
          },
          // onNeverAsk
          () => {
            source.postMessage(
              { type: PostMessageType.SAVE_PROMPT_RESULT, requestId, action: 'neverAsk' },
              { targetOrigin: event.origin },
            );
          },
        );
      });
    }

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
      formDetector.destroy();
      loginAutoSave.destroy();
      if (isTopFrame) {
        destroyFloatingButtonManager();
      }
    });
  },
});
