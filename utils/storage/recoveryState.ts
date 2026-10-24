import { STORAGE_KEYS } from '@/utils/storageKeys';
import { lazyImport } from '@/utils/lazyImport';
import { timingSafeEqual } from '@/utils/crypto-light';
// 强度规则只从 `passwordStrengthCore` 取，不在这里复制正则与阈值：UI 校验、安全体检与
// 恢复链路必须是同一口径，否则会出现「弹窗说合格、提交被判弱密码」的分叉。
// 该模块是纯函数（零 i18n、零 Vue），可以安全进入存储层与懒加载 chunk。
import { evaluateStrengthCore } from '@/utils/passwordStrengthCore';
import type { MasterPasswordConfig } from '@/utils/types';
import type { RecoveryDraft, VaultRecoverySnapshot } from './recoveryTypes';

const getEncryption = lazyImport(() => import('@/utils/encryption'));
const getRecoveryCrypto = lazyImport(() => import('@/utils/recoveryCrypto'));

/**
 * 带机器可读 code 的错误：调用方按 code 映射 i18n 文案，message 只作诊断兜底。
 *
 * 沿用改造前 `changeMasterPassword` 的「code + 中文 message」双形态——现有多条测试断言
 * message 原文，弹窗则读 code；两者都不能在本次改动里悄悄换掉。
 */
export function recoveryError(code: string, message?: string): Error & { code: string } {
  return Object.assign(new Error(message ?? code), { code });
}

export const RECOVERY_ERROR_MESSAGE = {
  WRONG_PASSWORD: '当前密码验证失败',
  EMPTY_PASSWORD: '密码不能为空',
  REKEY_CONCURRENT_WRITE: '检测到其他页面的改动刚刚写入，本次修改已安全取消，请重试',
} as const;

export function masterFingerprint(config: MasterPasswordConfig): string {
  return JSON.stringify([config.salt, config.hashedPassword, config.kdf ?? null]);
}

export function recoverySourceId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
  return 'corrupted';
}

export async function readVaultRecoverySnapshot(): Promise<VaultRecoverySnapshot> {
  const storedMaster = await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD);
  const master = storedMaster[STORAGE_KEYS.MASTER_PASSWORD] as MasterPasswordConfig | undefined;
  if (
    !master ||
    typeof master.salt !== 'string' ||
    !master.salt ||
    typeof master.hashedPassword !== 'string' ||
    !master.hashedPassword
  ) {
    throw recoveryError('RECOVERY_INVALID');
  }
  const storedRecovery = await chrome.storage.local.get(STORAGE_KEYS.RECOVERY_CONFIG);
  return { master, recovery: storedRecovery[STORAGE_KEYS.RECOVERY_CONFIG] };
}

export function assertSameMaster(expected: MasterPasswordConfig, current: MasterPasswordConfig): void {
  if (masterFingerprint(expected) !== masterFingerprint(current)) throw recoveryError('RECOVERY_STALE');
}

export function assertCurrentRecoveryDraft(draft: RecoveryDraft, snapshot: VaultRecoverySnapshot): void {
  if (
    !draft ||
    draft.sourceMasterFingerprint !== masterFingerprint(snapshot.master) ||
    draft.sourceRecoveryId !== recoverySourceId(snapshot.recovery)
  ) {
    throw recoveryError('RECOVERY_STALE');
  }
}

export function normalizeNewRecoveryPassword(password: string): string {
  const value = typeof password === 'string' ? password.trim() : '';
  if (!value) throw recoveryError('EMPTY_PASSWORD');
  if (!evaluateStrengthCore(value).allPassed) throw recoveryError('WEAK_PASSWORD');
  return value;
}

/**
 * 拒绝「换主密码但数据密钥没变」。
 *
 * 同 salt 下新旧密码相同 → 派生出同一把 DK，恢复包里的旧 DK 依旧能解恢复后的新增数据，
 * 换钥不再等于撤销旧副本。宁可让用户重输一次，也不能留下这种静默失效的恢复材料。
 */
export function assertRotatedDataKey(oldKey: string, newKey: string): void {
  if (timingSafeEqual(oldKey, newKey)) throw recoveryError('RECOVERY_SAME_PASSWORD');
}

export async function buildChangedMasterConfig(
  current: MasterPasswordConfig,
  password: string,
  preserveHint: boolean,
): Promise<MasterPasswordConfig> {
  const encryption = await getEncryption();
  return {
    salt: current.salt,
    hashedPassword: await encryption.deriveVerifierHash(password, current.salt),
    kdf: 'pbkdf2-sha256',
    ...(preserveHint && current.hint ? { hint: current.hint } : {}),
  };
}

export async function buildRecoveryDraft(
  snapshot: VaultRecoverySnapshot,
  dataKey: string,
  masterConfig: MasterPasswordConfig,
): Promise<RecoveryDraft> {
  const recoveryCrypto = await getRecoveryCrypto();
  return {
    material: await recoveryCrypto.createRecoveryMaterial(dataKey, masterConfig),
    sourceMasterFingerprint: masterFingerprint(snapshot.master),
    sourceRecoveryId: recoverySourceId(snapshot.recovery),
  };
}

export async function verifyRecoveryReplacement(
  draft: RecoveryDraft,
  confirmation: string,
  dataKey: string,
  newMaster: MasterPasswordConfig,
): Promise<void> {
  const recoveryCrypto = await getRecoveryCrypto();
  const recovered = await recoveryCrypto.unwrapRecoveryDataKey(draft?.material?.config, confirmation, newMaster);
  if (!timingSafeEqual(recovered, dataKey)) throw recoveryError('RECOVERY_INVALID');
}
