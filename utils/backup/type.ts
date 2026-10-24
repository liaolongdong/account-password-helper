/** 只读备份检查仅对外暴露摘要，不让解密后的记录进入 UI 状态。 */
export interface BackupVerificationResult {
  kind: 'passwords' | 'identities';
  count: number;
}
