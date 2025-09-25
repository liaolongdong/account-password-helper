import CryptoJS from 'crypto-js';
import type { PasswordEntry, MasterPasswordConfig } from './types';

// 存储键名常量
const STORAGE_KEYS = {
  PASSWORDS: 'account_passwords',
  MASTER_PASSWORD: 'master_password_config',
  SETTINGS: 'app_settings'
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

    console.log('MD5加密输入:', {
      passwordLength: cleanPassword.length,
      saltLength: cleanSalt.length,
      combinedLength: combined.length
    });

    const hash = CryptoJS.MD5(combined).toString();
    console.log('MD5加密结果:', `${hash.substring(0, 10)}...`);

    return hash;
  }

  /**
   * 生成随机盐值
   */
  static generateSalt(): string {
    return CryptoJS.lib.WordArray.random(16).toString();
  }

  /**
   * 生成唯一ID
   */
  static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
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
        salt
      };

      console.log('设置主密码 - 配置信息:', {
        salt: `${salt.substring(0, 5)}...`,
        hashedPassword: `${hashedPassword.substring(0, 10)}...`,
        originalPasswordLength: cleanPassword.length
      });

      await chrome.storage.local.set({
        [STORAGE_KEYS.MASTER_PASSWORD]: config
      });

      // 验证保存是否成功
      const savedConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const saved = !!savedConfig[STORAGE_KEYS.MASTER_PASSWORD];
      console.log('主密码保存验证:', saved);

      if (!saved) {
        throw new Error('主密码保存失败');
      }

      // 立即验证一次设置的密码
      const verifyResult = await this.verifyMasterPassword(cleanPassword);
      console.log('设置后立即验证结果:', verifyResult);

      if (!verifyResult) {
        throw new Error('主密码设置验证失败');
      }
    } catch (error) {
      console.error('设置主密码失败:', error);
      throw error;
    }
  }

  /**
   * 验证主密码
   */
  static async verifyMasterPassword(password: string): Promise<boolean> {
    try {
      console.log('开始验证主密码...');

      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];

      console.log('获取到的配置:', {
        hasConfig: !!config,
        hasSalt: config?.salt ? '有盐值' : '无盐值',
        hasHashedPassword: config?.hashedPassword ? '有哈希密码' : '无哈希密码'
      });

      if (!config || !config.salt || !config.hashedPassword) {
        console.log('主密码配置不完整');
        return false;
      }

      // 确保输入密码的一致性处理
      const cleanPassword = String(password || '').trim();
      if (!cleanPassword) {
        console.log('输入密码为空');
        return false;
      }

      const hashedInput = this.hashPassword(cleanPassword, config.salt);

      console.log('密码哈希比较:', {
        inputPassword: '隐藏',
        inputHash: `${hashedInput.substring(0, 10)}...`,
        storedHash: `${config.hashedPassword.substring(0, 10)}...`,
        saltUsed: `${config.salt.substring(0, 5)}...`,
        isMatch: hashedInput === config.hashedPassword
      });

      const isValid = hashedInput === config.hashedPassword;
      console.log('最终验证结果:', isValid);

      return isValid;
    } catch (error) {
      console.error('验证主密码失败:', error);
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

      console.log('检查主密码存在性:', {
        hasConfig: !!config,
        hasPassword
      });

      return hasPassword;
    } catch (error) {
      console.error('检查主密码失败:', error);
      return false;
    }
  }

  /**
   * 加密数据
   */
  static encryptData(data: string, key: string): string {
    return CryptoJS.AES.encrypt(data, key).toString();
  }

  /**
   * 解密数据
   */
  static decryptData(encryptedData: string, key: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, key);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('解密失败:', error);
      return '';
    }
  }

  /**
   * 保存密码条目
   */
  static async savePassword(entry: Omit<PasswordEntry, 'id' | 'createTime' | 'order'>): Promise<void> {
    try {
      const passwords = await this.getAllPasswords();
      const newEntry: PasswordEntry = {
        ...entry,
        id: this.generateId(),
        createTime: Date.now(),
        order: passwords.length
      };

      passwords.push(newEntry);
      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: passwords
      });
    } catch (error) {
      console.error('保存密码失败:', error);
      throw error;
    }
  }

  /**
   * 更新密码条目
   */
  static async updatePassword(id: string, updates: Partial<PasswordEntry>): Promise<void> {
    try {
      const passwords = await this.getAllPasswords();
      const index = passwords.findIndex(p => p.id === id);

      if (index !== -1) {
        passwords[index] = { ...passwords[index], ...updates };
        await chrome.storage.local.set({
          [STORAGE_KEYS.PASSWORDS]: passwords
        });
      }
    } catch (error) {
      console.error('更新密码失败:', error);
      throw error;
    }
  }

  /**
   * 删除密码条目
   */
  static async deletePassword(id: string): Promise<void> {
    try {
      const passwords = await this.getAllPasswords();
      const filteredPasswords = passwords.filter(p => p.id !== id);

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: filteredPasswords
      });
    } catch (error) {
      console.error('删除密码失败:', error);
      throw error;
    }
  }

  /**
   * 批量删除密码条目
   */
  static async deletePasswords(ids: string[]): Promise<void> {
    try {
      const passwords = await this.getAllPasswords();
      const filteredPasswords = passwords.filter(p => !ids.includes(p.id));

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: filteredPasswords
      });
    } catch (error) {
      console.error('批量删除密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有密码条目
   */
  static async getAllPasswords(): Promise<PasswordEntry[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      return result[STORAGE_KEYS.PASSWORDS] || [];
    } catch (error) {
      console.error('获取密码列表失败:', error);
      return [];
    }
  }

  /**
   * 根据URL搜索密码
   */
  static async getPasswordsByUrl(url: string): Promise<PasswordEntry[]> {
    try {
      const allPasswords = await this.getAllPasswords();
      return allPasswords
        .filter(p => {
          if (!p.url || p.url.trim() === '') return true; // 未填URL的匹配所有
          return url.includes(p.url) || p.url.includes(url);
        })
        .sort((a, b) => a.order - b.order);
    } catch (error) {
      console.error('根据URL搜索密码失败:', error);
      return [];
    }
  }

  /**
   * 搜索密码条目
   */
  static async searchPasswords(keyword: string): Promise<PasswordEntry[]> {
    try {
      const allPasswords = await this.getAllPasswords();
      const lowerKeyword = keyword.toLowerCase();

      return allPasswords
        .filter(
          p =>
            p.username.toLowerCase().includes(lowerKeyword) ||
            p.tag.toLowerCase().includes(lowerKeyword) ||
            p.remark.toLowerCase().includes(lowerKeyword) ||
            p.url.toLowerCase().includes(lowerKeyword)
        )
        .sort((a, b) => a.order - b.order);
    } catch (error) {
      console.error('搜索密码失败:', error);
      return [];
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
        order: index
      }));

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: updatedPasswords
      });
    } catch (error) {
      console.error('更新密码排序失败:', error);
      throw error;
    }
  }

  /**
   * 清空所有数据
   */
  static async clearAllData(): Promise<void> {
    try {
      await chrome.storage.local.clear();
      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw error;
    }
  }

  /**
   * 重置主密码（清空主密码配置）
   */
  static async resetMasterPassword(): Promise<void> {
    try {
      await chrome.storage.local.remove(STORAGE_KEYS.MASTER_PASSWORD);
      console.log('主密码配置已重置');
    } catch (error) {
      console.error('重置主密码失败:', error);
      throw error;
    }
  }

  /**
   * 调试工具：获取主密码配置信息
   */
  static async debugMasterPassword(): Promise<any> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];

      return {
        hasConfig: !!config,
        hasSalt: !!config?.salt,
        hasHashedPassword: !!config?.hashedPassword,
        saltLength: config?.salt?.length || 0,
        hashLength: config?.hashedPassword?.length || 0,
        saltPreview: `${config?.salt?.substring(0, 8)}...` || 'N/A',
        hashPreview: `${config?.hashedPassword?.substring(0, 10)}...` || 'N/A'
      };
    } catch (error) {
      console.error('获取主密码调试信息失败:', error);
      return { error: error.message };
    }
  }
}
