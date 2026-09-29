/**
 * 提交云端前的文本清洗
 *
 * 规则（设计规格 §5.5）：
 * 1. 过滤不可打印 ASCII 控制字符 0x00~0x1F、0x7F，**保留 \r\n**（备注可能含换行）；
 * 2. 移除零宽字符（U+200B/200C/200D/FEFF 等）；
 * 3. 超长文本按平台单元格上限提前截断，并记录**截断事件**（字段名 + 长度），
 *    绝不记录原始内容或脏字符；
 * 4. 清洗只作用于提交云端的数据副本，**不修改本地存储的原始条目**。
 */
import type { TruncationEvent } from './types';

/**
 * 控制字符（保留 \t \r \n）与零宽字符
 *
 * 零宽集合覆盖：零宽空格/非连接符/连接符与方向标记（U+200B~200F）、
 * 双向控制符（U+202A~202E）、词连接符等不可见格式符（U+2060~2064）
 * 与 BOM（U+FEFF）——这些字符在云端表格中不可见却会破坏哈希比对与人工核对。
 */
const INVISIBLE_PATTERN =
  // eslint-disable-next-line no-control-regex -- 本模块职责就是匹配并移除控制字符（设计规格 §5.5），正则中的控制字符区间是刻意声明
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** 单字段默认长度上限（保守值，低于平台单元格上限，避免触发 TooLargeCell） */
export const DEFAULT_FIELD_MAX_LENGTH = 20000;

/** 清洗结果 */
export interface SanitizeResult {
  value: string;
  /** 是否发生截断 */
  truncated: boolean;
  /** 原始长度（仅截断时有意义） */
  originalLength: number;
}

/**
 * 清洗单个文本值
 *
 * @param value 原始值（数字直接转字符串处理）
 * @param maxLength 长度上限，超出即截断
 */
export function sanitizeText(
  value: string | number | undefined | null,
  maxLength = DEFAULT_FIELD_MAX_LENGTH,
): SanitizeResult {
  if (value === undefined || value === null) return { value: '', truncated: false, originalLength: 0 };
  const cleaned = String(value).replace(INVISIBLE_PATTERN, '');
  if (cleaned.length <= maxLength) return { value: cleaned, truncated: false, originalLength: cleaned.length };
  return { value: cleaned.slice(0, maxLength), truncated: true, originalLength: cleaned.length };
}

/**
 * 批量清洗一行字段，收集截断事件
 *
 * 数字字段保持 number 类型（平台数字列不接受字符串），仅文本字段做清洗。
 *
 * @param fields 原始字段键值
 * @param maxLength 文本字段长度上限
 * @returns 清洗后的字段副本与截断事件列表
 */
export function sanitizeFields(
  fields: Record<string, string | number>,
  maxLength = DEFAULT_FIELD_MAX_LENGTH,
): { fields: Record<string, string | number>; truncated: TruncationEvent[] } {
  const output: Record<string, string | number> = {};
  const truncated: TruncationEvent[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    if (typeof raw === 'number') {
      output[key] = raw;
      continue;
    }
    const result = sanitizeText(raw, maxLength);
    output[key] = result.value;
    if (result.truncated) {
      // 只记录字段名与长度，绝不记录内容
      truncated.push({ field: key, originalLength: result.originalLength, truncatedLength: result.value.length });
    }
  }
  return { fields: output, truncated };
}
