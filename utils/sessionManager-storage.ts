import type { PasswordEntry, MasterPasswordConfig } from './types';
import { logger } from './logger';
import {
  STORAGE_KEYS,
  EncryptedPasswordEntry,
  hashPassword,
  encryptData,
  decryptData,
  encryptPasswordEntry,
  decryptPasswordEntry,
} from './encryption';

/**
 * 会话存储键名
 */
export const SESSION_STORAGE_KEYS = {
  MASTER_PASSWORD: 'session_master_password',
  PASSWORD_EXPIRY: 'session_password_expiry',
  VALIDITY_HOURS: 'session_validity_hours',
};

// 会话状态管理变量
let encryptedSessionMasterPassword: string | null = null;
let sessionPasswordExpiry: number | null = null;
let sessionValidityHours: number | null = null;
let sessionEncryptionKey: string | null = null;

/**
 * 同步检查会话是否有效（仅检查内存状态，不从存储恢复）
 */
export function isSessionActiveSync(): boolean {
  if (!encryptedSessionMasterPassword || !sessionPasswordExpiry) {
    return false;
  }
  return Date.now() < sessionPasswordExpiry;
}

/**
 * 检查会话是否有效
 * 增强：会话恢复后自动检查数据状态一致性，必要时重新解密
 */
export async function isSessionValid(): Promise<boolean> {
  try {
    let needCheckDataConsistency = false;

    if (!encryptedSessionMasterPassword || !sessionPasswordExpiry) {
      const result = await chrome.storage.local.get([
        SESSION_STORAGE_KEYS.MASTER_PASSWORD,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
        SESSION_STORAGE_KEYS.VALIDITY_HOURS,
      ]);

      if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
        encryptedSessionMasterPassword = result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] as string | null;
        sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | null;
        sessionValidityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;

        const masterPasswordConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
        const config = masterPasswordConfig[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;

        if (config && config.salt) {
          sessionEncryptionKey = hashPassword(config.salt, 'session_encryption').substring(0, 32);
        } else {
          sessionEncryptionKey = await generateSessionEncryptionKey();
        }

        needCheckDataConsistency = true;
      } else {
        return false;
      }
    }

    const now = Date.now();
    if (sessionPasswordExpiry !== null && now >= sessionPasswordExpiry) {
      await clearSession();
      return false;
    }

    if (needCheckDataConsistency) {
      await ensureDataConsistencyWithSession();
    }

    return true;
  } catch (error) {
    logger.error('会话验证失败:', error);
    await clearSession();
    return false;
  }
}

/**
 * 确保数据状态与会话状态一致
 */
async function ensureDataConsistencyWithSession(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const rawData: (PasswordEntry | EncryptedPasswordEntry)[] =
      (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
    if (rawData.length === 0) return;

    const hasEncrypted = rawData.some(e => 'encrypted' in e && (e as EncryptedPasswordEntry).encrypted === true);

    if (hasEncrypted) {
      logger.warn('检测到会话有效但数据已加密，正在自动修复...');
      const masterPassword = await getSessionMasterPasswordDecrypted();
      if (masterPassword) {
        await decryptAllPasswordsOnSessionCreate(masterPassword);
        logger.debug('数据状态已修复，所有条目已解密为明文');
      }
    }
  } catch (error) {
    logger.error('检查数据一致性失败:', error);
  }
}

/**
 * 获取会话主密码（已弃用，保留向后兼容）
 */
export function getSessionMasterPassword(): string | undefined {
  try {
    if (!encryptedSessionMasterPassword || !sessionEncryptionKey) {
      return undefined;
    }
    return decryptData(encryptedSessionMasterPassword, sessionEncryptionKey);
  } catch (error) {
    logger.error('解密会话主密码失败:', error);
    return undefined;
  }
}

/**
 * 获取会话主密码（解密后）
 */
export async function getSessionMasterPasswordDecrypted(): Promise<string | null> {
  if (!encryptedSessionMasterPassword || !sessionEncryptionKey) {
    return null;
  }

  try {
    return decryptData(encryptedSessionMasterPassword, sessionEncryptionKey);
  } catch (error) {
    logger.error('解密会话主密码失败:', error);
    return null;
  }
}

/**
 * 创建会话缓存
 */
export async function createSession(masterPassword: string, validityHours: number): Promise<void> {
  try {
    const masterPasswordConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = masterPasswordConfig[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;

    if (config && config.salt) {
      sessionEncryptionKey = hashPassword(config.salt, 'session_encryption').substring(0, 32);
    } else {
      sessionEncryptionKey = await generateSessionEncryptionKey();
    }

    encryptedSessionMasterPassword = encryptData(masterPassword, sessionEncryptionKey);
    sessionValidityHours = validityHours;
    sessionPasswordExpiry = Date.now() + validityHours * 60 * 60 * 1000;

    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.MASTER_PASSWORD]: encryptedSessionMasterPassword,
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: sessionPasswordExpiry,
      [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
    });

    await decryptAllPasswordsOnSessionCreate(masterPassword);
  } catch (error) {
    logger.error('创建会话缓存失败:', error);
    throw error;
  }
}

/**
 * 清除会话缓存
 */
export async function clearSession(): Promise<void> {
  try {
    const masterPassword = await getSessionMasterPasswordDecrypted();
    if (masterPassword) {
      await encryptAllPasswordsBeforeSessionClear(masterPassword);
    }

    encryptedSessionMasterPassword = null;
    sessionPasswordExpiry = null;
    sessionValidityHours = null;
    sessionEncryptionKey = null;

    await chrome.storage.local.remove([
      SESSION_STORAGE_KEYS.MASTER_PASSWORD,
      SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
      SESSION_STORAGE_KEYS.VALIDITY_HOURS,
    ]);
  } catch (error) {
    logger.error('清除会话缓存失败:', error);
    throw error;
  }
}

/**
 * 会话失效前加密所有密码条目
 */
async function encryptAllPasswordsBeforeSessionClear(masterPassword: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const rawPasswords: (PasswordEntry | EncryptedPasswordEntry)[] =
      (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];

    if (rawPasswords.length === 0) return;

    const encryptedPasswords: EncryptedPasswordEntry[] = [];
    let hasChanges = false;

    for (const entry of rawPasswords) {
      if ('encrypted' in entry && entry.encrypted === true) {
        encryptedPasswords.push(entry as EncryptedPasswordEntry);
        continue;
      }

      hasChanges = true;
      const encryptedEntry = await encryptPasswordEntry(entry as PasswordEntry, masterPassword);
      encryptedPasswords.push(encryptedEntry);
    }

    if (hasChanges) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: encryptedPasswords,
      });
      logger.debug('会话失效前，所有密码条目已加密');
    }
  } catch (error) {
    logger.error('会话失效前加密密码条目失败:', error);
  }
}

/**
 * 会话创建后解密所有密码条目并明文存储
 */
async function decryptAllPasswordsOnSessionCreate(masterPassword: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const rawPasswords: (PasswordEntry | EncryptedPasswordEntry)[] =
      (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];

    if (rawPasswords.length === 0) return;

    const decryptedPasswords: PasswordEntry[] = [];
    let hasEncryptedEntries = false;

    for (const entry of rawPasswords) {
      if ('encrypted' in entry && entry.encrypted === true) {
        hasEncryptedEntries = true;
        try {
          const decryptedEntry = await decryptPasswordEntry(entry, masterPassword);
          decryptedPasswords.push(decryptedEntry);
        } catch (decryptError) {
          logger.warn('跳过无法解密的条目: ' + entry.id);
          const { encrypted, ...rest } = entry;
          decryptedPasswords.push(rest as PasswordEntry);
        }
      } else {
        decryptedPasswords.push(entry as PasswordEntry);
      }
    }

    if (hasEncryptedEntries) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: decryptedPasswords,
      });
      logger.debug('会话创建后，所有密码条目已解密为明文存储');
    }
  } catch (error) {
    logger.error('会话创建后解密密码条目失败:', error);
  }
}

/**
 * 迁移未加密的密码条目
 */
export async function migrateUnencryptedEntries(masterPassword: string): Promise<void> {
  try {
    if (isSessionActiveSync()) return;

    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const rawPasswords: (PasswordEntry | EncryptedPasswordEntry)[] =
      (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];

    if (rawPasswords.length === 0) return;

    let hasUnencrypted = false;
    const encryptedPasswords: EncryptedPasswordEntry[] = [];

    for (const entry of rawPasswords) {
      if (!('encrypted' in entry) || entry.encrypted !== true) {
        hasUnencrypted = true;
        const encryptedEntry = await encryptPasswordEntry(entry as PasswordEntry, masterPassword);
        encryptedPasswords.push(encryptedEntry);
      } else {
        encryptedPasswords.push(entry as EncryptedPasswordEntry);
      }
    }

    if (hasUnencrypted) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: encryptedPasswords,
      });
      logger.debug('数据迁移完成，所有条目已加密');
    }
  } catch (error) {
    logger.error('数据迁移失败:', error);
  }
}

/**
 * 获取会话过期时间
 */
export async function getSessionExpiryTime(): Promise<number | null> {
  return sessionPasswordExpiry;
}

/**
 * 生成会话加密密钥
 */
export async function generateSessionEncryptionKey(): Promise<string> {
  const timestamp = Date.now().toString();
  const randomPart = Math.random().toString(36).substring(2, 15);
  const combined = timestamp + randomPart;
  const key = hashPassword(combined, 'session_encryption_salt');
  return key.substring(0, 32);
}

/**
 * 获取主密码有效期设置
 */
export async function getMasterPasswordValidityHours(): Promise<number> {
  try {
    if (sessionValidityHours !== null) {
      return sessionValidityHours;
    }

    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD_VALIDITY);
    const validityHours = (result[STORAGE_KEYS.MASTER_PASSWORD_VALIDITY] as number | undefined) || 24;
    sessionValidityHours = validityHours;
    return validityHours;
  } catch (error) {
    logger.error('获取主密码有效期失败:', error);
    return 24;
  }
}

/**
 * 设置主密码有效期
 */
export async function setMasterPasswordValidityHours(hours: number): Promise<void> {
  try {
    if (hours < 1 || hours > 168) {
      throw new Error('有效期必须在1小时到7天（168小时）之间');
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD_VALIDITY]: hours,
    });
    sessionValidityHours = hours;
  } catch (error) {
    logger.error('设置主密码有效期失败:', error);
    throw error;
  }
}
