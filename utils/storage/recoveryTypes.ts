import type { RecoveryConfig, RecoveryMaterial } from '@/utils/recoveryTypes';
import type { MasterPasswordConfig } from '@/utils/types';

export interface RecoveryStatus {
  enabled: boolean;
  config: RecoveryConfig | null;
  corrupted: boolean;
}

export interface VaultRecoverySnapshot {
  master: MasterPasswordConfig;
  recovery: unknown;
}

export interface VaultRekeyRequest {
  oldKey: string;
  newKey: string;
  newMasterConfig: MasterPasswordConfig;
  replacementRecovery?: RecoveryConfig;
  mode: 'password-change' | 'recovery';
}

export interface RecoveryDraft {
  material: RecoveryMaterial;
  sourceMasterFingerprint: string;
  sourceRecoveryId: string | null;
}

export interface RecoveryConfirmation {
  draft: RecoveryDraft;
  confirmation: string;
}
