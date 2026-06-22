import type { PasswordEntry } from '@/utils/types';

/**
 * 密码列表排序状态接口
 *
 * 描述当前 el-table 的排序列与方向，由列头点击事件（@sort-change）驱动更新。
 */
export interface SortState {
  /** 排序字段名，对应 PasswordEntry 的属性 */
  prop: string;
  /** 排序方向：'ascending' 升序、'descending' 降序、null 无排序 */
  order: 'ascending' | 'descending' | null;
}

/** 默认排序状态：收藏置顶，其次按 updateTime 降序 */
export const DEFAULT_SORT: SortState = { prop: 'updateTime', order: 'descending' };

/** 侧边栏默认排序：收藏置顶，其次按 lastUsedAt 降序（未使用时回退到 updateTime） */
export const DEFAULT_SIDEPANEL_SORT: SortState = { prop: 'lastUsedAt', order: 'descending' };

/**
 * 通用密码条目比较器
 *
 * 排序优先级（从高到低）：
 * 1. 可选的优先级函数（如域名匹配优先级）
 * 2. 收藏置顶（固定规则，不受 sort prop 影响）
 * 3. 按指定字段 + 方向排序
 *
 * @param a 第一个密码条目
 * @param b 第二个密码条目
 * @param sort 当前排序状态
 * @param priorityFn 可选的优先级函数，返回数值越小优先级越高
 * @returns 负数表示 a 排前，正数表示 b 排前，0 表示相等
 */
export function comparePasswordEntries(
  a: PasswordEntry,
  b: PasswordEntry,
  sort: SortState = DEFAULT_SORT,
  priorityFn?: (entry: PasswordEntry) => number,
): number {
  // 1. 可选的优先级（如域名匹配），数值越小越靠前
  if (priorityFn) {
    const dp = priorityFn(a) - priorityFn(b);
    if (dp !== 0) return dp;
  }

  // 2. 收藏置顶（固定规则）
  const favA = a.favorite ? 1 : 0;
  const favB = b.favorite ? 1 : 0;
  if (favA !== favB) return favB - favA;

  // 按指定字段排序（动态属性访问，类型安全由运行时 typeof 检查保障）
  if (!sort.prop || !sort.order) {
    return b.updateTime - a.updateTime;
  }

  const aVal: unknown = (a as any)[sort.prop];
  const bVal: unknown = (b as any)[sort.prop];

  // 处理 defined/undefined 混合情况（如 lastUsedAt：部分条目有值，部分没有）
  const aDefined = aVal !== undefined && aVal !== null;
  const bDefined = bVal !== undefined && bVal !== null;
  if (aDefined !== bDefined) {
    // descending: 有值的条目排前；ascending: 有值的条目排后
    return sort.order === 'ascending' ? (aDefined ? 1 : -1) : aDefined ? -1 : 1;
  }

  if (typeof aVal === 'string' && typeof bVal === 'string') {
    const cmp = aVal.localeCompare(bVal);
    return sort.order === 'ascending' ? cmp : -cmp;
  }
  if (typeof aVal === 'number' && typeof bVal === 'number') {
    const cmp = aVal - bVal;
    return sort.order === 'ascending' ? cmp : -cmp;
  }

  // 字段类型不支持或值为空时，回退到 updateTime 降序
  return b.updateTime - a.updateTime;
}

/**
 * 对密码条目数组按指定排序状态排序（就地排序，返回同一数组引用）
 *
 * @param list 待排序的密码条目数组
 * @param sort 排序状态
 * @param priorityFn 可选的优先级函数
 * @returns 排序后的数组（同一引用）
 */
export function sortPasswordEntries(
  list: PasswordEntry[],
  sort: SortState = DEFAULT_SORT,
  priorityFn?: (entry: PasswordEntry) => number,
): PasswordEntry[] {
  return list.sort((a, b) => comparePasswordEntries(a, b, sort, priorityFn));
}
