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
  /**
   * 用户已知情同意后，允许把解不开的条目**原样携带**过这次换钥（不重加密、不删除）。
   *
   * 恢复流程用它救回其余数据；改密流程用它避免「一条坏记录永久卡死主密码轮换」。
   * 默认 `false`，即维持原有的整笔中止（原子性）。开启后那些条目留在库里，
   * 但新数据密钥永远读不出它们——这是「救回大部分」与「一个都救不回」之间的取舍，
   * 必须由界面上的明确确认来授权，不能默认放行。
   */
  allowUndecryptable?: boolean;
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
