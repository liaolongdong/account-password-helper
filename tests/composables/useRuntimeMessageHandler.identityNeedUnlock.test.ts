/** @vitest-environment jsdom */
/**
 * 页面右键召唤身份库：未认证态不得静默丢弃（评审 2026-11-02 Minor 8）
 *
 * Background 已经判过会话有效并回执 `success: true`，指令才转到选项页；而选项页此刻可能仍处在
 * 未认证 / `checkAuth` 未完成态。原实现是一句 `if (!isAuthenticated.value) return;`——用户点了
 * 右键，标签页切过来了，屏幕上什么都没发生，也没有任何日志以外的反馈。
 * AGENTS.md 的硬口径是「用户可见操作失败时给出反馈；不得静默吞掉」。
 *
 * 同一条链路上「站点规则」那条深链早就有了正确形状：被挡下的那一次由持有 `t()` 与 `ElMessage`
 * 的一侧说一句话。本用例锁的是「门禁照旧、但必须出声」——开库只会得到一张空列表这件事不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, ref, type Ref } from 'vue';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { MessageType, type PasswordEntry } from '@/utils/types';

let registeredListener: ((message: unknown) => unknown) | undefined;
let passwords: Ref<PasswordEntry[]>;
let isAuthenticated: Ref<boolean>;
const openIdentityVault = vi.fn();
const notifyIdentityNeedUnlock = vi.fn();

function mountHandler(): () => void {
  passwords = ref<PasswordEntry[]>([]);
  isAuthenticated = ref(true);
  const app = createApp({
    setup() {
      useRuntimeMessageHandler({
        passwords,
        isAuthenticated,
        handleSessionExpired: vi.fn(),
        editPassword: vi.fn(),
        openPasswordDialog: vi.fn(),
        openIdentityVault,
        notifyIdentityNeedUnlock,
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

const sendIdentityCommand = (): void => {
  registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '张三', sourceTabId: 7 } });
};

beforeEach(() => {
  vi.clearAllMocks();
  openIdentityVault.mockReset();
  notifyIdentityNeedUnlock.mockReset();
  vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(cb => {
    registeredListener = cb as (message: unknown) => unknown;
  });
  vi.spyOn(chrome.runtime.onMessage, 'removeListener').mockImplementation(() => {});
});

afterEach(() => {
  registeredListener = undefined;
  vi.restoreAllMocks();
});

describe('未认证态的右键召唤必须有可读反馈', () => {
  it('选项页尚未认证：不开空库，但必须给一次反馈', async () => {
    const teardown = mountHandler();
    // 列表就绪、但认证未完成——这正是「后台说会话有效、选项页还没解锁/还没判完」的窗口
    passwords.value = [{} as PasswordEntry];
    isAuthenticated.value = false;

    sendIdentityCommand();
    await vi.waitFor(() => {
      expect(
        notifyIdentityNeedUnlock,
        '静默 return 等于用户点了右键什么都没发生；AGENTS.md 禁止吞掉用户可见操作的失败',
      ).toHaveBeenCalledTimes(1);
    });
    expect(openIdentityVault, '锁定态开库只会得到一张空列表，门禁必须照旧').not.toHaveBeenCalled();

    teardown();
  });

  it('已认证时照常打开、不报「请先解锁」', async () => {
    const teardown = mountHandler();
    passwords.value = [{} as PasswordEntry];
    isAuthenticated.value = true;

    sendIdentityCommand();
    await vi.waitFor(() => {
      expect(openIdentityVault).toHaveBeenCalledWith('张三', 7);
    });
    expect(notifyIdentityNeedUnlock).not.toHaveBeenCalled();

    teardown();
  });
});
