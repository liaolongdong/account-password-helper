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

/**
 * 一次换钥（改密或离线恢复）的提交结果。
 *
 * 两个字段都是「界面必须说实话」的依据：
 * - `relockRequired`：数据与新校验值已落盘，但会话材料没能发布（或本次本就处于锁定态），
 *   继续报「成功且仍在解锁态」会误导用户；
 * - `carriedUndecryptable`：原样携带过这次换钥的不可解条目数。这些记录留在库里，
 *   但新主密码永远读不出它们——只记日志等于对用户隐瞒，必须由调用方点名条数。
 */
export interface VaultRekeyResult {
  relockRequired: boolean;
  carriedUndecryptable: number;
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
