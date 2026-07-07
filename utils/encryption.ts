import type { PasswordEntry, MasterPasswordConfig, EncryptedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { hexToBytes, bytesToHex } from '@/utils/crypto-light';

// ── 公开 API ──────────────────────────────────────────────

/**
 * 使用 HKDF 派生会话加密密钥（256-bit AES-GCM）
 *
 * 从主密码 salt 通过 HKDF + SHA-256 派生独立于主密码体系的会话密钥，
 * 遵循密钥分离原则，避免复用主密码 KDF 输出。
 *
 * @param salt 主密码盐值
 * @returns 64-char hex string（32 bytes raw AES key）
 */
export async function deriveSessionKey(salt: string): Promise<string> {
  const enc = new TextEncoder();
  const ikm = enc.encode(salt);
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('aph-session-salt'),
      info: enc.encode('session-encryption-v2'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = await crypto.subtle.exportKey('raw', derivedKey);
  return bytesToHex(new Uint8Array(raw));
}

/**
 * 从主密码派生 AES-256-GCM 密钥（Web Crypto PBKDF2，原生实现，不阻塞主线程）
 * 返回 64-char hex string（32 bytes）
 */
export async function deriveEncryptionKey(masterPassword: string): Promise<string> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;
    if (!config?.salt) throw new Error('无法获取主密码配置');

    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(masterPassword), 'PBKDF2', false, ['deriveKey']);
    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(config.salt), iterations: 600000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const raw = await crypto.subtle.exportKey('raw', derivedKey);
    return bytesToHex(new Uint8Array(raw));
  } catch (error) {
    logger.error('派生加密密钥失败:', error);
    throw error;
  }
}

/**
 * AES-256-GCM 加密（Web Crypto 原生，随机 IV，认证加密）
 * 格式：Base64(IV[12] + ciphertext)，authTag 由 Web Crypto 自动追加
 */
export async function encryptData(data: string, hexKey: string): Promise<string> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(data));
    const combined = new Uint8Array(12 + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), 12);
    return btoa(Array.from(combined, b => String.fromCharCode(b)).join(''));
  } catch (error) {
    logger.error('加密失败:', error);
    throw error;
  }
}

/**
 * AES-256-GCM 解密（Web Crypto 原生，认证加密）
 */
export async function decryptData(encryptedData: string, hexKey: string): Promise<string> {
  if (!encryptedData) return '';
  if (!hexKey) throw new Error('解密密钥不能为空');
  let combined: Uint8Array;
  try {
    combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  } catch {
    logger.warn('Base64解析失败，可能不是加密数据');
    return encryptedData;
  }
  if (combined.length <= 12) return encryptedData;
  const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, ['decrypt']);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: combined.slice(0, 12) },
      key,
      combined.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    logger.warn('解密失败，可能密钥错误或数据损坏');
    throw error; // 让调用方决定如何处理，避免静默返回空字符串导致数据丢失
  }
}

/**
 * 安全解密字段（失败抛出异常，由调用方保留原始加密数据）
 */
export async function decryptFieldSafely(encryptedData: string, hexKey: string, fieldName: string): Promise<string> {
  if (!encryptedData) return '';
  logger.debug(`解密字段 ${fieldName}`);
  return decryptData(encryptedData, hexKey); // 让错误向上传播
}

/**
 * 加密密码条目的敏感字段（username/password/url/remark）
 */
export async function encryptPasswordEntry(
  entry: PasswordEntry,
  masterPassword: string,
  precomputedKey?: string,
): Promise<EncryptedPasswordEntry> {
  try {
    const key = precomputedKey ?? (await deriveEncryptionKey(masterPassword));
    const encryptedEntry: EncryptedPasswordEntry = {
      ...entry,
      username: entry.username ? await encryptData(entry.username, key) : '',
      password: entry.password ? await encryptData(entry.password, key) : '',
      url: entry.url ? await encryptData(entry.url, key) : '',
      remark: entry.remark ? await encryptData(entry.remark, key) : '',
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
 * 解密密码条目的敏感字段
 */
export async function decryptPasswordEntry(
  entry: EncryptedPasswordEntry,
  masterPassword: string,
  precomputedKey?: string,
): Promise<PasswordEntry> {
  try {
    if (!entry.encrypted) {
      const { encrypted: _encrypted, ...decryptedEntry } = entry;
      return decryptedEntry as PasswordEntry;
    }
    const key = precomputedKey ?? (await deriveEncryptionKey(masterPassword));
    const { encrypted: _encrypted, ...rest } = entry;
    const decryptedEntry: PasswordEntry = {
      ...rest,
      username: await decryptFieldSafely(entry.username, key, 'username'),
      password: await decryptFieldSafely(entry.password, key, 'password'),
      url: await decryptFieldSafely(entry.url, key, 'url'),
      remark: await decryptFieldSafely(entry.remark, key, 'remark'),
    };
    logger.debug('条目解密完成');
    return decryptedEntry;
  } catch (error) {
    logger.error('解密密码条目失败:', error);
    throw error;
  }
}
