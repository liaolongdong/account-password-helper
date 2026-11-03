import { STORAGE_KEYS } from '@/utils/storageKeys';
import { lazyImport } from '@/utils/lazyImport';
import { timingSafeEqual } from '@/utils/crypto-light';
// 强度规则只从 `passwordStrengthCore` 取，不在这里复制正则与阈值：UI 校验、安全体检与
// 恢复链路必须是同一口径，否则会出现「弹窗说合格、提交被判弱密码」的分叉。
// 该模块是纯函数（零 i18n、零 Vue），可以安全进入存储层与懒加载 chunk。
import { evaluateStrengthCore } from '@/utils/passwordStrengthCore';
import type { MasterPasswordConfig } from '@/utils/types';
import type { RecoveryDraft, VaultRecoverySnapshot } from './recoveryTypes';
import { VAULT_ERROR_CODES, type VaultErrorCode } from '@/utils/recoveryTypes';

const getEncryption = lazyImport(() => import('@/utils/encryption'));
const getRecoveryCrypto = lazyImport(() => import('@/utils/recoveryCrypto'));

/**
 * 带机器可读 code 的错误：调用方一律按 code 映射 i18n 文案（见 `utils/recoveryUi.ts`），
 * `Error.message` 只放 code 本身作诊断兜底。
 *
 * 存储层不再另存一份面向用户的中文文案表：那会让同一句话有两处事实来源（另一处是
 * `recoveryUi` 的码→key 映射表），改文案时必然漂移，也违背「不在 TS 中硬编码可见字符串」
 * 与「按码分流、不匹配文案」两条既有约定。测试据此断言 code 而不是文案原文。
 */
export function recoveryError(code: VaultErrorCode): Error & { code: VaultErrorCode } {
  return Object.assign(new Error(code), { code });
}

export function masterFingerprint(config: MasterPasswordConfig): string {
  return JSON.stringify([config.salt, config.hashedPassword, config.kdf ?? null]);
}

export function recoverySourceId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
  return 'corrupted';
}

/**
 * 本机是否登记过离线恢复密钥（只看「有没有这份配置」，不解析内容）。
 *
 * 与 `getRecoveryStatus().enabled` 同口径：值为 `undefined`/`null` 才算未启用；
 * 形状损坏也算「登记过」，因为那正是要把用户引到恢复界面去处理的场景。
 *
 * 刻意留在这里而不是复用 `getRecoveryStatus`：那个函数所在的 `recovery.ts` 静态依赖
 * `changeMasterPassword`（含整库重加密逻辑），锁定页只需要一个布尔位，不该为一个位
 * 把 ~20 KB 的换钥依赖图拉进首帧窗口（评审报告 P2-17）。本模块只依赖懒加载的加密入口，
 * 且此处不调用它。
 * @returns 已登记（含损坏形态）为 true
 */
export async function isRecoveryEnrolled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.RECOVERY_CONFIG);
  const value: unknown = stored[STORAGE_KEYS.RECOVERY_CONFIG];
  return value !== undefined && value !== null;
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
    throw recoveryError(VAULT_ERROR_CODES.RECOVERY_INVALID);
  }
  const storedRecovery = await chrome.storage.local.get(STORAGE_KEYS.RECOVERY_CONFIG);
  return { master, recovery: storedRecovery[STORAGE_KEYS.RECOVERY_CONFIG] };
}

export function assertSameMaster(expected: MasterPasswordConfig, current: MasterPasswordConfig): void {
  if (masterFingerprint(expected) !== masterFingerprint(current)) throw recoveryError(VAULT_ERROR_CODES.RECOVERY_STALE);
}

export function assertCurrentRecoveryDraft(draft: RecoveryDraft, snapshot: VaultRecoverySnapshot): void {
  if (
    !draft ||
    draft.sourceMasterFingerprint !== masterFingerprint(snapshot.master) ||
    draft.sourceRecoveryId !== recoverySourceId(snapshot.recovery)
  ) {
    throw recoveryError(VAULT_ERROR_CODES.RECOVERY_STALE);
  }
}

/**
 * 归一化并校验「新主密码」——所有换钥路径的唯一门槛。
 *
 * 刻意放在存储层而不是只做在弹窗里：UI 校验是可以被绕过的（漏挂 validator、将来的新入口、
 * 直接调用存储层的脚本），而主密码强度就是数据密钥强度。创建主密码时要求四条规则全通过，
 * 换钥时若只判 `level !== 'weak'`（通过数 ≥2 即算 medium），就等于开了一条
 * 「把库降级到比首次设置更弱的密钥」的通道。
 *
 * 三条换钥路径（改密 / 首次启用恢复 / 恢复解锁换钥）共用本函数，
 * 判定与 `composables/useAuthFlow.ts` 的创建表单同源于 `passwordStrengthCore`。
 *
 * @param password 新主密码明文（仅用于本机校验，绝不落盘）
 * @returns 去除首尾空白后的密码
 * @throws `EMPTY_PASSWORD` 空密码；`WEAK_PASSWORD` 未四条全通过
 */
export function normalizeNewMasterPassword(password: string): string {
  const value = typeof password === 'string' ? password.trim() : '';
  if (!value) throw recoveryError(VAULT_ERROR_CODES.EMPTY_PASSWORD);
  if (!evaluateStrengthCore(value).allPassed) throw recoveryError(VAULT_ERROR_CODES.WEAK_PASSWORD);
  return value;
}

/**
 * 拒绝「换主密码但数据密钥没变」。
 *
 * 同 salt 下新旧密码相同 → 派生出同一把 DK，恢复包里的旧 DK 依旧能解恢复后的新增数据，
 * 换钥不再等于撤销旧副本。宁可让用户重输一次，也不能留下这种静默失效的恢复材料。
 */
export function assertRotatedDataKey(oldKey: string, newKey: string): void {
  if (timingSafeEqual(oldKey, newKey)) throw recoveryError(VAULT_ERROR_CODES.RECOVERY_SAME_PASSWORD);
}

/**
 * 组装换钥后的主密码配置。
 *
 * `preserveHint` 两条链路都传 true：提示语是用户唯一的找回辅助，全站只有「设置主密码」那一次
 * 能写它（没有编辑入口），整对象覆写掉就永久消失。它既不参与恢复包的 AAD，也不进
 * {@link masterFingerprint}，带过去不影响套件绑定与陈旧判定。
 */
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
  if (!timingSafeEqual(recovered, dataKey)) throw recoveryError(VAULT_ERROR_CODES.RECOVERY_INVALID);
}
