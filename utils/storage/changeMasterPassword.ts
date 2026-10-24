import type { PasswordEntry, EncryptedPasswordEntry, TrashedPasswordEntry, PasswordHistoryRecord } from '@/utils/types';
import type { IdentityRecord } from '@/utils/identity/types';
import { logger } from '@/utils/logger';
import { mapWithConcurrency } from '@/utils/concurrency';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { lockSession } from '@/utils/sessionLock';
import { verifyMasterPassword } from './masterPassword';
import { getAllPasswordsRaw } from './passwordCrud';
import { getAllTrashRaw } from './trashManager';
import { getAllHistoryRaw } from './passwordHistory';
import { getAllIdentityRaw, reencryptAll } from './identityCrud';
import { getAllIdentityTrashRaw } from './identityTrashManager';
import { lazyImport } from '@/utils/lazyImport';
import { withVaultMutation, withVaultKeyTransition } from './vaultWriteLock';
import {
  assertCurrentRecoveryDraft,
  assertRotatedDataKey,
  assertSameMaster,
  buildChangedMasterConfig,
  readVaultRecoverySnapshot,
  recoveryError,
  verifyRecoveryReplacement,
  RECOVERY_ERROR_MESSAGE,
} from './recoveryState';
import type { RecoveryConfirmation, VaultRekeyRequest } from './recoveryTypes';

const getEncryption = lazyImport(() => import('@/utils/encryption'));
const getSessionManager = lazyImport(() => import('@/utils/sessionManager-storage'));

/**
 * 换钥前校验五个数据域的容器形状。
 *
 * `mapWithConcurrency` 按 `length` 迭代：`{0: 记录, length: 0}` 这类畸形容器会被当成空库，
 * 整数组覆写就把那条记录连根抹掉——「保留字节」变成了静默丢数据。恢复流程必须拒绝，
 * 改密流程同样拒绝，否则同一份畸形库会在改密后消失。
 */
function assertDomainsIntact(domains: unknown[], mode: VaultRekeyRequest['mode']): void {
  const corrupted = domains.some((raw, index) => {
    if (!Array.isArray(raw)) return true;
    // 历史域的身份键是 entryId，其余四域是 id；混用会误拒合法数据。
    const key = index === 2 ? 'entryId' : 'id';
    return raw.some(
      record => !record || typeof record !== 'object' || typeof (record as Record<string, unknown>)[key] !== 'string',
    );
  });
  if (corrupted) throw recoveryError(mode === 'recovery' ? 'RECOVERY_INCOMPLETE' : 'VAULT_DATA_CORRUPTED');
}

export async function changeMasterPassword(
  oldPassword: string,
  newPassword: string,
  replacement?: RecoveryConfirmation,
): Promise<'relock-required' | void> {
  const oldPw = String(oldPassword || '').trim();
  const newPw = String(newPassword || '').trim();
  if (!newPw) throw recoveryError('EMPTY_PASSWORD', RECOVERY_ERROR_MESSAGE.EMPTY_PASSWORD);
  const authorized = await withVaultMutation(async () => {
    if (!(await verifyMasterPassword(oldPw)))
      throw recoveryError('WRONG_PASSWORD', RECOVERY_ERROR_MESSAGE.WRONG_PASSWORD);
    return readVaultRecoverySnapshot();
  });
  return withVaultKeyTransition(async () => {
    const snapshot = await readVaultRecoverySnapshot();
    assertSameMaster(authorized.master, snapshot.master);
    const hasRecovery = snapshot.recovery !== undefined && snapshot.recovery !== null;
    const encryption = await getEncryption();
    const oldKey = await encryption.deriveEncryptionKey(oldPw);
    const newKey = await encryption.deriveEncryptionKey(newPw);
    // 换发恢复包的前提是数据密钥真的换了；同密码 = 同一把 DK，旧恢复包依旧能解新数据。
    if (hasRecovery) assertRotatedDataKey(oldKey, newKey);
    if (hasRecovery && !replacement) throw recoveryError('RECOVERY_REPLACEMENT_REQUIRED');
    if (!hasRecovery && replacement) throw recoveryError('RECOVERY_STALE');
    const newMasterConfig = await buildChangedMasterConfig(snapshot.master, newPw, true);
    if (replacement) {
      assertCurrentRecoveryDraft(replacement.draft, snapshot);
      await verifyRecoveryReplacement(replacement.draft, replacement.confirmation, newKey, newMasterConfig);
    }
    return commitVaultRekey({
      oldKey,
      newKey,
      newMasterConfig,
      replacementRecovery: replacement?.draft.material.config,
      mode: 'password-change',
    });
  });
}

/** The caller holds the exclusive key-transition lease; no authentication is bypassed by this internal commit stage. */
export async function commitVaultRekey(request: VaultRekeyRequest): Promise<'relock-required' | void> {
  const { oldKey, newKey, newMasterConfig, replacementRecovery, mode } = request;
  const encryption = await getEncryption();
  const rawPasswords = await getAllPasswordsRaw();
  const rawTrash = await getAllTrashRaw();
  const rawHistory = await getAllHistoryRaw();
  const identityRaw = await getAllIdentityRaw();
  const identityTrashRaw = await getAllIdentityTrashRaw();
  assertDomainsIntact([rawPasswords, rawTrash, rawHistory, identityRaw, identityTrashRaw], mode);

  let decryptedPasswords: PasswordEntry[];
  let decryptedTrash: TrashedPasswordEntry[];
  try {
    decryptedPasswords = await mapWithConcurrency(rawPasswords, async entry =>
      'encrypted' in entry && entry.encrypted === true
        ? encryption.decryptPasswordEntry(entry as EncryptedPasswordEntry, '', oldKey)
        : (entry as PasswordEntry),
    );
    decryptedTrash = await mapWithConcurrency(rawTrash, async entry => {
      if ('encrypted' in entry && entry.encrypted === true) {
        const plain = await encryption.decryptPasswordEntry(entry as EncryptedPasswordEntry, '', oldKey);
        return { ...plain, deletedAt: entry.deletedAt };
      }
      return entry;
    });
  } catch (error) {
    if (mode === 'recovery') throw recoveryError('RECOVERY_INCOMPLETE');
    throw error;
  }

  const historyOutcomes = await mapWithConcurrency(rawHistory, async record => {
    try {
      return { plainPassword: await encryption.decryptData(record.password, oldKey) };
    } catch {
      if (mode === 'recovery') throw recoveryError('RECOVERY_INCOMPLETE');
      logger.warn('Unreadable password history retained during key change');
      return null;
    }
  });
  const decryptedHistory: PasswordHistoryRecord[] = [];
  const unrecoverableHistory: PasswordHistoryRecord[] = [];
  historyOutcomes.forEach((outcome, index) => {
    if (outcome) decryptedHistory.push({ ...rawHistory[index], password: outcome.plainPassword });
    else unrecoverableHistory.push(rawHistory[index]);
  });

  const reEncryptedPasswords = await mapWithConcurrency(decryptedPasswords, entry =>
    encryption.encryptPasswordEntry(entry, '', newKey),
  );
  const reEncryptedTrash = await mapWithConcurrency(decryptedTrash, async entry => {
    const { deletedAt, ...plainEntry } = entry;
    const encrypted = await encryption.encryptPasswordEntry(plainEntry, '', newKey);
    return { ...encrypted, deletedAt };
  });
  const reEncryptedHistory = await mapWithConcurrency(decryptedHistory, async record => ({
    ...record,
    password: await encryption.encryptData(record.password, newKey),
  }));
  reEncryptedHistory.push(...unrecoverableHistory);

  async function recoverIdentities<T extends IdentityRecord>(records: T[]): Promise<T[]> {
    return mapWithConcurrency(records, async record => {
      let plaintext: string;
      try {
        plaintext = await encryption.decryptData(record.encryptedPayload, oldKey);
        JSON.parse(plaintext);
      } catch {
        throw recoveryError('RECOVERY_INCOMPLETE');
      }
      return { ...record, encryptedPayload: await encryption.encryptData(plaintext, newKey) };
    });
  }
  const reEncryptedIdentity =
    mode === 'recovery' ? await recoverIdentities(identityRaw) : await reencryptAll(identityRaw, oldKey, newKey);
  const identityTrashResult =
    mode === 'recovery'
      ? await recoverIdentities(identityTrashRaw)
      : await reencryptAll(identityTrashRaw, oldKey, newKey);
  const reEncryptedIdentityTrash = identityTrashResult.map((record, index) => ({
    ...record,
    deletedAt: identityTrashRaw[index].deletedAt,
  }));

  const sessionManager = await getSessionManager();
  let sessionKeysToWrite: Record<string, unknown> = {};
  if (mode === 'password-change') {
    const sessionResult = await chrome.storage.local.get(SESSION_STORAGE_KEYS.VALIDITY_HOURS);
    const validityHours = (sessionResult[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
    sessionKeysToWrite = await sessionManager.prepareSessionRekey(newKey, validityHours);
  }

  const fresh = await Promise.all([
    getAllPasswordsRaw(),
    getAllTrashRaw(),
    getAllHistoryRaw(),
    getAllIdentityRaw(),
    getAllIdentityTrashRaw(),
  ]);
  const original = [rawPasswords, rawTrash, rawHistory, identityRaw, identityTrashRaw];
  if (original.some((records, index) => JSON.stringify(records) !== JSON.stringify(fresh[index]))) {
    await sessionManager.clearSession().catch(() => {});
    throw recoveryError('REKEY_CONCURRENT_WRITE', RECOVERY_ERROR_MESSAGE.REKEY_CONCURRENT_WRITE);
  }

  if (mode === 'recovery') await lockSession();
  const recoveryToWrite = replacementRecovery
    ? {
        [STORAGE_KEYS.RECOVERY_CONFIG]: {
          version: replacementRecovery.version,
          id: replacementRecovery.id,
          createdAt: replacementRecovery.createdAt,
          wrappedDataKey: replacementRecovery.wrappedDataKey,
        },
      }
    : {};
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PASSWORDS]: reEncryptedPasswords,
      [STORAGE_KEYS.TRASH]: reEncryptedTrash,
      [STORAGE_KEYS.PASSWORD_HISTORY]: reEncryptedHistory,
      [STORAGE_KEYS.IDENTITY]: reEncryptedIdentity,
      [STORAGE_KEYS.IDENTITY_TRASH]: reEncryptedIdentityTrash,
      [STORAGE_KEYS.MASTER_PASSWORD]: newMasterConfig,
      ...recoveryToWrite,
      ...sessionKeysToWrite,
    });
  } catch (error) {
    await sessionManager.clearSession().catch(() => {});
    throw error;
  }
  if (mode === 'password-change') {
    // 提交点已越过：数据、校验哈希与新包裹密钥都已落盘。发布会话材料失败不得伪装成
    // 「未提交」错误——否则用户以为旧密码仍有效，重试必然失败。
    try {
      await sessionManager.publishSessionRekey(newKey, sessionKeysToWrite);
    } catch (error) {
      logger.error('Post-commit session refresh failed; forcing relock:', error);
      await sessionManager.clearSession().catch(() => {});
      return 'relock-required';
    }
    // 只剩旧版遗留 blob 清理：失败不影响一致性，记日志即可，不得反向推翻「已改密」。
    await chrome.storage.local.remove(SESSION_STORAGE_KEYS.MASTER_PASSWORD).catch(error => {
      logger.warn('Legacy session master-password cleanup failed:', error);
    });
  }
  logger.info('Vault key change committed');
}
