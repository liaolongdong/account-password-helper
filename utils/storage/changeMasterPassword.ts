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
  normalizeNewMasterPassword,
  readVaultRecoverySnapshot,
  recoveryError,
  verifyRecoveryReplacement,
  RECOVERY_ERROR_MESSAGE,
} from './recoveryState';
import type { RecoveryConfirmation, VaultRekeyRequest } from './recoveryTypes';
import { VAULT_ERROR_CODES } from '@/utils/recoveryTypes';

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
  if (corrupted)
    throw recoveryError(
      mode === 'recovery' ? VAULT_ERROR_CODES.RECOVERY_INCOMPLETE : VAULT_ERROR_CODES.VAULT_DATA_CORRUPTED,
    );
}

export async function changeMasterPassword(
  oldPassword: string,
  newPassword: string,
  replacement?: RecoveryConfirmation,
): Promise<'relock-required' | void> {
  const oldPw = String(oldPassword || '').trim();
  const newPw = String(newPassword || '').trim();
  if (!newPw) throw recoveryError(VAULT_ERROR_CODES.EMPTY_PASSWORD, RECOVERY_ERROR_MESSAGE.EMPTY_PASSWORD);
  // 主密码强度就是数据密钥强度，必须在存储层收口，不能只靠弹窗：创建时要求四条规则全通过，
  // 换钥时若只判 `level !== 'weak'`（通过数 ≥2 即算 medium），等于开了一条
  // 「把整库降级到比首次设置更弱的密钥」的通道，且会让同一串密码在启用/未启用离线恢复时
  // 得到两种结果。与恢复链路共用 `normalizeNewMasterPassword` 这一道门槛。
  // 位置与空密码校验并列：先拒形态再验旧密，避免为注定失败的提交付一次 PBKDF2。
  normalizeNewMasterPassword(newPw);
  const authorized = await withVaultMutation(async () => {
    if (!(await verifyMasterPassword(oldPw)))
      throw recoveryError(VAULT_ERROR_CODES.WRONG_PASSWORD, RECOVERY_ERROR_MESSAGE.WRONG_PASSWORD);
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
    if (hasRecovery && !replacement) throw recoveryError(VAULT_ERROR_CODES.RECOVERY_REPLACEMENT_REQUIRED);
    if (!hasRecovery && replacement) throw recoveryError(VAULT_ERROR_CODES.RECOVERY_STALE);
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
    if (mode === 'recovery') throw recoveryError(VAULT_ERROR_CODES.RECOVERY_INCOMPLETE);
    throw error;
  }

  const historyOutcomes = await mapWithConcurrency(rawHistory, async record => {
    try {
      return { plainPassword: await encryption.decryptData(record.password, oldKey) };
    } catch {
      if (mode === 'recovery') throw recoveryError(VAULT_ERROR_CODES.RECOVERY_INCOMPLETE);
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
        throw recoveryError(VAULT_ERROR_CODES.RECOVERY_INCOMPLETE);
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
  // 会话键基线：`prepareSessionRekey` 的产物是「即将随密文一起落盘的新会话材料」，
  // 而从准备到原子写之间隔着整轮加解密（2000 条量级为秒级）。这期间任何一次锁定或
  // 会话重建都必须让本次提交作废——否则用户点了「立即锁定」，会被这批早已备好的键
  // 复活成有效会话。`clearSession` 刻意不在租约内（它同时是恢复流程自己的提交步骤），
  // 所以这段窗口用读数比对兜住。
  const sessionGuardKeys = [
    SESSION_STORAGE_KEYS.WRAP_KEY,
    SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
    SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    SESSION_STORAGE_KEYS.VALIDITY_HOURS,
  ];
  const sessionBefore = await chrome.storage.local.get(sessionGuardKeys);
  let sessionKeysToWrite: Record<string, unknown> = {};
  if (mode === 'password-change') {
    const sessionResult = await chrome.storage.local.get(SESSION_STORAGE_KEYS.VALIDITY_HOURS);
    const validityHours = (sessionResult[SESSION_STORAGE_KEYS.VALIDITY_HOURS] as number | undefined) || 24;
    sessionKeysToWrite = await sessionManager.prepareSessionRekey(newKey, validityHours);
  }

  const [fresh, sessionAfter] = await Promise.all([
    Promise.all([
      getAllPasswordsRaw(),
      getAllTrashRaw(),
      getAllHistoryRaw(),
      getAllIdentityRaw(),
      getAllIdentityTrashRaw(),
    ]),
    chrome.storage.local.get(sessionGuardKeys),
  ]);
  const original = [rawPasswords, rawTrash, rawHistory, identityRaw, identityTrashRaw];
  const sessionMoved = sessionGuardKeys.some(key => sessionBefore[key] !== sessionAfter[key]);
  // 比对保持逐字节：换成「条数 + id 集合 + max(updateTime)」指纹能省掉 2000 条下约 40～80ms
  // 的同步 stringify，但那段开销被四次 PBKDF2（本机每台 ~2.4s）完全淹没，省它等于拿
  // 「新密文 + 旧会话密钥」这条数据完整性守卫去换一位数百分比的换钥耗时。
  if (sessionMoved || original.some((records, index) => JSON.stringify(records) !== JSON.stringify(fresh[index]))) {
    await sessionManager.clearSession().catch(() => {});
    throw recoveryError(VAULT_ERROR_CODES.REKEY_CONCURRENT_WRITE, RECOVERY_ERROR_MESSAGE.REKEY_CONCURRENT_WRITE);
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
