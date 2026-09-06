import { hkdfSync, pbkdf2Sync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  decryptData,
  decryptFieldSafely,
  decryptPasswordEntry,
  deriveEncryptionKey,
  deriveSessionKey,
  deriveVerifierHash,
  encryptData,
  encryptPasswordEntry,
} from '@/utils/encryption';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { EncryptedPasswordEntry } from '@/utils/types';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/**
 * encryption.ts 特征化测试
 *
 * 锁定安全关键行为：
 * - 三个密钥派生函数的 KDF 参数（HKDF / PBKDF2）与独立实现交叉校验，
 *   一旦参数（盐、info、迭代数、域分离前缀）被改动即会失败；
 * - AES-256-GCM 加解密往返、随机 IV、认证完整性（错密钥/篡改）；
 * - decryptData 的边界语义（空串、空密钥、非 Base64、过短密文）；
 * - 密码条目字段级加解密的往返与字段处理（含 undefined→'' 的既有行为）。
 *
 * 说明：deriveEncryptionKey 从 chrome.storage 读取主密码配置，
 * 经 WxtVitest 注入的内存态 fakeBrowser 提供；每个用例前 reset。
 */

/** 固定的 32 字节（AES-256）测试密钥 */
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
/** 与 KEY 等长但取值不同的错误密钥 */
const WRONG_KEY = 'ff'.repeat(32);

/**
 * 600k 迭代 KDF 用例的超时上限（ms）
 *
 * 这类用例各自跑两遍 PBKDF2-SHA256/600k：被测实现走 Web Crypto，期望值走 Node
 * `pbkdf2Sync` 做独立交叉校验，实测 3.3–4.9s，紧贴 Vitest 默认 5s 上限，
 * 机器负载抖动即会超时（断言本身从未失败）。放宽耗时上限不弱化任何断言：
 * 迭代次数、salt 域分离前缀与交叉校验期望值均保持原样。
 */
const KDF_TIMEOUT_MS = 20000;

beforeEach(() => {
  fakeBrowser.reset();
  // 加解密路径含 debug/warn/error 日志，静默 console 以保持测试输出整洁
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('密钥派生（与独立实现交叉校验，锁定 KDF 参数）', () => {
  it('deriveSessionKey：HKDF-SHA256（salt=aph-session-salt, info=session-encryption-v2）', async () => {
    const salt = 'master-salt-abc';
    const expected = Buffer.from(
      hkdfSync('sha256', Buffer.from(salt), Buffer.from('aph-session-salt'), Buffer.from('session-encryption-v2'), 32),
    ).toString('hex');
    expect(await deriveSessionKey(salt)).toBe(expected);
  });

  it('deriveSessionKey：确定性、对 salt 敏感、输出 64 位 hex', async () => {
    const a = await deriveSessionKey('s1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await deriveSessionKey('s1')).toBe(a);
    expect(await deriveSessionKey('s2')).not.toBe(a);
  });

  it(
    'deriveVerifierHash：PBKDF2-SHA256/600k，salt 域分离前缀 aph-verify|',
    async () => {
      const expected = pbkdf2Sync('pw', 'aph-verify|the-salt', 600000, 32, 'sha256').toString('hex');
      expect(await deriveVerifierHash('pw', 'the-salt')).toBe(expected);
    },
    KDF_TIMEOUT_MS,
  );
});

describe('deriveEncryptionKey（读取 chrome.storage 主密码配置）', () => {
  it(
    '以存储中的 salt 做 PBKDF2-SHA256/600k，与独立实现一致',
    async () => {
      const salt = 'stored-salt';
      await fakeBrowser.storage.local.set({
        [STORAGE_KEYS.MASTER_PASSWORD]: { hashedPassword: 'x', salt },
      });
      const expected = pbkdf2Sync('mymaster', salt, 600000, 32, 'sha256').toString('hex');
      expect(await deriveEncryptionKey('mymaster')).toBe(expected);
    },
    KDF_TIMEOUT_MS,
  );

  it('缺少主密码配置时抛出「无法获取主密码配置」', async () => {
    await expect(deriveEncryptionKey('mymaster')).rejects.toThrow('无法获取主密码配置');
  });
});

describe('encryptData / decryptData', () => {
  it('往返还原明文（含 Unicode 与长文本）', async () => {
    for (const text of ['hello', 'p@ssw0rd!', '中文密码🔒', 'x'.repeat(500)]) {
      const enc = await encryptData(text, KEY);
      expect(await decryptData(enc, KEY)).toBe(text);
    }
  });

  it('随机 IV：相同明文两次加密结果不同', async () => {
    expect(await encryptData('same', KEY)).not.toBe(await encryptData('same', KEY));
  });

  it('空输入直接返回空串（先于密钥校验）', async () => {
    expect(await decryptData('', '')).toBe('');
  });

  it('密钥为空时抛出「解密密钥不能为空」', async () => {
    await expect(decryptData('nonempty', '')).rejects.toThrow('解密密钥不能为空');
  });

  it('非 Base64 数据原样返回（视为非加密数据）', async () => {
    expect(await decryptData('!!!not base64!!!', KEY)).toBe('!!!not base64!!!');
  });

  it('过短的密文（<=12 字节）原样返回', async () => {
    const short = btoa('ab'); // 仅 2 字节
    expect(await decryptData(short, KEY)).toBe(short);
  });

  it('错误密钥导致 GCM 认证失败并抛出', async () => {
    const enc = await encryptData('secret', KEY);
    await expect(decryptData(enc, WRONG_KEY)).rejects.toBeTruthy();
  });

  it('密文被篡改（翻转末字节认证标签）导致认证失败并抛出', async () => {
    const enc = await encryptData('secret', KEY);
    const bytes = Uint8Array.from(atob(enc), c => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptData(tampered, KEY)).rejects.toBeTruthy();
  });
});

describe('decryptFieldSafely', () => {
  it('空字段返回空串', async () => {
    expect(await decryptFieldSafely('', KEY, 'password')).toBe('');
  });

  it('非空字段委托 decryptData，并透传解密错误', async () => {
    const enc = await encryptData('v', KEY);
    expect(await decryptFieldSafely(enc, KEY, 'password')).toBe('v');
    await expect(decryptFieldSafely(enc, WRONG_KEY, 'password')).rejects.toBeTruthy();
  });
});

describe('encryptPasswordEntry / decryptPasswordEntry', () => {
  it('往返：敏感字段还原，非敏感字段透传，encrypted 标志正确增删', async () => {
    const original = makePasswordEntry({
      id: 'e1',
      username: 'alice',
      password: 'secret',
      url: 'https://example.com',
      remark: 'note',
      totp: 'JBSWY3DPEHPK3PXP',
      tag: 'work',
      favorite: true,
      order: 2,
      createTime: 111,
      updateTime: 222,
    });

    const enc = await encryptPasswordEntry(original, '', KEY);
    expect(enc.encrypted).toBe(true);
    // 敏感字段被加密（不等于明文）
    expect(enc.username).not.toBe('alice');
    expect(enc.password).not.toBe('secret');
    // 非敏感字段透传
    expect(enc.id).toBe('e1');
    expect(enc.tag).toBe('work');
    expect(enc.favorite).toBe(true);
    expect(enc.order).toBe(2);

    const dec = await decryptPasswordEntry(enc, '', KEY);
    expect(dec).toEqual(original);
    expect('encrypted' in dec).toBe(false);
  });

  it("空敏感字段不加密；无 totp 往返后为空串（现有 undefined→'' 行为）", async () => {
    const original = makePasswordEntry({ username: '', password: '', url: '', remark: '' });
    const enc = await encryptPasswordEntry(original, '', KEY);
    expect(enc.username).toBe('');
    expect(enc.totp).toBe('');

    const dec = await decryptPasswordEntry(enc, '', KEY);
    expect(dec.username).toBe('');
    expect(dec.totp).toBe('');
  });

  it('decryptPasswordEntry 对未加密条目仅剥离 encrypted 标志，不做解密', async () => {
    const plain = makePasswordEntry({ username: 'plainuser' });
    const notEncrypted: EncryptedPasswordEntry = { ...plain, encrypted: false };
    const out = await decryptPasswordEntry(notEncrypted, '', KEY);
    expect(out.username).toBe('plainuser');
    expect('encrypted' in out).toBe(false);
  });
});
