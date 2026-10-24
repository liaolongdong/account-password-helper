const VAULT_WRITE_LOCK = 'aph-vault-key-transition';

/** Shared, non-queued leases allow nested writers without deadlocking behind a key transition. */
export function withVaultMutation<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(VAULT_WRITE_LOCK, { mode: 'shared', ifAvailable: true }, async lock => {
    if (!lock) throw Object.assign(new Error('Vault is busy changing keys'), { code: 'VAULT_BUSY' });
    return operation();
  });
}

export function withVaultKeyTransition<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request(VAULT_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw Object.assign(new Error('Vault has an unfinished write'), { code: 'VAULT_BUSY' });
    return operation();
  });
}
