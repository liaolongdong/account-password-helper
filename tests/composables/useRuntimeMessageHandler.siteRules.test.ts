/** @vitest-environment jsdom */

/**
 * useRuntimeMessageHandler 对 OPEN_OPTIONS_AND_SITE_RULES 的分发回归测试
 *
 * 背景：内容脚本「填充失败就地引导」经 Background 转发到选项页，由该 composable
 * 决定「打开站点规则弹窗并带上预填域名」。这里锁住两条对外契约：
 * 带域名 → 原样交给 openSiteRules；不带 → 以无参调用（与菜单/命令面板入口同形）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, ref } from 'vue';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { MessageType, type PasswordEntry } from '@/utils/types';

/** 捕获到的 runtime 消息监听器 */
let registeredListener:
  | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => unknown)
  | undefined;

/** 以最小宿主组件挂载 composable，触发 onMounted 注册 */
function mountHandler(openSiteRules: (domain?: string) => void): () => void {
  const app = createApp({
    setup() {
      useRuntimeMessageHandler({
        passwords: ref<PasswordEntry[]>([]),
        isAuthenticated: ref(true),
        handleSessionExpired: vi.fn(),
        editPassword: vi.fn(),
        openPasswordDialog: vi.fn(),
        openSiteRules,
      });
      return () => h('div');
    },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  return () => {
    app.unmount();
    host.remove();
  };
}

beforeEach(() => {
  registeredListener = undefined;
  (globalThis as any).chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: {
        addListener: vi.fn(listener => {
          registeredListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  vi.restoreAllMocks();
});

describe('OPEN_OPTIONS_AND_SITE_RULES 分发', () => {
  it('携带域名时在会话状态落地后交给 openSiteRules', async () => {
    const openSiteRules = vi.fn();
    const unmount = mountHandler(openSiteRules);

    registeredListener?.(
      { type: MessageType.OPEN_OPTIONS_AND_SITE_RULES, data: { domain: 'example.com' } },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );
    // 冷启动场景下需先等会话状态落地，否则会把已解锁误判成未解锁
    expect(openSiteRules).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(openSiteRules).toHaveBeenCalledWith('example.com'));
    unmount();
  });

  it('无载荷时以无参调用，行为与「安全设置」菜单入口一致', async () => {
    const openSiteRules = vi.fn();
    const unmount = mountHandler(openSiteRules);

    registeredListener?.(
      { type: MessageType.OPEN_OPTIONS_AND_SITE_RULES },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );

    await vi.waitFor(() => expect(openSiteRules).toHaveBeenCalledWith(undefined));
    unmount();
  });

  it('卸载时移除监听器，避免上下文失效后残留触发', () => {
    const removeListener = (globalThis as any).chrome.runtime.onMessage.removeListener;
    const unmount = mountHandler(vi.fn());
    const listener = registeredListener;

    unmount();

    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
