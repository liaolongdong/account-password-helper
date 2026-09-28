/** @vitest-environment jsdom */

/**
 * 本地操作守卫 × storage watcher 的时序回归测试（useStorageWatcher）
 *
 * 回归背景（issue #89 保存/收藏路径的实测瓶颈之一）：守卫原先用 `setTimeout(0)` 解除，
 * 而 `chrome.storage.onChanged` 由浏览器进程派发到本渲染进程——大列表就地更新把主线程
 * 占住时，事件会晚于这个宏任务到达。于是「本地操作已在 Vue 层就地更新」这层保护形同虚设：
 * 一次收藏/保存仍会走完整 `loadPasswords()`（数组换引用 → 数百行重渲染）。
 * 600 条真机测量里，单击收藏的长任务累计达 30 s 量级即源于此。
 *
 * 现在断言的口径：
 * 1. 事件**晚到**时仍然只跳过、不重载（旧实现在此失败）；
 * 2. 跳过即解除守卫，紧随其后的外部写入不再被吞（不会长期不刷新）；
 * 3. 没有对应事件的异常路径按兜底上限自动解除；
 * 4. 写入抛错立即解除，不掩盖其他上下文的更新；
 * 5. 未接入解除回调的调用方保持原语义（跳过但不改标志）。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createApp, type App, type Ref } from 'vue';
import { useStorageWatcher } from '@/composables/useStorageWatcher';
import { useLocalOperationGuard } from '@/composables/useLocalOperationGuard';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/** storage 变更监听回调（与 chrome.storage.onChanged 的派发签名一致） */
type StorageChangeHandler = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => void;

/** 挂载后可供用例驱动的最小句柄集 */
interface GuardHarness {
  isLocalOperation: Ref<boolean>;
  runLocalOperation: (fn: () => Promise<void>) => Promise<void>;
}

describe('useStorageWatcher 与本地操作守卫的时序', () => {
  let handler: StorageChangeHandler | null = null;
  let app: App | null = null;
  let harness: GuardHarness;
  let onAuthChange: Mock<() => void>;
  let onPasswordDataChange: Mock<() => void>;

  /**
   * 在真实组件作用域内挂载 watcher（其监听注册发生在 onMounted）
   * @param withConsume 是否接入「跳过即解除」回调（Options / SidePanel 均已接入）
   */
  const mountWatcher = (withConsume: boolean) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
      setup() {
        const guard = useLocalOperationGuard();
        useStorageWatcher({
          onAuthChange,
          onPasswordDataChange,
          skipIf: guard.isLocalOperation,
          ...(withConsume ? { consumeSkip: guard.consumeLocalOperation } : {}),
        });
        harness = guard;
        return () => null;
      },
    });
    app.mount(host);
  };

  /** 派发一次「密码数据变化」事件（本上下文写入与外部写入在事件层面不可区分） */
  const emitPasswordsChange = () => {
    handler?.({ [STORAGE_KEYS.PASSWORDS]: { newValue: 'ciphertext' } }, 'local');
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    handler = null;
    onAuthChange = vi.fn();
    onPasswordDataChange = vi.fn();
    vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation(callback => {
      handler = callback as StorageChangeHandler;
    });
    vi.spyOn(chrome.storage.onChanged, 'removeListener').mockImplementation(() => {});
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('事件晚于下一个宏任务到达时仍只跳过重载（旧实现在此失败）', async () => {
    mountWatcher(true);
    await harness.runLocalOperation(async () => {});
    // 主线程被大列表重渲染占住时，onChanged 会排在这些宏任务之后
    await vi.advanceTimersByTimeAsync(50);
    expect(harness.isLocalOperation.value).toBe(true);

    emitPasswordsChange();

    expect(onPasswordDataChange).not.toHaveBeenCalled();
  });

  it('跳过即解除守卫，紧随其后的外部写入仍会重载', async () => {
    mountWatcher(true);
    await harness.runLocalOperation(async () => {});
    emitPasswordsChange();
    expect(harness.isLocalOperation.value).toBe(false);

    emitPasswordsChange();

    expect(onPasswordDataChange).toHaveBeenCalledTimes(1);
  });

  it('没有对应事件时按兜底上限自动解除，不会长期吞掉外部更新', async () => {
    mountWatcher(true);
    await harness.runLocalOperation(async () => {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(harness.isLocalOperation.value).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.isLocalOperation.value).toBe(false);

    emitPasswordsChange();
    expect(onPasswordDataChange).toHaveBeenCalledTimes(1);
  });

  it('写入抛错时立即解除并继续向上抛出', async () => {
    mountWatcher(true);
    await expect(harness.runLocalOperation(async () => Promise.reject(new Error('写入失败')))).rejects.toThrow(
      '写入失败',
    );
    expect(harness.isLocalOperation.value).toBe(false);

    emitPasswordsChange();
    expect(onPasswordDataChange).toHaveBeenCalledTimes(1);
  });

  it('未接入解除回调时保持原语义：跳过但不改动标志', async () => {
    mountWatcher(false);
    await harness.runLocalOperation(async () => {});

    emitPasswordsChange();

    expect(onPasswordDataChange).not.toHaveBeenCalled();
    expect(harness.isLocalOperation.value).toBe(true);
  });

  it('认证相关 key 变动仍重跑认证检查', () => {
    mountWatcher(true);
    handler?.({ [STORAGE_KEYS.MASTER_PASSWORD]: { newValue: 'x' } }, 'local');

    expect(onAuthChange).toHaveBeenCalledTimes(1);
    expect(onPasswordDataChange).not.toHaveBeenCalled();
  });

  it('非 local 区域与非关注 key 不触发任何回调', () => {
    mountWatcher(true);
    handler?.({ some_other_key: { newValue: 'x' } }, 'session');
    handler?.({ some_other_key: { newValue: 'x' } }, 'local');

    expect(onAuthChange).not.toHaveBeenCalled();
    expect(onPasswordDataChange).not.toHaveBeenCalled();
  });
});
