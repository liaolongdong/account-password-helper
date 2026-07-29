/**
 * 轻量级加密工具（不包含 PBKDF2/HKDF/AES-GCM）
 *
 * 从 encryption.ts 中分离，使 masterPassword.ts 等模块可以静态导入
 * 这些轻量函数而不将重型 Web Crypto 代码拉入页面首屏 chunk
 * （SW 产物由 WXT 内联为单文件，不受此拆分影响）。
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
 * 轻量字符串哈希（DJB2 变体，非加密用途）
 *
 * 将字符串映射为稳定的 32 位非负整数，相同输入始终产生相同输出。
 * 适用于内存内去重指纹、颜色映射等场景；不可用于安全敏感的哈希需求
 * （安全场景请使用 hashPassword 的 SHA-256 实现）。
 *
 * @param str 输入字符串
 * @returns 非负整数哈希值
 */
export function hashStringLight(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash);
}

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
