import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry } from '@/utils/types';

/**
 * B8 数据层：读取失败不再伪装成「空」。
 *
 * 锁死三条契约：
 * - getAllPasswordsDetailed：会话密钥不符 / 密文损坏导致单条解密失败时，
 *   跳过该条目并累加 undecryptableCount（成功条目照常返回），而非静默把列表变短；
 * - getAllPasswords：仅返回详细结果的 entries（对既有调用方保持PasswordEntry[]语义）；
 * - 全明文（无 encrypted 标志）：原样返回、undecryptableCount 恒为 0（不破迁移动线）；
 * - storage 读取失败 / getPasswordsByUrl：异常向上抛出，不再 catch→[]。
 *
 * 加密链与会话密钥经模块 mock 从接缝注入，避免真实 PBKDF2/AES。
 */

const enc = vi.hoisted(() => ({
  decryptPasswordEntry: vi.fn(),
  deriveEncryptionKey: vi.fn(),
}));

const session = vi.hoisted(() => ({
  getSessionDataKey: vi.fn(),
}));

let localGetImpl: (key: string) => Promise<Record<string, unknown>>;

vi.mock('@/utils/encryption', () => ({
  decryptPasswordEntry: enc.decryptPasswordEntry,
  deriveEncryptionKey: enc.deriveEncryptionKey,
}));

vi.mock('@/utils/storage/facades', () => ({
  getSessionDataKey: session.getSessionDataKey,
}));

import { getAllPasswords, getAllPasswordsDetailed, getPasswordsByUrl } from '@/utils/storage/passwordCrud';

/** 构造带 encrypted 标志的密文条目（仅需触发解密分支所需字段） */
const encryptedEntry = (id: string): EncryptedPasswordEntry =>
  ({
    id,
    username: `cipher-${id}`,
    password: `cipher-pass-${id}`,
    url: `cipher-url-${id}`,
    remark: '',
    totp: '',
    tag: '',
    encrypted: true,
    createTime: 1,
    updateTime: 1,
    order: 1,
  }) as unknown as EncryptedPasswordEntry;

/** 解密成功后的明文条目形状 */
const plainEntry = (id: string) => ({
  id,
  username: `user-${id}`,
  password: `pass-${id}`,
  url: `https://${id}.example.com`,
  tag: '',
  remark: '',
  createTime: 1,
  updateTime: 1,
  order: 1,
});

beforeEach(() => {
  vi.resetModules();
  enc.decryptPasswordEntry.mockReset();
  enc.deriveEncryptionKey.mockReset().mockResolvedValue('derived-key');
  session.getSessionDataKey.mockReset().mockResolvedValue('session-data-key');
  localGetImpl = async () => ({});
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => localGetImpl(key)),
      },
      session: {},
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAllPasswordsDetailed 部分解密失败可见化', () => {
  it('单条解密失败：跳过该条并累加 undecryptableCount，成功条目照常返回', async () => {
    localGetImpl = async () => ({ [STORAGE_KEYS.PASSWORDS]: [encryptedEntry('a'), encryptedEntry('b')] });
    enc.decryptPasswordEntry.mockImplementation(async (entry: { id: string }) => {
      if (entry.id === 'b') throw new Error('需要主密码来解密数据');
      return plainEntry(entry.id);
    });

    const result = await getAllPasswordsDetailed();
    expect(result.entries.map(e => e.id)).toEqual(['a']);
    expect(result.undecryptableCount).toBe(1);
  });

  it('全部可解密：undecryptableCount 为 0（成功路径语义不变）', async () => {
    localGetImpl = async () => ({ [STORAGE_KEYS.PASSWORDS]: [encryptedEntry('a'), encryptedEntry('b')] });
    enc.decryptPasswordEntry.mockImplementation(async (entry: { id: string }) => plainEntry(entry.id));

    const result = await getAllPasswordsDetailed();
    expect(result.entries).toHaveLength(2);
    expect(result.undecryptableCount).toBe(0);
  });

  it('全部不可解密：列表为空但 undecryptableCount 非零（不伪装成「无数据」）', async () => {
    localGetImpl = async () => ({ [STORAGE_KEYS.PASSWORDS]: [encryptedEntry('a'), encryptedEntry('b')] });
    enc.decryptPasswordEntry.mockRejectedValue(new Error('bad key'));

    const result = await getAllPasswordsDetailed();
    expect(result.entries).toEqual([]);
    expect(result.undecryptableCount).toBe(2);
  });

  it('全明文条目（无 encrypted 标志）：原样返回，不触发解密，count 为 0', async () => {
    const plaintext = [plainEntry('a')];
    localGetImpl = async () => ({ [STORAGE_KEYS.PASSWORDS]: plaintext });

    const result = await getAllPasswordsDetailed();
    expect(result.entries).toEqual(plaintext);
    expect(result.undecryptableCount).toBe(0);
    expect(enc.decryptPasswordEntry).not.toHaveBeenCalled();
  });

  it('getAllPasswords 仅返回详细结果的 entries', async () => {
    localGetImpl = async () => ({ [STORAGE_KEYS.PASSWORDS]: [encryptedEntry('a'), encryptedEntry('b')] });
    enc.decryptPasswordEntry.mockImplementation(async (entry: { id: string }) => {
      if (entry.id === 'b') throw new Error('bad key');
      return plainEntry(entry.id);
    });

    const list = await getAllPasswords();
    expect(list.map(e => e.id)).toEqual(['a']);
  });
});

describe('读取失败向上抛出而非伪装成空（B8）', () => {
  it('getAllPasswordsDetailed 在 storage 读取失败时抛出', async () => {
    localGetImpl = async () => {
      throw new Error('simulated storage read failure');
    };
    await expect(getAllPasswordsDetailed()).rejects.toThrow('加载密码列表失败');
  });

  it('getPasswordsByUrl 在读取失败时抛出，不再返回空数组', async () => {
    localGetImpl = async () => {
      throw new Error('simulated storage read failure');
    };
    await expect(getPasswordsByUrl('https://x.example.com')).rejects.toThrow('加载密码列表失败');
  });
});
