/**
 * 云同步凭证加密存取
 *
 * 安全不变量：凭证（app_secret / access_token）以 AES-256-GCM 密文落盘，
 * 密钥为**会话数据密钥**（getSessionDataKey）。锁定后会话密钥销毁 → 凭证不可解，
 * 与密码条目的 at-rest 加密模型完全一致，不引入新的明文存活面。
 *
 * rekey 兼容：修改主密码会更换会话数据密钥，旧密文凭证 GCM 校验失败。
 * 此时返回 `corrupted`，UI 提示「凭证需重新录入」，**不清除目标表配置与快照**。
 */
import type { CloudProvider, CredentialLoadResult, ProviderCredentialMap } from './types';
import { logger } from '@/utils/logger';
import { lazyImport } from '@/utils/lazyImport';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { getSessionDataKey } from '@/utils/storage/facades';

/** 加密模块惰性加载：避免把 PBKDF2/AES-GCM 拉入 Options 首屏 chunk */
const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/** 凭证聚合对象（整体加密为单个密文串，避免逐字段多次 GCM 开销） */
type CredentialBlob = Partial<Record<CloudProvider, ProviderCredentialMap[CloudProvider]>>;

/** 校验飞书凭证字段完整性 */
function isValidFeishu(value: unknown): value is ProviderCredentialMap['feishu'] {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.appId === 'string' && v.appId !== '' && typeof v.appSecret === 'string' && v.appSecret !== '';
}

/** 校验腾讯凭证字段完整性 */
function isValidTencent(value: unknown): value is ProviderCredentialMap['tencent'] {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.clientId === 'string' &&
    v.clientId !== '' &&
    typeof v.openId === 'string' &&
    v.openId !== '' &&
    typeof v.accessToken === 'string' &&
    v.accessToken !== ''
  );
}

/** 校验 WebDAV 凭证：bearerToken 非空，或 username + password 均非空（WebDAV 规格 §7.4） */
function isValidWebDav(value: unknown): value is ProviderCredentialMap['webdav'] {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.bearerToken === 'string' && v.bearerToken !== '') return true;
  return typeof v.username === 'string' && v.username !== '' && typeof v.password === 'string' && v.password !== '';
}

/**
 * 按 provider 校验凭证（不可信存储数据一律经类型守卫收窄）
 *
 * 穷尽式 switch + never 兜底：新增 provider 时 TS 编译期强制补分支，
 * 防止新平台凭证被其他平台的 schema 误校验（WebDAV 规格 §2.2）。
 */
function isValidCredentials<P extends CloudProvider>(provider: P, value: unknown): value is ProviderCredentialMap[P] {
  switch (provider) {
    case 'feishu':
      return isValidFeishu(value);
    case 'tencent':
      return isValidTencent(value);
    case 'webdav':
      return isValidWebDav(value);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * 读取指定平台的凭证
 *
 * @returns 四态结果：ok / empty（未配置）/ locked（会话失效）/ corrupted（密文不可解）
 */
export async function loadCredentials<P extends CloudProvider>(provider: P): Promise<CredentialLoadResult<P>> {
  let cipher: string | undefined;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS);
    cipher = result[STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS] as string | undefined;
  } catch (error) {
    logger.error('读取云同步凭证失败:', error);
    return { status: 'empty' };
  }
  if (!cipher) return { status: 'empty' };

  const dataKey = await getSessionDataKey();
  if (!dataKey) return { status: 'locked' };

  let blob: CredentialBlob;
  try {
    const enc = await _getEncryption();
    blob = JSON.parse(await enc.decryptData(cipher, dataKey)) as CredentialBlob;
  } catch {
    // GCM 校验失败：rekey 后旧密文不可解，或数据损坏。不记录密文与密钥。
    logger.warn('云同步凭证解密失败（可能已修改主密码），需重新录入');
    return { status: 'corrupted' };
  }

  const credentials = blob[provider];
  if (!isValidCredentials(provider, credentials)) return { status: 'empty' };
  return { status: 'ok', credentials };
}

/**
 * 写入指定平台的凭证（其余平台凭证原样保留）
 *
 * 会话失效时抛错而非静默丢弃：凭证写入失败必须让用户感知，
 * 否则会出现「界面显示已配置但实际未落盘」的假成功。
 */
export async function saveCredentials<P extends CloudProvider>(
  provider: P,
  credentials: ProviderCredentialMap[P],
): Promise<void> {
  if (!isValidCredentials(provider, credentials)) {
    throw new Error('凭证字段不完整');
  }
  const dataKey = await getSessionDataKey();
  if (!dataKey) {
    throw new Error('会话已失效，无法保存凭证');
  }

  // 读取现有密文并合并：换平台配置时不得清空另一边
  let blob: CredentialBlob = {};
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS);
    const cipher = result[STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS] as string | undefined;
    if (cipher) {
      const enc = await _getEncryption();
      blob = JSON.parse(await enc.decryptData(cipher, dataKey)) as CredentialBlob;
    }
  } catch {
    // 旧密文不可解（rekey）：以空聚合重建，本次写入的凭证生效，其余平台需重新录入
    blob = {};
  }

  blob[provider] = credentials;
  const enc = await _getEncryption();
  const cipher = await enc.encryptData(JSON.stringify(blob), dataKey);
  await chrome.storage.local.set({ [STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS]: cipher });
}

/**
 * 清除指定平台凭证（其余平台保留）
 *
 * 用于「凭证已失效」引导重填场景；按设计不清除目标表配置与快照。
 */
export async function clearCredentials(provider: CloudProvider): Promise<void> {
  const dataKey = await getSessionDataKey();
  if (!dataKey) return;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS);
    const cipher = result[STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS] as string | undefined;
    if (!cipher) return;
    const enc = await _getEncryption();
    const blob = JSON.parse(await enc.decryptData(cipher, dataKey)) as CredentialBlob;
    delete blob[provider];
    if (Object.keys(blob).length === 0) {
      await chrome.storage.local.remove(STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS);
      return;
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.CLOUD_SYNC_CREDENTIALS]: await enc.encryptData(JSON.stringify(blob), dataKey),
    });
  } catch (error) {
    logger.error('清除云同步凭证失败:', error);
  }
}
