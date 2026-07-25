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
 * 核心编排流程：验证旧密码 → 解密全部数据 → 用新密码重新加密 → 准备新会话密钥 → 原子写入。
 *
 * 安全保证：
 * - 步骤 1-9 任意失败直接抛出，storage 未被写入，数据安全无损
 * - 步骤 11 使用单次 `chrome.storage.local.set()` 将数据密文与新会话密钥原子写入，
 *   不存在「新密文 + 旧会话密钥」的中间状态
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

  // 10. 准备新会话密钥材料（rekey）
  // salt 未变，步骤 7 派生的 newKey 即新会话数据密钥；prepareSessionRekey 会同步
  // 更新本上下文内存镜像与 storage.session，并返回需一并原子落盘的会话键值对。
  const sessionResult = await chrome.storage.local.get(SESSION_STORAGE_KEYS.VALIDITY_HOURS);
  const validityHours = (sessionResult[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
  const sessionManager = await _getSessionManager();
  const sessionKeysToWrite = await sessionManager.prepareSessionRekey(newKey, validityHours);

  // 11. 原子写入：数据密文 + 校验哈希 + 新会话密钥单次 chrome.storage.local.set()，
  // 全成功或全失败，消除「新密文已落盘、会话密钥仍是旧值」的竞态窗口
  // （各上下文的 storage 监听器会用旧密钥解密新密文全部失败，导致列表被清空）
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: reEncryptedPasswords,
      [STORAGE_KEYS.TRASH]: reEncryptedTrash,
      [STORAGE_KEYS.PASSWORD_HISTORY]: reEncryptedHistory,
      [STORAGE_KEYS.MASTER_PASSWORD]: {
        hashedPassword: newVerifierHash,
        salt: existingSalt,
        kdf: 'pbkdf2-sha256' as const,
      },
      ...sessionKeysToWrite,
    });
  } catch (error) {
    // 写入失败时数据仍为旧密文，但会话密钥材料（内存/storage.session）已更新为新值，
    // 主动清除会话强制重新验证，避免「新密钥 + 旧密文」的不一致状态
    await sessionManager.clearSession().catch(() => {});
    throw error;
  }

  // 12. 清理旧版遗留的主密码密文（若存在），与 createSession 的清理行为保持一致
  await chrome.storage.local.remove(SESSION_STORAGE_KEYS.MASTER_PASSWORD);

  logger.info('主密码修改成功，所有数据已重新加密');
}
