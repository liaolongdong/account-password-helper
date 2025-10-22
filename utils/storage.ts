import CryptoJS from 'crypto-js';
import type { PasswordEntry, MasterPasswordConfig } from './types';

// 扩展PasswordEntry接口以包含加密标识
interface EncryptedPasswordEntry extends PasswordEntry {
  encrypted?: boolean;
}

// 存储键名常量
const STORAGE_KEYS = {
  PASSWORDS: 'account_passwords',
  MASTER_PASSWORD: 'master_password_config',
  SETTINGS: 'app_settings',
  MASTER_PASSWORD_VALIDITY: 'master_password_validity', // 添加主密码有效期存储键
};

// 添加会话状态管理变量
let sessionMasterPassword: string | null = null;
let sessionPasswordExpiry: number | null = null;
let sessionValidityHours: number = 24; // 默认24小时

// 会话存储键名
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
    console.log('StorageUtils: 开始MD5加密');
    // 确保密码和盐值都是字符串并去除空格
    const cleanPassword = String(password || '').trim();
    const cleanSalt = String(salt || '').trim();
    const combined = cleanPassword + cleanSalt;

    console.log('StorageUtils: MD5加密输入:', {
      passwordLength: cleanPassword.length,
      saltLength: cleanSalt.length,
      combinedLength: combined.length,
    });

    const hash = CryptoJS.MD5(combined).toString();
    console.log('StorageUtils: MD5加密结果:', `${hash.substring(0, 10)}...`);

    return hash;
  }

  /**
   * 生成随机盐值
   */
  static generateSalt(): string {
    console.log('StorageUtils: 开始生成随机盐值');
    const salt = CryptoJS.lib.WordArray.random(16).toString();
    console.log('StorageUtils: 盐值生成完成', salt.substring(0, 10) + '...');
    return salt;
  }

  /**
   * 生成唯一ID
   */
  static generateId(): string {
    console.log('StorageUtils: 开始生成唯一ID');
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    console.log('StorageUtils: ID生成完成', id);
    return id;
  }

  /**
   * 设置主密码
   */
  static async setMasterPassword(password: string): Promise<void> {
    try {
      console.log('StorageUtils: 开始设置主密码');
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

      console.log('StorageUtils: 设置主密码 - 配置信息:', {
        salt: `${salt.substring(0, 5)}...`,
        hashedPassword: `${hashedPassword.substring(0, 10)}...`,
        originalPasswordLength: cleanPassword.length,
      });

      await chrome.storage.local.set({
        [STORAGE_KEYS.MASTER_PASSWORD]: config,
      });

      // 验证保存是否成功
      const savedConfig = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const saved = !!savedConfig[STORAGE_KEYS.MASTER_PASSWORD];
      console.log('StorageUtils: 主密码保存验证:', saved);

      if (!saved) {
        throw new Error('主密码保存失败');
      }

      // 立即验证一次设置的密码
      const verifyResult = await this.verifyMasterPassword(cleanPassword);
      console.log('StorageUtils: 设置后立即验证结果:', verifyResult);

      if (!verifyResult) {
        throw new Error('主密码设置验证失败');
      }
      console.log('StorageUtils: 主密码设置完成');
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
      console.log('StorageUtils: 开始验证主密码...');

      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];

      console.log('StorageUtils: 获取到的配置:', {
        hasConfig: !!config,
        hasSalt: config?.salt ? '有盐值' : '无盐值',
        hasHashedPassword: config?.hashedPassword ? '有哈希密码' : '无哈希密码',
      });

      if (!config || !config.salt || !config.hashedPassword) {
        console.log('StorageUtils: 主密码配置不完整');
        return false;
      }

      // 确保输入密码的一致性处理
      const cleanPassword = String(password || '').trim();
      if (!cleanPassword) {
        console.log('StorageUtils: 输入密码为空');
        return false;
      }

      const hashedInput = this.hashPassword(cleanPassword, config.salt);

      console.log('StorageUtils: 密码哈希比较:', {
        inputPassword: '隐藏',
        inputHash: `${hashedInput.substring(0, 10)}...`,
        storedHash: `${config.hashedPassword.substring(0, 10)}...`,
        saltUsed: `${config.salt.substring(0, 5)}...`,
        isMatch: hashedInput === config.hashedPassword,
      });

      const isValid = hashedInput === config.hashedPassword;
      console.log('StorageUtils: 最终验证结果:', isValid);

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
      console.log('StorageUtils: 开始检查主密码存在性');
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config = result[STORAGE_KEYS.MASTER_PASSWORD];
      const hasPassword = !!(config && config.hashedPassword && config.salt);

      console.log('StorageUtils: 检查主密码存在性结果:', {
        hasConfig: !!config,
        hasSalt: !!config?.salt,
        hasHashedPassword: !!config?.hashedPassword,
        hasPassword,
      });

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
      console.log('StorageUtils: 开始派生加密密钥');
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
      console.log('StorageUtils: 加密密钥派生完成', keyString.substring(0, 10) + '...');
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
      console.log('StorageUtils: 开始AES加密');
      // 生成随机初始化向量
      const iv = CryptoJS.lib.WordArray.random(16);

      // 使用AES-256-CBC加密
      const encrypted = CryptoJS.AES.encrypt(data, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      // 将IV和密文组合
      const combined = iv.concat(encrypted.ciphertext);
      const result = combined.toString(CryptoJS.enc.Base64);
      console.log('StorageUtils: AES加密完成', result.substring(0, 10) + '...');
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
      console.log('StorageUtils: 开始AES解密');

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
      const combined = CryptoJS.enc.Base64.parse(encryptedData);

      // 检查数据长度
      if (combined.words.length < 4) {
        console.warn('StorageUtils: 加密数据长度不足');
        throw new Error('加密数据格式不正确');
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

      // 解密
      const decrypted = CryptoJS.AES.decrypt({ ciphertext: ciphertext } as any, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      const result = decrypted.toString(CryptoJS.enc.Utf8);
      console.log('StorageUtils: AES解密结果长度:', result.length);

      // 检查解密结果
      if (!result) {
        console.warn('StorageUtils: 解密结果为空，可能密钥错误');
        return '';
      }

      return result;
    } catch (error: any) {
      console.error('StorageUtils: 解密失败:', error);

      // 根据不同的错误类型返回不同的结果
      if (error.message && error.message.includes('Malformed')) {
        console.warn('StorageUtils: 检测到畸形数据，返回空字符串');
        return '';
      }

      throw new Error('数据解密失败，请检查主密码');
    }
  }

  /**
   * todo:加密密码条目
   */
  static async encryptPasswordEntry(entry: PasswordEntry, masterPassword: string): Promise<EncryptedPasswordEntry> {
    try {
      console.log('StorageUtils: 开始加密密码条目', entry.id);
      // 派生加密密钥
      const key = await this.deriveEncryptionKey(masterPassword);
      console.log('StorageUtils: 派生加密密钥完成');

      // 创建加密条目（类型断言确保兼容性）
      const encryptedEntry: EncryptedPasswordEntry = {
        ...entry,
        // username: this.encryptData(entry.username, key),  // 用户名/用户号/邮箱/手机号/账号不加密
        password: this.encryptData(entry.password, key),
        // remark: this.encryptData(entry.remark, key),  // 备注不加密
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
   * todo:解密密码条目
   */
  static async decryptPasswordEntry(entry: EncryptedPasswordEntry, masterPassword: string): Promise<PasswordEntry> {
    try {
      console.log('StorageUtils: 开始解密密码条目', entry.id, entry.encrypted ? '已加密' : '未加密');
      // 如果条目未加密，直接返回
      if (!entry.encrypted) {
        // 移除encrypted属性并返回
        const { encrypted, ...decryptedEntry } = entry;
        console.log('StorageUtils: 条目未加密，直接返回');
        return decryptedEntry as PasswordEntry;
      }

      // 派生解密密钥
      const key = await this.deriveEncryptionKey(masterPassword);
      console.log('StorageUtils: 派生解密密钥完成');

      // 解密条目字段，即使某些字段解密失败也要继续处理其他字段
      const decryptedEntry: PasswordEntry = {
        ...entry,
        // username: this.decryptFieldSafely(entry.username, key, 'username'),
        password: this.decryptFieldSafely(entry.password, key, 'password'),
        // remark: this.decryptFieldSafely(entry.remark, key, 'remark'),
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
    try {
      if (!encryptedData) {
        return '';
      }
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
  ): Promise<void> {
    try {
      console.log('StorageUtils: 开始保存密码条目', masterPassword ? '有主密码' : '无主密码');
      const passwords = masterPassword ? await this.getAllPasswords(masterPassword) : await this.getAllPasswordsRaw();
      console.log('StorageUtils: 当前密码数量:', passwords.length);

      const newEntry: PasswordEntry = {
        ...entry,
        id: this.generateId(),
        updateTime: Date.now(),
        order: passwords.length,
      };
      console.log('StorageUtils: 新条目ID:', newEntry.id);

      // 如果提供了主密码，加密存储
      let entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
      if (masterPassword) {
        console.log('StorageUtils: 加密存储');
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
        console.log('StorageUtils: 明文存储');
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
      console.log('StorageUtils: 密码保存完成');
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
      console.log('StorageUtils: 开始更新密码条目', id, masterPassword ? '有主密码' : '无主密码');
      const passwords = masterPassword ? await this.getAllPasswords(masterPassword) : await this.getAllPasswordsRaw();
      console.log('StorageUtils: 当前密码数量:', passwords.length);

      const index = passwords.findIndex(p => p.id === id);
      console.log('StorageUtils: 条目索引:', index);

      if (index !== -1) {
        const updatedEntry: PasswordEntry = {
          ...passwords[index],
          ...updates,
          updateTime: Date.now(), // 更新时间
        };
        console.log('StorageUtils: 更新条目');

        // 如果提供了主密码，加密存储
        let entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
        if (masterPassword) {
          console.log('StorageUtils: 加密存储');
          const encryptedEntry = await this.encryptPasswordEntry(updatedEntry, masterPassword);
          entriesToSave[index] = encryptedEntry;
        } else {
          console.log('StorageUtils: 明文存储');
          entriesToSave[index] = updatedEntry;
        }

        await chrome.storage.local.set({
          [STORAGE_KEYS.PASSWORDS]: entriesToSave,
        });
        console.log('StorageUtils: 密码更新完成');
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
      console.log('StorageUtils: 开始获取所有原始密码条目');
      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      const passwords = result[STORAGE_KEYS.PASSWORDS] || [];
      console.log('StorageUtils: 获取到的原始密码数量:', passwords.length);
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
      console.log('StorageUtils: 开始删除密码条目', id);
      const passwords = await this.getAllPasswordsRaw();
      console.log('StorageUtils: 删除前密码数量:', passwords.length);
      const filteredPasswords = passwords.filter((p: PasswordEntry | EncryptedPasswordEntry) => p.id !== id);
      console.log('StorageUtils: 删除后密码数量:', filteredPasswords.length);

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: filteredPasswords,
      });
      console.log('StorageUtils: 密码删除完成');
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
      console.log('StorageUtils: 开始批量删除密码条目', ids);
      const passwords = await this.getAllPasswordsRaw();
      console.log('StorageUtils: 删除前密码数量:', passwords.length);
      const filteredPasswords = passwords.filter((p: PasswordEntry | EncryptedPasswordEntry) => !ids.includes(p.id));
      console.log('StorageUtils: 删除后密码数量:', filteredPasswords.length);

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: filteredPasswords,
      });
      console.log('StorageUtils: 密码批量删除完成');
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
      console.log('StorageUtils: 开始获取所有密码条目', masterPassword ? '有主密码' : '无主密码');
      const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      const entries: (PasswordEntry | EncryptedPasswordEntry)[] = result[STORAGE_KEYS.PASSWORDS] || [];
      console.log('StorageUtils: 获取到的密码条目数量:', entries.length);

      // 如果没有加密条目，直接返回
      const hasEncryptedEntries = entries.some(entry => 'encrypted' in entry && entry.encrypted === true);
      console.log('StorageUtils: 是否有加密条目:', hasEncryptedEntries);

      if (!hasEncryptedEntries) {
        console.log('StorageUtils: 无加密条目，直接返回');
        return entries as PasswordEntry[];
      }

      // 如果没有提供主密码，抛出错误
      if (!masterPassword) {
        console.log('StorageUtils: 无主密码，抛出错误');
        throw new Error('需要主密码来解密数据');
      }

      // 解密所有加密条目
      const decryptedEntries: PasswordEntry[] = [];
      console.log('StorageUtils: 开始解密条目');
      for (const entry of entries) {
        if ('encrypted' in entry && entry.encrypted === true) {
          try {
            // 解密加密条目
            const decryptedEntry = await this.decryptPasswordEntry(entry, masterPassword);
            decryptedEntries.push(decryptedEntry);
          } catch (decryptError) {
            console.error('StorageUtils: 单个条目解密失败:', decryptError);
            // 如果解密失败，跳过该条目并记录错误
            console.warn('StorageUtils: 跳过无法解密的条目:', entry.id);
            continue;
          }
        } else {
          // 直接添加未加密条目
          decryptedEntries.push(entry as PasswordEntry);
        }
      }
      console.log('StorageUtils: 解密完成，返回条目数量:', decryptedEntries.length);

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
      console.log('StorageUtils: 根据URL搜索密码', url, masterPassword ? '有主密码' : '无主密码');
      const allPasswords = await this.getAllPasswords(masterPassword);
      console.log('StorageUtils: 获取到所有密码数量:', allPasswords.length);
      const filteredPasswords = allPasswords
        .filter(p => {
          if (!p.url || p.url.trim() === '') return true; // 未填URL的匹配所有
          return url.includes(p.url) || p.url.includes(url);
        })
        .sort((a, b) => a.order - b.order);
      console.log('StorageUtils: 过滤后密码数量:', filteredPasswords.length);
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
      console.log('StorageUtils: 开始搜索密码条目', keyword, masterPassword ? '有主密码' : '无主密码');
      const allPasswords = await this.getAllPasswords(masterPassword);
      console.log('StorageUtils: 获取到所有密码数量:', allPasswords.length);
      const lowerKeyword = keyword.toLowerCase();

      const filteredPasswords = allPasswords
        .filter(
          p =>
            p.username.toLowerCase().includes(lowerKeyword) ||
            p.tag.toLowerCase().includes(lowerKeyword) ||
            p.remark.toLowerCase().includes(lowerKeyword) ||
            p.url.toLowerCase().includes(lowerKeyword),
        )
        .sort((a, b) => a.order - b.order);
      console.log('StorageUtils: 过滤后密码数量:', filteredPasswords.length);
      return filteredPasswords;
    } catch (error) {
      console.error('StorageUtils: 搜索密码失败:', error);
      return [];
    }
  }

  /**
   * 更新密码排序
   */
  static async updatePasswordsOrder(passwords: PasswordEntry[]): Promise<void> {
    try {
      console.log('StorageUtils: 开始更新密码排序', passwords.length);
      // 重新设置order字段
      const updatedPasswords = passwords.map((p, index) => ({
        ...p,
        order: index,
      }));

      await chrome.storage.local.set({
        [STORAGE_KEYS.PASSWORDS]: updatedPasswords,
      });
      console.log('StorageUtils: 密码排序更新完成');
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
      console.log('StorageUtils: 开始清空所有数据');
      await chrome.storage.local.clear();
      console.log('StorageUtils: 所有数据已清空');
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
      console.log('StorageUtils: 开始重置主密码');
      await chrome.storage.local.remove(STORAGE_KEYS.MASTER_PASSWORD);
      console.log('StorageUtils: 主密码配置已重置');
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
      console.log('StorageUtils: 获取主密码有效期设置', sessionValidityHours);
      // 首先检查内存中的会话设置
      if (sessionValidityHours !== null) {
        console.log('StorageUtils: 从内存缓存获取有效期设置', sessionValidityHours);
        return sessionValidityHours;
      }

      // 从存储中获取默认值
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD_VALIDITY);
      const validityHours = result[STORAGE_KEYS.MASTER_PASSWORD_VALIDITY] || 24;
      console.log('StorageUtils: 从存储获取有效期设置', validityHours);

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
      console.log('StorageUtils: 设置主密码有效期', hours);
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
      console.log('StorageUtils: 主密码有效期设置完成');
    } catch (error) {
      console.error('设置主密码有效期失败:', error);
      throw error;
    }
  }

  /**
   * 检查会话是否有效
   */
  static async isSessionValid(): Promise<boolean> {
    try {
      console.log('StorageUtils: 检查会话状态', {
        hasSessionMasterPassword: !!sessionMasterPassword,
        hasSessionPasswordExpiry: !!sessionPasswordExpiry,
        sessionMasterPassword: sessionMasterPassword ? '存在' : '不存在',
        sessionPasswordExpiry: sessionPasswordExpiry,
        currentTime: Date.now(),
      });

      // 如果内存中没有会话信息，尝试从存储中恢复
      if (!sessionMasterPassword || !sessionPasswordExpiry) {
        console.log('StorageUtils: 内存中缺少会话信息，尝试从存储中恢复');
        const result = await chrome.storage.local.get([
          SESSION_STORAGE_KEYS.MASTER_PASSWORD,
          SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
          SESSION_STORAGE_KEYS.VALIDITY_HOURS,
        ]);
        console.log('StorageUtils: 从存储中获取到的结果:', result);

        if (result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] && result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]) {
          sessionMasterPassword = result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] ?? null;
          sessionPasswordExpiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] ?? null;
          sessionValidityHours = result[SESSION_STORAGE_KEYS.VALIDITY_HOURS] || 24;
          console.log('StorageUtils: 从存储中恢复会话信息', {
            sessionMasterPassword: sessionMasterPassword ? '存在' : '不存在',
            sessionPasswordExpiry: sessionPasswordExpiry,
            sessionValidityHours: sessionValidityHours,
          });
        } else {
          console.log('StorageUtils: 存储中也没有会话信息');
          return false;
        }
      }

      // 检查是否过期（确保sessionPasswordExpiry不为null）
      const now = Date.now();
      if (sessionPasswordExpiry !== null && now >= sessionPasswordExpiry) {
        console.log('StorageUtils: 会话已过期');
        // 会话已过期，清除缓存
        await this.clearSession();
        return false;
      }

      console.log('StorageUtils: 会话有效');
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
   */
  static getSessionMasterPassword(): string | undefined {
    console.log('StorageUtils: 获取会话主密码', sessionMasterPassword ? '存在' : '不存在');
    return sessionMasterPassword ?? undefined;
  }

  /**
   * 创建会话缓存
   */
  static async createSession(masterPassword: string, validityHours: number): Promise<void> {
    try {
      console.log('StorageUtils: 创建会话缓存', {
        masterPassword: masterPassword ? '存在' : '不存在',
        validityHours: validityHours,
        expiryTime: Date.now() + validityHours * 60 * 60 * 1000,
      });
      sessionMasterPassword = masterPassword;
      sessionValidityHours = validityHours;
      sessionPasswordExpiry = Date.now() + validityHours * 60 * 60 * 1000;

      // 持久化会话信息
      await chrome.storage.local.set({
        [SESSION_STORAGE_KEYS.MASTER_PASSWORD]: masterPassword,
        [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: sessionPasswordExpiry,
        [SESSION_STORAGE_KEYS.VALIDITY_HOURS]: validityHours,
      });
      console.log('StorageUtils: 会话缓存创建完成');
    } catch (error) {
      console.error('创建会话缓存失败:', error);
      throw error;
    }
  }

  /**
   * 清除会话缓存
   */
  static async clearSession(): Promise<void> {
    try {
      console.log('StorageUtils: 清除会话缓存');
      sessionMasterPassword = null;
      sessionPasswordExpiry = null;
      sessionValidityHours = 24;

      // 清除持久化的会话信息
      await chrome.storage.local.remove([
        SESSION_STORAGE_KEYS.MASTER_PASSWORD,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
        SESSION_STORAGE_KEYS.VALIDITY_HOURS,
      ]);
      console.log('StorageUtils: 会话缓存清除完成');
    } catch (error) {
      console.error('清除会话缓存失败:', error);
      throw error;
    }
  }

  /**
   * 获取会话过期时间
   */
  static async getSessionExpiryTime(): Promise<number | null> {
    console.log('StorageUtils: 获取会话过期时间', sessionPasswordExpiry);
    return sessionPasswordExpiry;
  }

  /**
   * 调试工具：获取主密码配置信息
   */
  static async debugMasterPassword(): Promise<any> {
    try {
      console.log('StorageUtils: 获取主密码调试信息');
      const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
      const config: MasterPasswordConfig = result[STORAGE_KEYS.MASTER_PASSWORD];
      console.log('StorageUtils: 获取到的配置:', config);

      const debugInfo = {
        hasConfig: !!config,
        hasSalt: !!config?.salt,
        hasHashedPassword: !!config?.hashedPassword,
        saltLength: config?.salt?.length || 0,
        hashLength: config?.hashedPassword?.length || 0,
        saltPreview: `${config?.salt?.substring(0, 8)}...` || 'N/A',
        hashPreview: `${config?.hashedPassword?.substring(0, 10)}...` || 'N/A',
      };
      console.log('StorageUtils: 调试信息:', debugInfo);
      return debugInfo;
    } catch (error: any) {
      console.error('StorageUtils: 获取主密码调试信息失败:', error);
      return { error: error.message };
    }
  }
}
