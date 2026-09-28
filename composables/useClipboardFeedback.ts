/**
 * 剪贴板自动清除结果的统一反馈
 *
 * 敏感值（密码 / 历史密码 / 分享卡片）必须经 `utils/clipboard` 的
 * `copySecretToClipboard` 出口写入，它按「剪贴板设置」限时自动清除；
 * 清除完成/失败需要一个可理解的回执，否则用户会以为明文仍留在剪贴板里。
 *
 * 该回执原先在密码详情抽屉、身份信息库各写一份且逐字相同，任何新增的
 * 机密复制入口（如编辑弹窗的历史密码）若再抄一遍，就会变成三处漂移源：
 * 文案 key、info/warning 级别、以及「清除失败仅告警不阻断」的取舍都需要
 * 保持一致，因此收拢为单一来源。
 *
 * 复用 `fill` 命名空间既有词条，不新增文案。
 */
import { useI18n } from '@/utils/i18n';

/** 剪贴板反馈接口 */
export interface ClipboardFeedback {
  /**
   * 自动清除完成回调，作为 `copySecretToClipboard` 的 `onCleared` 传入
   * @param ok 是否成功清除（失败不阻断操作，只提示用户手动清理）
   */
  notifyClipboardCleared: (ok: boolean) => void;
}

/**
 * 获取剪贴板自动清除的 UI 反馈方法
 * @returns 当前仅含 `notifyClipboardCleared`，后续剪贴板回执统一在此扩展
 */
export function useClipboardFeedback(): ClipboardFeedback {
  const { t } = useI18n();

  const notifyClipboardCleared = (ok: boolean): void => {
    if (ok) {
      ElMessage.info(t('fill.clipboardCleared'));
    } else {
      ElMessage.warning(t('fill.clipboardClearFailed'));
    }
  };

  return { notifyClipboardCleared };
}
