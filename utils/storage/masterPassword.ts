import type { MasterPasswordConfig } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { hashPassword, generateSalt, timingSafeEqual } from '@/utils/encryption';

/**
 * 设置主密码
 */
export async function setMasterPassword(password: string): Promise<void> {
  try {
    const cleanPassword = String(password || '').trim();
    if (!cleanPassword) {
      throw new Error('密码不能为空');
    }

    const salt = generateSalt();
    const hashedPassword = await hashPassword(cleanPassword, salt);

    const config: MasterPasswordConfig = {
      hashedPassword,
      salt,
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: config,
    });

    const savedConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const saved = !!savedConfig[STORAGE_KEYS.MASTER_PASSWORD];

    if (!saved) {
      throw new Error('主密码保存失败');
    }

    const verifyResult = await verifyMasterPassword(cleanPassword);
    if (!verifyResult) {
      throw new Error('主密码设置验证失败');
    }
  } catch (error) {
    logger.error('设置主密码失败:', error);
    throw error;
  }
}

/**
 * 验证主密码
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;

    if (!config || !config.salt || !config.hashedPassword) {
      return false;
    }

    const cleanPassword = String(password || '').trim();
    if (!cleanPassword) {
      return false;
    }

    const hashedInput = await hashPassword(cleanPassword, config.salt);
    return timingSafeEqual(hashedInput, config.hashedPassword);
  } catch (error) {
    logger.error('验证主密码失败:', error);
    return false;
  }
}

/**
 * 检查是否已设置主密码
 */
export async function hasMasterPassword(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;
    return !!(config && config.hashedPassword && config.salt);
  } catch (error) {
    logger.error('检查主密码失败:', error);
    return false;
  }
}

/**
 * 重置主密码（清空主密码配置）
 */
export async function resetMasterPassword(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.MASTER_PASSWORD);
  } catch (error) {
    logger.error('重置主密码失败:', error);
    throw error;
  }
}

/**
 * 清空所有数据
 */
export async function clearAllData(): Promise<void> {
  try {
    await chrome.storage.local.clear();
  } catch (error) {
    logger.error('清空数据失败:', error);
    throw error;
  }
}
