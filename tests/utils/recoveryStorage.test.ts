import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import {
  deriveEncryptionKey,
  deriveVerifierHash,
  encryptData,
  encryptPasswordEntry,
  decryptData,
  decryptPasswordEntry,
} from '@/utils/encryption';
import { verifyMasterPassword } from '@/utils/storage/masterPassword';
import { changeMasterPassword } from '@/utils/storage/changeMasterPassword';
import { unwrapRecoveryDataKey } from '@/utils/recoveryCrypto';
import { withVaultMutation } from '@/utils/storage/vaultWriteLock';
import type { EncryptedPasswordEntry, MasterPasswordConfig, PasswordHistoryRecord } from '@/utils/types';
import type { IdentityRecord, TrashedIdentityRecord } from '@/utils/identity/types';
import {
  getRecoveryStatus,
  prepareRecoveryEnrollment,
  activateRecovery,
  disableRecovery,
  preparePasswordRecovery,
  recoverMasterPassword,
  prepareChangedPasswordRecovery,
} from '@/utils/storage/recovery';

const OLD_PASSWORD = 'Old-test-vault!123';
const NEW_PASSWORD = 'New-test-vault!456';
const IDENTITY = { pv: 1, category: 'person', name: 'Fictional recovery fixture' };
const PASSWORD = makePasswordEntry({
  id: 'recovery-password',
  password: 'Fixture-password!789',
  username: 'fixture-user',
  totp: 'JBSWY3DPEHPK3PXP',
});
let oldConfig: MasterPasswordConfig;
let oldKey: string;
let seed: Record<string, unknown>;

beforeAll(async () => {
  const salt = '11223344556677889900aabbccddeeff';
  oldConfig = {
    salt,
    hashedPassword: await deriveVerifierHash(OLD_PASSWORD, salt),
    kdf: 'pbkdf2-sha256',
    hint: 'old fixture hint',
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_PASSWORD]: oldConfig });
  oldKey = await deriveEncryptionKey(OLD_PASSWORD);
  const password = await encryptPasswordEntry(PASSWORD, '', oldKey);
  const encryptedPayload = await encryptData(JSON.stringify(IDENTITY), oldKey);
  seed = {
    [STORAGE_KEYS.MASTER_PASSWORD]: oldConfig,
    [STORAGE_KEYS.PASSWORDS]: [password],
    [STORAGE_KEYS.TRASH]: [{ ...password, id: 'trashed-password', deletedAt: Date.now() }],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [
      { entryId: PASSWORD.id, password: await encryptData('Fixture-history!456', oldKey), changedAt: Date.now() },
    ],
    [STORAGE_KEYS.IDENTITY]: [{ id: 'identity', encryptedPayload, createTime: 1, updateTime: 1 }],
    [STORAGE_KEYS.IDENTITY_TRASH]: [
      { id: 'trashed-identity', encryptedPayload, createTime: 1, updateTime: 1, deletedAt: Date.now() },
    ],
  };
}, 90_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set(structuredClone(seed));
});

async function enroll() {
  const draft = await prepareRecoveryEnrollment(OLD_PASSWORD);
  await activateRecovery(OLD_PASSWORD, draft, draft.material.recoveryKey);
  return draft;
}

async function assertFiveDomains(password: string) {
  const key = await deriveEncryptionKey(password);
  const stored = await chrome.storage.local.get(null);
  const passwords = stored[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[];
  expect(await decryptPasswordEntry(passwords[0], '', key)).toEqual(PASSWORD);
  const trash = stored[STORAGE_KEYS.TRASH] as (EncryptedPasswordEntry & { deletedAt: number })[];
  expect((await decryptPasswordEntry(trash[0], '', key)).password).toBe(PASSWORD.password);
  expect(trash[0].deletedAt).toBe((seed[STORAGE_KEYS.TRASH] as { deletedAt: number }[])[0].deletedAt);
  const history = stored[STORAGE_KEYS.PASSWORD_HISTORY] as PasswordHistoryRecord[];
  expect(await decryptData(history[0].password, key)).toBe('Fixture-history!456');
  for (const storageKey of [STORAGE_KEYS.IDENTITY, STORAGE_KEYS.IDENTITY_TRASH]) {
    const entries = stored[storageKey] as IdentityRecord[];
    expect(JSON.parse(await decryptData(entries[0].encryptedPayload, key))).toEqual(IDENTITY);
  }
  expect((stored[STORAGE_KEYS.IDENTITY_TRASH] as TrashedIdentityRecord[])[0].deletedAt).toBe(
    (seed[STORAGE_KEYS.IDENTITY_TRASH] as TrashedIdentityRecord[])[0].deletedAt,
  );
}

describe('offline recovery enrollment', () => {
  it('is opt-in and does not write a draft before the saved key is verified', async () => {
    expect(await getRecoveryStatus()).toEqual({ enabled: false, config: null, corrupted: false });
    const before = await chrome.storage.local.get(null);
    const draft = await prepareRecoveryEnrollment(OLD_PASSWORD);
    expect(await chrome.storage.local.get(null)).toEqual(before);
    await expect(activateRecovery(OLD_PASSWORD, draft, 'wrong')).rejects.toMatchObject({ code: 'RECOVERY_INVALID' });
    expect(await chrome.storage.local.get(null)).toEqual(before);
    await activateRecovery(OLD_PASSWORD, draft, draft.material.recoveryKey);
    expect(await getRecoveryStatus()).toMatchObject({
      enabled: true,
      config: { id: draft.material.config.id },
      corrupted: false,
    });
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toContain(draft.material.recoveryKey);
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toContain(oldKey);
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toContain(OLD_PASSWORD);
  }, 90_000);

  it('requires the current master password to create, activate or disable recovery', async () => {
    await expect(prepareRecoveryEnrollment('wrong')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    const draft = await enroll();
    await expect(activateRecovery('wrong', draft, draft.material.recoveryKey)).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
    await expect(disableRecovery('wrong')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect((await getRecoveryStatus()).enabled).toBe(true);
    await disableRecovery(OLD_PASSWORD);
    expect((await getRecoveryStatus()).enabled).toBe(false);
    await expect(preparePasswordRecovery(draft.material.recoveryKey, NEW_PASSWORD)).rejects.toMatchObject({
      code: 'RECOVERY_DISABLED',
    });
  }, 90_000);

  it('rejects a stale enrollment draft instead of replacing newer recovery material', async () => {
    const older = await prepareRecoveryEnrollment(OLD_PASSWORD);
    const newer = await enroll();
    await expect(activateRecovery(OLD_PASSWORD, older, older.material.recoveryKey)).rejects.toMatchObject({
      code: 'RECOVERY_STALE',
    });
    expect((await getRecoveryStatus()).config?.id).toBe(newer.material.config.id);
  }, 90_000);
});

describe('offline recovery of the current vault', () => {
  it('recovers all five domains, rotates the recovery kit, and stays locked', async () => {
    const enrolled = await enroll();
    const before = await chrome.storage.local.get(null);
    const replacement = await preparePasswordRecovery(enrolled.material.recoveryKey, NEW_PASSWORD);
    expect(await chrome.storage.local.get(null)).toEqual(before);
    await recoverMasterPassword(
      enrolled.material.recoveryKey,
      NEW_PASSWORD,
      replacement,
      replacement.material.recoveryKey,
    );
    expect(await verifyMasterPassword(OLD_PASSWORD)).toBe(false);
    expect(await verifyMasterPassword(NEW_PASSWORD)).toBe(true);
    await assertFiveDomains(NEW_PASSWORD);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
    const current = (await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD))[
      STORAGE_KEYS.MASTER_PASSWORD
    ] as MasterPasswordConfig;
    // 提示语必须活过恢复换钥：它没有编辑入口，一旦被整对象覆写吃掉就永久消失。
    expect(current.hint).toBe('old fixture hint');
    expect(
      await unwrapRecoveryDataKey((await getRecoveryStatus()).config, replacement.material.recoveryKey, current),
    ).toBe(await deriveEncryptionKey(NEW_PASSWORD));
    await expect(preparePasswordRecovery(enrolled.material.recoveryKey, 'Another-test!789')).rejects.toMatchObject({
      code: 'RECOVERY_INVALID',
    });
  }, 90_000);

  it('does not touch the vault for a wrong key or an unverified replacement kit', async () => {
    const enrolled = await enroll();
    const before = await chrome.storage.local.get(null);
    await expect(preparePasswordRecovery('wrong', NEW_PASSWORD)).rejects.toMatchObject({ code: 'RECOVERY_INVALID' });
    const replacement = await preparePasswordRecovery(enrolled.material.recoveryKey, NEW_PASSWORD);
    await expect(
      recoverMasterPassword(enrolled.material.recoveryKey, NEW_PASSWORD, replacement, 'wrong'),
    ).rejects.toMatchObject({ code: 'RECOVERY_INVALID' });
    expect(await chrome.storage.local.get(null)).toEqual(before);
  }, 90_000);

  it('refuses incomplete decryption rather than reporting success with stranded identity data', async () => {
    const enrolled = await enroll();
    const replacement = await preparePasswordRecovery(enrolled.material.recoveryKey, NEW_PASSWORD);
    await chrome.storage.local.set({
      [STORAGE_KEYS.IDENTITY_TRASH]: [
        { id: 'broken', encryptedPayload: 'invalid', createTime: 1, updateTime: 1, deletedAt: 1 },
      ],
    });
    const before = await chrome.storage.local.get(null);
    await expect(
      recoverMasterPassword(enrolled.material.recoveryKey, NEW_PASSWORD, replacement, replacement.material.recoveryKey),
    ).rejects.toMatchObject({ code: 'RECOVERY_INCOMPLETE' });
    expect(await chrome.storage.local.get(null)).toEqual(before);
  }, 90_000);

  it('carries the undecryptable record through and recovers everything else once the user consents', async () => {
    const enrolled = await enroll();
    const replacement = await preparePasswordRecovery(enrolled.material.recoveryKey, NEW_PASSWORD);
    const broken = { id: 'broken', encryptedPayload: 'invalid', createTime: 1, updateTime: 1, deletedAt: 1 };
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY_TRASH]: [broken] });

    await recoverMasterPassword(
      enrolled.material.recoveryKey,
      NEW_PASSWORD,
      replacement,
      replacement.material.recoveryKey,
      true,
    );

    const after = (await chrome.storage.local.get(null)) as Record<string, unknown>;
    // 坏记录原样携带：字节一个不动，既不重加密也不删除。
    expect(after[STORAGE_KEYS.IDENTITY_TRASH]).toEqual([broken]);

    // 其余各域确实换到了新数据密钥——这才是这扇门存在的理由：
    // 一条坏记录不该把用户逼回「清空全部」这条唯一出路。
    const newKey = await deriveEncryptionKey(NEW_PASSWORD);
    const passwords = after[STORAGE_KEYS.PASSWORDS] as EncryptedPasswordEntry[];
    const restored = await decryptPasswordEntry(passwords[0], '', newKey);
    expect(restored.password).toBe(PASSWORD.password);
    const identities = after[STORAGE_KEYS.IDENTITY] as IdentityRecord[];
    expect(JSON.parse(await decryptData(identities[0].encryptedPayload, newKey))).toEqual(IDENTITY);
    expect(await verifyMasterPassword(NEW_PASSWORD)).toBe(true);
    // 旧主密码不再能验证：换钥是真的提交了，不是半途状态
    expect(await verifyMasterPassword(OLD_PASSWORD)).toBe(false);
  }, 90_000);

  it('rejects recovery while an ordinary write is running', async () => {
    const enrolled = await enroll();
    const replacement = await preparePasswordRecovery(enrolled.material.recoveryKey, NEW_PASSWORD);
    await withVaultMutation(async () => {
      await expect(
        recoverMasterPassword(
          enrolled.material.recoveryKey,
          NEW_PASSWORD,
          replacement,
          replacement.material.recoveryKey,
        ),
      ).rejects.toMatchObject({ code: 'VAULT_BUSY' });
    });
    await assertFiveDomains(OLD_PASSWORD);
  }, 90_000);

  it('keeps the old ciphertext and usable old kit if the final write fails', async () => {
    const enrolled = await enroll();
    const replacement = await preparePasswordRecovery(enrolled.material.recoveryKey, NEW_PASSWORD);
    const before = await chrome.storage.local.get(null);
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    const failingSet = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async items => {
      if (STORAGE_KEYS.MASTER_PASSWORD in items && STORAGE_KEYS.PASSWORDS in items) throw new Error('storage failure');
      await originalSet(items);
    });
    await expect(
      recoverMasterPassword(enrolled.material.recoveryKey, NEW_PASSWORD, replacement, replacement.material.recoveryKey),
    ).rejects.toThrow('storage failure');
    failingSet.mockRestore();
    expect(await chrome.storage.local.get(null)).toEqual(before);
    expect(
      await unwrapRecoveryDataKey((await getRecoveryStatus()).config, enrolled.material.recoveryKey, oldConfig),
    ).toBe(oldKey);
  }, 90_000);
});

describe('password changes with recovery enabled', () => {
  it('does not silently invalidate recovery: it requires a saved replacement kit', async () => {
    const enrolled = await enroll();
    await expect(changeMasterPassword(OLD_PASSWORD, NEW_PASSWORD)).rejects.toMatchObject({
      code: 'RECOVERY_REPLACEMENT_REQUIRED',
    });
    const draft = await prepareChangedPasswordRecovery(OLD_PASSWORD, NEW_PASSWORD);
    expect(draft).not.toBeNull();
    await changeMasterPassword(OLD_PASSWORD, NEW_PASSWORD, {
      draft: draft!,
      confirmation: draft!.material.recoveryKey,
    });
    await assertFiveDomains(NEW_PASSWORD);
    const config = (await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD))[
      STORAGE_KEYS.MASTER_PASSWORD
    ] as MasterPasswordConfig;
    expect(await unwrapRecoveryDataKey((await getRecoveryStatus()).config, draft!.material.recoveryKey, config)).toBe(
      await deriveEncryptionKey(NEW_PASSWORD),
    );
    await expect(
      unwrapRecoveryDataKey((await getRecoveryStatus()).config, enrolled.material.recoveryKey, config),
    ).rejects.toMatchObject({ code: 'RECOVERY_INVALID' });
  }, 90_000);

  it('does not create recovery for users who have not opted in', async () => {
    expect(await prepareChangedPasswordRecovery(OLD_PASSWORD, NEW_PASSWORD)).toBeNull();
    await changeMasterPassword(OLD_PASSWORD, NEW_PASSWORD);
    expect((await getRecoveryStatus()).enabled).toBe(false);
    await assertFiveDomains(NEW_PASSWORD);
  }, 90_000);
});

describe('recovery review regressions', () => {
  it('refuses to prepare recovery using the unchanged master password', async () => {
    const enrolled = await enroll();
    await expect(preparePasswordRecovery(enrolled.material.recoveryKey, OLD_PASSWORD)).rejects.toMatchObject({
      code: 'RECOVERY_SAME_PASSWORD',
    });
  }, 90_000);

  it('refuses the unchanged key at commit even with a valid replacement kit', async () => {
    const enrolled = await enroll();
    const { createRecoveryMaterial } = await import('@/utils/recoveryCrypto');
    const replacement = {
      ...enrolled,
      sourceRecoveryId: enrolled.material.config.id,
      material: await createRecoveryMaterial(oldKey, oldConfig),
    };
    const before = await chrome.storage.local.get(null);
    await expect(
      recoverMasterPassword(enrolled.material.recoveryKey, OLD_PASSWORD, replacement, replacement.material.recoveryKey),
    ).rejects.toMatchObject({ code: 'RECOVERY_SAME_PASSWORD' });
    expect(await chrome.storage.local.get(null)).toEqual(before);
  }, 90_000);

  it('does not issue a replacement for a no-op password change', async () => {
    await enroll();
    await expect(prepareChangedPasswordRecovery(OLD_PASSWORD, OLD_PASSWORD)).rejects.toMatchObject({
      code: 'RECOVERY_SAME_PASSWORD',
    });
    await expect(changeMasterPassword(OLD_PASSWORD, OLD_PASSWORD)).rejects.toMatchObject({
      code: 'RECOVERY_SAME_PASSWORD',
    });
  }, 90_000);

  it.each([
    STORAGE_KEYS.PASSWORDS,
    STORAGE_KEYS.TRASH,
    STORAGE_KEYS.PASSWORD_HISTORY,
    STORAGE_KEYS.IDENTITY,
    STORAGE_KEYS.IDENTITY_TRASH,
  ])(
    'does not treat an array-like %s domain as an empty vault',
    async storageKey => {
      const { commitVaultRekey } = await import('@/utils/storage/changeMasterPassword');
      const { withVaultKeyTransition } = await import('@/utils/storage/vaultWriteLock');
      await chrome.storage.local.set({ [storageKey]: { 0: (seed[storageKey] as unknown[])[0], length: 0 } });
      const before = await chrome.storage.local.get(null);
      await expect(
        withVaultKeyTransition(() =>
          commitVaultRekey({ oldKey, newKey: oldKey, newMasterConfig: oldConfig, mode: 'recovery' }),
        ),
      ).rejects.toMatchObject({ code: 'RECOVERY_INCOMPLETE' });
      expect(await chrome.storage.local.get(null)).toEqual(before);
    },
    90_000,
  );
});
