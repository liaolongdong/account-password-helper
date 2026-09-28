import type { PasswordEntry, PasswordGroup } from '@/utils/types';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { formatTimestampCompact } from '@/utils/dateFormat';

/**
 * 备份文件版本标识
 *
 * - v1：仅条目，导入时全部归入「未分组」
 * - v2：条目携带 groupId，顶层携带 groups 分组树
 */
const BACKUP_VERSION = 2;
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
  /** v2 新增；v1 文件缺省时按空分组树处理 */
  groups?: PasswordGroup[];
}

/** 校验备份中的分组项，损坏项不进入导入合并流程。 */
function isPasswordGroup(value: unknown): value is PasswordGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<PasswordGroup>;
  return (
    typeof group.code === 'string' &&
    typeof group.name === 'string' &&
    typeof group.parentCode === 'string' &&
    typeof group.order === 'number' &&
    Number.isFinite(group.order)
  );
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
 * 使用主密码通过 AES-GCM 加密密码数据，下载为 .aph 文件
 */
export async function exportEncryptedBackup(
  passwords: PasswordEntry[],
  masterPassword: string,
  groups: readonly PasswordGroup[] = [],
): Promise<void> {
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
        groupId: p.groupId,
      })),
      groups: groups.map(group => ({ ...group })),
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
    logger.error('导出加密备份失败:', error);
    const err = new Error(t('backup.exportError'));
    (err as any).cause = error;
    throw err;
  }
}

/**
 * 导入加密备份文件
 * 读取 .aph 文件，用主密码解密，返回密码数据
 */
export async function importEncryptedBackup(
  file: File,
  masterPassword: string,
): Promise<{ entries: Omit<PasswordEntry, 'id' | 'order'>[]; groups: PasswordGroup[] }> {
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
    const backupData: BackupData = JSON.parse(jsonStr);

    if (!backupData.version || !Array.isArray(backupData.entries)) {
      throw new Error(t('backup.invalidStructure'));
    }

    const groups = Array.isArray(backupData.groups) ? backupData.groups.filter(isPasswordGroup) : [];
    return { entries: backupData.entries, groups };
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
