import type { PasswordEntry, MasterPasswordConfig, EncryptedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import {
  STORAGE_KEYS,
  encryptData,
  decryptData,
  encryptPasswordEntry,
  decryptPasswordEntry,
  deriveSessionKey,
} from '@/utils/encryption';

/**
 * 会话存储键名
 */
export const SESSION_STORAGE_KEYS = {
  MASTER_PASSWORD: 'session_master_password',
  PASSWORD_EXPIRY: 'session_password_expiry',
  VALIDITY_HOURS: 'session_validity_hours',
  /** 标记密码数据已在 storage 中解密为明文，避免 ensureDataConsistencyWithSession 重复读取 PASSWORDS */
  PASSWORDS_DECRYPTED: 'session_passwords_decrypted',
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
    if (!encryptedSessionMasterPassword || !sessionPasswordExpiry) {
      // 性能优化：合并 session keys + MASTER_PASSWORD + PASSWORDS 为单次 storage 批量读取
      const result = await chrome.storage.local.get([
        SESSION_STORAGE_KEYS.MASTER_PASSWORD,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
        SESSION_STORAGE_KEYS.VALIDITY_HOURS,
        SESSION_STORAGE_KEYS.PASSWORDS_DECRYPTED,
        STORAGE_KEYS.MASTER_PASSWORD,
        STORAGE_KEYS.PASSWORDS,
      ]);

      if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
        encryptedSessionMasterPassword = result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] as string | null;
        sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | null;
        sessionValidityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;

        const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;

        if (config && config.salt) {
          sessionEncryptionKey = await deriveSessionKey(config.salt);
        } else {
          sessionEncryptionKey = await generateSessionEncryptionKey();
        }

        // 检查解密标记：如果标记为 true，跳过 expensive 的数据一致性检查（避免重复解密）
        const passwordsDecrypted = result[SESSION_STORAGE_KEYS.PASSWORDS_DECRYPTED] as boolean | undefined;
        if (!passwordsDecrypted) {
          // flag 为 false 时需要进行数据一致性检查，但 PASSWORDS 已在批量读取中获取，直接传入避免重复读取
          const rawPasswords =
            (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
          await ensureDataConsistencyWithSession(rawPasswords);
        }
      } else {
        return false;
      }
    }

    const now = Date.now();
    if (sessionPasswordExpiry !== null && now >= sessionPasswordExpiry) {
      await clearSession();
      return false;
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
 * @param preloadedPasswords 可选，从批量 storage 读取中已获取的密码数据，传入可避免重复读取
 */
async function ensureDataConsistencyWithSession(
  preloadedPasswords?: (PasswordEntry | EncryptedPasswordEntry)[],
): Promise<void> {
  try {
    const rawData: (PasswordEntry | EncryptedPasswordEntry)[] =
      preloadedPasswords ??
      (((await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS))[STORAGE_KEYS.PASSWORDS] as
        | (PasswordEntry | EncryptedPasswordEntry)[]
        | undefined) ||
        []);
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
 * 获取会话主密码（解密后）
 */
export async function getSessionMasterPasswordDecrypted(): Promise<string | null> {
  if (!encryptedSessionMasterPassword || !sessionEncryptionKey) {
    return null;
  }

  try {
    return await decryptData(encryptedSessionMasterPassword, sessionEncryptionKey);
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
      sessionEncryptionKey = await deriveSessionKey(config.salt);
    } else {
      sessionEncryptionKey = await generateSessionEncryptionKey();
    }

    encryptedSessionMasterPassword = await encryptData(masterPassword, sessionEncryptionKey);
    sessionValidityHours = validityHours;
    sessionPasswordExpiry = Date.now() + validityHours * 60 * 60 * 1000;

    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.MASTER_PASSWORD]: encryptedSessionMasterPassword,
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: sessionPasswordExpiry,
      [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
      [SESSION_STORAGE_KEYS.PASSWORDS_DECRYPTED]: false, // 解密前先设为 false，解密成功后更新
    });

    await decryptAllPasswordsOnSessionCreate(masterPassword);

    // 解密成功，标记密码数据已为明文
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.PASSWORDS_DECRYPTED]: true,
    });
  } catch (error) {
    logger.error('创建会话缓存失败:', error);
    throw error;
  }
}

/**
 * 从 storage 恢复会话加密密钥（不触发过期检查）
 */
async function restoreSessionEncryptionKeyFromStorage(): Promise<void> {
  const result = await chrome.storage.local.get([
    SESSION_STORAGE_KEYS.MASTER_PASSWORD,
    SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    SESSION_STORAGE_KEYS.VALIDITY_HOURS,
    STORAGE_KEYS.MASTER_PASSWORD,
  ]);

  if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD]) {
    encryptedSessionMasterPassword = result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] as string;
    sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number;
    sessionValidityHours = (result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;

    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;
    if (config && config.salt) {
      sessionEncryptionKey = await deriveSessionKey(config.salt);
    } else {
      sessionEncryptionKey = await generateSessionEncryptionKey();
    }
  }
}

/**
 * 清除会话缓存
 */
export async function clearSession(): Promise<void> {
  try {
    // 内存状态可能因页面重载而丢失，直接从 storage 恢复（避免调用 isSessionValid 产生递归）
    if (!encryptedSessionMasterPassword || !sessionEncryptionKey) {
      await restoreSessionEncryptionKeyFromStorage();
    }

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
      SESSION_STORAGE_KEYS.PASSWORDS_DECRYPTED,
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

    const hasUnencrypted = rawPasswords.some(e => !('encrypted' in e && e.encrypted === true));
    if (!hasUnencrypted) return;

    // 派生一次密钥，所有条目复用，避免 PBKDF2 × N 次
    const key = await deriveEncryptionKey(masterPassword);

    const encryptedPasswords: EncryptedPasswordEntry[] = [];
    for (const entry of rawPasswords) {
      if ('encrypted' in entry && entry.encrypted === true) {
        encryptedPasswords.push(entry as EncryptedPasswordEntry);
        continue;
      }
      const encryptedEntry = await encryptPasswordEntry(entry as PasswordEntry, masterPassword, key);
      encryptedPasswords.push(encryptedEntry);
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORDS]: encryptedPasswords });
    logger.debug('会话失效前，所有密码条目已加密');
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

    const hasEncrypted = rawPasswords.some(e => 'encrypted' in e && e.encrypted === true);
    if (!hasEncrypted) return;

    // 派生一次密钥，所有条目复用
    const key = await deriveEncryptionKey(masterPassword);

    const decryptedPasswords: PasswordEntry[] = [];
    for (const entry of rawPasswords) {
      if ('encrypted' in entry && entry.encrypted === true) {
        try {
          const decryptedEntry = await decryptPasswordEntry(entry, masterPassword, key);
          decryptedPasswords.push(decryptedEntry);
        } catch (_decryptError) {
          logger.warn('跳过无法解密的条目: ' + entry.id);
          // 保留加密条目原样，防止密文被当作明文重新加密导致数据丢失
          decryptedPasswords.push(entry as unknown as PasswordEntry);
        }
      } else {
        decryptedPasswords.push(entry as PasswordEntry);
      }
    }

    if (hasEncrypted) {
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
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
    /** todo 测试过期时间 别删除 start */
    if (hours < 0.1 || hours > 168) {
      throw new Error('有效期必须在0.1小时到7天（168小时）之间');
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
