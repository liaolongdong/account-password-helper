/**
 * 将时间戳或 Date 对象格式化为 YYYY-MM-DD
 * @param ts - 时间戳（number）或 Date 对象
 * @returns 格式化后的日期字符串，如 "2025-06-10"
 */
export function formatDate(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 将时间戳或 Date 对象格式化为 YYYY-MM-DD hh:mm:ss
 * @param ts - 时间戳（number）或 Date 对象
 * @returns 格式化后的日期时间字符串，如 "2025-06-10 15:30:00"
 */
export function formatDateTime(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  const date = formatDate(d);
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${date} ${h}:${min}:${s}`;
}

/**
 * 将时间戳或 Date 对象格式化为 YYYYMMDD（紧凑日期，无分隔符）
 * 适用于文件名等不允许特殊字符的场景
 * @param ts - 时间戳（number）或 Date 对象，默认当前时间
 * @returns 格式化后的紧凑日期字符串，如 "20250610"
 */
export function formatDateCompact(ts: number | Date = Date.now()): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 将时间戳或 Date 对象格式化为 HHmmss（紧凑时间，无分隔符）
 * 适用于文件名等不允许特殊字符的场景
 * @param ts - 时间戳（number）或 Date 对象，默认当前时间
 * @returns 格式化后的紧凑时间字符串，如 "153000"
 */
export function formatTimeCompact(ts: number | Date = Date.now()): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}${min}${s}`;
}
