import CryptoJS from 'crypto-js';
import type { PasswordEntry, MasterPasswordConfig, FloatingButtonConfig } from './types';

// 扩展PasswordEntry接口以包含加密标识
interface EncryptedPasswordEntry extends PasswordEntry {
  encrypted?: boolean;
}

/**
 * 存储键名常量
 */
const STORAGE_KEYS = {
  PASSWORDS: 'account_passwords',
  MASTER_PASSWORD: 'master_password_config',
  SETTINGS: 'app_settings',
  MASTER_PASSWORD_VALIDITY: 'master_password_validity', // 添加主密码有效期存储键
  SORT_CONFIG: 'password_sort_config', // 添加排序配置存储键
  FLOATING_BUTTON_CONFIG: 'floating_button_config', // 悬浮按钮配置存储键
};

// 添加会话状态管理变量
let encryptedSessionMasterPassword: string | null = null; // 存储加密后的主密码
let sessionPasswordExpiry: number | null = null;
let sessionValidityHours: number | null = null; // 从存储中读取，初始为null

// 内存临时密钥，用于加密/解密会话中的主密码
let sessionEncryptionKey: string | null = null;

/**
 * 会话存储键名
 */
const SESSION_STORAGE_KEYS = {
  MASTER_PASSWORD: 'session_master_password',
  PASSWORD_EXPIRY: 'session_password_expiry',
  VALIDITY_HOURS: 'session_validity_hours',
};

export class StorageUtils {
  /**
   * MD5 加密
   */
  static hashPassword(password: string, salt: string = ''): string {
    // 确保密码和盐值都是字符串并去除空格
    const cleanPassword = String(password || '').trim();
    const cleanSalt = String(salt || '').trim();
    const combined = cleanPassword + cleanSalt;

    const hash = CryptoJS.MD5(combined).toString();

    return hash;
  }

  /**
   * 生成随机盐值
   */
  static generateSalt(): string {
    const salt = CryptoJS.lib.WordArray.random(16).toString();
    return salt;
  }

  /**
   * 生成唯一ID
   */
  static generateId(): string {
    // 优先使用原生JS提供的crypto API生成uuid
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return 'uuid-' + crypto.randomUUID();
    }
    // 降级处理
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    return `uuid-${id}`;
  }

  /**
   * 设置主密码
   */
  static async setMasterPassword(password: string): Promise<void> {
    try {
      // 确保密码的一致性处理
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

      // 验证保存是否成功
      const savedConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const saved = !!savedConfig[STORAGE_KEYS.MASTER_PASSWORD];

      if (!saved) {
        throw new Error('主密码保存失败');
      }

      // 立即验证一次设置的密码
      const verifyResult = await this.verifyMasterPassword(cleanPassword);

      if (!verifyResult) {
        throw new Error('主密码设置验证失败');
      }
    } catch (error) {
      console.error('StorageUtils: 设置主密码失败:', error);
      throw error;
    }
  }

  /**
   * 验证主密码
   */
  static async verifyMasterPassword(password: string): Promise<boolean> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];

      if (!config || !config.salt || !config.hashedPassword) {
        return false;
      }

      // 确保输入密码的一致性处理
      const cleanPassword = String(password || '').trim();
      if (!cleanPassword) {
        return false;
      }

      const hashedInput = this.hashPassword(cleanPassword, config.salt);

      const isValid = hashedInput === config.hashedPassword;

      return isValid;
    } catch (error) {
      console.error('StorageUtils: 验证主密码失败:', error);
      return false;
    }
  }

  /**
   * 检查是否已设置主密码
   */
  static async hasMasterPassword(): Promise<boolean> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config = result[STORAGE_KEYS.MASTER_PASSWORD];
      const hasPassword = !!(config && config.hashedPassword && config.salt);

      return hasPassword;
    } catch (error) {
      console.error('StorageUtils: 检查主密码失败:', error);
      return false;
    }
  }

  /**
   * 从主密码派生密钥
   */
  static async deriveEncryptionKey(masterPassword: string): Promise<string> {
    try {
      // 获取主密码配置中的盐值
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];

      if (!config || !config.salt) {
        throw new Error('无法获取主密码配置');
      }

      // 使用PBKDF2算法从主密码和盐值派生密钥
      const key = CryptoJS.PBKDF2(masterPassword, config.salt, {
        keySize: 256 / 32, // 256位密钥
        iterations: 10000, // 迭代次数，增强安全性
      });

      const keyString = key.toString();
      return keyString;
    } catch (error) {
      console.error('StorageUtils: 派生加密密钥失败:', error);
      throw error;
    }
  }

  /**
   * 高级AES加密 - 使用随机IV增强安全性
   */
  static encryptData(data: string, key: string): string {
    try {
      // 生成随机初始化向量
      const iv = CryptoJS.lib.WordArray.random(16);

      // 将密钥作为UTF-8解析
      const parsedKey = CryptoJS.enc.Utf8.parse(key);

      // 使用AES-256-CBC加密
      const encrypted = CryptoJS.AES.encrypt(data, parsedKey, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      // 将IV和密文组合
      const combined = iv.concat(encrypted.ciphertext);
      const result = combined.toString(CryptoJS.enc.Base64);
      return result;
    } catch (error) {
      console.error('StorageUtils: 加密失败:', error);
      throw error;
    }
  }

  /**
   * 高级AES解密 - 提取IV并解密
   */
  static decryptData(encryptedData: string, key: string): string {
    try {
      // 检查输入数据
      if (!encryptedData) {
        console.warn('StorageUtils: 加密数据为空');
        return '';
      }

      // 检查密钥
      if (!key) {
        console.warn('StorageUtils: 解密密钥为空');
        throw new Error('解密密钥不能为空');
      }

      // 将Base64编码的数据转换为WordArray
      let combined;
      try {
        combined = CryptoJS.enc.Base64.parse(encryptedData);
      } catch (parseError) {
        console.warn('StorageUtils: Base64解析失败，可能不是加密数据');
        return encryptedData; // 返回原始数据，可能本身就是明文
      }

      // 检查数据长度
      if (combined.words.length < 4) {
        console.warn('StorageUtils: 加密数据长度不足');
        return encryptedData; // 返回原始数据
      }

      // 提取IV（前16字节）
      const iv = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4));

      // 提取密文（剩余部分）
      const ciphertext = CryptoJS.lib.WordArray.create(combined.words.slice(4));

      // 检查密文是否为空
      if (ciphertext.words.length === 0) {
        console.warn('StorageUtils: 密文为空');
        return '';
      }

      // 创建cipher params对象
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: ciphertext,
        iv: iv,
      });

      // 解密
      const decrypted = CryptoJS.AES.decrypt(cipherParams, CryptoJS.enc.Utf8.parse(key), {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      try {
        const result = decrypted.toString(CryptoJS.enc.Utf8);
        // 检查解密结果
        if (result === '') {
          console.warn('StorageUtils: 解密结果为空，可能密钥错误');
          return '';
        }
        return result;
      } catch (utf8Error) {
        console.warn('StorageUtils: UTF-8解码失败，可能密钥错误或数据损坏');
        return '';
      }
    } catch (error: any) {
      console.error('StorageUtils: 解密失败:', error);

      // 根据不同的错误类型返回不同的结果
      if (error.message && (error.message.includes('Malformed') || error.message.includes('malformed'))) {
        console.warn('StorageUtils: 检测到畸形数据，返回空字符串');
        return '';
      }

      // 对于其他错误，返回原始数据，可能是明文
      return encryptedData;
    }
  }

  /**
   * 加密密码条目
   * 对敏感字段（username、password、url、remark）进行加密
   * 空字段不进行加密，保持原值
   */
  static async encryptPasswordEntry(entry: PasswordEntry, masterPassword: string): Promise<EncryptedPasswordEntry> {
    try {
      // 派生加密密钥
      const key = await this.deriveEncryptionKey(masterPassword);

      // 创建加密条目，对非空敏感字段进行加密
      const encryptedEntry: EncryptedPasswordEntry = {
        ...entry,
        username: entry.username ? this.encryptData(entry.username, key) : '',
        password: entry.password ? this.encryptData(entry.password, key) : '',
        url: entry.url ? this.encryptData(entry.url, key) : '',
        remark: entry.remark ? this.encryptData(entry.remark, key) : '',
        encrypted: true,
      } as EncryptedPasswordEntry;
      console.log('StorageUtils: 条目加密完成');

      return encryptedEntry;
    } catch (error) {
      console.error('StorageUtils: 加密密码条目失败:', error);
      throw error;
    }
  }

  /**
   * 解密密码条目
   * 对敏感字段（username、password、url、remark）进行解密
   */
  static async decryptPasswordEntry(entry: EncryptedPasswordEntry, masterPassword: string): Promise<PasswordEntry> {
    try {
      // 如果条目未加密，直接返回
      if (!entry.encrypted) {
        // 移除encrypted属性并返回
        const { encrypted, ...decryptedEntry } = entry;
        return decryptedEntry as PasswordEntry;
      }

      // 派生解密密钥
      const key = await this.deriveEncryptionKey(masterPassword);

      // 解密条目所有敏感字段，即使某些字段解密失败也要继续处理其他字段
      const decryptedEntry: PasswordEntry = {
        ...entry,
        username: this.decryptFieldSafely(entry.username, key, 'username'),
        password: this.decryptFieldSafely(entry.password, key, 'password'),
        url: this.decryptFieldSafely(entry.url, key, 'url'),
        remark: this.decryptFieldSafely(entry.remark, key, 'remark'),
      };
      console.log('StorageUtils: 条目解密完成');

      // 移除encrypted属性
      delete (decryptedEntry as any).encrypted;

      return decryptedEntry;
    } catch (error) {
      console.error('StorageUtils: 解密密码条目失败:', error);
      throw error;
    }
  }

  /**
   * 安全解密字段 - 即使解密失败也返回原始数据或空字符串
   */
  static decryptFieldSafely(encryptedData: string, key: string, fieldName: string): string {
    if (!encryptedData) {
      return '';
    }
    try {
      return this.decryptData(encryptedData, key);
    } catch (error) {
      console.warn(`StorageUtils: 字段 ${fieldName} 解密失败，返回原始数据`);
      // 如果解密失败，返回原始数据（可能已经是明文）
      return encryptedData;
    }
  }

  /**
   * todo:保存密码条目
   */
  static async savePassword(
    entry: Omit<PasswordEntry, 'id' | 'order'>,
    masterPassword?: string,
    copyItemId?: string,
  ): Promise<PasswordEntry> {
    try {
      const passwords = masterPassword ? await this.getAllPasswords(masterPassword) : await this.getAllPasswordsRaw();

      const newEntry: PasswordEntry = {
        ...entry,
        id: this.generateId(),
        updateTime: Date.now(),
        order: passwords.length,
      };

      // 如果提供了主密码，加密存储
      let entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
      if (masterPassword) {
        const encryptedEntry = await this.encryptPasswordEntry(newEntry, masterPassword);
        // 如果是复制的条目，则添加到复制条目下方
        if (copyItemId) {
          const copyIndex = entriesToSave.findIndex(p => p.id === copyItemId);
          if (copyIndex !== -1) {
            entriesToSave.splice(copyIndex + 1, 0, encryptedEntry);
          }
        } else {
          entriesToSave.push(encryptedEntry);
        }
      } else {
        // 如果是复制的条目，则添加到复制条目下方
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
      console.error('StorageUtils: 保存密码失败:', error);
      throw error;
    }
  }

  /**
   * 更新密码条目
   */
  static async updatePassword(id: string, updates: Partial<PasswordEntry>, masterPassword?: string): Promise<void> {
    try {
      const passwords = masterPassword ? await this.getAllPasswords(masterPassword) : await this.getAllPasswordsRaw();

      const index = passwords.findIndex(p => p.id === id);

      if (index !== -1) {
        const updatedEntry: PasswordEntry = {
          ...passwords[index],
          ...updates,
          updateTime: Date.now(), // 更新时间
        };

        // 如果提供了主密码，加密存储
        let entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
        if (masterPassword) {
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
      console.error('StorageUtils: 更新密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有密码条目（原始数据，不进行解密）
   */
  static async getAllPasswordsRaw(): Promise<(PasswordEntry | EncryptedPasswordEntry)[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      const passwords = result[STORAGE_KEYS.PASSWORDS] || [];
      return passwords;
    } catch (error) {
      console.error('StorageUtils: 获取原始密码列表失败:', error);
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
      console.error('StorageUtils: 删除密码失败:', error);
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
      console.error('StorageUtils: 批量删除密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有密码条目（自动解密）
   */
  static async getAllPasswords(masterPassword?: string): Promise<PasswordEntry[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      const entries: (PasswordEntry | EncryptedPasswordEntry)[] = result[STORAGE_KEYS.PASSWORDS] || [];

      // 如果没有加密条目，直接返回
      const hasEncryptedEntries = entries.some(entry => 'encrypted' in entry && entry.encrypted === true);

      if (!hasEncryptedEntries) {
        return entries as PasswordEntry[];
      }

      // 如果没有提供主密码，抛出错误
      if (!masterPassword) {
        throw new Error('需要主密码来解密数据');
      }

      // 解密所有加密条目
      const decryptedEntries: PasswordEntry[] = [];
      for (const entry of entries) {
        if ('encrypted' in entry && entry.encrypted === true) {
          try {
            // 解密加密条目
            const decryptedEntry = await this.decryptPasswordEntry(entry, masterPassword);
            decryptedEntries.push(decryptedEntry);
          } catch (decryptError) {
            // 如果解密失败，跳过该条目并记录错误
            console.warn('StorageUtils: 跳过无法解密的条目:', entry.id);
            continue;
          }
        } else {
          // 直接添加未加密条目
          decryptedEntries.push(entry as PasswordEntry);
        }
      }

      return decryptedEntries;
    } catch (error) {
      console.error('StorageUtils: 获取密码列表失败:', error);
      throw new Error('加载密码列表失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  /**
   * 根据URL搜索密码
   */
  static async getPasswordsByUrl(url: string, masterPassword?: string): Promise<PasswordEntry[]> {
    try {
      const allPasswords = await this.getAllPasswords(masterPassword);
      const filteredPasswords = allPasswords.filter(p => {
        if (!p.url || p.url.trim() === '') return true; // 未填URL的匹配所有
        return url.includes(p.url) || p.url.includes(url);
      });

      // 应用保存的排序配置
      await this.applySavedSortConfig(filteredPasswords);

      return filteredPasswords;
    } catch (error) {
      console.error('StorageUtils: 根据URL搜索密码失败:', error);
      return [];
    }
  }

  /**
   * 搜索密码条目
   */
  static async searchPasswords(keyword: string, masterPassword?: string): Promise<PasswordEntry[]> {
    try {
      const allPasswords = await this.getAllPasswords(masterPassword);
      const lowerKeyword = keyword.toLowerCase();

      const filteredPasswords = allPasswords.filter(
        p =>
          p.username.toLowerCase().includes(lowerKeyword) ||
          p.tag.toLowerCase().includes(lowerKeyword) ||
          p.remark.toLowerCase().includes(lowerKeyword) ||
          p.url.toLowerCase().includes(lowerKeyword),
      );

      // 应用保存的排序配置
      await this.applySavedSortConfig(filteredPasswords);

      return filteredPasswords;
    } catch (error) {
      console.error('StorageUtils: 搜索密码失败:', error);
      return [];
    }
  }

  /**
   * 应用保存的排序配置
   */
  static async applySavedSortConfig(passwords: PasswordEntry[]): Promise<void> {
    try {
      // 获取保存的排序配置
      const sortConfig = await this.getSortConfig();

      if (sortConfig) {
        // 根据保存的排序配置进行排序
        passwords.sort((a, b) => {
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
              // 默认按创建时间倒序排序
              passwords.sort((a, b) => b.createTime - a.createTime);
              return 0;
          }

          // 根据排序顺序进行比较
          let comparison = 0;
          if (typeof aValue === 'string' && typeof bValue === 'string') {
            comparison = aValue.localeCompare(bValue);
          } else if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue;
          } else {
            // 默认按创建时间倒序排序
            return b.createTime - a.createTime;
          }

          return sortConfig.order === 'ascending' ? comparison : -comparison;
        });
      } else {
        // 默认按创建时间倒序排序
        passwords.sort((a, b) => b.createTime - a.createTime);
      }
    } catch (error) {
      console.error('StorageUtils: 应用排序配置失败，使用默认排序:', error);
      // 默认按创建时间倒序排序
      passwords.sort((a, b) => b.createTime - a.createTime);
    }
  }

  /**
   * 更新密码排序
   */
  static async updatePasswordsOrder(passwords: PasswordEntry[]): Promise<void> {
    try {
      // 重新设置order字段
      const updatedPasswords = passwords.map((p, index) => ({
        ...p,
        order: index,
      }));

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: updatedPasswords,
      });
    } catch (error) {
      console.error('StorageUtils: 更新密码排序失败:', error);
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
      console.error('StorageUtils: 清空数据失败:', error);
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
      console.error('StorageUtils: 重置主密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取主密码有效期设置
   */
  static async getMasterPasswordValidityHours(): Promise<number> {
    try {
      // 首先检查内存中的会话设置
      if (sessionValidityHours !== null) {
        return sessionValidityHours;
      }

      // 从存储中获取默认值
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD_VALIDITY);
      const validityHours = result[STORAGE_KEYS.MASTER_PASSWORD_VALIDITY] || 24;

      // 更新内存缓存
      sessionValidityHours = validityHours;
      return validityHours;
    } catch (error) {
      console.error('获取主密码有效期失败:', error);
      return 24; // 默认24小时
    }
  }

  /**
   * 设置主密码有效期
   */
  static async setMasterPasswordValidityHours(hours: number): Promise<void> {
    try {
      // 参数验证
      if (hours < 1 || hours > 24) {
        throw new Error('有效期必须在1-24小时之间');
      }

      // 保存到存储
      await chrome.storage.local.set({
        [STORAGE_KEYS.MASTER_PASSWORD_VALIDITY]: hours,
      });

      // 更新内存缓存
      sessionValidityHours = hours;
    } catch (error) {
      console.error('设置主密码有效期失败:', error);
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
      console.error('StorageUtils: 保存排序配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取排序配置
   */
  static async getSortConfig(): Promise<{ prop: string; order: string } | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SORT_CONFIG);
      const sortConfig = result[STORAGE_KEYS.SORT_CONFIG] || null;
      return sortConfig;
    } catch (error) {
      console.error('StorageUtils: 获取排序配置失败:', error);
      return null;
    }
  }

  /**
   * 检查会话是否有效
   */
  static async isSessionValid(): Promise<boolean> {
    try {
      // 如果内存中没有会话信息，尝试从存储中恢复
      if (!encryptedSessionMasterPassword || !sessionPasswordExpiry) {
        const result = await chrome.storage.local.get([
          SESSION_STORAGE_KEYS.MASTER_PASSWORD,
          SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
          SESSION_STORAGE_KEYS.VALIDITY_HOURS,
        ]);

        if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
          // 直接从存储中获取加密的主密码和过期时间
          encryptedSessionMasterPassword = result[SESSION_STORAGE_KEYS.MASTER_PASSWORD];
          sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY];
          sessionValidityHours = result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] || 24;

          // 使用固定的密钥派生方法，确保每次都能正确解密
          // 使用主密码配置中的盐值的一部分作为会话加密密钥的基础
          const masterPasswordConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
          const config: MasterPasswordConfig = masterPasswordConfig[STORAGE_KEYS.MASTER_PASSWORD];

          if (config && config.salt) {
            // 使用盐值派生一个稳定的密钥用于会话加密
            sessionEncryptionKey = this.hashPassword(config.salt, 'session_encryption').substring(0, 32);
          } else {
            // 如果无法获取配置，尝试使用其他方式生成密钥
            sessionEncryptionKey = await this.generateSessionEncryptionKey();
          }
        } else {
          return false;
        }
      }

      // 检查是否过期（确保sessionPasswordExpiry不为null）
      const now = Date.now();
      if (sessionPasswordExpiry !== null && now >= sessionPasswordExpiry) {
        // 会话已过期，清除缓存
        await this.clearSession();
        return false;
      }

      return true;
    } catch (error) {
      console.error('StorageUtils: 会话验证失败:', error);
      // 出错时清除会话以确保安全
      await this.clearSession();
      return false;
    }
  }

  /**
   * 获取会话主密码
   * 注意：为了安全起见，此方法已被弃用，建议使用 getSessionMasterPasswordDecrypted
   */
  static getSessionMasterPassword(): string | undefined {
    // 此方法已弃用，为了向后兼容暂时保留但返回解密后的密码
    // 实际上内存中不再存储明文主密码
    try {
      if (!encryptedSessionMasterPassword || !sessionEncryptionKey) {
        return undefined;
      }
      const decrypted = this.decryptData(encryptedSessionMasterPassword, sessionEncryptionKey);
      return decrypted;
    } catch (error) {
      console.error('StorageUtils: 解密会话主密码失败:', error);
      return undefined;
    }
  }

  /**
   * 创建会话缓存
   */
  static async createSession(masterPassword: string, validityHours: number): Promise<void> {
    try {
      // 获取主密码配置以生成稳定加密密钥
      const masterPasswordConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = masterPasswordConfig[STORAGE_KEYS.MASTER_PASSWORD];

      if (config && config.salt) {
        // 使用盐值派生一个稳定的密钥用于会话加密
        sessionEncryptionKey = this.hashPassword(config.salt, 'session_encryption').substring(0, 32);
      } else {
        // 如果无法获取配置，回退到生成随机密钥
        sessionEncryptionKey = await this.generateSessionEncryptionKey();
      }

      // 加密主密码
      encryptedSessionMasterPassword = this.encryptData(masterPassword, sessionEncryptionKey);
      sessionValidityHours = validityHours;
      sessionPasswordExpiry = Date.now() + validityHours * 60 * 60 * 1000;

      // 持久化会话信息（加密存储）
      await chrome.storage.local.set({
        [SESSION_STORAGE_KEYS.MASTER_PASSWORD]: encryptedSessionMasterPassword, // 加密存储
        [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: sessionPasswordExpiry,
        [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
      });

      // 会话创建后，解密所有密码条目并明文存储
      await this.decryptAllPasswordsOnSessionCreate(masterPassword);
    } catch (error) {
      console.error('创建会话缓存失败:', error);
      throw error;
    }
  }

  /**
   * 清除会话缓存
   * 在清除会话前确保所有密码条目的敏感字段已加密
   */
  static async clearSession(): Promise<void> {
    try {
      // 会话失效前，确保密码列表中的敏感字段已加密
      const masterPassword = await this.getSessionMasterPasswordDecrypted();
      if (masterPassword) {
        await this.encryptAllPasswordsBeforeSessionClear(masterPassword);
      }

      // 清除内存中的会话数据
      encryptedSessionMasterPassword = null;
      sessionPasswordExpiry = null;
      sessionValidityHours = null;
      sessionEncryptionKey = null; // 清除会话加密密钥

      // 清除持久化的会话信息
      await chrome.storage.local.remove([
        SESSION_STORAGE_KEYS.MASTER_PASSWORD,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
        SESSION_STORAGE_KEYS.VALIDITY_HOURS,
      ]);
    } catch (error) {
      console.error('清除会话缓存失败:', error);
      throw error;
    }
  }

  /**
   * 会话失效前加密所有密码条目
   * 确保所有敏感字段（username、password、url、remark）都已加密
   */
  private static async encryptAllPasswordsBeforeSessionClear(masterPassword: string): Promise<void> {
    try {
      const rawPasswords = await this.getAllPasswordsRaw();

      if (rawPasswords.length === 0) {
        return;
      }

      const encryptedPasswords: EncryptedPasswordEntry[] = [];
      let hasChanges = false;

      for (const entry of rawPasswords) {
        // 如果已加密，直接保留
        if ('encrypted' in entry && entry.encrypted === true) {
          encryptedPasswords.push(entry as EncryptedPasswordEntry);
          continue;
        }

        // 加密未加密的条目
        hasChanges = true;
        const encryptedEntry = await this.encryptPasswordEntry(entry as PasswordEntry, masterPassword);
        encryptedPasswords.push(encryptedEntry);
      }

      // 只有在有变更时才保存
      if (hasChanges) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.PASSWORDS]: encryptedPasswords,
        });
        console.log('StorageUtils: 会话失效前，所有密码条目已加密');
      }
    } catch (error) {
      console.error('StorageUtils: 会话失效前加密密码条目失败:', error);
      // 不抛出错误，避免阻塞会话清除
    }
  }

  /**
   * 会话创建后解密所有密码条目并明文存储
   * 在会话有效期内，敏感字段以明文形式存储，提高读取性能
   */
  private static async decryptAllPasswordsOnSessionCreate(masterPassword: string): Promise<void> {
    try {
      const rawPasswords = await this.getAllPasswordsRaw();

      if (rawPasswords.length === 0) {
        return;
      }

      const decryptedPasswords: PasswordEntry[] = [];
      let hasEncryptedEntries = false;

      for (const entry of rawPasswords) {
        // 如果是加密的条目，进行解密
        if ('encrypted' in entry && entry.encrypted === true) {
          hasEncryptedEntries = true;
          try {
            const decryptedEntry = await this.decryptPasswordEntry(entry, masterPassword);
            decryptedPasswords.push(decryptedEntry);
          } catch (decryptError) {
            console.warn('StorageUtils: 跳过无法解密的条目:', entry.id);
            // 保留原始加密条目以避免数据丢失
            const { encrypted, ...rest } = entry;
            decryptedPasswords.push(rest as PasswordEntry);
          }
        } else {
          // 已经是明文的条目，直接保留
          decryptedPasswords.push(entry as PasswordEntry);
        }
      }

      // 只有在存在加密条目时才更新存储
      if (hasEncryptedEntries) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.PASSWORDS]: decryptedPasswords,
        });
        console.log('StorageUtils: 会话创建后，所有密码条目已解密为明文存储');
      }
    } catch (error) {
      console.error('StorageUtils: 会话创建后解密密码条目失败:', error);
      // 不抛出错误，避免影响会话创建
    }
  }

  /**
   * 迁移未加密的密码条目
   * 用于将旧版本的明文数据迁移为加密数据
   */
  static async migrateUnencryptedEntries(masterPassword: string): Promise<void> {
    try {
      const rawPasswords = await this.getAllPasswordsRaw();

      if (rawPasswords.length === 0) {
        return;
      }

      let hasUnencrypted = false;
      const encryptedPasswords: EncryptedPasswordEntry[] = [];

      for (const entry of rawPasswords) {
        if (!('encrypted' in entry) || entry.encrypted !== true) {
          hasUnencrypted = true;
          const encryptedEntry = await this.encryptPasswordEntry(entry as PasswordEntry, masterPassword);
          encryptedPasswords.push(encryptedEntry);
        } else {
          encryptedPasswords.push(entry as EncryptedPasswordEntry);
        }
      }

      if (hasUnencrypted) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.PASSWORDS]: encryptedPasswords,
        });
        console.log('StorageUtils: 数据迁移完成，所有条目已加密');
      }
    } catch (error) {
      console.error('StorageUtils: 数据迁移失败:', error);
      // 不抛出错误，避免影响正常使用
    }
  }

  /**
   * 获取会话过期时间
   */
  static async getSessionExpiryTime(): Promise<number | null> {
    return sessionPasswordExpiry;
  }

  /**
   * 调试工具：获取主密码配置信息
   */
  /**
   * 生成会话加密密钥
   * 使用随机字符串作为临时密钥来加密内存中的主密码
   */
  static async generateSessionEncryptionKey(): Promise<string> {
    // 使用当前时间戳和随机数生成临时密钥
    const timestamp = Date.now().toString();
    const randomPart = Math.random().toString(36).substring(2, 15);
    const combined = timestamp + randomPart;

    // 使用MD5生成固定长度的密钥
    const key = this.hashPassword(combined, 'session_encryption_salt');
    return key.substring(0, 32); // 截取前32个字符作为AES密钥
  }

  /**
   * 获取会话主密码（解密后）
   */
  static async getSessionMasterPasswordDecrypted(): Promise<string | null> {
    if (!encryptedSessionMasterPassword || !sessionEncryptionKey) {
      return null;
    }

    try {
      const decryptedPassword = this.decryptData(encryptedSessionMasterPassword, sessionEncryptionKey);
      return decryptedPassword;
    } catch (error) {
      console.error('StorageUtils: 解密会话主密码失败:', error);
      return null;
    }
  }

  static async debugMasterPassword(): Promise<any> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];

      const debugInfo = {
        hasConfig: !!config,
        hasSalt: !!config?.salt,
        hasHashedPassword: !!config?.hashedPassword,
        saltLength: config?.salt?.length || 0,
        hashLength: config?.hashedPassword?.length || 0,
        saltPreview: `${config?.salt?.substring(0, 8)}...` || 'N/A',
        hashPreview: `${config?.hashedPassword?.substring(0, 10)}...` || 'N/A',
      };
      return debugInfo;
    } catch (error: any) {
      console.error('StorageUtils: 获取主密码调试信息失败:', error);
      return { error: error.message };
    }
  }

  /**
   * 默认悬浮按钮配置
   */
  static getDefaultFloatingButtonConfig(): FloatingButtonConfig {
    return {
      visible: true,
      position: 'right',
      offsetY: 0,
      opacity: 0.9,
      autoShowSidepanel: true,
    };
  }

  /**
   * 获取悬浮按钮配置
   */
  static async getFloatingButtonConfig(): Promise<FloatingButtonConfig> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.FLOATING_BUTTON_CONFIG);
      const config = result[STORAGE_KEYS.FLOATING_BUTTON_CONFIG];

      if (!config) {
        return this.getDefaultFloatingButtonConfig();
      }

      // 合并默认配置，确保所有字段都存在
      return {
        ...this.getDefaultFloatingButtonConfig(),
        ...config,
      };
    } catch (error) {
      console.error('StorageUtils: 获取悬浮按钮配置失败:', error);
      return this.getDefaultFloatingButtonConfig();
    }
  }

  /**
   * 保存悬浮按钮配置
   */
  static async saveFloatingButtonConfig(config: Partial<FloatingButtonConfig>): Promise<void> {
    try {
      // 获取当前配置
      const currentConfig = await this.getFloatingButtonConfig();

      // 合并新配置
      const newConfig: FloatingButtonConfig = {
        ...currentConfig,
        ...config,
      };

      await chrome.storage.local.set({
        [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: newConfig,
      });
    } catch (error) {
      console.error('StorageUtils: 保存悬浮按钮配置失败:', error);
      throw error;
    }
  }

  /**
   * 设置悬浮按钮显示状态
   */
  static async setFloatingButtonVisible(visible: boolean): Promise<void> {
    await this.saveFloatingButtonConfig({ visible });
  }

  /**
   * 设置悬浮按钮位置
   */
  static async setFloatingButtonPosition(position: 'left' | 'right', offsetY?: number): Promise<void> {
    const config: Partial<FloatingButtonConfig> = { position };
    if (offsetY !== undefined) {
      config.offsetY = offsetY;
    }
    await this.saveFloatingButtonConfig(config);
  }
}
