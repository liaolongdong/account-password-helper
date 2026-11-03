/**
 * 换钥 / 恢复链路跨边界错误码登记表
 *
 * 这些码是稳定契约：存储层用 `Object.assign(new Error(...), { code })` 抛出，
 * `utils/recoveryUi.ts` 与改密弹窗按码分流呈现。此前字面量散落在 8 个文件里，
 * 拼错的码能编译通过并静默落进 `default:` 兜底分支——用户看到一句不相干的通用错误。
 * 集中成一张表 + 判别联合后，新增码必须同时在这里和 `recoveryUi.ts` 的映射表登记。
 */
export const VAULT_ERROR_CODES = {
  RECOVERY_INVALID: 'RECOVERY_INVALID',
  RECOVERY_DISABLED: 'RECOVERY_DISABLED',
  RECOVERY_STALE: 'RECOVERY_STALE',
  RECOVERY_REPLACEMENT_REQUIRED: 'RECOVERY_REPLACEMENT_REQUIRED',
  RECOVERY_SAME_PASSWORD: 'RECOVERY_SAME_PASSWORD',
  RECOVERY_INCOMPLETE: 'RECOVERY_INCOMPLETE',
  /** 改密路径遇到解不开的密码/回收站记录；与恢复的 RECOVERY_INCOMPLETE 分开呈现 */
  UNDECRYPTABLE_RECORDS: 'UNDECRYPTABLE_RECORDS',
  RECOVERY_FILE_TOO_LARGE: 'RECOVERY_FILE_TOO_LARGE',
  VAULT_DATA_CORRUPTED: 'VAULT_DATA_CORRUPTED',
  VAULT_BUSY: 'VAULT_BUSY',
  REKEY_CONCURRENT_WRITE: 'REKEY_CONCURRENT_WRITE',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  EMPTY_PASSWORD: 'EMPTY_PASSWORD',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
} as const;

/** 跨边界错误码；`recoveryUi.ts` 的映射表以它为键，缺项即编译失败 */
export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[keyof typeof VAULT_ERROR_CODES];

export const RECOVERY_INVALID = VAULT_ERROR_CODES.RECOVERY_INVALID;
export const RECOVERY_FORMAT = {
  version: 1,
  kitKind: 'aph-recovery',
  maxInputLength: 4096,
  idBytes: 16,
  keyBytes: 32,
  ivBytes: 12,
  tagBits: 128,
  checksumBytes: 4,
  codeGroupLength: 8,
  wrappedBase64Length: 80,
  aadDomain: 'aph-recovery-v1',
  wrapInfo: 'aph-recovery-wrap-v1',
} as const;

export interface RecoveryError extends Error {
  code: typeof RECOVERY_INVALID;
}

export interface RecoveryConfig {
  version: 1;
  id: string;
  createdAt: number;
  wrappedDataKey: string;
}

export interface RecoveryKit {
  kind: typeof RECOVERY_FORMAT.kitKind;
  version: 1;
  id: string;
  recoveryKey: string;
  createdAt: number;
}

export interface RecoveryMaterial {
  config: RecoveryConfig;
  recoveryKey: string;
}
