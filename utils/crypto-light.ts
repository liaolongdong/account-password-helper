/**
 * 轻量级加密工具（不包含 PBKDF2/HKDF/AES-GCM）
 *
 * 从 encryption.ts 中分离，使 masterPassword.ts 等模块可以静态导入
 * 这些轻量函数而不将重型 Web Crypto 代码打入 SW 初始包。
 */

// ── 内部工具 ──────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ── 公开 API ──────────────────────────────────────────────

/**
 * 常量时间字符串比较，防止时序攻击
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/**
 * SHA-256 哈希（Web Crypto 原生实现）
 */
export async function hashPassword(password: string, salt: string = ''): Promise<string> {
  const combined = String(password || '').trim() + String(salt || '').trim();
  const data = new TextEncoder().encode(combined);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * 生成随机盐值（32 hex chars = 16 bytes）
 */
export function generateSalt(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}
