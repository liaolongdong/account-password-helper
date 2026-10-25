import type { MasterPasswordConfig } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { hashPassword, generateSalt, timingSafeEqual } from '@/utils/crypto-light';
import { isWebPageContext } from '@/utils/runtimeContext';
import { withVaultMutation } from './vaultWriteLock';

/**
 * 惰性加载加密模块（仅用于 PBKDF2 校验哈希派生）
 *
 * 避免将 encryption.ts 的 PBKDF2/AES-GCM 重代码静态打入 Service Worker 冷启动初始包，
 * 与 sessionManager-storage.ts / passwordCrud.ts 中的惰性加载模式保持一致。
 */
let _encryptionModule: typeof import('@/utils/encryption') | null = null;
async function _getEncryption(): Promise<typeof import('@/utils/encryption')> {
  if (!_encryptionModule) {
    _encryptionModule = await import('@/utils/encryption');
  }
  return _encryptionModule;
}

/**
 * 当前校验哈希使用的 KDF 算法标记
 */
const CURRENT_VERIFIER_KDF = 'pbkdf2-sha256' as const;

/**
 * 主密码提示语的最大字符数
 *
 * 提示语以明文落在 `master_password_config.hint`，上限用于挡住异常长的输入
 * （表单侧 `maxlength` 只是体验，存储边界才是事实来源）。
 */
export const MAX_MASTER_PASSWORD_HINT_LENGTH = 120;

/**
 * 归一化提示语：去首尾空白并按上限截断
 *
 * @returns 归一化后的提示语；空串表示「未设置提示语」，调用方据此省略该字段
 */
function normalizeHint(raw: string | undefined): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  // 按码位（code point）截断，不按 UTF-16 码元：`slice` 会把 emoji 或生僻字所在的
  // 代理对劈成一半，留下一个孤立代理项落盘——它渲染成 U+FFFD，且再也无法被原样比对回去。
  // 上限语义与 docs/ARCHITECTURE 写的「120 码位」一致。
  return Array.from(trimmed).slice(0, MAX_MASTER_PASSWORD_HINT_LENGTH).join('');
}

/**
 * 设置主密码
 *
 * @param password 主密码明文（仅用于本机派生校验哈希与数据密钥，绝不落盘）
 * @param hint 可选的主密码提示语，明文存于本机；省略即不写入该字段
 */
export async function setMasterPassword(password: string, hint?: string): Promise<void> {
  return withVaultMutation(() => setMasterPasswordInternal(password, hint));
}

async function setMasterPasswordInternal(password: string, hint?: string): Promise<void> {
  try {
    const cleanPassword = String(password || '').trim();
    if (!cleanPassword) {
      throw new Error('密码不能为空');
    }

    const salt = generateSalt();
    const enc = await _getEncryption();
    const hashedPassword = await enc.deriveVerifierHash(cleanPassword, salt);

    const normalizedHint = normalizeHint(hint);
    const config: MasterPasswordConfig = {
      hashedPassword,
      salt,
      kdf: CURRENT_VERIFIER_KDF,
      ...(normalizedHint ? { hint: normalizedHint } : {}),
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
 *
 * - 新版配置（kdf === 'pbkdf2-sha256'）：直接用 PBKDF2 校验哈希比对。
 * - 旧版配置（无 kdf，单轮 SHA-256）：先用 SHA-256 比对；通过后透明迁移为 PBKDF2，
 *   用户无感知，不需重设或重输主密码。
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  return withVaultMutation(() => verifyMasterPasswordInternal(password));
}

async function verifyMasterPasswordInternal(password: string): Promise<boolean> {
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

    const enc = await _getEncryption();

    // 新版：PBKDF2 慢哈希校验
    if (config.kdf === CURRENT_VERIFIER_KDF) {
      const hashedInput = await enc.deriveVerifierHash(cleanPassword, config.salt);
      return timingSafeEqual(hashedInput, config.hashedPassword);
    }

    // 旧版：单轮 SHA-256 校验，成功后透明迁移升级为 PBKDF2
    const legacyHash = await hashPassword(cleanPassword, config.salt);
    if (!timingSafeEqual(legacyHash, config.hashedPassword)) {
      return false;
    }

    // 升级写回是整对象覆写，而内容脚本跑在宿主页面的 origin 上：`navigator.locks` 按 origin 分组，
    // 它在这里的共享租约挡不住扩展侧的独占换钥。若换钥期间从网页触发一次验证，旧口令的校验哈希
    // 会盖掉刚提交的新配置——旧密码「验得过」而整库已是新钥密文，连绑定该配置的恢复密钥一起失效。
    // 因此宿主页面上只判定通过、不写回；升级留给扩展自身上下文的下次验证完成。
    if (isWebPageContext()) {
      logger.debug('宿主页面上下文跳过校验哈希升级写回：避免与换钥事务互相覆写');
      return true;
    }

    try {
      const upgradedHash = await enc.deriveVerifierHash(cleanPassword, config.salt);
      const upgradedConfig: MasterPasswordConfig = {
        hashedPassword: upgradedHash,
        salt: config.salt,
        kdf: CURRENT_VERIFIER_KDF,
        // 提示语没有编辑入口，全站只有设置主密码那一次能写它；这里是最后一处对
        // MASTER_PASSWORD 的无条件整对象覆写，带上它以免哪天存量记录真的带 hint。
        ...(config.hint ? { hint: config.hint } : {}),
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_PASSWORD]: upgradedConfig });
      logger.debug('主密码校验哈希已自动升级为 PBKDF2');
    } catch (upgradeError) {
      // 升级写回失败不影响本次验证结果，下次验证会再次尝试升级
      logger.warn('主密码校验哈希升级写回失败，将在下次验证时重试:', upgradeError);
    }

    return true;
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
 * 读取主密码提示语
 *
 * 供解锁页在连续输错后展示。提示语是本机明文数据，不含任何主密码材料，
 * 因此读取不经会话门禁；未设置、配置缺失或读取失败一律返回空串（调用方隐藏该区块）。
 */
export async function getMasterPasswordHint(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
    const config = result[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;
    return normalizeHint(config?.hint);
  } catch (error) {
    logger.error('读取主密码提示语失败:', error);
    return '';
  }
}

/**
 * 重置主密码（清空主密码配置）
 */
export async function resetMasterPassword(): Promise<void> {
  return withVaultMutation(resetMasterPasswordInternal);
}

async function resetMasterPasswordInternal(): Promise<void> {
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
  return withVaultMutation(clearAllDataInternal);
}

async function clearAllDataInternal(): Promise<void> {
  try {
    await chrome.storage.local.clear();
  } catch (error) {
    logger.error('清空数据失败:', error);
    throw error;
  }
}
