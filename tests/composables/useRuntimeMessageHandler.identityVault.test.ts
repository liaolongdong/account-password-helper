/** @vitest-environment jsdom */

/**
 * useRuntimeMessageHandler 对 OPEN_OPTIONS_AND_IDENTITY 的分发回归测试
 *
 * 背景：页面侧身份提示经 Background 转发到选项页，由该 composable 决定「过复验门槛打开
 * 身份库，并把类别筛选预选到对应档」。这里锁住选项页侧的三条契约：
 *
 * 1. **再收一次闭集**。后台已按 `normalizeIdentityHintRole` 收口，但消息通道的对端不在本
 *    进程内，「外部输入一律不可校验上游」——卡类角色与非字符串一律降级成「不带筛选打开」。
 * 2. **等会话状态落地**。身份库要过复验门槛，冷启动时直接判定会把已解锁误判成未解锁。
 * 3. **未接线静默降级**。回调缺位时不抛，同批其他指令照常分发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, ref, type Ref } from 'vue';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { MessageType, type PasswordEntry } from '@/utils/types';

/** 捕获到的 runtime 消息监听器 */
let registeredListener: ((message: unknown) => unknown) | undefined;

/** 挂载用的会话态，供用例在「未就绪 → 就绪」之间切换 */
let passwords: Ref<PasswordEntry[]>;
let isAuthenticated: Ref<boolean>;

/** 以最小宿主组件挂载 composable，触发 onMounted 注册 */
function mountHandler(openIdentityVault?: (role?: string) => void): () => void {
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

describe('OPEN_OPTIONS_AND_IDENTITY 分发', () => {
  it('携带合法角色时交给回调，用于预选类别筛选', async () => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { role: 'idNumber' } });

    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledWith('idNumber'));
    unmount();
  });

  it.each([
    ['卡类角色', { role: 'cardNo' }],
    ['词表外的任意串', { role: 'whatever' }],
    ['角色不是字符串', { role: 1 }],
    ['缺 role 字段', {}],
    ['无载荷', undefined],
  ])('%s 一律降级成「不过滤打开」，不原样透传', async (_label, data) => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data });

    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledTimes(1));
    expect(openIdentityVault.mock.calls[0][0]).toBeUndefined();
    unmount();
  });

  it('会话状态未落地时不立刻打开：身份库的复验门槛要等解锁判定完成', async () => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);
    // 冷启动形态：列表空、认证态尚未写回，此时直接判定会把已解锁误判成未解锁
    passwords.value = [];
    isAuthenticated.value = false;

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { role: 'name' } });
    expect(openIdentityVault).not.toHaveBeenCalled();

    isAuthenticated.value = true;
    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledWith('name'));
    unmount();
  });

  it('未接线回调时静默降级，不抛给消息通道', () => {
    const unmount = mountHandler();

    expect(() =>
      registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { role: 'name' } }),
    ).not.toThrow();
    unmount();
  });
});
