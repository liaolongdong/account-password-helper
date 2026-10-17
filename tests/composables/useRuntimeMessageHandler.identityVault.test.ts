/** @vitest-environment jsdom */

/**
 * useRuntimeMessageHandler 对 OPEN_OPTIONS_AND_IDENTITY 的分发回归测试
 *
 * 背景：页面侧身份提示经 Background 转发到选项页，由该 composable 决定「过复验门槛打开身份库，
 * 并按需预填检索词」。这里锁住选项页侧的三条契约：
 *
 * 1. **只收一个标签**。跨入口载荷只剩搜索词——类别筛选刻意不做（身份库的一条条目可以同时在
 *    「个人信息」和证件号码上都有值，按角色预选档位会把该筛出来的那一条筛掉）。
 *    词按 `normalizeSearchKeyword` 再收一次：消息通道的对端不在本进程内，
 *    「外部输入一律不可校验上游」，非字符串、空白、超长一律降级成「不带词打开」。
 * 2. **等会话状态落地**。身份库要过复验门槛，冷启动时直接判定会把已解锁误判成未解锁。
 * 3. **未接线静默降级**。回调缺位时不抛，同批其他指令照常分发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, ref, type Ref } from 'vue';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { MessageType, type PasswordEntry } from '@/utils/types';
import { MAX_SEARCH_KEYWORD_LENGTH } from '@/utils/keywordMatch';

/** 捕获到的 runtime 消息监听器 */
let registeredListener: ((message: unknown) => unknown) | undefined;

/** 挂载用的会话态，供用例在「未就绪 → 就绪」之间切换 */
let passwords: Ref<PasswordEntry[]>;
let isAuthenticated: Ref<boolean>;

/** 以最小宿主组件挂载 composable，触发 onMounted 注册 */
function mountHandler(openIdentityVault?: (keyword?: string) => void): () => void {
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
  it('携带搜索词时只把词交给回调：类别筛选保持「全部」，不随角色预选', async () => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);

    // 旧契约的 `role` 键照原样送来，必须被忽略——深链的出口只剩一个标签
    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { role: 'idNumber', keyword: '张三' } });

    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledTimes(1));
    expect(openIdentityVault.mock.calls[0]).toEqual(['张三']);
    unmount();
  });

  it('无载荷与空载荷都照样打开身份库（只是不带筛选词）', async () => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY });
    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: {} });

    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledTimes(2));
    for (const call of openIdentityVault.mock.calls) {
      expect(call).toEqual([undefined]);
    }
    unmount();
  });

  it('会话状态未落地时不立刻打开：身份库的复验门槛要等解锁判定完成', async () => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);
    // 冷启动形态：列表空、认证态尚未写回，此时直接判定会把已解锁误判成未解锁
    passwords.value = [];
    isAuthenticated.value = false;

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '张三' } });
    expect(openIdentityVault).not.toHaveBeenCalled();

    isAuthenticated.value = true;
    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledWith('张三'));
    unmount();
  });

  it('未接线回调时静默降级，不抛给消息通道', () => {
    const unmount = mountHandler();

    expect(() =>
      registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '张三' } }),
    ).not.toThrow();
    unmount();
  });

  /** 词是页面自报的不可信输入：后台收过一次，这里按同一套归一再收一次（64 字上限只有一份真源） */
  it('姓名超长时按既有上限截断，空白与非字符串一律当成没带', async () => {
    const openIdentityVault = vi.fn();
    const unmount = mountHandler(openIdentityVault);

    registeredListener?.({
      type: MessageType.OPEN_OPTIONS_AND_IDENTITY,
      data: { keyword: 'k'.repeat(MAX_SEARCH_KEYWORD_LENGTH + 20) },
    });
    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledTimes(1));
    expect(openIdentityVault.mock.calls[0][0]).toHaveLength(MAX_SEARCH_KEYWORD_LENGTH);

    openIdentityVault.mockClear();
    const badKeywords = ['', '   ', 12345, ['zs'], null, undefined];
    for (const bad of badKeywords) {
      registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: bad } });
    }
    await vi.waitFor(() => expect(openIdentityVault).toHaveBeenCalledTimes(badKeywords.length));
    for (const call of openIdentityVault.mock.calls) {
      expect(call).toEqual([undefined]);
    }
    unmount();
  });
});
