import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE } from '@/utils/types';

let capturedParts: BlobPart[] = [];

beforeEach(() => {
  capturedParts = [];
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('document', {
    createElement: () => ({ click: vi.fn(), style: {} }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  const OriginalBlob = globalThis.Blob;
  vi.stubGlobal(
    'Blob',
    class extends OriginalBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        capturedParts = parts;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

import { exportEncryptedBackup, importEncryptedBackup } from '@/utils/backupExport';

const GROUPS: PasswordGroup[] = [
  { code: 'work', name: 'Work', parentCode: ROOT_GROUP_CODE, order: 0 },
  { code: 'proj', name: 'Project A', parentCode: 'work', order: 0 },
];

const toFile = async (): Promise<File> => {
  const blob = new Blob(capturedParts);
  return new File([await blob.arrayBuffer()], 'backup.aph');
};

describe('.aph backup groups', () => {
  it('restores the group tree and entry ownership after a v2 round trip', async () => {
    await exportEncryptedBackup(
      [makePasswordEntry({ id: '1', username: 'a', groupId: 'proj' })],
      'master-pass',
      GROUPS,
    );

    const result = await importEncryptedBackup(await toFile(), 'master-pass');

    expect(result.groups.map(group => group.name)).toEqual(['Work', 'Project A']);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].groupId).toBe('proj');
    expect(result.groups.find(group => group.name === 'Project A')?.parentCode).toBe('work');
  });

  it('exports and imports empty groups when no groups are provided', async () => {
    await exportEncryptedBackup([makePasswordEntry({ id: '1' })], 'master-pass');

    const result = await importEncryptedBackup(await toFile(), 'master-pass');

    expect(result.groups).toEqual([]);
    expect(result.entries[0].groupId).toBeUndefined();
  });

  it('imports v1 backups with ungrouped entries', async () => {
    const v1Payload = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      count: 1,
      entries: [{ username: 'a', password: 'p', url: '', tag: '', remark: '', createTime: 0, updateTime: 0 }],
    });
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode('master-pass'), 'PBKDF2', false, [
      'deriveKey',
    ]);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 600_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(v1Payload));
    const output = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    output.set(salt, 0);
    output.set(iv, salt.length);
    output.set(new Uint8Array(ciphertext), salt.length + iv.length);

    const result = await importEncryptedBackup(new File([output], 'old.aph'), 'master-pass');

    expect(result.groups).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].groupId).toBeUndefined();
  });

  it('still rejects a wrong password', async () => {
    await exportEncryptedBackup([makePasswordEntry({ id: '1' })], 'master-pass', GROUPS);

    await expect(importEncryptedBackup(await toFile(), 'wrong-pass')).rejects.toThrow();
  });
});
