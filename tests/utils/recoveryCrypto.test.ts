import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRecoveryMaterial,
  isRecoveryConfig,
  serializeRecoveryKit,
  unwrapRecoveryDataKey,
} from '@/utils/recoveryCrypto';
import type { RecoveryConfig, RecoveryMaterial } from '@/utils/recoveryTypes';
import type { MasterPasswordConfig } from '@/utils/types';

const DATA_KEY = '0123456789abcdef'.repeat(4);
const MASTER: MasterPasswordConfig = {
  salt: 'ab'.repeat(16),
  hashedPassword: 'cd'.repeat(32),
  kdf: 'pbkdf2-sha256',
};
const METADATA = { version: 1 as const, id: '12'.repeat(16), createdAt: 1792800000000 };
const SHAPE_CONFIG: RecoveryConfig = { ...METADATA, wrappedDataKey: 'A'.repeat(80) };
const INVALID = { code: 'RECOVERY_INVALID', message: 'RECOVERY_INVALID' };

/** 独立编码夹具，不依赖被测模块的编码与派生助手。 */
async function referenceRecoveryKey(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', secret);
  return Buffer.from(secret).toString('hex') + Buffer.from(digest).subarray(0, 4).toString('hex');
}

async function referenceWrappingKey(secret: Uint8Array<ArrayBuffer>, id: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: Buffer.from(id, 'hex'),
      info: new TextEncoder().encode('aph-recovery-wrap-v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function referenceAad(config: RecoveryConfig, master: MasterPasswordConfig): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    'aph-recovery-v1' +
      JSON.stringify([config.id, config.createdAt, master.salt, master.hashedPassword, master.kdf ?? 'legacy-sha256']),
  );
}

async function referenceMaterial(master = MASTER, plaintext = Buffer.from(DATA_KEY, 'hex')): Promise<RecoveryMaterial> {
  const secret = new Uint8Array(32).fill(0x57);
  const iv = new Uint8Array(12).fill(0x26);
  const key = await referenceWrappingKey(secret, METADATA.id);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128, additionalData: referenceAad(SHAPE_CONFIG, master) },
    key,
    plaintext,
  );
  return {
    config: { ...METADATA, wrappedDataKey: Buffer.concat([iv, Buffer.from(ciphertext)]).toString('base64') },
    recoveryKey: await referenceRecoveryKey(secret),
  };
}

function kit(material: RecoveryMaterial, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 'aph-recovery',
    version: 1,
    id: material.config.id,
    recoveryKey: material.recoveryKey,
    ...overrides,
  });
}

function flipHex(value: string, index: number): string {
  return value.slice(0, index) + (value[index] === '0' ? '1' : '0') + value.slice(index + 1);
}

afterEach(() => vi.restoreAllMocks());

describe('recovery material and cryptographic contract', () => {
  it('roundtrips only the 32-byte DK and emits the exact public shapes', async () => {
    const before = Date.now();
    const material = await createRecoveryMaterial(DATA_KEY, MASTER);
    expect(Object.keys(material).sort()).toEqual(['config', 'recoveryKey']);
    expect(Object.keys(material.config).sort()).toEqual(['createdAt', 'id', 'version', 'wrappedDataKey']);
    expect(material.config.version).toBe(1);
    expect(material.config.id).toMatch(/^[0-9a-f]{32}$/);
    expect(material.config.createdAt).toBeGreaterThanOrEqual(before);
    expect(material.config.createdAt).toBeLessThanOrEqual(Date.now());
    expect(material.config.wrappedDataKey).toMatch(/^[A-Za-z0-9+/]{80}$/);
    expect(Buffer.from(material.config.wrappedDataKey, 'base64')).toHaveLength(60);
    expect(material.recoveryKey).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{8}){8}$/);
    expect(isRecoveryConfig(material.config)).toBe(true);
    expect(await unwrapRecoveryDataKey(material.config, material.recoveryKey, MASTER)).toBe(DATA_KEY);
  });

  it('uses fresh recovery entropy, id and IV for the same DK', async () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const first = await createRecoveryMaterial(DATA_KEY, MASTER);
    const second = await createRecoveryMaterial(DATA_KEY, MASTER);
    expect(first.recoveryKey).not.toBe(second.recoveryKey);
    expect(first.config.id).not.toBe(second.config.id);
    expect(first.config.wrappedDataKey).not.toBe(second.config.wrappedDataKey);
    expect(Buffer.from(first.config.wrappedDataKey, 'base64').subarray(0, 12)).not.toEqual(
      Buffer.from(second.config.wrappedDataKey, 'base64').subarray(0, 12),
    );
    expect(random.mock.calls.map(([bytes]) => bytes?.byteLength).sort((a, b) => Number(a) - Number(b))).toEqual([
      12, 12, 16, 16, 32, 32,
    ]);
    expect(await unwrapRecoveryDataKey(first.config, first.recoveryKey, MASTER)).toBe(DATA_KEY);
    expect(await unwrapRecoveryDataKey(second.config, second.recoveryKey, MASTER)).toBe(DATA_KEY);
  });

  it('matches independently specified HKDF, AAD, checksum and raw DK layout', async () => {
    const material = await createRecoveryMaterial(DATA_KEY, MASTER);
    const code = material.recoveryKey.replace(/-/g, '');
    const secret = Buffer.from(code.slice(0, 64), 'hex');
    expect(code).toBe(await referenceRecoveryKey(secret));
    const key = await referenceWrappingKey(secret, material.config.id);
    const wrapped = Buffer.from(material.config.wrappedDataKey, 'base64');
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: wrapped.subarray(0, 12),
        tagLength: 128,
        additionalData: referenceAad(material.config, MASTER),
      },
      key,
      wrapped.subarray(12),
    );
    expect(Buffer.from(plaintext).toString('hex')).toBe(DATA_KEY);
  });

  it.each([MASTER, { salt: MASTER.salt, hashedPassword: MASTER.hashedPassword }])(
    'reads an independent fixture with master binding %j',
    async master => {
      const material = await referenceMaterial(master);
      expect(await unwrapRecoveryDataKey(material.config, material.recoveryKey, master)).toBe(DATA_KEY);
    },
  );

  it('keeps both operation-specific wrapping keys non-exportable', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    const material = await createRecoveryMaterial(DATA_KEY, MASTER);
    await unwrapRecoveryDataKey(material.config, material.recoveryKey, MASTER);
    expect(derive).toHaveBeenCalledTimes(2);
    for (const [index, usage] of ['encrypt', 'decrypt'].entries()) {
      const key: CryptoKey = await derive.mock.results[index].value;
      expect(key.extractable).toBe(false);
      expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toEqual([usage]);
      await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    }
  });

  it.each([DATA_KEY.toUpperCase(), '00'.repeat(32)])('normalizes valid DK %s to lowercase hex', async dataKey => {
    const material = await createRecoveryMaterial(dataKey, MASTER);
    expect(await unwrapRecoveryDataKey(material.config, material.recoveryKey, MASTER)).toBe(dataKey.toLowerCase());
  });

  it('does not bind optional hints or mutate the supplied master record', async () => {
    const master = Object.freeze({ ...MASTER, hint: 'test-only hint' });
    const material = await createRecoveryMaterial(DATA_KEY, master);
    expect(await unwrapRecoveryDataKey(material.config, material.recoveryKey, { ...MASTER, hint: 'changed' })).toBe(
      DATA_KEY,
    );
    expect(master).toEqual({ ...MASTER, hint: 'test-only hint' });
  });
});

describe('recovery input encoding', () => {
  it.each(['compact', 'uppercase', 'whitespace', 'hyphens', 'kit', 'utf8-kit', '4096'])('accepts %s', async format => {
    const material = await referenceMaterial();
    const code = material.recoveryKey;
    const inputs: Record<string, string> = {
      compact: code,
      uppercase: code.toUpperCase(),
      whitespace: ` \n\t${code.slice(0, 32)} \r\n${code.slice(32)}\u3000`,
      hyphens: code.match(/.{8}/g)!.join('-'),
      kit: kit(material),
      'utf8-kit': '\uFEFF \n' + kit(material, { note: '应急套件', recoveryKey: code.toUpperCase() }) + '\n',
      '4096': code.padEnd(4096, ' '),
    };
    expect(await unwrapRecoveryDataKey(material.config, inputs[format], MASTER)).toBe(DATA_KEY);
  });

  it.each(['', ' \n-\t ', 'a'.repeat(4097), '{bad-json', '{}', 'null', '[]', '"abc"', '123', 'not-a-code'])(
    'rejects invalid input case %#',
    async input => {
      await expect(unwrapRecoveryDataKey(SHAPE_CONFIG, input, MASTER)).rejects.toMatchObject(INVALID);
    },
  );

  it('bounds the original input before whitespace normalization or JSON parsing', async () => {
    const material = await referenceMaterial();
    await expect(
      unwrapRecoveryDataKey(material.config, material.recoveryKey.padEnd(4097, ' '), MASTER),
    ).rejects.toMatchObject(INVALID);
    await expect(unwrapRecoveryDataKey(material.config, kit(material).padEnd(4097, ' '), MASTER)).rejects.toMatchObject(
      INVALID,
    );
  });

  it.each(['secret', 'checksum', 'missing-checksum', 'extra-hex', 'punctuation', 'non-hex'])(
    'rejects %s before HKDF',
    async variant => {
      const material = await referenceMaterial();
      const code = material.recoveryKey;
      const inputs: Record<string, string> = {
        secret: flipHex(code, 0),
        checksum: flipHex(code, 71),
        'missing-checksum': code.slice(0, 64),
        'extra-hex': code + '0',
        punctuation: code.slice(0, 32) + '!' + code.slice(32),
        'non-hex': 'g' + code.slice(1),
      };
      const derive = vi.spyOn(crypto.subtle, 'deriveKey');
      await expect(unwrapRecoveryDataKey(material.config, inputs[variant], MASTER)).rejects.toMatchObject(INVALID);
      expect(derive).not.toHaveBeenCalled();
    },
  );

  it('rejects a different valid recovery key even with a valid checksum', async () => {
    const material = await referenceMaterial();
    const wrongCode = await referenceRecoveryKey(new Uint8Array(32).fill(0x58));
    await expect(unwrapRecoveryDataKey(material.config, wrongCode, MASTER)).rejects.toMatchObject(INVALID);
  });

  it.each([
    { kind: 'other' },
    { kind: undefined },
    { version: 0 },
    { version: 2 },
    { version: '1' },
    { version: undefined },
    { id: '34'.repeat(16) },
    { id: '' },
    { id: null },
    { id: undefined },
    { recoveryKey: 123 },
    { recoveryKey: null },
    { recoveryKey: undefined },
  ])('rejects kit metadata case %#', async overrides => {
    const material = await referenceMaterial();
    await expect(unwrapRecoveryDataKey(material.config, kit(material, overrides), MASTER)).rejects.toMatchObject(
      INVALID,
    );
  });

  it('rejects another vault kit before HKDF', async () => {
    const first = await createRecoveryMaterial(DATA_KEY, MASTER);
    const second = await createRecoveryMaterial(DATA_KEY, MASTER);
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(unwrapRecoveryDataKey(first.config, serializeRecoveryKit(second), MASTER)).rejects.toMatchObject(
      INVALID,
    );
    expect(derive).not.toHaveBeenCalled();
  });
});

describe('authenticated binding and tamper rejection', () => {
  it.each([
    { ...MASTER, salt: 'ef'.repeat(16) },
    { ...MASTER, hashedPassword: 'ef'.repeat(32) },
    { salt: MASTER.salt, hashedPassword: MASTER.hashedPassword },
  ])('rejects changed master binding case %# even if the kit supplies the old record', async master => {
    const material = await referenceMaterial();
    const input = kit(material, { masterConfig: MASTER });
    await expect(unwrapRecoveryDataKey(material.config, input, master)).rejects.toMatchObject(INVALID);
  });

  it.each([{ id: '34'.repeat(16) }, { createdAt: METADATA.createdAt + 1 }])(
    'authenticates recovery metadata case %#',
    async override => {
      const material = await referenceMaterial();
      await expect(
        unwrapRecoveryDataKey({ ...material.config, ...override }, material.recoveryKey, MASTER),
      ).rejects.toMatchObject(INVALID);
    },
  );

  it.each([0, 12, 59])('rejects byte tampering at offset %i (IV, ciphertext, tag)', async offset => {
    const material = await referenceMaterial();
    const bytes = Buffer.from(material.config.wrappedDataKey, 'base64');
    bytes[offset] ^= 1;
    const config = { ...material.config, wrappedDataKey: bytes.toString('base64') };
    expect(isRecoveryConfig(config)).toBe(true);
    await expect(unwrapRecoveryDataKey(config, material.recoveryKey, MASTER)).rejects.toMatchObject(INVALID);
  });

  it.each([0, 16, 31, 33, 64])('rejects authenticated payloads that are not a 32-byte DK (%i bytes)', async length => {
    const material = await referenceMaterial(MASTER, Buffer.alloc(length));
    await expect(unwrapRecoveryDataKey(material.config, material.recoveryKey, MASTER)).rejects.toMatchObject(INVALID);
  });
});

describe('config field boundaries', () => {
  it('accepts only supported structural fields with a positive safe integer timestamp', () => {
    expect(isRecoveryConfig(SHAPE_CONFIG)).toBe(true);
    expect(isRecoveryConfig({ ...SHAPE_CONFIG, createdAt: 1 })).toBe(true);
    expect(isRecoveryConfig({ ...SHAPE_CONFIG, createdAt: Number.MAX_SAFE_INTEGER })).toBe(true);
  });

  it.each([
    null,
    undefined,
    true,
    1,
    'config',
    [],
    {},
    { ...SHAPE_CONFIG, version: undefined },
    { ...SHAPE_CONFIG, version: 0 },
    { ...SHAPE_CONFIG, version: 2 },
    { ...SHAPE_CONFIG, version: '1' },
    { ...SHAPE_CONFIG, id: undefined },
    { ...SHAPE_CONFIG, id: null },
    { ...SHAPE_CONFIG, id: 'ab'.repeat(16).toUpperCase() },
    { ...SHAPE_CONFIG, id: 'g'.repeat(32) },
    { ...SHAPE_CONFIG, id: 'a'.repeat(31) },
    { ...SHAPE_CONFIG, id: 'a'.repeat(33) },
    { ...SHAPE_CONFIG, id: ' ' + METADATA.id },
    { ...SHAPE_CONFIG, id: 'a'.repeat(31) + '\n' },
    { ...SHAPE_CONFIG, createdAt: undefined },
    { ...SHAPE_CONFIG, createdAt: '1792800000000' },
    { ...SHAPE_CONFIG, createdAt: NaN },
    { ...SHAPE_CONFIG, createdAt: Infinity },
    { ...SHAPE_CONFIG, createdAt: -1 },
    { ...SHAPE_CONFIG, createdAt: 0 },
    { ...SHAPE_CONFIG, createdAt: 1.5 },
    { ...SHAPE_CONFIG, createdAt: Number.MAX_SAFE_INTEGER + 1 },
    { ...SHAPE_CONFIG, wrappedDataKey: undefined },
    { ...SHAPE_CONFIG, wrappedDataKey: 123 },
    { ...SHAPE_CONFIG, wrappedDataKey: '' },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(79) },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(81) },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(79) + '=' },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(78) + '==' },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(79) + '_' },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(79) + '-' },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(79) + ' ' },
    { ...SHAPE_CONFIG, wrappedDataKey: 'A'.repeat(79) + '\n' },
  ])('rejects malformed config case %# without exposing values', async config => {
    expect(isRecoveryConfig(config)).toBe(false);
    await expect(unwrapRecoveryDataKey(config, 'sensitive-invalid-input', MASTER)).rejects.toMatchObject(INVALID);
  });
});

describe('serialization and invalid DK', () => {
  it('serializes only the kit whitelist, never DK, ciphertext or master information', async () => {
    const material = await createRecoveryMaterial(DATA_KEY, MASTER);
    const polluted = {
      ...material,
      dataKey: DATA_KEY,
      masterPassword: 'test-only-master-password',
      masterConfig: MASTER,
      config: { ...material.config, recoveryKey: material.recoveryKey, dataKey: DATA_KEY },
    };
    const serialized = serializeRecoveryKit(polluted);
    expect(JSON.parse(serialized)).toEqual({
      kind: 'aph-recovery',
      version: 1,
      id: material.config.id,
      createdAt: material.config.createdAt,
      recoveryKey: material.recoveryKey,
    });
    expect(serialized).not.toContain(DATA_KEY);
    expect(serialized).not.toContain(MASTER.salt);
    expect(serialized).not.toContain(MASTER.hashedPassword);
    expect(serialized).not.toContain('test-only-master-password');
    expect(JSON.stringify(material.config)).not.toContain(material.recoveryKey);
    expect(await unwrapRecoveryDataKey(material.config, serialized, MASTER)).toBe(DATA_KEY);
  });

  it.each([
    '',
    ' ',
    'a'.repeat(63),
    'a'.repeat(65),
    'g'.repeat(64),
    '0x' + DATA_KEY,
    DATA_KEY + '\n',
    'ab-'.repeat(32),
  ])('rejects invalid DK case %# with a stable redacted error', async dataKey => {
    await expect(createRecoveryMaterial(dataKey, MASTER)).rejects.toMatchObject(INVALID);
  });

  it('exposes no input, cause or secret in recovery errors', async () => {
    const material = await referenceMaterial();
    const error = await unwrapRecoveryDataKey(material.config, 'private-input-marker', MASTER).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject(INVALID);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).toBe('Error: RECOVERY_INVALID');
    expect(JSON.stringify(error)).toBe('{"code":"RECOVERY_INVALID"}');
  });
});
