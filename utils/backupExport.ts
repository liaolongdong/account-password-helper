import type { PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { formatTimestampCompact } from '@/utils/dateFormat';
import { parseBackupContainer, PasswordBackupError } from '@/utils/backup/parseBackupEntries';
import { markVerifiedBackupAt } from '@/utils/storage/configManager';

/** 备份文件版本标识 */
const BACKUP_VERSION = 1;
/** AES-GCM IV 长度 */
const IV_LENGTH = 12;
/** PBKDF2 迭代次数（与主加密体系一致的 600K） */
const PBKDF2_ITERATIONS = 600_000;
/** Salt 长度 */
const SALT_LENGTH = 16;

/** 备份数据结构 */
interface BackupData {
  version: number;
  exportedAt: number;
  count: number;
  entries: Omit<PasswordEntry, 'id' | 'order'>[];
}

/**
 * 从主密码派生 AES-GCM 密钥
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 导出加密备份文件
 *
 * 使用主密码通过 AES-256-GCM 加密密码数据，下载为 .aph 文件。
 * 下载前先做一次 round-trip 自检（用同一 salt 重新派生密钥、解密、解析并核对
 * version/count/entries 长度），确认这份文件确实能被本扩展解回，校验通过才落盘、
 * 并在成功后记录「最近成功备份」时间戳。字节格式（salt‖iv‖ciphertext）保持不变。
 */
export async function exportEncryptedBackup(passwords: PasswordEntry[], masterPassword: string): Promise<void> {
  try {
    const backupData: BackupData = {
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      count: passwords.length,
      entries: passwords.map(p => ({
        username: p.username,
        password: p.password,
        url: p.url,
        tag: p.tag,
        remark: p.remark,
        totp: p.totp,
        createTime: p.createTime,
        updateTime: p.updateTime,
        favorite: p.favorite,
      })),
    };

    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(backupData));

    // 生成随机 salt 和 IV
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // 派生密钥
    const key = await deriveKey(masterPassword, salt);

    // 加密
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    // 拼接: salt + iv + ciphertext
    const output = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    output.set(salt, 0);
    output.set(iv, salt.length);
    output.set(new Uint8Array(ciphertext), salt.length + iv.length);

    // 下载前完整性自检：把刚产出的容器原样解回，验证 GCM 校验和可过、结构与源数据一致。
    // 单独 try：解密/解析/比对任一失败都归为「自检未通过」，与通用加密失败区分文案。
    try {
      const verifyKey = await deriveKey(masterPassword, salt);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, verifyKey, ciphertext);
      const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as BackupData;
      if (
        parsed.version !== BACKUP_VERSION ||
        parsed.count !== passwords.length ||
        !Array.isArray(parsed.entries) ||
        parsed.entries.length !== passwords.length
      ) {
        throw new Error('backup_verify_mismatch');
      }
    } catch (cause) {
      logger.error('加密备份自检未通过:', cause);
      const err = new Error(t('backup.exportVerifyFailed'));
      err.name = 'BackupVerifyError';
      (err as any).cause = cause;
      throw err;
    }

    // 下载文件
    const blob = new Blob([output], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = formatTimestampCompact();
    a.href = url;
    a.download = `backup_${dateStr}.aph`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    // 自检失败已有专属文案，原样上抛供调用方差异化提示；其余统一归为导出失败。
    if ((error as any)?.name === 'BackupVerifyError') {
      throw error;
    }
    logger.error('导出加密备份失败:', error);
    const err = new Error(t('backup.exportError'));
    (err as any).cause = error;
    throw err;
  }

  // 走到此处说明自检通过且文件已产出；时间戳记录属提醒元数据，失败不影响本次备份成功。
  try {
    await markVerifiedBackupAt();
  } catch (error) {
    logger.error('记录成功备份时间失败（备份本身已完成）:', error);
  }
}

/**
 * 导入加密备份文件
 * 读取 .aph 文件，用主密码解密，返回密码数据
 */
export async function importEncryptedBackup(
  file: File,
  masterPassword: string,
): Promise<Omit<PasswordEntry, 'id' | 'order'>[]> {
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    if (data.length < SALT_LENGTH + IV_LENGTH + 1) {
      throw new Error(t('backup.invalidFile'));
    }

    // 拆解: salt + iv + ciphertext
    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);

    // 派生密钥
    const key = await deriveKey(masterPassword, salt);

    // 解密
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(decrypted);
    const backupData: unknown = JSON.parse(jsonStr);

    // B4：与 CSV/JSON 导入共用同一份边界口径——校验 version 上界、count↔entries
    // 交叉一致、字段白名单、逐字段类型/长度上限与条数上界，替代此前仅判 version 真值
    // + Array.isArray 的零逐条校验。解析成功即返回可信条目。
    try {
      return parseBackupContainer(backupData, true);
    } catch (err) {
      if (err instanceof PasswordBackupError) {
        const wrapped = new Error(t('backup.invalidStructure'));
        (wrapped as any).cause = err;
        throw wrapped;
      }
      throw err;
    }
  } catch (error: any) {
    if (error.message?.includes('decrypt') || error.name === 'OperationError') {
      const err = new Error(t('backup.wrongPasswordOrCorrupted'));
      (err as any).cause = error;
      throw err;
    }
    logger.error('导入加密备份失败:', error);
    const err = new Error(error.message || t('backup.importError'));
    (err as any).cause = error;
    throw err;
  }
}
