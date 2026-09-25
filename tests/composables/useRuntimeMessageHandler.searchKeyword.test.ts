/** @vitest-environment jsdom */

/**
 * useRuntimeMessageHandler 对 OPEN_OPTIONS_AND_SEARCH 的分发测试
 *
 * 内联下拉空态「到全库找」经 Background 转发到选项页，这里锁住选项页侧的契约：
 * - 有关键词即写入筛选条件，且不等密码列表（写入的是筛选本身，锁定态下同样成立，
 *   解锁后列表自然按此过滤）；
 * - 空白 / 缺字段一律忽略，不把列表清成「按空串检索」的意外状态；
 * - 未接线回调时静默降级，同批其它指令照常分发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, ref } from 'vue';
import { useRuntimeMessageHandler } from '@/composables/useRuntimeMessageHandler';
import { MAX_SEARCH_KEYWORD_LENGTH } from '@/utils/keywordMatch';
import { MessageType, type PasswordEntry } from '@/utils/types';

/** 捕获到的 runtime 消息监听器 */
let registeredListener: ((message: unknown) => unknown) | undefined;

/** 以最小宿主组件挂载 composable，触发 onMounted 注册 */
function mountHandler(options: { applySearchKeyword?: (keyword: string) => void } = {}): () => void {
  const app = createApp({
    setup() {
      useRuntimeMessageHandler({
        passwords: ref<PasswordEntry[]>([]),
        isAuthenticated: ref(false),
        handleSessionExpired: vi.fn(),
        editPassword: vi.fn(),
        openPasswordDialog: vi.fn(),
        applySearchKeyword: options.applySearchKeyword,
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

describe('OPEN_OPTIONS_AND_SEARCH 分发', () => {
  it('未解锁状态下也立即写入关键词（不排队等密码列表）', () => {
    const applySearchKeyword = vi.fn();
    const unmount = mountHandler({ applySearchKeyword });

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_SEARCH, data: { keyword: '张三' } });

    expect(applySearchKeyword).toHaveBeenCalledTimes(1);
    expect(applySearchKeyword).toHaveBeenCalledWith('张三');
    unmount();
  });

  it('关键词缺失或为空白时忽略，不清空既有筛选', () => {
    const applySearchKeyword = vi.fn();
    const unmount = mountHandler({ applySearchKeyword });

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_SEARCH });
    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_SEARCH, data: {} });
    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_SEARCH, data: { keyword: '' } });

    expect(applySearchKeyword).not.toHaveBeenCalled();
    unmount();
  });

  it('非字符串关键词按缺失处理，不让页面侧伪造载荷穿透到筛选条件', () => {
    const applySearchKeyword = vi.fn();
    const unmount = mountHandler({ applySearchKeyword });

    registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_SEARCH, data: { keyword: { evil: 'zs' } } });

    expect(applySearchKeyword).not.toHaveBeenCalled();
    unmount();
  });

  it('超长关键词在边界处被截断（与后台同一套归一，不各写一份上限）', () => {
    const applySearchKeyword = vi.fn();
    const unmount = mountHandler({ applySearchKeyword });

    registeredListener?.({
      type: MessageType.OPEN_OPTIONS_AND_SEARCH,
      data: { keyword: 'k'.repeat(MAX_SEARCH_KEYWORD_LENGTH + 20) },
    });

    expect(applySearchKeyword).toHaveBeenCalledTimes(1);
    expect(applySearchKeyword.mock.calls[0][0]).toHaveLength(MAX_SEARCH_KEYWORD_LENGTH);
    unmount();
  });

  it('未接线回调时静默降级，同批其他指令照常分发', () => {
    const unmount = mountHandler();

    expect(() =>
      registeredListener?.({ type: MessageType.OPEN_OPTIONS_AND_SEARCH, data: { keyword: 'zs' } }),
    ).not.toThrow();
    unmount();
  });
});
