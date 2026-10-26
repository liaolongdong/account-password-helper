import { ElMessageBox } from 'element-plus';
import { t } from '@/utils/i18n';
import { RECOVERY_FORMAT, VAULT_ERROR_CODES, type VaultErrorCode } from './recoveryTypes';

/** 文件字节先限流；读取后的字符上限仍由恢复协议控制，不能只检查 file.size。 */
export async function readRecoveryInputFile(file: File): Promise<string> {
  if (file.size > 16 * 1024) throw vaultCodeError(VAULT_ERROR_CODES.RECOVERY_FILE_TOO_LARGE);
  const text = await file.text();
  if (text.length > RECOVERY_FORMAT.maxInputLength) {
    throw vaultCodeError(VAULT_ERROR_CODES.RECOVERY_FILE_TOO_LARGE);
  }
  return text;
}

/** 只带码、不带任何输入回声的异常；message 与 code 同值，避免把用户材料写进 message。 */
function vaultCodeError(code: VaultErrorCode): Error & { code: VaultErrorCode } {
  return Object.assign(new Error(code), { code });
}

/**
 * 错误码 → 本地化文案 key
 *
 * 刻意用 `Record<VaultErrorCode, string>` 而不是 switch：联合里新增一个码时，
 * 少写一项就是编译错误；switch 只会安静地走进 `default:`，用户拿到一句不相干的兜底。
 */
const RECOVERY_ERROR_KEYS: Record<VaultErrorCode, string> = {
  [VAULT_ERROR_CODES.RECOVERY_INVALID]: 'recovery.error.invalid',
  [VAULT_ERROR_CODES.RECOVERY_DISABLED]: 'recovery.notEnabled',
  [VAULT_ERROR_CODES.RECOVERY_STALE]: 'recovery.error.stale',
  [VAULT_ERROR_CODES.RECOVERY_REPLACEMENT_REQUIRED]: 'recovery.error.replacementRequired',
  [VAULT_ERROR_CODES.RECOVERY_SAME_PASSWORD]: 'recovery.error.samePassword',
  [VAULT_ERROR_CODES.RECOVERY_INCOMPLETE]: 'recovery.error.incomplete',
  [VAULT_ERROR_CODES.UNDECRYPTABLE_RECORDS]: 'recovery.error.undecryptableRecords',
  [VAULT_ERROR_CODES.RECOVERY_FILE_TOO_LARGE]: 'recovery.fileTooLarge',
  [VAULT_ERROR_CODES.VAULT_DATA_CORRUPTED]: 'recovery.error.corrupted',
  [VAULT_ERROR_CODES.VAULT_BUSY]: 'recovery.error.busy',
  [VAULT_ERROR_CODES.REKEY_CONCURRENT_WRITE]: 'recovery.error.concurrentWrite',
  [VAULT_ERROR_CODES.WRONG_PASSWORD]: 'recovery.error.wrongPassword',
  [VAULT_ERROR_CODES.EMPTY_PASSWORD]: 'recovery.error.emptyPassword',
  [VAULT_ERROR_CODES.WEAK_PASSWORD]: 'recovery.error.weakPassword',
};

/**
 * 取异常上携带的稳定错误码。
 *
 * 存储层统一用 `Object.assign(new Error(...), { code })` 抛错；调用方要按码分流
 * （比如决定要不要亮出「知情跳过」这扇门），但绝不该去匹配 message 文本——
 * 文案一改就静默失效。
 */
export function recoveryErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? ((error as { code: unknown }).code as string | undefined)
    : undefined;
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
  const key = RECOVERY_ERROR_KEYS[recoveryErrorCode(error) as VaultErrorCode];
  return key ? t(key) : (fallback ?? t('recovery.error.failed'));
}

/** 立即清除已渲染的输入值，避免 Vue 卸载后停用的更新队列留下 detached DOM 明文。 */
export function clearRecoveryInputs(root: HTMLElement | null | undefined): void {
  root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(input => {
    input.value = '';
  });
}

/**
 * 草稿态关闭前的知情确认。
 *
 * Esc/X 已关掉，但页脚「取消」仍是一键退出；刚下载/抄下的套件会随草稿作废，
 * 必须让用户看到后果再决定。取消确认返回 false，调用方保持弹窗打开。
 */
export async function confirmDiscardRecoveryDraft(): Promise<boolean> {
  try {
    await ElMessageBox.confirm(t('recovery.discardDraftMessage'), t('recovery.discardDraftTitle'), {
      confirmButtonText: t('recovery.discardDraftConfirm'),
      cancelButtonText: t('common.cancel'),
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 切到恢复套件步骤后把焦点送到新内容。
 *
 * 提交按钮被 `v-if` 移除时，Element Plus 的 focus-trap 未必会把焦点拉回；不处理就会出现
 * 「焦点悬空、Tab 落到遮罩后页面」的状态。`RecoveryKitSaveStep` 的根节点带 `tabindex="-1"`，
 * 这里只负责在 DOM flush 后聚焦它。
 */
export function focusRecoveryKitStep(root: HTMLElement | null | undefined): void {
  root?.querySelector<HTMLElement>('.save-step')?.focus();
}
