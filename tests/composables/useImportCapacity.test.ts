/** @vitest-environment jsdom */

/**
 * 导入预览页额度逻辑回归测试（composables/useImportCapacity.ts）
 *
 * 钉住已拍板的语义：**超限时不静默截断、也不整批拒绝**，而是把「当前 / 上限 / 可导入 / 将忽略」
 * 摊开后由用户选择「只导入前 N 条」或取消。因此断言集中在三处：
 * 切片数量、确认框是否弹（以及取消时一条都不写）、额度读不到时**不得**先弹出告警。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const getAllPasswordsRaw = vi.fn();
const confirm = vi.fn();

vi.mock('@/utils/storage', () => ({
  StorageUtils: { getAllPasswordsRaw },
}));

vi.mock('element-plus', () => ({
  ElMessageBox: { confirm },
}));

// 只验证「用了哪个 key、带了哪些数字」，真实文案由 i18n 自身与真机 e2e 负责
vi.mock('@/utils/i18n', () => ({
  t: (key: string, named?: Record<string, unknown>) => `${key}|${JSON.stringify(named ?? {})}`,
}));

/** 造一份 n 元素的待导入数组 */
const previewOf = (n: number) => Array.from({ length: n }, (_, i) => ({ username: `u${i}` }));

beforeEach(() => {
  getAllPasswordsRaw.mockReset();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
  getAllPasswordsRaw.mockResolvedValue(new Array(1990));
});

/** 挂载 composable 并等预览计数读回来 */
const setup = async (incoming: number) => {
  const { useImportCapacity } = await import('@/composables/useImportCapacity');
  const previewData = ref(previewOf(incoming));
  const api = useImportCapacity(previewData);
  await nextTick();
  await vi.waitFor(() => expect(api.currentCount.value).not.toBeNull());
  return { previewData, ...api };
};

describe('useImportCapacity', () => {
  it('额度充足时不告警、不弹确认、原样导入', async () => {
    getAllPasswordsRaw.mockResolvedValue(new Array(10));
    const { overLimit, skipped, capacityExhausted, importableEntries, confirmOverLimit } = await setup(5);

    expect(capacityExhausted.value).toBe(false);
    expect(overLimit.value).toBe(false);
    expect(skipped.value).toBe(0);
    expect(importableEntries.value).toHaveLength(5);
    await expect(confirmOverLimit()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('超出剩余额度时按额度切片并要求用户确认', async () => {
    const { skipped, overLimit, importableEntries, confirmOverLimit } = await setup(50);

    expect(overLimit.value).toBe(true);
    expect(skipped.value).toBe(40);
    expect(importableEntries.value).toHaveLength(10);

    await expect(confirmOverLimit()).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    const [text, title, options] = confirm.mock.calls[0] as [string, string, { confirmButtonText: string }];
    expect(text).toContain('options.capacity.partialConfirmText|');
    expect(text).toContain('"remaining":10');
    expect(text).toContain('"skipped":40');
    expect(title).toContain('options.capacity.partialTitle');
    expect(options.confirmButtonText).toContain('options.capacity.partialConfirm|');
  });

  it('用户取消时一条都不导入', async () => {
    confirm.mockRejectedValue('cancel');
    const { confirmOverLimit } = await setup(50);

    await expect(confirmOverLimit()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('额度已用尽：可导入切片为空且按钮态为已填满', async () => {
    getAllPasswordsRaw.mockResolvedValue(new Array(2000));
    const { capacityExhausted, importableEntries, skipped } = await setup(5);

    expect(capacityExhausted.value).toBe(true);
    expect(skipped.value).toBe(5);
    expect(importableEntries.value).toHaveLength(0);
  });

  it('读不到当前条数时不产出告警（真正的收口在写路径守卫）', async () => {
    getAllPasswordsRaw.mockRejectedValue(new Error('storage unavailable'));
    const { useImportCapacity } = await import('@/composables/useImportCapacity');
    const api = useImportCapacity(ref(previewOf(50)));
    await nextTick();
    await vi.waitFor(() => expect(getAllPasswordsRaw).toHaveBeenCalled());

    expect(api.currentCount.value).toBeNull();
    expect(api.overLimit.value).toBe(false);
    expect(api.capacityExhausted.value).toBe(false);
    expect(api.importableEntries.value).toHaveLength(50);
  });

  it('预览内容变化时会重读条数，不复用上一次的额度', async () => {
    const { previewData, currentCount } = await setup(5);
    expect(getAllPasswordsRaw).toHaveBeenCalledTimes(1);

    getAllPasswordsRaw.mockResolvedValue(new Array(10));
    previewData.value = previewOf(50);
    await nextTick();
    await vi.waitFor(() => expect(getAllPasswordsRaw).toHaveBeenCalledTimes(2));

    expect(currentCount.value).toBe(10);
  });
});

/**
 * `takeImportableEntries`：切片 + 确认一次做完
 *
 * 两个导入弹窗共用它，因此「取消即不写」「额度用尽即不进写入流程」必须在这里就成立，
 * 而不是靠每个调用点各自记得先判长度再判确认结果。
 */
describe('useImportCapacity.takeImportableEntries', () => {
  it('超限时返回按额度切片的条目，并确认过一次', async () => {
    const { takeImportableEntries } = await setup(50);

    await expect(takeImportableEntries()).resolves.toHaveLength(10);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('用户取消时返回 null（调用方据此一条都不写）', async () => {
    confirm.mockRejectedValue('cancel');
    const { takeImportableEntries } = await setup(50);

    await expect(takeImportableEntries()).resolves.toBeNull();
  });

  it('额度已用尽时直接返回 null，连确认框都不弹', async () => {
    getAllPasswordsRaw.mockResolvedValue(new Array(2000));
    const { takeImportableEntries } = await setup(5);

    await expect(takeImportableEntries()).resolves.toBeNull();
    expect(confirm, '一条都导不进时不该再问用户「只导入前 0 条吗」').not.toHaveBeenCalled();
  });

  it('额度充足时原样返回，不弹确认', async () => {
    getAllPasswordsRaw.mockResolvedValue(new Array(10));
    const { takeImportableEntries } = await setup(5);

    await expect(takeImportableEntries()).resolves.toHaveLength(5);
    expect(confirm).not.toHaveBeenCalled();
  });
});

/**
 * 导入结果的文案选择（纯函数）
 *
 * 只钉「用了哪个 key、带了哪个数字」：成功读数在超限时必须带上被忽略条数，
 * 失败读数必须把容量守卫的错误与真正的导入失败分开——这两处曾在两个弹窗里各写一遍，
 * 收进函数后就在这里一次锁死。
 */
describe('导入结果文案的选择', () => {
  /** 取纯函数（与上方同一份 mock：i18n 的 `t` 被打桩成 `key|json`） */
  const loadCopy = async () => import('@/composables/useImportCapacity');

  it('有条目被忽略时报「导入 N 条 / 忽略 M 条」', async () => {
    const { importSuccessMessage } = await loadCopy();
    expect(importSuccessMessage(10, 40)).toBe('options.capacity.partialSuccess|{"imported":10,"skipped":40}');
  });

  it('没有条目被忽略时沿用原有单一计数文案', async () => {
    const { importSuccessMessage } = await loadCopy();
    expect(importSuccessMessage(5, 0)).toBe('options.import.importSuccess|{"count":5}');
  });

  it('容量守卫抛的错误说成「到了上限」，其它错误说成「导入失败」', async () => {
    const { importFailureMessage } = await loadCopy();
    const { VaultCapacityError } = await import('@/utils/storage/vaultCapacity');
    // 断言里不出现真实条目内容，只出现 key 与上限数字
    expect(importFailureMessage(new VaultCapacityError(1995, 10))).toContain('options.capacity.importBlocked|');
    expect(importFailureMessage(new VaultCapacityError(1995, 10))).toContain('"max":2000');
    expect(importFailureMessage(new Error('boom'))).toBe('options.import.importFailed|{}');
    expect(importFailureMessage(undefined)).toBe('options.import.importFailed|{}');
  });
});
