/** @vitest-environment jsdom */

/**
 * 管理页档位持久化接线测试（usePasswordManagement）
 *
 * 存储层的白名单与回落由 `tests/utils/configManager.vaultPageSize.test.ts` 负责；
 * 这里只钉组合层这三条契约，各自对应一个真实故障形状：
 * 1. 恢复不生效 → 用户每次打开管理页都要重选档位（这正是本次要修的问题）；
 * 2. 改档位不落盘 → 记不住，等价于没有持久化；
 * 3. 恢复动作本身触发回写 → 每次打开页面都白写一次 storage.local，
 *    Windows 慢磁盘 + 杀毒扫描下这就是首屏前的一次额外磁盘 IO。
 *
 * 页码刻意不在恢复范围内（它是命中集合的派生值，见 `restorePageSizeConfig` 的注释），
 * 因此这里同时断言恢复档位不会把页码挪走。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { DEFAULT_PAGE_SIZE } from '@/utils/vaultPageSize';
import { StorageUtils } from '@/utils/storage';

/** 造 n 条最小条目：只需要够出多页，不关心字段内容 */
const makeList = (n: number): PasswordEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i + 1}`,
    username: `u${i + 1}`,
    password: 'p',
    url: '',
    tag: '',
    remark: '',
    totp: '',
    createTime: 1_000_000 + i,
    updateTime: 1_000_000 + i,
    order: i + 1,
  }));

/** 等 watcher 的 pre flush 与其中的异步保存都落地 */
const settle = async () => {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
};

describe('usePasswordManagement 的档位持久化', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;
  let getSpy: MockInstance<typeof StorageUtils.getVaultPageSize>;
  let saveSpy: MockInstance<typeof StorageUtils.saveVaultPageSize>;

  beforeEach(() => {
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    });
    getSpy = vi.spyOn(StorageUtils, 'getVaultPageSize').mockResolvedValue(DEFAULT_PAGE_SIZE);
    saveSpy = vi.spyOn(StorageUtils, 'saveVaultPageSize').mockResolvedValue(undefined);

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    mgmt.passwords.value = makeList(500);
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
  });

  it('默认状态不读存储：只有显式恢复才发请求', async () => {
    await settle();
    expect(getSpy, '构造期不该抢跑一次存储读取').not.toHaveBeenCalled();
  });

  it('恢复把存储里的档位应用到列表上，且不改页码', async () => {
    getSpy.mockResolvedValue(200);
    mgmt.currentPage.value = 3;
    await settle();

    await mgmt.restorePageSizeConfig();

    expect(mgmt.pageSize.value).toBe(200);
    expect(mgmt.pageCount.value, '500 条 / 每页 200 → 3 页').toBe(3);
    expect(mgmt.currentPage.value, '恢复档位不该把用户从第 3 页弹走').toBe(3);
    // 末页行数按新档位算：第 3 页覆盖第 401～500 条，只有 100 行
    expect(mgmt.pagedEntries.value).toHaveLength(100);

    mgmt.currentPage.value = 1;
    await settle();
    expect(mgmt.pagedEntries.value, '换档后每页行数随之变化，`data` 恒为一页').toHaveLength(200);
  });

  it('恢复本身不回写存储（否则每次打开页面白做一次磁盘 IO）', async () => {
    getSpy.mockResolvedValue(50);
    await mgmt.restorePageSizeConfig();
    await settle();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(mgmt.pageSize.value).toBe(50);
  });

  it('用户换档位写一次存储，且重复写同值不再落盘', async () => {
    await mgmt.restorePageSizeConfig();
    saveSpy.mockClear();

    mgmt.pageSize.value = 50;
    await settle();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(50);

    // 换走再换回原档位：与"当前已落盘值"不同的每一次变化都应当记录
    mgmt.pageSize.value = 200;
    await settle();
    mgmt.pageSize.value = 50;
    await settle();
    expect(saveSpy).toHaveBeenCalledTimes(3);

    mgmt.pageSize.value = 50;
    await settle();
    expect(saveSpy, '同值写入不该再触发落盘').toHaveBeenCalledTimes(3);
  });

  it('保存失败不影响当前页呈现（视图偏好是尽力持久化）', async () => {
    saveSpy.mockRejectedValue(new Error('quota'));
    mgmt.pageSize.value = 200;
    await settle();

    expect(mgmt.pageSize.value, '落盘失败也要保住用户刚选的档位，本轮只记日志').toBe(200);
    expect(mgmt.pagedEntries.value.length).toBeGreaterThan(0);
  });

  it('未成功落盘的值不会被当成"已记住的档位"，重试仍会写', async () => {
    saveSpy.mockRejectedValueOnce(new Error('quota'));
    mgmt.pageSize.value = 200;
    await settle();
    expect(saveSpy).toHaveBeenCalledTimes(1);

    mgmt.pageSize.value = 50;
    await settle();
    expect(saveSpy, '上一次失败不该让后续档位变化静默跳过').toHaveBeenCalledTimes(2);
  });
});
