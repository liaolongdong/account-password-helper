import { describe, expect, it } from 'vitest';
import { withVaultMutation, withVaultKeyTransition } from '@/utils/storage/vaultWriteLock';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('vault write isolation', () => {
  it('allows nested ordinary mutations without deadlocking', async () => {
    await expect(withVaultMutation(() => withVaultMutation(async () => 'saved'))).resolves.toBe('saved');
  });

  it('refuses key transitions while a mutation is in progress', async () => {
    const started = deferred();
    const finish = deferred();
    const mutation = withVaultMutation(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    try {
      await expect(withVaultKeyTransition(async () => 'changed')).rejects.toMatchObject({ code: 'VAULT_BUSY' });
    } finally {
      finish.resolve();
      await mutation;
    }
    await expect(withVaultKeyTransition(async () => 'changed')).resolves.toBe('changed');
  });

  it('refuses writes and another transition until a key transition completes', async () => {
    const started = deferred();
    const finish = deferred();
    let writes = 0;
    const transition = withVaultKeyTransition(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    try {
      await expect(
        withVaultMutation(async () => {
          writes++;
        }),
      ).rejects.toMatchObject({ code: 'VAULT_BUSY' });
      await expect(
        withVaultKeyTransition(async () => {
          writes++;
        }),
      ).rejects.toMatchObject({ code: 'VAULT_BUSY' });
      expect(writes).toBe(0);
    } finally {
      finish.resolve();
      await transition;
    }
    await withVaultMutation(async () => {
      writes++;
    });
    expect(writes).toBe(1);
  });

  it('releases the lock when the operation fails', async () => {
    const failure = new Error('storage failed');
    await expect(
      withVaultKeyTransition(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(withVaultMutation(async () => 'saved')).resolves.toBe('saved');
  });
});
