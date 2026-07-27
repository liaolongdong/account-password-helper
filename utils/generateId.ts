/**
 * 生成唯一 ID（不依赖加密模块）
 *
 * 从 encryption.ts 中分离，避免静态 import 将 PBKDF2/HKDF 等
 * Web Crypto 代码拉入页面首屏 chunk（SW 产物由 WXT 内联为单文件，
 * 不受此拆分影响）。
 *
 * @returns 格式为 "uuid-<random>" 的唯一标识符
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'uuid-' + crypto.randomUUID();
  }
  return `uuid-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}
