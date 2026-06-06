import CryptoJS from 'crypto-js';
import type { PasswordEntry, MasterPasswordConfig } from '@/utils/types';
import { logger } from '@/utils/logger';

// 扩展PasswordEntry接口以包含加密标识
export interface EncryptedPasswordEntry extends PasswordEntry {
  encrypted?: boolean;
}

/**
 * 存储键名常量（加密模块使用的部分）
 */
export const STORAGE_KEYS = {
  PASSWORDS: 'account_passwords',
  MASTER_PASSWORD: 'master_password_config',
  SETTINGS: 'app_settings',
  MASTER_PASSWORD_VALIDITY: 'master_password_validity',
  SORT_CONFIG: 'password_sort_config',
  FLOATING_BUTTON_CONFIG: 'floating_button_config',
  EMAIL_BACKUP_CONFIG: 'email_backup_config',
  LAST_AUTO_BACKUP_TIME: 'last_auto_backup_time',
  AUTO_SAVE_CONFIG: 'auto_save_config',
};

/**
 * MD5 加密
 */
export function hashPassword(password: string, salt: string = ''): string {
  const cleanPassword = String(password || '').trim();
  const cleanSalt = String(salt || '').trim();
  const combined = cleanPassword + cleanSalt;
  return CryptoJS.MD5(combined).toString();
}

/**
 * 生成随机盐值
 */
export function generateSalt(): string {
  return CryptoJS.lib.WordArray.random(16).toString();
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'uuid-' + crypto.randomUUID();
  }
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  return `uuid-${id}`;
}

/**
 * 从主密码派生密钥
 */
export async function deriveEncryptionKey(masterPassword: string): Promise<string> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;

    if (!config || !config.salt) {
      throw new Error('无法获取主密码配置');
    }

    const key = CryptoJS.PBKDF2(masterPassword, config.salt, {
      keySize: 256 / 32,
      iterations: 10000,
    });

    return key.toString();
  } catch (error) {
    logger.error('派生加密密钥失败:', error);
    throw error;
  }
}

/**
 * 高级AES加密 - 使用随机IV增强安全性
 */
export function encryptData(data: string, key: string): string {
  try {
    const iv = CryptoJS.lib.WordArray.random(16);
    const parsedKey = CryptoJS.enc.Utf8.parse(key);

    const encrypted = CryptoJS.AES.encrypt(data, parsedKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const combined = iv.concat(encrypted.ciphertext);
    return combined.toString(CryptoJS.enc.Base64);
  } catch (error) {
    logger.error('加密失败:', error);
    throw error;
  }
}

/**
 * 高级AES解密 - 提取IV并解密
 */
export function decryptData(encryptedData: string, key: string): string {
  try {
    if (!encryptedData) {
      logger.warn('加密数据为空');
      return '';
    }

    if (!key) {
      logger.warn('解密密钥为空');
      throw new Error('解密密钥不能为空');
    }

    let combined;
    try {
      combined = CryptoJS.enc.Base64.parse(encryptedData);
    } catch (_parseError) {
      logger.warn('Base64解析失败，可能不是加密数据');
      return encryptedData;
    }

    if (combined.words.length < 4) {
      logger.warn('加密数据长度不足');
      return encryptedData;
    }

    const iv = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4));
    const ciphertext = CryptoJS.lib.WordArray.create(combined.words.slice(4));

    if (ciphertext.words.length === 0) {
      logger.warn('密文为空');
      return '';
    }

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertext,
      iv: iv,
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, CryptoJS.enc.Utf8.parse(key), {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    try {
      const result = decrypted.toString(CryptoJS.enc.Utf8);
      if (result === '') {
        logger.warn('解密结果为空，可能密钥错误');
        return '';
      }
      return result;
    } catch (_utf8Error) {
      logger.warn('UTF-8解码失败，可能密钥错误或数据损坏');
      return '';
    }
  } catch (error: any) {
    logger.error('解密失败:', error);

    if (error.message && (error.message.includes('Malformed') || error.message.includes('malformed'))) {
      logger.warn('检测到畸形数据，返回空字符串');
      return '';
    }

    return encryptedData;
  }
}

/**
 * 加密密码条目
 * 对敏感字段（username、password、url、remark）进行加密
 * 空字段不进行加密，保持原值
 */
export async function encryptPasswordEntry(
  entry: PasswordEntry,
  masterPassword: string,
): Promise<EncryptedPasswordEntry> {
  try {
    const key = await deriveEncryptionKey(masterPassword);

    const encryptedEntry: EncryptedPasswordEntry = {
      ...entry,
      username: entry.username ? encryptData(entry.username, key) : '',
      password: entry.password ? encryptData(entry.password, key) : '',
      url: entry.url ? encryptData(entry.url, key) : '',
      remark: entry.remark ? encryptData(entry.remark, key) : '',
      encrypted: true,
    } as EncryptedPasswordEntry;

    logger.debug('条目加密完成');
    return encryptedEntry;
  } catch (error) {
    logger.error('加密密码条目失败:', error);
    throw error;
  }
}

/**
 * 解密密码条目
 * 对敏感字段（username、password、url、remark）进行解密
 */
export async function decryptPasswordEntry(
  entry: EncryptedPasswordEntry,
  masterPassword: string,
): Promise<PasswordEntry> {
  try {
    if (!entry.encrypted) {
      const { encrypted: _encrypted, ...decryptedEntry } = entry;
      return decryptedEntry as PasswordEntry;
    }

    const key = await deriveEncryptionKey(masterPassword);

    const decryptedEntry: PasswordEntry = {
      ...entry,
      username: decryptFieldSafely(entry.username, key, 'username'),
      password: decryptFieldSafely(entry.password, key, 'password'),
      url: decryptFieldSafely(entry.url, key, 'url'),
      remark: decryptFieldSafely(entry.remark, key, 'remark'),
    };

    logger.debug('条目解密完成');
    delete (decryptedEntry as any).encrypted;
    return decryptedEntry;
  } catch (error) {
    logger.error('解密密码条目失败:', error);
    throw error;
  }
}

/**
 * 安全解密字段 - 即使解密失败也返回原始数据或空字符串
 */
export function decryptFieldSafely(encryptedData: string, key: string, fieldName: string): string {
  if (!encryptedData) {
    return '';
  }
  try {
    return decryptData(encryptedData, key);
  } catch (_error) {
    logger.warn(`字段 ${fieldName} 解密失败，返回原始数据`);
    return encryptedData;
  }
}
