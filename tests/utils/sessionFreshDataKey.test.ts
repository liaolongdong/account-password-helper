import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';
import { withVaultKeyTransition, withVaultMutation } from '@/utils/storage/vaultWriteLock';

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

const oldKey = '11'.repeat(32);
const newKey = '33'.repeat(32);
const wrapKey = '22'.repeat(32);

beforeEach(async () => {
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function publishKey(key: string, expiry = Date.now() + 60_000) {
  const { SESSION_STORAGE_KEYS } = await import('@/utils/sessionManager-storage');
  const { encryptData } = await import('@/utils/encryption');
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEYS.WRAP_KEY]: wrapKey,
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: await encryptData(key, wrapKey),
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: expiry,
  });
}

async function seedOldCache() {
  await publishKey(oldKey);
  await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: oldKey });
  const session = await import('@/utils/sessionManager-storage');
  expect(await session.getSessionDataKey()).toBe(oldKey);
  return session;
}

describe('fresh write keys under a shared lease', () => {
  it('forceFresh ignores both stale memory and storage.session keys', async () => {
    const session = await seedOldCache();
    await withVaultKeyTransition(() => publishKey(newKey));
    expect(await session.getSessionDataKey()).toBe(oldKey); // default read fast path is unchanged
    expect(await withVaultMutation(() => session.getSessionDataKey(true))).toBe(newKey);
    expect(await session.getSessionDataKey()).toBe(newKey);
  });

  /**
   * fresh 读要的是「以盘上当前状态为准」，不是「每次重算一遍」。
   *
   * 一次网页自动保存会经两次 fresh 读（外层匹配查询 + 内层保存）；盘上配对令牌未变时
   * 第二次必须复用内存镜像，否则白付一次 AES-GCM 与一次 storage.session 写。
   * 而令牌一变（别的上下文换了钥），就必须重新解包，不得沿用镜像。
   */
  it('reuses the mirrored key on a second fresh read until the pairing token changes', async () => {
    const session = await seedOldCache();
    const enc = await import('@/utils/encryption');
    const decrypt = vi.spyOn(enc, 'decryptData');

    expect(await withVaultMutation(() => session.getSessionDataKey(true))).toBe(oldKey);
    expect(decrypt, '配对令牌未变仍重解了一遍').not.toHaveBeenCalled();

    await withVaultKeyTransition(() => publishKey(newKey));
    expect(await withVaultMutation(() => session.getSessionDataKey(true))).toBe(newKey);
    expect(decrypt, '换钥后没有重新解包，写路径会拿陈旧数据钥').toHaveBeenCalledTimes(1);
  });

  it.each([0, Number.NaN])('forceFresh rejects invalid/expired local expiry %s despite a cached key', async expiry => {
    const session = await seedOldCache();
    await publishKey(newKey, expiry);
    expect(await withVaultMutation(() => session.getSessionDataKey(true))).toBeNull();
  });

  it('forceFresh rejects missing wrapped material rather than returning cached DK', async () => {
    const session = await seedOldCache();
    await chrome.storage.local.remove(session.SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY);
    expect(await withVaultMutation(() => session.getSessionDataKey(true))).toBeNull();
  });

  it('forceFresh discards an unwrap completed after runtime invalidation', async () => {
    const session = await seedOldCache();
    await publishKey(newKey);
    const enc = await import('@/utils/encryption');
    const decrypt = enc.decryptData;
    vi.spyOn(enc, 'decryptData').mockImplementationOnce(async (cipher, key) => {
      const value = await decrypt(cipher, key);
      session.markSessionInvalid();
      return value;
    });
    expect(await withVaultMutation(() => session.getSessionDataKey(true))).toBeNull();
    expect((await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY]).toBe(oldKey);
  });

  it('password and identity writes encrypt with the current local DK after a missed rekey notification', async () => {
    await seedOldCache();
    await withVaultKeyTransition(() => publishKey(newKey));
    const { savePassword } = await import('@/utils/storage/passwordCrud');
    const { saveIdentity } = await import('@/utils/storage/identityCrud');
    const { decryptData } = await import('@/utils/encryption');
    await savePassword(makePasswordEntry({ password: 'new-password' }));
    const savedIdentity = await saveIdentity({ pv: 1, category: 'person', name: 'fixture' });
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const entries = stored[STORAGE_KEYS.PASSWORDS] as Array<{ password: string }>;
    expect(await decryptData(entries[0].password, newKey)).toBe('new-password');
    expect(JSON.parse(await decryptData(savedIdentity.encryptedPayload, newKey)).name).toBe('fixture');
  });

  it('at-rest migration uses fresh local DK instead of a stale memory key', async () => {
    const session = await seedOldCache();
    await publishKey(newKey);
    await chrome.storage.local.set({ [STORAGE_KEYS.PASSWORDS]: [makePasswordEntry({ password: 'legacy-plain' })] });
    await session.migrateUnencryptedEntries('');
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const entries = stored[STORAGE_KEYS.PASSWORDS] as Array<{ password: string }>;
    const { decryptData } = await import('@/utils/encryption');
    expect(await decryptData(entries[0].password, newKey)).toBe('legacy-plain');
  });

  it('late createSession rejects the old password after a completed key transition', async () => {
    const master = await import('@/utils/storage/masterPassword');
    const session = await import('@/utils/sessionManager-storage');
    const { hashPassword } = await import('@/utils/crypto-light');
    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: {
        salt: 'old-fixture-salt',
        hashedPassword: await hashPassword('old-fixture-password', 'old-fixture-salt'),
      },
    });
    expect(await master.verifyMasterPassword('old-fixture-password')).toBe(true);
    // Another context commits a new verifier before the previously authenticated UI creates its session.
    const salt = 'new-fixture-salt';
    const hashedPassword = await hashPassword('new-fixture-password', salt);
    await withVaultKeyTransition(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_PASSWORD]: { salt, hashedPassword } });
      await publishKey(newKey);
    });
    const before = await chrome.storage.local.get(null);
    await expect(session.createSession('old-fixture-password', 24)).rejects.toThrow();
    expect(await chrome.storage.local.get(null)).toEqual(before);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
  }, 30_000);

  it('legacy session migration holds a mutation lease until publication', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const enc = await import('@/utils/encryption');
    const { hashPassword } = await import('@/utils/crypto-light');
    const salt = 'legacy-fixture-salt';
    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: { salt, hashedPassword: await hashPassword('legacy-fixture', salt) },
      [session.SESSION_STORAGE_KEYS.MASTER_PASSWORD]: await enc.encryptData(
        'legacy-fixture',
        await enc.deriveSessionKey(salt),
      ),
      [session.SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 60_000,
    });
    let transitionOutcome: PromiseSettledResult<string>[] = [];
    vi.spyOn(enc, 'deriveEncryptionKey').mockImplementationOnce(async () => {
      transitionOutcome = await Promise.allSettled([withVaultKeyTransition(async () => 'transition')]);
      return newKey;
    });
    expect(await session.isSessionValid({ skipConsistencyCheck: true })).toBe(true);
    expect(transitionOutcome[0]).toMatchObject({ status: 'rejected', reason: { code: 'VAULT_BUSY' } });
  }, 30_000);

  it('createSession cannot publish DK after invalidation during derivation', async () => {
    const session = await import('@/utils/sessionManager-storage');
    const master = await import('@/utils/storage/masterPassword');
    const enc = await import('@/utils/encryption');
    // Authentication is not the boundary under test here; the derivation is the controlled asynchronous pause.
    vi.spyOn(master, 'verifyMasterPassword').mockResolvedValue(true);
    vi.spyOn(enc, 'deriveEncryptionKey').mockImplementationOnce(async () => {
      session.markSessionInvalid();
      return newKey;
    });
    await expect(session.createSession('fixture', 24)).rejects.toThrow();
    expect(
      (await chrome.storage.local.get(session.SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY))[
        session.SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY
      ],
    ).toBeUndefined();
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
    ).toBeUndefined();
  });

  it('explicit old passwords cannot encrypt new password or identity records under current salt', async () => {
    const { hashPassword } = await import('@/utils/crypto-light');
    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: {
        salt: 'fixture-salt',
        hashedPassword: await hashPassword('current-fixture-password', 'fixture-salt'),
      },
    });
    const { savePassword } = await import('@/utils/storage/passwordCrud');
    const { saveIdentity } = await import('@/utils/storage/identityCrud');
    await expect(savePassword(makePasswordEntry(), 'old-fixture-password')).rejects.toThrow();
    await expect(saveIdentity({ pv: 1, category: 'person' }, 'old-fixture-password')).rejects.toThrow();
    const stored = await chrome.storage.local.get([STORAGE_KEYS.PASSWORDS, STORAGE_KEYS.IDENTITY]);
    expect(stored[STORAGE_KEYS.PASSWORDS]).toBeUndefined();
    expect(stored[STORAGE_KEYS.IDENTITY]).toBeUndefined();
  }, 30_000);
});
