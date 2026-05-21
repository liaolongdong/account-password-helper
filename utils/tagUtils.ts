/**
 * 标签颜色工具函数
 * 根据标签内容返回对应的 Element Plus Tag 类型
 */
import type { PasswordEntry } from '@/utils/types';

// 标签颜色映射缓存
const tagColorCache = new Map<string, string>();

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
 * 字符串哈希函数，用于生成一致的随机颜色
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
 * 获取标签颜色类型
 * 根据标签内容匹配预定义的类别，返回对应的 Element Plus Tag 类型
 */
export const getTagType = (tag: string): string => {
  const tagLower = tag.toLowerCase();

  // 工作相关标签
  if (
    tagLower.includes('工作') ||
    tagLower.includes('work') ||
    tagLower.includes('office') ||
    tagLower.includes('公司')
  ) {
    return 'primary';
  }

  // 个人相关标签
  if (tagLower.includes('个人') || tagLower.includes('personal') || tagLower.includes('私人')) {
    return 'success';
  }

  // 学习相关标签
  if (
    tagLower.includes('学习') ||
    tagLower.includes('study') ||
    tagLower.includes('课程') ||
    tagLower.includes('教育')
  ) {
    return 'warning';
  }

  // 游戏相关标签
  if (tagLower.includes('游戏') || tagLower.includes('game') || tagLower.includes('娱乐')) {
    return 'danger';
  }

  // 购物相关标签
  if (
    tagLower.includes('购物') ||
    tagLower.includes('shop') ||
    tagLower.includes('电商') ||
    tagLower.includes('淘宝') ||
    tagLower.includes('京东')
  ) {
    return 'info';
  }

  // 社交相关标签
  if (
    tagLower.includes('社交') ||
    tagLower.includes('social') ||
    tagLower.includes('微信') ||
    tagLower.includes('qq')
  ) {
    return 'success';
  }

  // 金融相关标签
  if (
    tagLower.includes('银行') ||
    tagLower.includes('金融') ||
    tagLower.includes('支付') ||
    tagLower.includes('理财')
  ) {
    return 'warning';
  }

  // 开发相关标签
  if (
    tagLower.includes('开发') ||
    tagLower.includes('dev') ||
    tagLower.includes('github') ||
    tagLower.includes('代码')
  ) {
    return 'primary';
  }

  // 媒体相关标签
  if (
    tagLower.includes('视频') ||
    tagLower.includes('音乐') ||
    tagLower.includes('直播') ||
    tagLower.includes('媒体')
  ) {
    return 'danger';
  }

  // 对于未匹配的标签，使用随机颜色但保持一致性
  if (tagColorCache.has(tag)) {
    return tagColorCache.get(tag)!;
  }

  // 生成随机颜色类型（排除空字符串，确保有颜色）
  const randomTypes = ['primary', 'success', 'warning', 'danger', 'info'];
  const randomType = randomTypes[hashString(tag) % randomTypes.length];

  // 缓存颜色映射，确保同一标签始终使用相同颜色
  tagColorCache.set(tag, randomType);

  return randomType;
};
