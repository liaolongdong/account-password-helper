/** @vitest-environment jsdom */

/**
 * useRuntimeMessageHandler 对 OPEN_OPTIONS_AND_DOMAIN_MATCH 的分发测试
 *
 * 锁住跨子域匹配设置深链的对外契约：内容脚本/侧边栏的引导经 Background 转发到选项页后，
 * 必须等密码列表/会话状态落地再打开设置弹窗，且未接线该回调时静默降级（不抛错）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, ref } from 'vue';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { MessageType, type PasswordEntry } from '@/utils/types';

/** 捕获到的 runtime 消息监听器 */
let registeredListener: ((message: unknown) => unknown) | undefined;

/** 以最小宿主组件挂载 composable，触发 onMounted 注册 */
function mountHandler(
  options: { openDomainMatchSetting?: () => void; handleSessionExpired?: () => void } = {},
): () => void {
  const app = createApp({
    setup() {
      useRuntimeMessageHandler({
        passwords: ref<PasswordEntry[]>([]),
        isAuthenticated: ref(true),
        handleSessionExpired: options.handleSessionExpired ?? vi.fn(),
        editPassword: vi.fn(),
        openPasswordDialog: vi.fn(),
        openDomainMatchSetting: options.openDomainMatchSetting,
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

describe('OPEN_OPTIONS_AND_DOMAIN_MATCH 分发', () => {
  it('在密码列表/会话状态落地后打开跨子域匹配设置弹窗', async () => {
    const openDomainMatchSetting = vi.fn();
    const unmount = mountHandler({ openDomainMatchSetting });

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH });
    expect(openDomainMatchSetting).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(openDomainMatchSetting).toHaveBeenCalledTimes(1));
    unmount();
  });

  it('未接线回调时静默降级，同批其他指令照常分发', async () => {
    const handleSessionExpired = vi.fn();
    const unmount = mountHandler({ handleSessionExpired });

    expect(() => registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH })).not.toThrow();

    registeredListener?.({ type: MessageType.SESSION_EXPIRED });
    expect(handleSessionExpired).toHaveBeenCalledTimes(1);
    unmount();
  });
});
