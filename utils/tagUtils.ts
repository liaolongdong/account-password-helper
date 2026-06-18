/**
 * 标签颜色工具函数
 * 根据标签内容生成基于 HSL 色彩空间的自定义颜色，确保不同标签颜色区分度高、同一标签颜色始终一致。
 */
import type { PasswordEntry } from '@/utils/types';

/**
 * 解析标签字符串为数组
 * 支持英文逗号 `,` 与中文逗号 `，` 作为分隔符；自动去空白、过滤空项并去重。
 *
 * @param tag 原始标签字符串（可能为 undefined/空串）
 * @returns 去重后的标签数组
 */
export const parseTags = (tag: string | undefined | null): string[] => {
  if (!tag) return [];
  const parts = String(tag).split(/[,，]/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

/**
 * 将标签数组规范化为以英文逗号拼接的字符串
 * 自动去空白、过滤空项并去重。
 *
 * @param tags 标签数组
 * @returns 规范化后的标签字符串
 */
export const stringifyTags = (tags: string[] | undefined | null): string => {
  if (!tags || !tags.length) return '';
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const trimmed = String(tag ?? '').trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result.join(',');
};

/**
 * 聚合所有密码条目中的标签，返回去重后的候选项
 * 用于标签下拉框的候选列表。
 *
 * @param passwords 密码条目列表
 * @returns 去重后的标签候选数组
 */
export const collectAllTags = (passwords: Array<Pick<PasswordEntry, 'tag'>>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of passwords) {
    for (const tag of parseTags(p.tag)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
};

/**
 * 标签颜色对象，包含背景色、文字色和边框色
 */
export interface TagColor {
  /** 背景色（HSL 浅色） */
  background: string;
  /** 文字色（HSL 深色） */
  text: string;
  /** 边框色（与文字色一致） */
  border: string;
}

/**
 * 字符串哈希函数
 * 基于 DJB2 变体算法，将字符串映射为稳定的 32 位正整数，
 * 确保相同输入始终产生相同输出。
 *
 * @param str 输入字符串
 * @returns 非负整数哈希值
 */
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash);
};

/**
 * 根据标签内容生成基于 HSL 色彩空间的自定义颜色
 *
 * 算法说明（马卡龙色系）：
 * - 色相（Hue）：由标签字符串哈希映射到 0-359 度，保证不同标签色相均匀分布
 * - 饱和度（Saturation）：背景 55% / 文字 45% / 边框 45%，柔和清新不刺眼
 * - 亮度（Lightness）：背景 93%（极浅通透），文字 42%（温和可读），边框 85%（与背景自然过渡）
 * - 同一标签始终生成相同颜色，保证视觉一致性
 *
 * @param tag 标签文本
 * @returns 包含 background、text、border 的颜色对象
 */
export const getTagColor = (tag: string): TagColor => {
  const hue = hashString(tag) % 360;
  const background = `hsl(${hue}, 55%, 93%)`;
  const text = `hsl(${hue}, 45%, 42%)`;
  const border = `hsl(${hue}, 45%, 85%)`;
  return { background, text, border };
};
