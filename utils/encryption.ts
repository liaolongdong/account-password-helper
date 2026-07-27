import type { PasswordEntry, MasterPasswordConfig, EncryptedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { hexToBytes, bytesToHex } from '@/utils/crypto-light';

// ── CryptoKey 句柄缓存 ────────────────────────────────────

/**
 * AES-GCM CryptoKey 句柄缓存（key = `${usage}|${hexKey}`）
 *
 * 批量加解密（如 getAllPasswords 全量解密 N 条 ×5 字段）时，每字段重复 importKey
 * 会产生可观的累积开销（实测 300 条约 50ms，Windows 低端机可达 100ms+）。
 * 同一会话期数据密钥固定，缓存导入后的句柄可将 importKey 从 O(N×5) 降为 O(1)。
 *
 * 安全性：句柄不可导出（extractable=false），且在 clearSession 时经
 * clearCryptoKeyCache 清空，避免锁定后仍驻留可用的解密句柄。
 */
const _cryptoKeyCache = new Map<string, Promise<CryptoKey>>();

/** 缓存容量上限：正常仅会话数据密钥一把（encrypt/decrypt 各一条），rekey 期新旧密钥短暂共存 */
const CRYPTO_KEY_CACHE_MAX = 4;

/**
 * 获取（或导入并缓存）AES-GCM CryptoKey 句柄
 *
 * @param hexKey 64-char hex 密钥
 * @param usage 密钥用途（encrypt/decrypt 分开缓存，保持句柄权限最小化）
 */
function getAesCryptoKey(hexKey: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const cacheKey = `${usage}|${hexKey}`;
  let keyPromise = _cryptoKeyCache.get(cacheKey);
  if (!keyPromise) {
    if (_cryptoKeyCache.size >= CRYPTO_KEY_CACHE_MAX) {
      // FIFO 淘汰最早条目，防止异常调用（如批量导入外部密钥）导致缓存无界增长
      const oldest = _cryptoKeyCache.keys().next().value;
      if (oldest !== undefined) _cryptoKeyCache.delete(oldest);
    }
    keyPromise = crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, [usage]);
    _cryptoKeyCache.set(cacheKey, keyPromise);
    // 导入失败（如非法 hex）时不缓存失败态，保留下次重试机会；按身份删除，
    // 避免旧 Promise 迟到 reject 时误删同键重新导入的新条目；
    // 调用方 await 时仍会收到原始 rejection，行为与未缓存前一致
    const createdPromise = keyPromise;
    keyPromise.catch(() => {
      if (_cryptoKeyCache.get(cacheKey) === createdPromise) _cryptoKeyCache.delete(cacheKey);
    });
  }
  return keyPromise;
}

/**
 * 清空 CryptoKey 句柄缓存
 *
 * 锁定/会话清除时调用，尽力确保锁定后内存中不残留可用的加解密句柄。
 * 注意：缓存为每 JS 上下文独立（SW/sidepanel/options 各一份），各上下文
 * 需在自身锁定感知点分别调用；句柄本身不可导出，清理属纵深防御。
 */
export function clearCryptoKeyCache(): void {
  _cryptoKeyCache.clear();
}

// ── 公开 API ──────────────────────────────────────────────

/**
 * 使用 HKDF 派生「旧版会话包裹密钥」（256-bit AES-GCM）
 *
 * 仅用于旧版会话迁移：解包历史遗留的 session_master_password blob
 * （见 getSessionMasterPasswordDecrypted）。新版主密码不再落盘，此函数不参与新会话流程。
 *
 * 注意：salt 为公开值（明文存于 storage.local），故本密钥不提供抗磁盘访问的机密性，
 * 仅用于一次性迁移旧数据。
 *
 * @param salt 主密码盐值（公开）
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
 * 派生主密码校验哈希（PBKDF2-SHA256 慢哈希，抗离线爆破）
 *
 * 与 deriveEncryptionKey 使用相同的迭代强度（600k），使攻击者即便拿到存储也无法
 * 以 GPU 快速爆破主密码。通过对 salt 做域分离（前缀 'aph-verify|'），保证校验值与
 * 加密密钥在密码学上相互独立——存储的校验值无法被反推为解密密钥。
 *
 * @param password 主密码明文
 * @param salt 主密码盐值（与加密密钥共享同一盐值，但派生上下文不同）
 * @returns 64-char hex string（32 bytes raw）
 */
export async function deriveVerifierHash(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('aph-verify|' + salt), iterations: 600000, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
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
    const key = await getAesCryptoKey(hexKey, 'encrypt');
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
  const key = await getAesCryptoKey(hexKey, 'decrypt');
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
 * 加密密码条目的敏感字段（username/password/url/remark/totp）
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
      totp: entry.totp ? await encryptData(entry.totp, key) : '',
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
      totp: await decryptFieldSafely(entry.totp ?? '', key, 'totp'),
    };
    logger.debug('条目解密完成');
    return decryptedEntry;
  } catch (error) {
    logger.error('解密密码条目失败:', error);
    throw error;
  }
}
