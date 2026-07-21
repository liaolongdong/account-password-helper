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
  main(ctx) {
    // 仅顶层 frame 渲染悬浮按钮，避免每个 iframe 都重复注入 UI 造成重复与定位错乱
    const isTopFrame = window === window.top;

    // 初始化表单检测器（所有 frame 都需要）
    const formDetector = new FormDetector();

    // 初始化登录自动保存（所有 frame 都需要，以便捕获 iframe 内的登录表单）
    const loginAutoSave = new LoginAutoSave();

    // 预唤醒 SW：用户聚焦表单输入框时，很可能即将使用侧边栏快速填充
    // 提前发送消息唤醒 SW，与用户操作并行，消除后续 sidePanel.open() 的冷启动延迟。
    // 统一通过 ctx.addEventListener 注册：扩展上下文失效时 WXT 会自动移除监听器，
    // 避免旧 content script 残留回调继续调用 chrome API 抛出 "Extension context invalidated"。
    ctx.addEventListener(
      document,
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

    // 被动预唤醒：用户切换回当前标签页时（页面变为可见），预唤醒 SW。
    // 覆盖用户从其他应用切回 Chrome 后直接使用快捷键 Cmd+Shift+L 打开侧边栏的场景，
    // 此时可能尚未聚焦表单输入框或 hover 悬浮按钮，需要 visibilitychange 作为兜底。
    if (isTopFrame) {
      ctx.addEventListener(document, 'visibilitychange', () => {
        if (!document.hidden) {
          preWarmServiceWorker();
        }
      });
    }

    // 仅顶层 frame 初始化悬浮按钮管理器
    if (isTopFrame) {
      // 页面加载完成后预唤醒 SW：用户在页面初期就可能使用快捷键 Ctrl+Shift+L 打开侧边栏，
      // 提前触发 SW 启动可消除冷启动延迟。延迟 100ms 避免阻塞页面首屏渲染。
      // 使用 ctx.setTimeout：上下文失效时自动清除，避免延迟回调在失效后仍执行预热。
      ctx.setTimeout(() => preWarmServiceWorker(), 100);

      const floatingButtonManager = getFloatingButtonManager();
      floatingButtonManager.init().catch(error => {
        logger.error('FloatingButtonManager 初始化失败:', error);
      });

      // 监听来自 iframe 的保存弹窗委托请求
      // iframe 中的 LoginAutoSave 捕获凭证后，通过 postMessage 委托顶层 frame 渲染弹窗，
      // 确保弹窗出现在整个页面右上角而非被限制在 iframe 小视口内
      ctx.addEventListener(window, 'message', event => {
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

    // 统一清理逻辑：销毁各实例注册的事件监听器、MutationObserver 与注入 UI。
    // 各 destroy() 均为幂等实现，可安全地被多次/多入口调用。
    const cleanup = (): void => {
      formDetector.destroy();
      loginAutoSave.destroy();
      if (isTopFrame) {
        destroyFloatingButtonManager();
      }
    };

    // 扩展上下文失效（扩展重载/更新/禁用）时主动清理，
    // 从根源消除残留监听器在失效后调用 chrome API 触发 "Extension context invalidated" 的问题。
    ctx.onInvalidated(cleanup);

    // 页面正常卸载（导航/关闭标签页）时清理
    ctx.addEventListener(window, 'beforeunload', cleanup);
  },
});
