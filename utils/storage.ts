import type {
  PasswordEntry,
  MasterPasswordConfig,
  FloatingButtonConfig,
  EmailBackupConfig,
  AutoSaveConfig,
  AutoSavePasswordData,
} from '@/utils/types';
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
      const entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
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
        const entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
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
          } catch (_decryptError) {
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
      const err = new Error('加载密码列表失败: ' + (error instanceof Error ? error.message : '未知错误'));
      (err as any).cause = error;
      throw err;
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

          let comparison;
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
        saltPreview: config?.salt ? `${config.salt.substring(0, 8)}...` : 'N/A',
        hashPreview: config?.hashedPassword ? `${config.hashedPassword.substring(0, 10)}...` : 'N/A',
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

  // ==================== 自动保存配置 ====================

  /**
   * 获取默认自动保存配置
   */
  static getDefaultAutoSaveConfig(): AutoSaveConfig {
    return {
      enabled: true,
      domainPatterns: [],
      excludedDomains: [],
    };
  }

  /**
   * 获取自动保存配置（带默认值）
   */
  static async getAutoSaveConfig(): Promise<AutoSaveConfig> {
    const defaultConfig = this.getDefaultAutoSaveConfig();
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.AUTO_SAVE_CONFIG);
      const config = result[STORAGE_KEYS.AUTO_SAVE_CONFIG] as Partial<AutoSaveConfig> | undefined;
      if (!config) return defaultConfig;
      return {
        ...defaultConfig,
        ...config,
        domainPatterns: Array.isArray(config.domainPatterns) ? config.domainPatterns : defaultConfig.domainPatterns,
        excludedDomains: Array.isArray(config.excludedDomains) ? config.excludedDomains : defaultConfig.excludedDomains,
      };
    } catch (error) {
      logger.error('获取自动保存配置失败:', error);
      return defaultConfig;
    }
  }

  /**
   * 保存自动保存配置
   */
  static async saveAutoSaveConfig(config: Partial<AutoSaveConfig>): Promise<void> {
    try {
      const current = await this.getAutoSaveConfig();
      const updated: AutoSaveConfig = { ...current, ...config };
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_SAVE_CONFIG]: updated,
      });
    } catch (error) {
      logger.error('保存自动保存配置失败:', error);
      throw error;
    }
  }

  /**
   * 添加域名到自动保存黑名单（去重）
   *
   * 用户在保存密码弹窗中点击「不再提示」后调用，
   * 后续该域名下的登录将不再弹窗提示保存密码。
   *
   * @param domain 要屏蔽的域名
   */
  static async addExcludedDomain(domain: string): Promise<void> {
    const config = await this.getAutoSaveConfig();
    const lowerDomain = domain.toLowerCase();
    if (config.excludedDomains.some(d => d.toLowerCase() === lowerDomain)) {
      return;
    }
    config.excludedDomains.push(lowerDomain);
    await this.saveAutoSaveConfig({ excludedDomains: config.excludedDomains });
    logger.info(`[APH] 已将 ${lowerDomain} 加入自动保存屏蔽列表`);
  }

  /**
   * 从自动保存黑名单中移除域名
   *
   * 用户在设置弹窗中删除屏蔽域名后调用，
   * 恢复该域名的自动保存弹窗提示。
   *
   * @param domain 要移除的域名
   */
  static async removeExcludedDomain(domain: string): Promise<void> {
    const config = await this.getAutoSaveConfig();
    const lowerDomain = domain.toLowerCase();
    config.excludedDomains = config.excludedDomains.filter(d => d.toLowerCase() !== lowerDomain);
    await this.saveAutoSaveConfig({ excludedDomains: config.excludedDomains });
    logger.info(`[APH] 已将 ${lowerDomain} 从自动保存屏蔽列表移除`);
  }

  /**
   * 检测域名是否匹配自动保存规则
   * - domainPatterns 为空时匹配所有域名
   * - isRegex=false 时进行精确匹配或子域名匹配
   * - isRegex=true 时使用正则表达式匹配
   * @param hostname 当前页面域名
   * @param config 自动保存配置
   * @returns 是否匹配
   */
  static isDomainMatchForAutoSave(hostname: string, config: AutoSaveConfig): boolean {
    if (!hostname) return false;

    // 黑名单前置检查：已屏蔽的域名直接返回 false，优先级高于 domainPatterns
    if (config.excludedDomains && config.excludedDomains.length > 0) {
      const lowerHostname = hostname.toLowerCase();
      const isExcluded = config.excludedDomains.some(excluded => {
        const lowerExcluded = excluded.toLowerCase();
        return lowerHostname === lowerExcluded || lowerHostname.endsWith('.' + lowerExcluded);
      });
      if (isExcluded) return false;
    }

    if (config.domainPatterns.length === 0) return true;

    const lowerHostname = hostname.toLowerCase();
    return config.domainPatterns.some(rule => {
      if (!rule.pattern) return false;
      if (rule.isRegex) {
        try {
          const regex = new RegExp(rule.pattern, 'i');
          return regex.test(lowerHostname);
        } catch {
          logger.warn('自动保存域名正则表达式无效:', rule.pattern);
          return false;
        }
      }
      const lowerPattern = rule.pattern.toLowerCase();
      return lowerHostname === lowerPattern || lowerHostname.endsWith('.' + lowerPattern);
    });
  }

  /**
   * 自动保存密码
   * - 会话有效期内才保存
   * - 同账号+同域名时更新已有条目
   * - 新账号时新增条目，备注设为"自动保存"，tag标签取页面标题
   * @param data 自动保存密码数据
   * @returns 保存结果
   */
  static async autoSavePassword(data: AutoSavePasswordData): Promise<{ success: boolean; message: string }> {
    try {
      // 1. 校验会话有效性
      const sessionValid = await this.isSessionValid();
      if (!sessionValid) {
        return { success: false, message: '会话已过期，跳过自动保存' };
      }

      // 2. 读取配置并校验域名
      const config = await this.getAutoSaveConfig();
      if (!config.enabled) {
        return { success: false, message: '自动保存已禁用' };
      }
      if (!this.isDomainMatchForAutoSave(data.url, config)) {
        return { success: false, message: '域名不匹配，跳过自动保存' };
      }

      // 3. 校验账号密码非空
      if (!data.username || !data.password) {
        return { success: false, message: '账号或密码为空，跳过保存' };
      }

      // 4. 获取当前密码列表（会话期内为明文）
      const passwords = await this.getAllPasswordsRaw();

      // 5. 查找同账号+同域名条目（精确域名/子域名匹配，避免子串误匹配）
      const existingEntry = passwords.find(p => {
        const entry = p as PasswordEntry;
        if (!entry.url || entry.username !== data.username) return false;
        const entryHost = (() => {
          try {
            return new URL(entry.url.startsWith('http') ? entry.url : `https://${entry.url}`).hostname;
          } catch {
            return entry.url;
          }
        })().toLowerCase();
        const dataHost = data.url.toLowerCase();
        return entryHost === dataHost || entryHost.endsWith('.' + dataHost) || dataHost.endsWith('.' + entryHost);
      }) as PasswordEntry | undefined;

      if (existingEntry) {
        // 同账号+同域名，更新密码
        // 标签更新策略：用户主动编辑过则使用新值，否则保留存量值
        const newTag = data.tagEdited ? data.tag : existingEntry.tag || data.tag || '';
        // 备注更新策略：用户主动编辑过则使用新值，否则保留存量值（存量为空时用新值兜底）
        const newRemark = data.remarkEdited
          ? data.remark || '自动保存'
          : existingEntry.remark || data.remark || '自动保存';

        await this.updatePassword(existingEntry.id, {
          password: data.password,
          tag: newTag,
          remark: newRemark,
          updateTime: Date.now(),
        });
        return { success: true, message: '已更新已有账号密码' };
      } else {
        // 新账号，新增条目，直接使用用户编辑后的标签和备注
        await this.savePassword({
          username: data.username,
          password: data.password,
          url: data.url,
          tag: data.tag || '',
          remark: data.remark || '自动保存',
          createTime: Date.now(),
          updateTime: Date.now(),
        });
        return { success: true, message: '已自动保存新账号密码' };
      }
    } catch (error) {
      logger.error('自动保存密码失败:', error);
      return { success: false, message: '自动保存失败: ' + (error instanceof Error ? error.message : '未知错误') };
    }
  }
}
