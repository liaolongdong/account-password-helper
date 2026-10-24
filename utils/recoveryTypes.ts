export const RECOVERY_INVALID = 'RECOVERY_INVALID';
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
