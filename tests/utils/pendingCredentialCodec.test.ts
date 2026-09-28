/**
 * 待确认凭据编解码器（S2）单元测试
 *
 * 覆盖：加解密往返、UTF-8 多字节、密钥不匹配时 fail-closed、脏数据容错。
 * 本模块刻意不触碰任何存储：密钥由调用方（内容脚本向 background 申请）传入，
 * 这样「解密密钥从不进入宿主页面可达的存储」这一安全属性由结构本身保证。
 */
import { describe, expect, it } from 'vitest';
import { decryptPendingCredential, encryptPendingCredential } from '@/utils/pendingCredentialCodec';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('encryptPendingCredential / decryptPendingCredential', () => {
  it('同一密钥往返得到原文', () => {
    const plaintext = JSON.stringify({ username: 'alice@Example.com', password: 'P@ss w0rd!', url: 'example.com' });
    expect(decryptPendingCredential(encryptPendingCredential(plaintext, KEY_A), KEY_A)).toBe(plaintext);
  });

  it('支持中文等多字节字符', () => {
    const plaintext = JSON.stringify({ remark: '自动保存 · 密码管理器', tag: '测试环境' });
    expect(decryptPendingCredential(encryptPendingCredential(plaintext, KEY_A), KEY_A)).toBe(plaintext);
  });

  it('密文不含明文子串', () => {
    const plaintext = 'super-secret-password';
    const cipher = encryptPendingCredential(plaintext, KEY_A);
    expect(cipher).not.toContain(plaintext);
    expect(Buffer.from(cipher, 'base64').toString('utf8')).not.toContain(plaintext);
  });

  it('密钥不匹配时返回 null（fail-closed，不吐半成品明文）', () => {
    const cipher = encryptPendingCredential('anything', KEY_A);
    expect(decryptPendingCredential(cipher, KEY_B)).toBeNull();
  });

  it('空密钥不静默退化为全零密文：加密抛错、解密 fail-closed', () => {
    expect(() => encryptPendingCredential('anything', '')).toThrow();
    expect(decryptPendingCredential(encryptPendingCredential('anything', KEY_A), '')).toBeNull();
  });

  it('非 base64 脏数据返回 null 而不抛异常', () => {
    expect(decryptPendingCredential('not!!base64!!', KEY_A)).toBeNull();
  });

  it('超长于密钥的明文仍可往返（密钥循环复用）', () => {
    const plaintext = 'x'.repeat(500);
    expect(decryptPendingCredential(encryptPendingCredential(plaintext, KEY_A), KEY_A)).toBe(plaintext);
  });
});
