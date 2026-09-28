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

/**
 * 条目 id 长度上限（字符）
 *
 * `generateId()` 的产出恒为 41 字符（`uuid-` + 36 位 UUID），这里给足余量，
 * 只用于收口跨上下文消息中的不可信 id，避免任意长度的字符串进入按 id 查找的循环。
 * 身份信息库导入侧另有 `MAX_ID_LEN`（同为 64）约束备份文件：两者口径相同但服务对象
 * 不同（运行时消息载荷 vs 备份格式），各自独立演化，故不共用同一个常量。
 */
export const MAX_ID_LENGTH = 64;

/**
 * 收口跨上下文消息携带的条目 id
 *
 * 编译期类型不约束运行时载荷，因此路由在边界处只接受长度合法的字符串：
 * 非字符串或超长值一律按「无 id」处理，调用方据此降级为「不带预填的打开」。
 * 这里刻意用拒绝而不是截断——截断后的前缀理论上可与另一条真实 id 相等，拒绝不会。
 *
 * @param value 消息里的原始 id（跨上下文载荷，按不可信输入处理）
 * @returns 合法时返回原值，不合法时返回空串
 */
export function normalizeEntryId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length > MAX_ID_LENGTH ? '' : value;
}
