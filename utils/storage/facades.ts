import type { MasterPasswordConfig } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

// ==================== 加密相关（委托到 encryption.ts） ====================

export {
  hashPassword,
  generateSalt,
  generateId,
  deriveEncryptionKey,
  encryptData,
  decryptData,
  encryptPasswordEntry,
  decryptPasswordEntry,
  decryptFieldSafely,
} from '@/utils/encryption';

// ==================== 会话管理（委托到 sessionManager-storage.ts） ====================

export {
  isSessionActiveSync,
  isSessionValid,
  createSession,
  clearSession,
  getSessionMasterPasswordDecrypted,
  getSessionExpiryTime,
  generateSessionEncryptionKey,
  migrateUnencryptedEntries,
  getMasterPasswordValidityHours,
  setMasterPasswordValidityHours,
} from '@/utils/sessionManager-storage';

// ==================== 调试工具 ====================

export async function debugMasterPassword(): Promise<any> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;

    return {
      hasConfig: !!config,
      hasSalt: !!config?.salt,
      hasHashedPassword: !!config?.hashedPassword,
      saltLength: config?.salt?.length || 0,
      hashLength: config?.hashedPassword?.length || 0,
      saltPreview: config?.salt ? `${config.salt.substring(0, 8)}...` : 'N/A',
      hashPreview: config?.hashedPassword ? `${config.hashedPassword.substring(0, 10)}...` : 'N/A',
    };
  } catch (error: any) {
    logger.error('获取主密码调试信息失败:', error);
    return { error: error.message };
  }
}
