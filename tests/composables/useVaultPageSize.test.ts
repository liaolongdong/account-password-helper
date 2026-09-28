/** @vitest-environment jsdom */

/**
 * 档位持久化的读写规则测试（composables/useVaultPageSize.ts）
 *
 * 这个 composable 是「档位」这一处偏好的唯一读写入口（管理页密码表与回收站弹窗共用），
 * 所以本文件钉的是它自身的四条契约，其中后两条只在「两个视图共用一份偏好」之后才存在：
 * 1. 恢复动作不回写存储——否则每次打开页面都白付一次 `storage.local` 写入（Windows 慢磁盘
 *    + 杀毒扫描下这就是首屏前的一次额外 IO）；
 * 2. 落盘失败不推进「已落盘档位」，下一次换档仍会重试，不让存储停在半旧状态；
 * 3. 两个实例各自盯自己的 ref，彼此不触发对方的落盘（否则会交叉写同一个键）；
 * 4. 一个实例落盘后另一个实例重新 `restore` 即收敛到同一档位——这正是弹窗关闭时
 *    `App.vue` 补那一下恢复动作所依赖的机制。
 *
 * 存储层的白名单与回落由 `tests/utils/configManager.vaultPageSize.test.ts` 负责；
 * 密码表那侧的端到端接线由 `tests/composables/usePasswordManagement.pageSize.test.ts` 负责；
 * 两处的接线存在性由 `tests/architecture/vaultPageSizeWiring.test.ts` 守卫。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { useVaultPageSize } from '@/composables/useVaultPageSize';
import { DEFAULT_PAGE_SIZE } from '@/utils/vaultPageSize';
import { StorageUtils } from '@/utils/storage';

/** 等 watcher 的 pre flush 与其中的异步读写都落地（一个宏任务把微任务队列清空） */
const settle = async () => {
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 0));
};

describe('useVaultPageSize', () => {
  let scope: EffectScope;
  let getSpy: MockInstance<typeof StorageUtils.getVaultPageSize>;
  let saveSpy: MockInstance<typeof StorageUtils.saveVaultPageSize>;

  /** 在受管作用域里挂一份接线，测试结束统一停掉 watcher */
  const mount = (initialSize: number) => {
    const pageSize = ref(initialSize);
    const hook = scope.run(() => useVaultPageSize(pageSize))!;
    return { pageSize, ...hook };
  };

  beforeEach(() => {
    scope = effectScope();
    getSpy = vi.spyOn(StorageUtils, 'getVaultPageSize').mockResolvedValue(DEFAULT_PAGE_SIZE);
    saveSpy = vi.spyOn(StorageUtils, 'saveVaultPageSize').mockResolvedValue(undefined);
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
  });

  it('构造期不抢跑读取，只有显式恢复才发请求', async () => {
    mount(DEFAULT_PAGE_SIZE);
    await settle();

    expect(getSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('恢复把落盘档位套到 ref 上，且这次变化不回写存储', async () => {
    const { pageSize, restorePageSize } = mount(DEFAULT_PAGE_SIZE);
    getSpy.mockResolvedValue(200);

    await restorePageSize();
    await settle();

    expect(pageSize.value).toBe(200);
    expect(saveSpy, '恢复出来的是存储里已有的值，回写等于每次打开页面白做一次磁盘 IO').not.toHaveBeenCalled();
  });

  it('用户换档位写一次，与已落盘值相同的档位不再写', async () => {
    const { pageSize, restorePageSize } = mount(DEFAULT_PAGE_SIZE);
    await restorePageSize();
    saveSpy.mockClear();

    pageSize.value = 50;
    await settle();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(50);

    pageSize.value = 200;
    await settle();
    pageSize.value = 50;
    await settle();
    expect(saveSpy, '换走再换回：每一次与当前落盘值不同的变化都该记住').toHaveBeenCalledTimes(3);
  });

  it('落盘失败不推进基准，后续换档仍会写', async () => {
    const { pageSize } = mount(DEFAULT_PAGE_SIZE);
    saveSpy.mockRejectedValueOnce(new Error('quota'));

    pageSize.value = 200;
    await settle();
    expect(saveSpy).toHaveBeenCalledTimes(1);

    pageSize.value = 50;
    await settle();
    expect(saveSpy, '上一次失败不该让这次变化被当成"已经是这个值"而静默跳过').toHaveBeenCalledTimes(2);
  });

  it('两个实例互不触发对方的落盘', async () => {
    const table = mount(DEFAULT_PAGE_SIZE);
    const trash = mount(DEFAULT_PAGE_SIZE);
    saveSpy.mockClear();

    trash.pageSize.value = 200;
    await settle();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(200);
    expect(table.pageSize.value, '弹窗换档不该直接改掉主表的档位（收敛由关闭时的恢复动作负责）').toBe(
      DEFAULT_PAGE_SIZE,
    );
  });

  it('一个实例落盘后，另一个实例重新恢复即收敛到同一档位', async () => {
    const table = mount(DEFAULT_PAGE_SIZE);
    const trash = mount(DEFAULT_PAGE_SIZE);

    trash.pageSize.value = 200;
    await settle();
    expect(saveSpy).toHaveBeenCalledWith(200);

    // App.vue 在弹窗关闭时走的就是这一步（真机读的是同一存储键，这里让桩返回弹窗刚写入的值）
    getSpy.mockResolvedValue(200);
    saveSpy.mockClear();
    await table.restorePageSize();
    await settle();

    expect(table.pageSize.value).toBe(200);
    expect(saveSpy, '收敛过去之后不该再回写一次').not.toHaveBeenCalled();
  });

  it('读取失败保留当前档位，既不写也不向调用方抛出', async () => {
    const { pageSize, restorePageSize } = mount(200);
    getSpy.mockRejectedValue(new Error('unavailable'));

    await expect(restorePageSize()).resolves.toBeUndefined();
    await settle();

    expect(pageSize.value).toBe(200);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
