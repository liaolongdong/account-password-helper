import type { MasterPasswordConfig } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

// ==================== 加密委托 ====================
// 注意：所有加密函数（deriveEncryptionKey / encryptPasswordEntry 等）
// 仅在 sessionManager-storage.ts 和 passwordCrud.ts 中通过
// 延迟 import('@/utils/encryption') 按需加载，不在此处静态 re-export，
// 避免将 PBKDF2/HKDF/AES-GCM 拉入页面首屏 chunk（SW 产物由 WXT
// 内联为单文件，不受此拆分影响）。

// generateId 从独立文件中导入，避免静态 import 将 encryption.ts 的 PBKDF2 代码拉入页面首屏 chunk
export { generateId } from '@/utils/generateId';

// ==================== 会话管理（委托到 sessionManager-storage.ts） ====================

export {
  isSessionActiveSync,
  isSessionValid,
  invalidateSessionCache,
  createSession,
  clearSession,
  getSessionMasterPasswordDecrypted,
  getSessionDataKey,
  requestReEncryptAtRest,
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
