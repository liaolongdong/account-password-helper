import { STORAGE_KEYS } from '@/utils/storageKeys';
import { lazyImport } from '@/utils/lazyImport';
import { isRecoveryConfig, unwrapRecoveryDataKey } from '@/utils/recoveryCrypto';
import { verifyMasterPassword } from './masterPassword';
import { withVaultMutation, withVaultKeyTransition } from './vaultWriteLock';
import { commitVaultRekey } from './changeMasterPassword';
import {
  assertCurrentRecoveryDraft,
  assertRotatedDataKey,
  assertSameMaster,
  buildChangedMasterConfig,
  buildRecoveryDraft,
  normalizeNewMasterPassword,
  readVaultRecoverySnapshot,
  recoveryError,
  verifyRecoveryReplacement,
} from './recoveryState';
import type { RecoveryDraft, RecoveryStatus, VaultRecoverySnapshot } from './recoveryTypes';
import { VAULT_ERROR_CODES } from '@/utils/recoveryTypes';

const getEncryption = lazyImport(() => import('@/utils/encryption'));

async function authorizeMaster(password: string): Promise<VaultRecoverySnapshot> {
  return withVaultMutation(async () => {
    if (!(await verifyMasterPassword(password))) throw recoveryError(VAULT_ERROR_CODES.WRONG_PASSWORD);
    return readVaultRecoverySnapshot();
  });
}

export async function getRecoveryStatus(): Promise<RecoveryStatus> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.RECOVERY_CONFIG);
  const value: unknown = stored[STORAGE_KEYS.RECOVERY_CONFIG];
  if (value === undefined || value === null) return { enabled: false, config: null, corrupted: false };
  return { enabled: true, config: isRecoveryConfig(value) ? value : null, corrupted: !isRecoveryConfig(value) };
}

export async function prepareRecoveryEnrollment(masterPassword: string): Promise<RecoveryDraft> {
  return withVaultMutation(async () => {
    const snapshot = await authorizeMaster(masterPassword);
    const encryption = await getEncryption();
    const key = await encryption.deriveEncryptionKey(masterPassword.trim());
    return buildRecoveryDraft(snapshot, key, snapshot.master);
  });
}

export async function activateRecovery(
  masterPassword: string,
  draft: RecoveryDraft,
  confirmation: string,
): Promise<void> {
  const authorized = await authorizeMaster(masterPassword);
  await withVaultKeyTransition(async () => {
    const snapshot = await readVaultRecoverySnapshot();
    assertSameMaster(authorized.master, snapshot.master);
    assertCurrentRecoveryDraft(draft, snapshot);
    const encryption = await getEncryption();
    const key = await encryption.deriveEncryptionKey(masterPassword.trim());
    await verifyRecoveryReplacement(draft, confirmation, key, snapshot.master);
    const { version, id, createdAt, wrappedDataKey } = draft.material.config;
    await chrome.storage.local.set({ [STORAGE_KEYS.RECOVERY_CONFIG]: { version, id, createdAt, wrappedDataKey } });
  });
}

export async function disableRecovery(masterPassword: string): Promise<void> {
  const authorized = await authorizeMaster(masterPassword);
  await withVaultKeyTransition(async () => {
    const snapshot = await readVaultRecoverySnapshot();
    assertSameMaster(authorized.master, snapshot.master);
    await chrome.storage.local.remove(STORAGE_KEYS.RECOVERY_CONFIG);
  });
}

export async function preparePasswordRecovery(input: string, newPassword: string): Promise<RecoveryDraft> {
  const password = normalizeNewMasterPassword(newPassword);
  return withVaultMutation(async () => {
    const snapshot = await readVaultRecoverySnapshot();
    if (snapshot.recovery === undefined || snapshot.recovery === null)
      throw recoveryError(VAULT_ERROR_CODES.RECOVERY_DISABLED);
    const oldKey = await unwrapRecoveryDataKey(snapshot.recovery, input, snapshot.master);
    const encryption = await getEncryption();
    const key = await encryption.deriveEncryptionKey(password);
    assertRotatedDataKey(oldKey, key);
    const nextMaster = await buildChangedMasterConfig(snapshot.master, password, true);
    return buildRecoveryDraft(snapshot, key, nextMaster);
  });
}

/**
 * 用恢复码换回本机当前库：解出数据密钥 → 全库重加密 → 换发新套件 → 保持锁定。
 *
 * @param allowUndecryptable 用户已知情同意时，允许把解不开的条目原样携带过这次换钥，
 *   从而在「库里已有一条坏记录」的情况下仍救回其余数据。默认 `false` 维持整笔中止——
 *   半恢复的库比不恢复更糟，除非用户明确知道自己在换什么。
 */
export async function recoverMasterPassword(
  input: string,
  newPassword: string,
  draft: RecoveryDraft,
  confirmation: string,
  allowUndecryptable = false,
): Promise<void> {
  const password = normalizeNewMasterPassword(newPassword);
  await withVaultKeyTransition(async () => {
    const snapshot = await readVaultRecoverySnapshot();
    if (snapshot.recovery === undefined || snapshot.recovery === null)
      throw recoveryError(VAULT_ERROR_CODES.RECOVERY_DISABLED);
    assertCurrentRecoveryDraft(draft, snapshot);
    const oldKey = await unwrapRecoveryDataKey(snapshot.recovery, input, snapshot.master);
    const encryption = await getEncryption();
    const newKey = await encryption.deriveEncryptionKey(password);
    assertRotatedDataKey(oldKey, newKey);
    const nextMaster = await buildChangedMasterConfig(snapshot.master, password, true);
    await verifyRecoveryReplacement(draft, confirmation, newKey, nextMaster);
    await commitVaultRekey({
      oldKey,
      newKey,
      newMasterConfig: nextMaster,
      replacementRecovery: draft.material.config,
      mode: 'recovery',
      allowUndecryptable,
    });
  });
}

export async function prepareChangedPasswordRecovery(
  oldPassword: string,
  newPassword: string,
): Promise<RecoveryDraft | null> {
  return withVaultMutation(async () => {
    const status = await getRecoveryStatus();
    if (!status.enabled) return null;
    const password = normalizeNewMasterPassword(newPassword);
    const snapshot = await authorizeMaster(oldPassword);
    const encryption = await getEncryption();
    const [oldKey, key] = await Promise.all([
      encryption.deriveEncryptionKey(String(oldPassword || '').trim()),
      encryption.deriveEncryptionKey(password),
    ]);
    assertRotatedDataKey(oldKey, key);
    const nextMaster = await buildChangedMasterConfig(snapshot.master, password, true);
    return buildRecoveryDraft(snapshot, key, nextMaster);
  });
}
