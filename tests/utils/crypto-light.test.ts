import { describe, expect, it } from 'vitest';
import { bytesToHex, generateSalt, hashPassword, hexToBytes, timingSafeEqual } from '@/utils/crypto-light';

/**
 * crypto-light.ts 特征化测试
 *
 * 目标：锁定当前可观察行为（含既有细节/怪癖），为后续重构提供护栏。
 * 注意：本文件仅记录「现状」，不主张「应然」；若发现 bug 亦不在此修复。
 */

describe('hexToBytes / bytesToHex', () => {
  it('bytesToHex 将字节转为小写、零填充的 hex', () => {
    expect(bytesToHex(new Uint8Array([0, 10, 255]))).toBe('000aff');
    expect(bytesToHex(new Uint8Array([1, 2, 3]))).toBe('010203');
  });

  it('空输入互转为空', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('');
    expect(Array.from(hexToBytes(''))).toEqual([]);
  });

  it('hexToBytes 解析偶数长度 hex，大小写均可', () => {
    expect(Array.from(hexToBytes('0A0bFF'))).toEqual([10, 11, 255]);
    expect(Array.from(hexToBytes('deadbeef'))).toEqual([222, 173, 190, 239]);
  });

  it('round-trip：小写偶数长度 hex 经 hexToBytes→bytesToHex 保持不变', () => {
    for (const hex of ['00', 'ff', '000aff', 'deadbeef', generateSalt()]) {
      expect(bytesToHex(hexToBytes(hex))).toBe(hex);
    }
  });
});

describe('timingSafeEqual', () => {
  it('内容相同返回 true', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('长度不同直接返回 false', () => {
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('a', '')).toBe(false);
  });

  it('等长但内容不同返回 false', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });
});

describe('hashPassword', () => {
  it('已知向量：SHA-256（含默认空 salt）', async () => {
    // 空串的 SHA-256（业界公认向量）
    await expect(hashPassword('')).resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // "password" 的 SHA-256（业界公认向量）
    await expect(hashPassword('password')).resolves.toBe(
      '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    );
  });

  it('对 password 与 salt 均做首尾 trim', async () => {
    const trimmed = await hashPassword('password');
    await expect(hashPassword('  password  ')).resolves.toBe(trimmed);
    await expect(hashPassword('password', '  ')).resolves.toBe(trimmed);
  });

  it('按 password + salt 顺序拼接后再哈希', async () => {
    const ab = await hashPassword('ab');
    await expect(hashPassword('a', 'b')).resolves.toBe(ab);
  });

  it('输出为 64 位小写 hex（32 字节）', async () => {
    expect(await hashPassword('anything', 'salt')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateSalt', () => {
  it('返回 32 位小写 hex（16 字节）', () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('多次调用产生不同值', () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});
