import { t } from '@/utils/i18n';
import { RECOVERY_FORMAT } from './recoveryTypes';

/** 文件字节先限流；读取后的字符上限仍由恢复协议控制，不能只检查 file.size。 */
export async function readRecoveryInputFile(file: File): Promise<string> {
  if (file.size > 16 * 1024) throw Object.assign(new Error(), { code: 'RECOVERY_FILE_TOO_LARGE' });
  const text = await file.text();
  if (text.length > RECOVERY_FORMAT.maxInputLength) {
    throw Object.assign(new Error(), { code: 'RECOVERY_FILE_TOO_LARGE' });
  }
  return text;
}

/**
 * 仅翻译允许的稳定 code，永不把异常 message、输入或完整对象回显/记录。
 *
 * @param error 存储层抛出的带 `code` 异常
 * @param fallback 未知 code 时的兜底文案；调用方（如改密弹窗）自带既有兜底串时用它，
 *                 这样未登记的码不会突然换成恢复域文案，保持原有呈现口径
 * @returns 面向用户的本地化错误文案
 */
export function recoveryErrorMessage(error: unknown, fallback?: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'RECOVERY_INVALID':
      return t('recovery.error.invalid');
    case 'RECOVERY_DISABLED':
      return t('recovery.notEnabled');
    case 'RECOVERY_STALE':
      return t('recovery.error.stale');
    case 'RECOVERY_REPLACEMENT_REQUIRED':
      return t('recovery.error.replacementRequired');
    case 'RECOVERY_SAME_PASSWORD':
      return t('recovery.error.samePassword');
    case 'RECOVERY_INCOMPLETE':
      return t('recovery.error.incomplete');
    case 'VAULT_DATA_CORRUPTED':
      return t('recovery.error.corrupted');
    case 'WEAK_PASSWORD':
      return t('recovery.error.weakPassword');
    case 'WRONG_PASSWORD':
      return t('recovery.error.wrongPassword');
    case 'EMPTY_PASSWORD':
      return t('recovery.error.emptyPassword');
    case 'REKEY_CONCURRENT_WRITE':
      return t('recovery.error.concurrentWrite');
    case 'VAULT_BUSY':
      return t('recovery.error.busy');
    case 'RECOVERY_FILE_TOO_LARGE':
      return t('recovery.fileTooLarge');
    default:
      return fallback ?? t('recovery.error.failed');
  }
}

/** 立即清除已渲染的输入值，避免 Vue 卸载后停用的更新队列留下 detached DOM 明文。 */
export function clearRecoveryInputs(root: HTMLElement | null | undefined): void {
  root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(input => {
    input.value = '';
  });
}
