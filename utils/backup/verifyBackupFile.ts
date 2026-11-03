import type { BackupVerificationResult } from './types';
import { MAX_PASSWORD_IMPORT_INPUT_BYTES } from './constants';
import { BackupImportUserError, importEncryptedBackup } from '@/utils/backupExport';
import { getIdentityBackupErrorCode, importIdentityBackup } from '@/utils/identity/backup';
import { MAX_IDENTITY_IMPORT_INPUT_BYTES } from '@/utils/identity/constants';
import { formatFileSize } from '@/utils/formatFileSize';
import { t } from '@/utils/i18n';

/**
 * 验证用户选择的加密备份是否可解密、结构是否合法；不导入、不写入任何库或备份状态。
 *
 * 复用既有导入校验和字节上限，尤其在 identity 导入 API 读取前补齐调用方的大小闸门。
 * 密码沿用 .aph 导入界面的 trim 口径；明文仅存在于既有解析调用期间，返回后不持有记录。
 * 所有失败只抛用户可读的 BackupImportUserError，不把原始解析异常带入 UI。
 */
export async function verifyBackupFile(file: File, password: string): Promise<BackupVerificationResult> {
  const name = file.name.toLowerCase();
  const isPasswords = name.endsWith('.aph');
  if (!isPasswords && !name.endsWith('.aphid')) {
    throw new BackupImportUserError(t('options.forgot.checkUnsupported'));
  }

  const maxBytes = isPasswords ? MAX_PASSWORD_IMPORT_INPUT_BYTES : MAX_IDENTITY_IMPORT_INPUT_BYTES;
  if (file.size > maxBytes) {
    throw new BackupImportUserError(t('backup.fileTooLarge', { max: formatFileSize(maxBytes) }));
  }
  const exportPassword = password.trim();
  if (!exportPassword) {
    throw new BackupImportUserError(t('options.forgot.checkPasswordRequired'));
  }

  try {
    if (isPasswords) {
      return { kind: 'passwords', count: (await importEncryptedBackup(file, exportPassword)).length };
    }
    return { kind: 'identities', count: (await importIdentityBackup(file, exportPassword)).records.length };
  } catch (error: unknown) {
    // 只保留已翻译消息，丢弃可能含解析上下文的 cause 链。
    if (error instanceof BackupImportUserError) throw new BackupImportUserError(error.message);
    switch (getIdentityBackupErrorCode(error)) {
      case 'WRONG_PASSWORD':
        throw new BackupImportUserError(t('backup.wrongPasswordOrCorrupted'));
      case 'INVALID_FILE':
        throw new BackupImportUserError(t('backup.invalidFile'));
      case 'NOT_APHID':
      case 'INVALID_STRUCTURE':
        throw new BackupImportUserError(t('backup.invalidStructure'));
      default:
        throw new BackupImportUserError(t('options.forgot.checkFailed'));
    }
  }
}
