import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
// 显式导入而非依赖 AutoImport：本模块要在单测里以 `vi.mock('element-plus')` 打桩确认框，
// 而 WxtVitest 不套 Element Plus 的 AutoImport 转换。样式不受影响——
// 使用方（Options 的导入弹窗）所在 chunk 已由 TrashDialog 等经 AutoImport 带入 message-box 样式。
import { ElMessageBox } from 'element-plus';
import { StorageUtils } from '@/utils/storage';
import { isVaultCapacityError, MAX_PASSWORD_ENTRIES, remainingCapacity } from '@/utils/storage/vaultCapacity';
import { t } from '@/utils/i18n';
import { logger } from '@/utils/logger';

/**
 * `useImportCapacity` 的对外契约
 *
 * 显式命名而不是依赖推导：两个导入弹窗按同一份契约接线，字段增删必须在这里被看见，
 * 避免「一个弹窗先偷偷用了另一个弹窗没有的读数」。
 */
export interface ImportCapacity<T> {
  /** 当前已有条目数；`null` 表示尚未读取（此时不告警也不切片） */
  currentCount: Ref<number | null>;
  /** 还可写入的条数；未读到条数时为 `Infinity`（不限制） */
  remaining: ComputedRef<number>;
  /** 本次将被忽略的条数 */
  skipped: ComputedRef<number>;
  /** 是否超出剩余额度（决定是否显示告警条、是否需要二次确认） */
  overLimit: ComputedRef<boolean>;
  /** 额度已用尽：一条都导不进去 */
  capacityExhausted: ComputedRef<boolean>;
  /** 本次实际可导入的条目（超限时按文件内顺序截取前 `remaining` 条） */
  importableEntries: ComputedRef<T[]>;
  /** 主动重读当前条目数 */
  refreshCurrentCount: () => Promise<void>;
  /** 超限时向用户确认「只导入前 N 条」；未超限直接返回 true */
  confirmOverLimit: () => Promise<boolean>;
  /** 切片 + 确认一次做完：返回可导入条目，用户取消或一条都导不进时返回 `null` */
  takeImportableEntries: () => Promise<T[] | null>;
}

/**
 * 导入成功的读数
 *
 * 超限时必须说清「导入了多少、忽略了多少」，否则用户以为整个文件都进去了；
 * 未超限沿用原有的单一计数文案，不改变既有读法。
 *
 * @param imported 实际写入条数
 * @param skipped 因额度被忽略的条数
 * @returns 已本地化的成功文案
 */
export const importSuccessMessage = (imported: number, skipped: number): string =>
  skipped > 0
    ? t('options.capacity.partialSuccess', { imported, skipped })
    : t('options.import.importSuccess', { count: imported });

/**
 * 导入失败的文案
 *
 * 解密预览到真正写入之间，其它入口（自动保存、另一个管理页标签）可能已把条数填满，
 * 此时写路径的容量守卫会抛错——那是「到了上限」而不是「导入出错」，两者必须分开说。
 *
 * @param error 捕获到的异常（不外泄其内容，只判别形态）
 * @returns 已本地化的失败文案
 */
export const importFailureMessage = (error: unknown): string =>
  isVaultCapacityError(error)
    ? t('options.capacity.importBlocked', { max: MAX_PASSWORD_ENTRIES })
    : t('options.import.importFailed');

/**
 * 导入类弹窗的条目总量额度
 *
 * 语义（与产品口径一致）：超出剩余额度时**不静默截断、也不整批拒绝**，
 * 而是在预览页把「当前条数 / 上限 / 可导入条数 / 将被忽略条数」摊开给用户看，
 * 由用户选择「只导入前 N 条」或取消。因此本 composable 只做两件事：
 * 读一次当前条目数供预览展示，以及在点导入时按需弹一次确认。
 *
 * 计数走 `getAllPasswordsRaw()`：只需要条数，绝不为计数触发全量 AES-GCM 解密。
 * 这一次读取会拉回整个密文数组（2000 条量级），因此只在预览出现有效数据时读一次，
 * 不在输入过程或渲染期读取。
 *
 * @param previewData - 已解析待导入的条目数组（两个导入弹窗的 `previewData`）
 * @returns 额度展示值、超限判定、确认入口与真正导入时要用的切片函数
 */
export function useImportCapacity<T>(previewData: Ref<T[]>): ImportCapacity<T> {
  /** 当前已有条目数；null 表示尚未读取（此时不做超限提示，避免闪现误报） */
  const currentCount = ref<number | null>(null);

  /** 还可写入的条数（上限减去当前），未读取时按不限制处理；口径与写路径守卫同源于 remainingCapacity */
  const remaining = computed(() => (currentCount.value === null ? Infinity : remainingCapacity(currentCount.value)));

  /** 本次将被忽略的条数 */
  const skipped = computed(() =>
    Number.isFinite(remaining.value) ? Math.max(0, previewData.value.length - remaining.value) : 0,
  );

  /** 是否超出剩余额度（决定是否显示告警条、是否需要二次确认） */
  const overLimit = computed(() => previewData.value.length > 0 && skipped.value > 0);

  /** 额度已用尽：一条都导不进去，导入按钮直接禁用 */
  const capacityExhausted = computed(() => currentCount.value !== null && remaining.value === 0);

  /** 读取代际：只有最后一次读取的结果允许落地，避免旧额度覆盖新额度 */
  let countRequestId = 0;

  /** 读取当前条目数（预览出现有效数据时自动调用，也可在打开对话框时调用） */
  const refreshCurrentCount = async () => {
    const requestId = ++countRequestId;
    // 读取期间先回到「未知」：换文件后沿用上一轮的条数，会把过期的「可导入 / 将忽略」当事实展示，
    // 甚至让用户在过期数字上确认一次本不需要的截断。未知态不告警也不切片，
    // 收口仍在 batchSavePasswords 的容量守卫——最多是「整批被拒 + 明确文案」，不会静默少导。
    currentCount.value = null;
    try {
      const entries = await StorageUtils.getAllPasswordsRaw();
      if (requestId !== countRequestId) return;
      currentCount.value = Array.isArray(entries) ? entries.length : 0;
    } catch (error) {
      if (requestId !== countRequestId) return;
      // 读不到条数时宁可退回「不提示」：额度信息只是导入前的预告，
      // 真正的收口在 batchSavePasswords 的容量守卫里，不会因为这里降级而失效。
      logger.error('读取条目总数失败，导入前的上限提示已跳过:', error);
      currentCount.value = null;
    }
  };

  // 预览数组被换成新内容时重读一次（两个弹窗都以 `previewData.value = 新数组` 落数据，
  // 所以这里按引用变化观察，而不是按长度变化观察）：沿用旧值会在「导入完再导下一个文件」
  // 时用错额度，而两次选择恰好同条数时长度观察根本不会触发。
  // immediate 让「构造时预览里已有数据」也能读到一次计数，生产路径初始为空数组因此不会多读。
  watch(
    previewData,
    entries => {
      if (entries.length > 0) {
        void refreshCurrentCount();
      }
    },
    { immediate: true },
  );

  /** 本次实际可导入的条目（超限时截取前 remaining 条，保持文件内顺序） */
  const importableEntries = computed(() =>
    Number.isFinite(remaining.value) ? previewData.value.slice(0, remaining.value) : previewData.value.slice(),
  );

  /**
   * 超限时的导入确认
   *
   * @returns 用户是否同意只导入 `importableEntries`；未超限直接返回 true
   */
  const confirmOverLimit = async (): Promise<boolean> => {
    if (!overLimit.value) return true;
    try {
      await ElMessageBox.confirm(
        t('options.capacity.partialConfirmText', { remaining: remaining.value, skipped: skipped.value }),
        t('options.capacity.partialTitle'),
        {
          confirmButtonText: t('options.capacity.partialConfirm', { remaining: remaining.value }),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      );
      return true;
    } catch {
      // ElMessageBox 取消走 reject('cancel')：用户选择取消即不导入，不需要日志
      return false;
    }
  };

  /**
   * 切片 + 确认一次做完
   *
   * 「取消即一条都不写」和「额度用尽时不进入写入流程」这两个判定必须成对出现，
   * 分开写在两个弹窗里迟早会漏掉一个，因此收在这里。
   *
   * @returns 允许写入的条目；用户取消或本批无可导入条目时返回 `null`
   */
  const takeImportableEntries = async (): Promise<T[] | null> => {
    const entries = importableEntries.value;
    if (entries.length === 0) return null;
    return (await confirmOverLimit()) ? entries : null;
  };

  return {
    currentCount,
    remaining,
    skipped,
    overLimit,
    capacityExhausted,
    importableEntries,
    refreshCurrentCount,
    confirmOverLimit,
    takeImportableEntries,
  };
}
