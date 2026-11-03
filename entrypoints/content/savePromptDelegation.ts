import { MessageType, type RuntimeMessage, type SavePromptDecision } from '@/utils/types';
import { showSavePasswordPrompt, dismissSavePasswordPrompt } from './SavePasswordPrompt';
import { showNativeNotification } from './NativeNotification';
import { tl } from '@/utils/i18n-lite';

/** 顶层文档的可信保存确认入口；返回幂等清理函数，供 WXT 生命周期持有。 */
export function setupSavePromptDelegation(): () => void {
  let activeId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const clear = (): void => {
    activeId = null;
    if (timer) clearTimeout(timer);
    timer = null;
    // 同一顶层文档至多一张保存卡片（showSavePasswordPrompt 起手即 dismiss），
    // 因此这里回收的就是本次委托渲染的那一张。
    dismissSavePasswordPrompt();
  };
  const listener = (
    message: RuntimeMessage,
    sender: chrome.runtime.MessageSender,
    reply: (response: { success: boolean }) => void,
  ): boolean => {
    // Background 发来的消息无 sender.tab；页面脚本不能调用扩展内部 runtime API。
    if (disposed || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.type === MessageType.CANCEL_DELEGATED_SAVE_PROMPT) {
      if (message.data.requestId === activeId) clear();
      reply({ success: true });
      return false;
    }
    if (message.type !== MessageType.SHOW_DELEGATED_SAVE_PROMPT) return false;
    clear();
    const { requestId, prompt } = message.data;
    const decide = (decision: SavePromptDecision): void => {
      if (disposed || activeId !== requestId) return;
      clear();
      void chrome.runtime
        .sendMessage({ type: MessageType.SAVE_PROMPT_DECISION, data: { requestId, decision } })
        .then(response => {
          if (!response?.success && !disposed) showNativeNotification(tl('cs.notify.saveFailedRetry'), 'warning');
        })
        .catch(() => {
          if (!disposed) showNativeNotification(tl('cs.notify.saveFailedRetry'), 'warning');
        });
    };
    try {
      activeId = requestId;
      showSavePasswordPrompt(
        prompt,
        editedData => decide({ action: 'save', editedData }),
        () => decide({ action: 'dismiss' }),
        () => decide({ action: 'neverAsk' }),
      );
      timer = setTimeout(clear, 30_000);
      reply({ success: true });
    } catch {
      clear();
      reply({ success: false });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    if (disposed) return;
    disposed = true;
    activeId = null;
    if (timer) clearTimeout(timer);
    timer = null;
    dismissSavePasswordPrompt();
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {
      // 扩展上下文失效时 Chrome 已回收运行时监听器。
    }
  };
}
