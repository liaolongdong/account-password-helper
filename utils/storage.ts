import type { PasswordEntry, MasterPasswordConfig, FloatingButtonConfig, EmailBackupConfig } from '@/utils/types';
import { logger } from '@/utils/logger';
import {
  STORAGE_KEYS,
  EncryptedPasswordEntry,
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
import {
  isSessionActiveSync,
  isSessionValid,
  createSession,
  clearSession,
  getSessionMasterPassword,
  getSessionMasterPasswordDecrypted,
  getSessionExpiryTime,
  generateSessionEncryptionKey,
  migrateUnencryptedEntries,
  getMasterPasswordValidityHours,
  setMasterPasswordValidityHours,
} from '@/utils/sessionManager-storage';

// 重新导出供外部使用
export type { EncryptedPasswordEntry } from '@/utils/encryption';
export { STORAGE_KEYS } from '@/utils/encryption';

export class StorageUtils {
  // ==================== 加密相关（委托到 encryption.ts） ====================

  static hashPassword(password: string, salt: string = ''): string {
    return hashPassword(password, salt);
  }

  static generateSalt(): string {
    return generateSalt();
  }

  static generateId(): string {
    return generateId();
  }

  static async deriveEncryptionKey(masterPassword: string): Promise<string> {
    return deriveEncryptionKey(masterPassword);
  }

  static encryptData(data: string, key: string): string {
    return encryptData(data, key);
  }

  static decryptData(encryptedData: string, key: string): string {
    return decryptData(encryptedData, key);
  }

  static async encryptPasswordEntry(entry: PasswordEntry, masterPassword: string): Promise<EncryptedPasswordEntry> {
    return encryptPasswordEntry(entry, masterPassword);
  }

  static async decryptPasswordEntry(entry: EncryptedPasswordEntry, masterPassword: string): Promise<PasswordEntry> {
    return decryptPasswordEntry(entry, masterPassword);
  }

  static decryptFieldSafely(encryptedData: string, key: string, fieldName: string): string {
    return decryptFieldSafely(encryptedData, key, fieldName);
  }

  // ==================== 会话管理（委托到 sessionManager-storage.ts） ====================

  static isSessionActiveSync(): boolean {
    return isSessionActiveSync();
  }

  static async isSessionValid(): Promise<boolean> {
    return isSessionValid();
  }

  static async createSession(masterPassword: string, validityHours: number): Promise<void> {
    return createSession(masterPassword, validityHours);
  }

  static async clearSession(): Promise<void> {
    return clearSession();
  }

  static getSessionMasterPassword(): string | undefined {
    return getSessionMasterPassword();
  }

  static async getSessionMasterPasswordDecrypted(): Promise<string | null> {
    return getSessionMasterPasswordDecrypted();
  }

  static async getSessionExpiryTime(): Promise<number | null> {
    return getSessionExpiryTime();
  }

  static async generateSessionEncryptionKey(): Promise<string> {
    return generateSessionEncryptionKey();
  }

  static async migrateUnencryptedEntries(masterPassword: string): Promise<void> {
    return migrateUnencryptedEntries(masterPassword);
  }

  static async getMasterPasswordValidityHours(): Promise<number> {
    return getMasterPasswordValidityHours();
  }

  static async setMasterPasswordValidityHours(hours: number): Promise<void> {
    return setMasterPasswordValidityHours(hours);
  }

  // ==================== 主密码管理 ====================

  /**
   * 设置主密码
   */
  static async setMasterPassword(password: string): Promise<void> {
    try {
      const cleanPassword = String(password || '').trim();
      if (!cleanPassword) {
        throw new Error('密码不能为空');
      }

      const salt = this.generateSalt();
      const hashedPassword = this.hashPassword(cleanPassword, salt);

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

      const verifyResult = await this.verifyMasterPassword(cleanPassword);
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
  static async verifyMasterPassword(password: string): Promise<boolean> {
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

      const hashedInput = this.hashPassword(cleanPassword, config.salt);
      return hashedInput === config.hashedPassword;
    } catch (error) {
      logger.error('验证主密码失败:', error);
      return false;
    }
  }

  /**
   * 检查是否已设置主密码
   */
  static async hasMasterPassword(): Promise<boolean> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;
      return !!(config && config.hashedPassword && config.salt);
    } catch (error) {
      logger.error('检查主密码失败:', error);
      return false;
    }
  }

  // ==================== 密码 CRUD ====================

  /**
   * 保存密码条目
   */
  static async savePassword(
    entry: Omit<PasswordEntry, 'id' | 'order'>,
    masterPassword?: string,
    copyItemId?: string,
  ): Promise<PasswordEntry> {
    try {
      const sessionActive = this.isSessionActiveSync();
      const passwords =
        masterPassword && !sessionActive ? await this.getAllPasswords(masterPassword) : await this.getAllPasswordsRaw();

      const now = Date.now();
      const createTime = entry.createTime ?? now;
      const updateTime = entry.updateTime ?? createTime;
      const newEntry: PasswordEntry = {
        ...entry,
        id: this.generateId(),
        createTime,
        updateTime,
        order: passwords.length,
      };

      const shouldEncrypt = masterPassword && !sessionActive;
      let entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
      if (shouldEncrypt) {
        const encryptedEntry = await this.encryptPasswordEntry(newEntry, masterPassword);
        if (copyItemId) {
          const copyIndex = entriesToSave.findIndex(p => p.id === copyItemId);
          if (copyIndex !== -1) {
            entriesToSave.splice(copyIndex + 1, 0, encryptedEntry);
          }
        } else {
          entriesToSave.push(encryptedEntry);
        }
      } else {
        if (copyItemId) {
          const copyIndex = entriesToSave.findIndex(p => p.id === copyItemId);
          if (copyIndex !== -1) {
            entriesToSave.splice(copyIndex + 1, 0, newEntry);
          }
        } else {
          entriesToSave.push(newEntry);
        }
      }

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: entriesToSave,
      });

      return newEntry;
    } catch (error) {
      logger.error('保存密码失败:', error);
      throw error;
    }
  }

  /**
   * 更新密码条目
   */
  static async updatePassword(id: string, updates: Partial<PasswordEntry>, masterPassword?: string): Promise<void> {
    try {
      const sessionActive = this.isSessionActiveSync();
      const passwords =
        masterPassword && !sessionActive ? await this.getAllPasswords(masterPassword) : await this.getAllPasswordsRaw();

      const index = passwords.findIndex(p => p.id === id);

      if (index !== -1) {
        const updatedEntry: PasswordEntry = {
          ...passwords[index],
          ...updates,
          updateTime: Date.now(),
        };

        const shouldEncrypt = masterPassword && !sessionActive;
        let entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
        if (shouldEncrypt) {
          const encryptedEntry = await this.encryptPasswordEntry(updatedEntry, masterPassword);
          entriesToSave[index] = encryptedEntry;
        } else {
          entriesToSave[index] = updatedEntry;
        }

        await chrome.storage.local.set({
          [STORAGE_KEYS.PASSWORDS]: entriesToSave,
        });
      }
    } catch (error) {
      logger.error('更新密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有密码条目（原始数据，不进行解密）
   */
  static async getAllPasswordsRaw(): Promise<(PasswordEntry | EncryptedPasswordEntry)[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      return (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
    } catch (error) {
      logger.error('获取原始密码列表失败:', error);
      return [];
    }
  }

  /**
   * 删除密码条目
   */
  static async deletePassword(id: string): Promise<void> {
    try {
      const passwords = await this.getAllPasswordsRaw();
      const filteredPasswords = passwords.filter((p: PasswordEntry | EncryptedPasswordEntry) => p.id !== id);

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: filteredPasswords,
      });
    } catch (error) {
      logger.error('删除密码失败:', error);
      throw error;
    }
  }

  /**
   * 批量删除密码条目
   */
  static async deletePasswords(ids: string[]): Promise<void> {
    try {
      const passwords = await this.getAllPasswordsRaw();
      const filteredPasswords = passwords.filter((p: PasswordEntry | EncryptedPasswordEntry) => !ids.includes(p.id));

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: filteredPasswords,
      });
    } catch (error) {
      logger.error('批量删除密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有密码条目（自动解密）
   */
  static async getAllPasswords(masterPassword?: string): Promise<PasswordEntry[]> {
    try {
      if (this.isSessionActiveSync()) {
        const rawData = await this.getAllPasswordsRaw();
        return rawData as PasswordEntry[];
      }

      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      const entries: (PasswordEntry | EncryptedPasswordEntry)[] =
        (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];

      const hasEncryptedEntries = entries.some(entry => 'encrypted' in entry && entry.encrypted === true);

      if (!hasEncryptedEntries) {
        return entries as PasswordEntry[];
      }

      if (!masterPassword) {
        throw new Error('需要主密码来解密数据');
      }

      const decryptedEntries: PasswordEntry[] = [];
      for (const entry of entries) {
        if ('encrypted' in entry && entry.encrypted === true) {
          try {
            const decryptedEntry = await this.decryptPasswordEntry(entry, masterPassword);
            decryptedEntries.push(decryptedEntry);
          } catch (decryptError) {
            logger.warn('跳过无法解密的条目: ' + entry.id);
            continue;
          }
        } else {
          decryptedEntries.push(entry as PasswordEntry);
        }
      }

      return decryptedEntries;
    } catch (error) {
      logger.error('获取密码列表失败:', error);
      throw new Error('加载密码列表失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  /**
   * 根据URL搜索密码
   */
  static async getPasswordsByUrl(url: string, masterPassword?: string): Promise<PasswordEntry[]> {
    try {
      const sessionActive = this.isSessionActiveSync();
      const allPasswords = sessionActive ? await this.getAllPasswords() : await this.getAllPasswords(masterPassword);

      const filteredPasswords = allPasswords.filter(p => {
        if (!p.url || p.url.trim() === '') return true;
        return url.includes(p.url) || p.url.includes(url);
      });

      await this.applySavedSortConfig(filteredPasswords, url);
      return filteredPasswords;
    } catch (error) {
      logger.error('根据URL搜索密码失败:', error);
      return [];
    }
  }

  /**
   * 搜索密码条目
   */
  static async searchPasswords(keyword: string, masterPassword?: string): Promise<PasswordEntry[]> {
    try {
      const sessionActive = this.isSessionActiveSync();
      const allPasswords = sessionActive ? await this.getAllPasswords() : await this.getAllPasswords(masterPassword);

      const lowerKeyword = keyword.toLowerCase();

      const filteredPasswords = allPasswords.filter(
        p =>
          p.username.toLowerCase().includes(lowerKeyword) ||
          p.tag.toLowerCase().includes(lowerKeyword) ||
          p.remark.toLowerCase().includes(lowerKeyword) ||
          p.url.toLowerCase().includes(lowerKeyword),
      );

      await this.applySavedSortConfig(filteredPasswords);
      return filteredPasswords;
    } catch (error) {
      logger.error('搜索密码失败:', error);
      return [];
    }
  }

  // ==================== 排序配置 ====================

  /**
   * 应用保存的排序配置
   */
  static async applySavedSortConfig(passwords: PasswordEntry[], domain?: string): Promise<void> {
    const getDomainPriority = (entry: PasswordEntry): number => {
      if (!domain) return 0;
      const hasUrl = entry.url && entry.url.trim() !== '';
      if (hasUrl && (domain.includes(entry.url) || entry.url.includes(domain))) return 0;
      return 1;
    };

    try {
      const sortConfig = await this.getSortConfig();

      if (sortConfig) {
        passwords.sort((a, b) => {
          const aPriority = getDomainPriority(a);
          const bPriority = getDomainPriority(b);
          if (aPriority !== bPriority) return aPriority - bPriority;

          let aValue: any, bValue: any;

          switch (sortConfig.prop) {
            case 'username':
              aValue = a.username;
              bValue = b.username;
              break;
            case 'url':
              aValue = a.url;
              bValue = b.url;
              break;
            case 'tag':
              aValue = a.tag;
              bValue = b.tag;
              break;
            case 'remark':
              aValue = a.remark;
              bValue = b.remark;
              break;
            case 'createTime':
              aValue = a.createTime;
              bValue = b.createTime;
              break;
            case 'updateTime':
              aValue = a.updateTime;
              bValue = b.updateTime;
              break;
            default:
              return b.updateTime - a.updateTime;
          }

          let comparison = 0;
          if (typeof aValue === 'string' && typeof bValue === 'string') {
            comparison = aValue.localeCompare(bValue);
          } else if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue;
          } else {
            return b.updateTime - a.updateTime;
          }

          return sortConfig.order === 'ascending' ? comparison : -comparison;
        });
      } else {
        passwords.sort((a, b) => {
          const aPriority = getDomainPriority(a);
          const bPriority = getDomainPriority(b);
          if (aPriority !== bPriority) return aPriority - bPriority;
          return b.updateTime - a.updateTime;
        });
      }
    } catch (error) {
      logger.error('应用排序配置失败，使用默认排序:', error);
      passwords.sort((a, b) => {
        const aPriority = getDomainPriority(a);
        const bPriority = getDomainPriority(b);
        if (aPriority !== bPriority) return aPriority - bPriority;
        return b.updateTime - a.updateTime;
      });
    }
  }

  /**
   * 更新密码排序
   */
  static async updatePasswordsOrder(passwords: PasswordEntry[]): Promise<void> {
    try {
      const updatedPasswords = passwords.map((p, index) => ({
        ...p,
        order: index,
      }));

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: updatedPasswords,
      });
    } catch (error) {
      logger.error('更新密码排序失败:', error);
      throw error;
    }
  }

  /**
   * 清空所有数据
   */
  static async clearAllData(): Promise<void> {
    try {
      await chrome.storage.local.clear();
    } catch (error) {
      logger.error('清空数据失败:', error);
      throw error;
    }
  }

  /**
   * 重置主密码（清空主密码配置）
   */
  static async resetMasterPassword(): Promise<void> {
    try {
      await chrome.storage.local.remove(STORAGE_KEYS.MASTER_PASSWORD);
    } catch (error) {
      logger.error('重置主密码失败:', error);
      throw error;
    }
  }

  /**
   * 保存排序配置
   */
  static async saveSortConfig(sortConfig: { prop: string; order: string }): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SORT_CONFIG]: sortConfig,
      });
    } catch (error) {
      logger.error('保存排序配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取排序配置
   */
  static async getSortConfig(): Promise<{ prop: string; order: string } | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SORT_CONFIG);
      return (result[STORAGE_KEYS.SORT_CONFIG] as { prop: string; order: string } | undefined) || null;
    } catch (error) {
      logger.error('获取排序配置失败:', error);
      return null;
    }
  }

  // ==================== 调试工具 ====================

  static async debugMasterPassword(): Promise<any> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig;

      return {
        hasConfig: !!config,
        hasSalt: !!config?.salt,
        hasHashedPassword: !!config?.hashedPassword,
        saltLength: config?.salt?.length || 0,
        hashLength: config?.hashedPassword?.length || 0,
        saltPreview: `${config?.salt?.substring(0, 8)}...` || 'N/A',
        hashPreview: `${config?.hashedPassword?.substring(0, 10)}...` || 'N/A',
      };
    } catch (error: any) {
      logger.error('获取主密码调试信息失败:', error);
      return { error: error.message };
    }
  }

  // ==================== 悬浮按钮配置 ====================

  static getDefaultFloatingButtonConfig(): FloatingButtonConfig {
    return {
      visible: true,
      position: 'right',
      offsetY: 0,
      opacity: 0.9,
      autoShowSidepanel: true,
      autoTriggerLogin: false,
      passwordVisibilityToggle: true,
    };
  }

  static async getFloatingButtonConfig(): Promise<FloatingButtonConfig> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.FLOATING_BUTTON_CONFIG);
      const config = result[STORAGE_KEYS.FLOATING_BUTTON_CONFIG];

      if (!config) {
        return this.getDefaultFloatingButtonConfig();
      }

      return {
        ...this.getDefaultFloatingButtonConfig(),
        ...config,
      };
    } catch (error) {
      logger.error('获取悬浮按钮配置失败:', error);
      return this.getDefaultFloatingButtonConfig();
    }
  }

  static async saveFloatingButtonConfig(config: Partial<FloatingButtonConfig>): Promise<void> {
    try {
      const currentConfig = await this.getFloatingButtonConfig();
      const newConfig: FloatingButtonConfig = {
        ...currentConfig,
        ...config,
      };

      await chrome.storage.local.set({
        [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: newConfig,
      });
    } catch (error) {
      logger.error('保存悬浮按钮配置失败:', error);
      throw error;
    }
  }

  static async setFloatingButtonVisible(visible: boolean): Promise<void> {
    await this.saveFloatingButtonConfig({ visible });
  }

  static async setFloatingButtonPosition(position: 'left' | 'right', offsetY?: number): Promise<void> {
    const config: Partial<FloatingButtonConfig> = { position };
    if (offsetY !== undefined) {
      config.offsetY = offsetY;
    }
    await this.saveFloatingButtonConfig(config);
  }

  // ==================== 邮箱备份配置 ====================

  /**
   * 获取邮箱备份配置（带默认值）
   */
  static async getEmailBackupConfig(): Promise<EmailBackupConfig> {
    const defaultConfig: EmailBackupConfig = {
      email: '',
      autoBackup: false,
      autoBackupIntervalDays: 7,
    };
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_BACKUP_CONFIG);
      const config = result[STORAGE_KEYS.EMAIL_BACKUP_CONFIG] as Partial<EmailBackupConfig> | undefined;
      if (!config) return defaultConfig;
      return { ...defaultConfig, ...config };
    } catch (error) {
      logger.error('获取邮箱备份配置失败:', error);
      return defaultConfig;
    }
  }

  /**
   * 保存邮箱备份配置
   */
  static async saveEmailBackupConfig(config: Partial<EmailBackupConfig>): Promise<void> {
    try {
      const current = await this.getEmailBackupConfig();
      const updated: EmailBackupConfig = { ...current, ...config };
      await chrome.storage.local.set({
        [STORAGE_KEYS.EMAIL_BACKUP_CONFIG]: updated,
      });
    } catch (error) {
      logger.error('保存邮箱备份配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取最后一次自动备份时间戳
   */
  static async getLastAutoBackupTime(): Promise<number | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_AUTO_BACKUP_TIME);
      return (result[STORAGE_KEYS.LAST_AUTO_BACKUP_TIME] as number | undefined) ?? null;
    } catch (error) {
      logger.error('获取最后自动备份时间失败:', error);
      return null;
    }
  }

  /**
   * 记录自动备份时间戳
   */
  static async setLastAutoBackupTime(timestamp: number = Date.now()): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_AUTO_BACKUP_TIME]: timestamp,
      });
    } catch (error) {
      logger.error('记录自动备份时间失败:', error);
      throw error;
    }
  }
}
