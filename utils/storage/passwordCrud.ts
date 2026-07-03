import type { PasswordEntry, EncryptedPasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { deriveEncryptionKey, encryptPasswordEntry, decryptPasswordEntry, generateId } from '@/utils/encryption';
import { isSessionActiveSync } from './facades';
import { applySavedSortConfig } from './configManager';

/**
 * 获取所有密码条目（原始数据，不进行解密）
 */
export async function getAllPasswordsRaw(): Promise<(PasswordEntry | EncryptedPasswordEntry)[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    return (result[STORAGE_KEYS.PASSWORDS] as (PasswordEntry | EncryptedPasswordEntry)[] | undefined) || [];
  } catch (error) {
    logger.error('获取原始密码列表失败:', error);
    return [];
  }
}

/**
 * 保存密码条目
 */
export async function savePassword(
  entry: Omit<PasswordEntry, 'id' | 'order'>,
  masterPassword?: string,
  copyItemId?: string,
): Promise<PasswordEntry> {
  try {
    const sessionActive = isSessionActiveSync();
    const passwords =
      masterPassword && !sessionActive ? await getAllPasswords(masterPassword) : await getAllPasswordsRaw();

    const now = Date.now();
    const createTime = entry.createTime ?? now;
    const updateTime = entry.updateTime ?? createTime;
    const newEntry: PasswordEntry = {
      ...entry,
      id: generateId(),
      createTime,
      updateTime,
      order: passwords.length,
    };

    const shouldEncrypt = masterPassword && !sessionActive;
    const entriesToSave: (PasswordEntry | EncryptedPasswordEntry)[] = [...passwords];
    if (shouldEncrypt) {
      const encryptedEntry = await encryptPasswordEntry(newEntry, masterPassword);
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
 * 批量保存密码条目（性能优化：单次读写替代 N 次循环调用 savePassword）
 */
export async function batchSavePasswords(
  entries: Omit<PasswordEntry, 'id' | 'order'>[],
  masterPassword?: string,
): Promise<PasswordEntry[]> {
  try {
    if (!entries || entries.length === 0) return [];

    const sessionActive = isSessionActiveSync();
    const existingPasswords =
      masterPassword && !sessionActive ? await getAllPasswords(masterPassword) : await getAllPasswordsRaw();

    const now = Date.now();
    const newEntries: PasswordEntry[] = entries.map((entry, i) => ({
      ...entry,
      id: generateId(),
      createTime: entry.createTime ?? now,
      updateTime: entry.updateTime ?? now,
      order: existingPasswords.length + i,
    }));

    const shouldEncrypt = masterPassword && !sessionActive;
    let combinedEntries: (PasswordEntry | EncryptedPasswordEntry)[];

    if (shouldEncrypt) {
      const key = await deriveEncryptionKey(masterPassword);
      const encryptedNewEntries: EncryptedPasswordEntry[] = [];
      for (const entry of newEntries) {
        const encrypted = await encryptPasswordEntry(entry, masterPassword, key);
        encryptedNewEntries.push(encrypted);
      }
      combinedEntries = [...existingPasswords, ...encryptedNewEntries];
    } else {
      combinedEntries = [...existingPasswords, ...newEntries];
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: combinedEntries,
    });

    return newEntries;
  } catch (error) {
    logger.error('批量保存密码失败:', error);
    throw error;
  }
}

/**
 * 更新密码条目
 */
export async function updatePassword(
  id: string,
  updates: Partial<PasswordEntry>,
  masterPassword?: string,
): Promise<void> {
  try {
    const sessionActive = isSessionActiveSync();
    const passwords =
      masterPassword && !sessionActive ? await getAllPasswords(masterPassword) : await getAllPasswordsRaw();

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
        const encryptedEntry = await encryptPasswordEntry(updatedEntry, masterPassword);
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
 * 删除密码条目
 */
export async function deletePassword(id: string): Promise<void> {
  try {
    const passwords = await getAllPasswordsRaw();
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
export async function deletePasswords(ids: string[]): Promise<void> {
  try {
    const passwords = await getAllPasswordsRaw();
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
export async function getAllPasswords(masterPassword?: string): Promise<PasswordEntry[]> {
  try {
    if (isSessionActiveSync()) {
      const rawData = await getAllPasswordsRaw();
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
          const decryptedEntry = await decryptPasswordEntry(entry, masterPassword);
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
export async function getPasswordsByUrl(url: string, masterPassword?: string): Promise<PasswordEntry[]> {
  try {
    const sessionActive = isSessionActiveSync();
    const allPasswords = sessionActive ? await getAllPasswords() : await getAllPasswords(masterPassword);

    const filteredPasswords = allPasswords.filter(p => {
      if (!p.url || p.url.trim() === '') return true;
      return url.includes(p.url) || p.url.includes(url);
    });

    await applySavedSortConfig(filteredPasswords, url);
    return filteredPasswords;
  } catch (error) {
    logger.error('根据URL搜索密码失败:', error);
    return [];
  }
}
