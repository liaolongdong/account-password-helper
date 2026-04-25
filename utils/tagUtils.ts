/**
 * 标签颜色工具函数
 * 根据标签内容返回对应的 Element Plus Tag 类型
 */

// 标签颜色映射缓存
const tagColorCache = new Map<string, string>();

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
