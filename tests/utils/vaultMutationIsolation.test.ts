import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';
import { withVaultKeyTransition } from '@/utils/storage/vaultWriteLock';

vi.mock('@/utils/browserStartupRelock', () => ({
  waitForBrowserStartupRelockBeforeAuthentication: vi.fn(async () => true),
  recoverBrowserStartupRelockAfterAuthentication: vi.fn(async () => true),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const key = '11'.repeat(32);
const wrapKey = '22'.repeat(32);

beforeEach(async () => {
  vi.resetModules();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  const { encryptData, encryptPasswordEntry } = await import('@/utils/encryption');
  const { SESSION_STORAGE_KEYS } = await import('@/utils/sessionManager-storage');
  const entry = await encryptPasswordEntry(makePasswordEntry({ id: 'p1' }), '', key);
  await chrome.storage.local.set({
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: await encryptData(key, wrapKey),
    [SESSION_STORAGE_KEYS.WRAP_KEY]: wrapKey,
    [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 60_000,
    [STORAGE_KEYS.PASSWORDS]: [entry],
    [STORAGE_KEYS.TRASH]: [{ ...entry, id: 't1', deletedAt: 1 }],
    [STORAGE_KEYS.PASSWORD_HISTORY]: [{ entryId: 't1', password: entry.password, changedAt: 1 }],
    [STORAGE_KEYS.IDENTITY]: [{ id: 'i1', encryptedPayload: 'cipher', createTime: 1, updateTime: 1 }],
    [STORAGE_KEYS.IDENTITY_TRASH]: [
      { id: 'it1', encryptedPayload: 'cipher', createTime: 1, updateTime: 1, deletedAt: 1 },
    ],
  });
  await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.DATA_KEY]: key });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function writers() {
  const passwords = await import('@/utils/storage/passwordCrud');
  const trash = await import('@/utils/storage/trashManager');
  const history = await import('@/utils/storage/passwordHistory');
  const identities = await import('@/utils/storage/identityCrud');
  const identityTrash = await import('@/utils/storage/identityTrashManager');
  const master = await import('@/utils/storage/masterPassword');
  const session = await import('@/utils/sessionManager-storage');
  const auto = await import('@/utils/storage/autoSaveManager');
  return {
    savePassword: () => passwords.savePassword(makePasswordEntry()),
    batchSavePasswords: () => passwords.batchSavePasswords([makePasswordEntry()]),
    updatePassword: () => passwords.updatePassword('p1', { favorite: true }),
    batchUpdatePasswordMetadata: () =>
      passwords.batchUpdatePasswordMetadata([{ id: 'p1', updates: { favorite: true } }]),
    moveToTrash: () => trash.moveToTrash(['p1']),
    restoreFromTrash: () => trash.restoreFromTrash(['t1']),
    permanentDeleteFromTrash: () => trash.permanentDeleteFromTrash(['t1']),
    emptyTrash: () => trash.emptyTrash(),
    cleanExpiredTrash: () => trash.cleanExpiredTrash(),
    replaceAllTrash: () => trash.replaceAllTrash([]),
    snapshotPasswordHistory: () => history.snapshotPasswordHistory('p1', 'cipher'),
    deleteHistoryByEntryId: () => history.deleteHistoryByEntryId('t1'),
    deleteHistoryByEntryIds: () => history.deleteHistoryByEntryIds(['t1']),
    replaceAllHistory: () => history.replaceAllHistory([]),
    saveIdentity: () => identities.saveIdentity({ pv: 1, category: 'person', name: 'fixture' }),
    updateIdentity: () => identities.updateIdentity('i1', { name: 'updated' }, 1),
    replaceAllIdentity: () => identities.replaceAllIdentity([]),
    replaceAllIdentityRaw: () => identities.replaceAllIdentityRaw([]),
    moveIdentitiesToTrash: () => identityTrash.moveIdentitiesToTrash(['i1']),
    restoreIdentitiesFromTrash: () => identityTrash.restoreIdentitiesFromTrash(['it1']),
    permanentDeleteIdentitiesFromTrash: () => identityTrash.permanentDeleteIdentitiesFromTrash(['it1']),
    emptyIdentityTrash: () => identityTrash.emptyIdentityTrash(),
    cleanExpiredIdentityTrash: () => identityTrash.cleanExpiredIdentityTrash(),
    setMasterPassword: () => master.setMasterPassword('fixture-master'),
    verifyMasterPassword: () => master.verifyMasterPassword('fixture-master'),
    resetMasterPassword: () => master.resetMasterPassword(),
    clearAllData: () => master.clearAllData(),
    createSession: () => session.createSession('fixture-master', 24),
    autoSavePassword: () =>
      auto.autoSavePassword({
        username: 'fixture',
        password: 'new',
        url: 'example.com',
        tag: '',
        remark: '',
        tagEdited: false,
        remarkEdited: false,
      }),
  };
}

describe('ordinary vault writers vs real exclusive key transition', () => {
  it('does not start any read-modify-write or raw write while exclusive is held', async () => {
    const operations = await writers();
    await withVaultKeyTransition(async () => {
      const get = vi.spyOn(chrome.storage.local, 'get');
      const set = vi.spyOn(chrome.storage.local, 'set');
      const remove = vi.spyOn(chrome.storage.local, 'remove');
      const clear = vi.spyOn(chrome.storage.local, 'clear');
      for (const [name, operation] of Object.entries(operations)) {
        await Promise.allSettled([operation()]);
        expect(get, `${name} read while exclusive was held`).not.toHaveBeenCalled();
        expect(set, `${name} wrote while exclusive was held`).not.toHaveBeenCalled();
        expect(remove, `${name} removed while exclusive was held`).not.toHaveBeenCalled();
        expect(clear, `${name} cleared while exclusive was held`).not.toHaveBeenCalled();
      }
    });
  });

  it.each([
    'savePassword',
    'moveToTrash',
    'restoreFromTrash',
    'snapshotPasswordHistory',
    'saveIdentity',
    'moveIdentitiesToTrash',
    'autoSavePassword',
  ] as const)('%s holds the lease from its first read through its write', async name => {
    const operations = await writers();
    const entered = deferred();
    const finishRead = deferred();
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'get').mockImplementationOnce(async keys => {
      const snapshot = await get(keys);
      entered.resolve();
      await finishRead.promise;
      return snapshot;
    });
    const operation = operations[name]();
    await entered.promise;
    try {
      await expect(withVaultKeyTransition(async () => 'transition')).rejects.toMatchObject({ code: 'VAULT_BUSY' });
    } finally {
      finishRead.resolve();
      await operation;
    }
    await expect(withVaultKeyTransition(async () => 'transition')).resolves.toBe('transition');
  });

  it('updatePassword settles history before its lease ends', async () => {
    const { updatePassword } = await import('@/utils/storage/passwordCrud');
    const historyStarted = deferred();
    const finishHistory = deferred();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async items => {
      if (STORAGE_KEYS.PASSWORD_HISTORY in items) {
        historyStarted.resolve();
        await finishHistory.promise;
      }
      await set(items);
    });
    let completed = false;
    const updating = updatePassword('p1', { password: 'new-fixture-password' }).then(() => {
      completed = true;
    });
    await historyStarted.promise;
    try {
      await expect(withVaultKeyTransition(async () => 'transition')).rejects.toMatchObject({ code: 'VAULT_BUSY' });
      expect(completed).toBe(false);
    } finally {
      finishHistory.resolve();
      await updating;
    }
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PASSWORD_HISTORY);
    expect(stored[STORAGE_KEYS.PASSWORD_HISTORY]).toHaveLength(2);
    await expect(withVaultKeyTransition(async () => 'transition')).resolves.toBe('transition');
  });

  it('history storage failure remains nonfatal to password update', async () => {
    const { updatePassword, getAllPasswords } = await import('@/utils/storage/passwordCrud');
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async items => {
      if (STORAGE_KEYS.PASSWORD_HISTORY in items) throw new Error('history write failed');
      await set(items);
    });
    await updatePassword('p1', { password: 'new-fixture-password' });
    expect((await getAllPasswords())[0].password).toBe('new-fixture-password');
  });

  it('debounced metadata flush cannot rewrite ciphertext during exclusive transition', async () => {
    const { updatePasswordInSession } = await import('@/utils/storage/passwordCrud');
    vi.useFakeTimers();
    const update = updatePasswordInSession('p1', { favorite: true });
    await withVaultKeyTransition(async () => {
      const set = vi.spyOn(chrome.storage.local, 'set');
      await vi.advanceTimersByTimeAsync(1500);
      await update;
      expect(set).not.toHaveBeenCalled();
    });
  });
});
