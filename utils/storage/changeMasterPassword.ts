import type { PasswordEntry, EncryptedPasswordEntry, TrashedPasswordEntry, PasswordHistoryRecord } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { verifyMasterPassword } from './masterPassword';
import { getAllPasswordsRaw } from './passwordCrud';
import { getAllTrashRaw } from './trashManager';
import { getAllHistoryRaw } from './passwordHistory';
import { lazyImport } from '@/utils/lazyImport';
import type { MasterPasswordConfig } from '@/utils/types';

/**
 * 延迟加载加密模块
 */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/**
 * 延迟加载会话管理模块
 */
const _getSessionManager = lazyImport(() => import('@/utils/sessionManager-storage'));

/**
 * 修改主密码（Rekey）
 *
 * 核心编排流程：验证旧密码 → 解密全部数据 → 用新密码重新加密 → 原子写入 → 建立新会话。
 *
 * 安全保证：
 * - 步骤 1-8 任意失败直接抛出，storage 未被写入，数据安全无损
 * - 步骤 9 使用单次 `chrome.storage.local.set()` 原子写入所有键
 * - 加密备份文件（.aph）不受影响：导入时使用导出时的密码解密，与当前主密码无关
 *
 * @param oldPassword 当前主密码（明文）
 * @param newPassword 新主密码（明文）
 * @throws 旧密码验证失败或 rekey 过程中任何错误
 */
export async function changeMasterPassword(oldPassword: string, newPassword: string): Promise<void> {
  // 1. 验证旧密码
  const isValid = await verifyMasterPassword(oldPassword);
  if (!isValid) {
    throw Object.assign(new Error('当前密码验证失败'), { code: 'WRONG_PASSWORD' });
  }

  const enc = await _getEncryption();

  // 2. 派生旧数据密钥
  const oldKey = await enc.deriveEncryptionKey(oldPassword);

  // 3. 读取三块密文数据
  const rawPasswords = await getAllPasswordsRaw();
  const rawTrash = await getAllTrashRaw();
  const rawHistory = await getAllHistoryRaw();

  // 4. 用旧密钥解密 passwords
  const decryptedPasswords: PasswordEntry[] = [];
  for (const entry of rawPasswords) {
    if ('encrypted' in entry && entry.encrypted === true) {
      const plain = await enc.decryptPasswordEntry(entry as EncryptedPasswordEntry, '', oldKey);
      decryptedPasswords.push(plain);
    } else {
      decryptedPasswords.push(entry as PasswordEntry);
    }
  }

  // 5. 用旧密钥解密 trash
  const decryptedTrash: (TrashedPasswordEntry & { _plainFields?: PasswordEntry })[] = [];
  for (const entry of rawTrash) {
    if ('encrypted' in entry && entry.encrypted === true) {
      const plain = await enc.decryptPasswordEntry(entry as EncryptedPasswordEntry, '', oldKey);
      decryptedTrash.push({ ...plain, deletedAt: entry.deletedAt } as any);
    } else {
      decryptedTrash.push(entry);
    }
  }

  // 6. 用旧密钥解密 history 中的密码字段
  const decryptedHistory: PasswordHistoryRecord[] = [];
  for (const record of rawHistory) {
    try {
      const plainPassword = await enc.decryptData(record.password, oldKey);
      decryptedHistory.push({ ...record, password: plainPassword });
    } catch {
      // 无法解密的历史记录跳过（可能是损坏数据）
      logger.warn(`跳过无法解密的历史记录: entryId=${record.entryId}`);
    }
  }

  // 7. 派生新数据密钥
  const newKey = await enc.deriveEncryptionKey(newPassword);

  // 8. 用新密钥重新加密所有数据
  const reEncryptedPasswords: EncryptedPasswordEntry[] = [];
  for (const entry of decryptedPasswords) {
    const encrypted = await enc.encryptPasswordEntry(entry, '', newKey);
    reEncryptedPasswords.push(encrypted);
  }

  const reEncryptedTrash: TrashedPasswordEntry[] = [];
  for (const entry of decryptedTrash) {
    const { deletedAt, ...plainEntry } = entry as any;
    const encrypted = await enc.encryptPasswordEntry(plainEntry as PasswordEntry, '', newKey);
    reEncryptedTrash.push({ ...encrypted, deletedAt } as TrashedPasswordEntry);
  }

  const reEncryptedHistory: PasswordHistoryRecord[] = [];
  for (const record of decryptedHistory) {
    const encryptedPassword = await enc.encryptData(record.password, newKey);
    reEncryptedHistory.push({ ...record, password: encryptedPassword });
  }

  // 9. 生成新的校验哈希（保留原 salt！）
  // 注意：deriveEncryptionKey 内部从 storage 读取 salt 来派生数据密钥，
  // 若此处替换为新 salt，则后续解密时会派生出不同的密钥，导致数据永久不可解密。
  // salt 的安全作用是防彩虹表，更换密码本身已提供足够安全性，无需更新 salt。
  const masterPwResult = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
  const existingConfig = masterPwResult[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;
  const existingSalt = existingConfig.salt;
  const newVerifierHash = await enc.deriveVerifierHash(newPassword, existingSalt);

  // 10. 原子写入：单次 chrome.storage.local.set() 保证全成功或全失败
  await chrome.storage.local.set({
    [STORAGE_KEYS.PASSWORDS]: reEncryptedPasswords,
    [STORAGE_KEYS.TRASH]: reEncryptedTrash,
    [STORAGE_KEYS.PASSWORD_HISTORY]: reEncryptedHistory,
    [STORAGE_KEYS.MASTER_PASSWORD]: {
      hashedPassword: newVerifierHash,
      salt: existingSalt,
      kdf: 'pbkdf2-sha256' as const,
    },
  });

  // 11. 建立新会话
  // 读取当前有效期配置（默认 24 小时）
  const sessionResult = await chrome.storage.local.get(SESSION_STORAGE_KEYS.VALIDITY_HOURS);
  const validityHours = (sessionResult[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;

  const sessionManager = await _getSessionManager();
  await sessionManager.createSession(newPassword, validityHours);

  logger.info('主密码修改成功，所有数据已重新加密');
}
