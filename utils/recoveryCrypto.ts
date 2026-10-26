import { bytesToHex, hexToBytes, timingSafeEqual } from './crypto-light';
import { RECOVERY_FORMAT, RECOVERY_INVALID } from './recoveryTypes';
import type { RecoveryConfig, RecoveryError, RecoveryKit, RecoveryMaterial } from './recoveryTypes';
import type { MasterPasswordConfig } from './types';

function invalidRecovery(): RecoveryError {
  return Object.assign(new Error(RECOVERY_INVALID), { code: RECOVERY_INVALID } as const);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 仅验证存储形状；真实性由解包时的 GCM 认证保证。 */
export function isRecoveryConfig(value: unknown): value is RecoveryConfig {
  if (!isRecord(value)) return false;
  return (
    value.version === RECOVERY_FORMAT.version &&
    typeof value.id === 'string' &&
    value.id.length === RECOVERY_FORMAT.idBytes * 2 &&
    /^[0-9a-f]+$/.test(value.id) &&
    typeof value.createdAt === 'number' &&
    Number.isSafeInteger(value.createdAt) &&
    value.createdAt > 0 &&
    typeof value.wrappedDataKey === 'string' &&
    value.wrappedDataKey.length === RECOVERY_FORMAT.wrappedBase64Length &&
    /^[A-Za-z0-9+/]+$/.test(value.wrappedDataKey)
  );
}

/** 绑定调用方当前主密码记录，不读取套件中自报的主密码信息。 */
function recoveryAad(
  config: Pick<RecoveryConfig, 'id' | 'createdAt'>,
  masterConfig: MasterPasswordConfig,
): Uint8Array<ArrayBuffer> {
  if (
    !isRecord(masterConfig) ||
    typeof masterConfig.salt !== 'string' ||
    masterConfig.salt.length === 0 ||
    typeof masterConfig.hashedPassword !== 'string' ||
    masterConfig.hashedPassword.length === 0 ||
    (masterConfig.kdf !== undefined && masterConfig.kdf !== 'pbkdf2-sha256')
  ) {
    throw invalidRecovery();
  }
  return new TextEncoder().encode(
    RECOVERY_FORMAT.aadDomain +
      JSON.stringify([
        config.id,
        config.createdAt,
        masterConfig.salt,
        masterConfig.hashedPassword,
        masterConfig.kdf ?? 'legacy-sha256',
      ]),
  );
}

/** R 与不可导出的 KEK 仅在本次操作内使用，不进入全局密钥缓存。 */
async function deriveWrappingKey(
  secret: Uint8Array<ArrayBuffer>,
  id: string,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: hexToBytes(id),
      info: new TextEncoder().encode(RECOVERY_FORMAT.wrapInfo),
    },
    baseKey,
    { name: 'AES-GCM', length: RECOVERY_FORMAT.keyBytes * 8 },
    false,
    [usage],
  );
}

/** 校验和只检测抄写错误，不替代 GCM 认证。 */
async function recoveryChecksum(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', secret);
  return bytesToHex(new Uint8Array(digest).subarray(0, RECOVERY_FORMAT.checksumBytes));
}

function normalizeRecoveryCode(input: string): string {
  if (typeof input !== 'string' || input.length > RECOVERY_FORMAT.maxInputLength) throw invalidRecovery();
  const code = input.replace(/[\s-]/gu, '').toLowerCase();
  if (code.length !== (RECOVERY_FORMAT.keyBytes + RECOVERY_FORMAT.checksumBytes) * 2 || !/^[0-9a-f]+$/.test(code)) {
    throw invalidRecovery();
  }
  return code;
}

function readRecoveryCode(input: string, id: string): string {
  if (typeof input !== 'string' || input.length > RECOVERY_FORMAT.maxInputLength) throw invalidRecovery();
  const text = input.trim();
  if (!text.startsWith('{')) return normalizeRecoveryCode(text);
  const kit: unknown = JSON.parse(text);
  if (
    !isRecord(kit) ||
    kit.kind !== RECOVERY_FORMAT.kitKind ||
    kit.version !== RECOVERY_FORMAT.version ||
    kit.id !== id ||
    typeof kit.recoveryKey !== 'string'
  ) {
    throw invalidRecovery();
  }
  return normalizeRecoveryCode(kit.recoveryKey);
}

/** 用独立高熵恢复密钥包裹既有 DK，不接收或保存主密码。 */
export async function createRecoveryMaterial(
  dataKey: string,
  masterConfig: MasterPasswordConfig,
): Promise<RecoveryMaterial> {
  let secret: Uint8Array<ArrayBuffer> | undefined;
  let dataKeyBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (
      typeof dataKey !== 'string' ||
      dataKey.length !== RECOVERY_FORMAT.keyBytes * 2 ||
      !/^[0-9a-f]+$/i.test(dataKey)
    ) {
      throw invalidRecovery();
    }
    const metadata = {
      version: RECOVERY_FORMAT.version,
      id: bytesToHex(crypto.getRandomValues(new Uint8Array(RECOVERY_FORMAT.idBytes))),
      createdAt: Date.now(),
    };
    const additionalData = recoveryAad(metadata, masterConfig);
    dataKeyBytes = hexToBytes(dataKey);
    secret = crypto.getRandomValues(new Uint8Array(RECOVERY_FORMAT.keyBytes));
    const code = bytesToHex(secret) + (await recoveryChecksum(secret));
    const groups: string[] = [];
    for (let offset = 0; offset < code.length; offset += RECOVERY_FORMAT.codeGroupLength) {
      groups.push(code.slice(offset, offset + RECOVERY_FORMAT.codeGroupLength));
    }
    const key = await deriveWrappingKey(secret, metadata.id, 'encrypt');
    const iv = crypto.getRandomValues(new Uint8Array(RECOVERY_FORMAT.ivBytes));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData, tagLength: RECOVERY_FORMAT.tagBits },
      key,
      dataKeyBytes,
    );
    const wrapped = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    wrapped.set(iv);
    wrapped.set(new Uint8Array(ciphertext), iv.byteLength);
    return {
      config: { ...metadata, wrappedDataKey: btoa(String.fromCharCode(...wrapped)) },
      recoveryKey: groups.join('-'),
    };
  } catch {
    throw invalidRecovery();
  } finally {
    secret?.fill(0);
    dataKeyBytes?.fill(0);
  }
}

/** 校验输入后只返回 DK；所有失败统一为不含输入内容的稳定错误。 */
export async function unwrapRecoveryDataKey(
  config: unknown,
  input: string,
  masterConfig: MasterPasswordConfig,
): Promise<string> {
  let secret: Uint8Array<ArrayBuffer> | undefined;
  let dataKeyBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (!isRecoveryConfig(config)) throw invalidRecovery();
    const { id, createdAt, wrappedDataKey } = config;
    const additionalData = recoveryAad({ id, createdAt }, masterConfig);
    const code = readRecoveryCode(input, id);
    const secretHexLength = RECOVERY_FORMAT.keyBytes * 2;
    secret = hexToBytes(code.slice(0, secretHexLength));
    if (!timingSafeEqual(await recoveryChecksum(secret), code.slice(secretHexLength))) throw invalidRecovery();
    const key = await deriveWrappingKey(secret, id, 'decrypt');
    const wrapped = Uint8Array.from(atob(wrappedDataKey), character => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: wrapped.subarray(0, RECOVERY_FORMAT.ivBytes),
        additionalData,
        tagLength: RECOVERY_FORMAT.tagBits,
      },
      key,
      wrapped.subarray(RECOVERY_FORMAT.ivBytes),
    );
    dataKeyBytes = new Uint8Array(plaintext);
    if (dataKeyBytes.byteLength !== RECOVERY_FORMAT.keyBytes) throw invalidRecovery();
    return bytesToHex(dataKeyBytes);
  } catch {
    throw invalidRecovery();
  } finally {
    secret?.fill(0);
    dataKeyBytes?.fill(0);
  }
}

/** 仅导出恢复码与公开元数据，不展开调用方对象中的额外字段。 */
export function serializeRecoveryKit(material: RecoveryMaterial): string {
  try {
    if (!isRecoveryConfig(material.config)) throw invalidRecovery();
    normalizeRecoveryCode(material.recoveryKey);
    const kit: RecoveryKit = {
      kind: RECOVERY_FORMAT.kitKind,
      version: RECOVERY_FORMAT.version,
      id: material.config.id,
      recoveryKey: material.recoveryKey,
      createdAt: material.config.createdAt,
    };
    return JSON.stringify(kit, null, 2);
  } catch {
    throw invalidRecovery();
  }
}
