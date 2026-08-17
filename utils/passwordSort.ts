import type { PasswordEntry } from '@/utils/types';
import { isExactHostMatch, isLocalDevDomain } from '@/utils/domain';

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
  if (!priorityFn || list.length < 2) {
    return list.sort((a, b) => comparePasswordEntries(a, b, sort));
  }

  // 域名优先级可能包含 URL 解析/主机匹配。若放在 O(N log N) 比较器内，
  // 同一条目会被重复计算数十次；排序前按条目引用预计算一次，比较阶段仅查表。
  // priorityFn 在项目内均为同步纯函数，预计算不会改变优先级链或排序结果。
  const firstPriority = priorityFn(list[0]);
  // 非有限值相减可能得到 NaN；旧比较器会直接返回 NaN（由 Array.sort 视为相等），
  // 因此只对有限且完全相同的优先级启用「跳过优先级比较」快路。
  let priorityByEntry: Map<PasswordEntry, number> | null = Number.isFinite(firstPriority)
    ? null
    : new Map([[list[0], firstPriority]]);
  for (let index = 1; index < list.length; index += 1) {
    const entry = list[index];
    const priority = priorityFn(entry);
    if (!priorityByEntry && priority !== firstPriority) {
      // 前面的条目优先级均与 firstPriority 相同；仅在发现差异后才创建 Map，
      // 避免当前域名尚未就绪（全 0）时给比较器增加无收益的查表开销。
      priorityByEntry = new Map<PasswordEntry, number>();
      for (let previous = 0; previous < index; previous += 1) {
        priorityByEntry.set(list[previous], firstPriority);
      }
    }
    priorityByEntry?.set(entry, priority);
  }

  if (!priorityByEntry) {
    return list.sort((a, b) => comparePasswordEntries(a, b, sort));
  }

  return list.sort((a, b) => {
    const priorityDiff = priorityByEntry.get(a)! - priorityByEntry.get(b)!;
    if (priorityDiff !== 0) return priorityDiff;
    return comparePasswordEntries(a, b, sort);
  });
}

/**
 * 按域名过滤并按侧边栏展示顺序排序密码条目（纯函数）
 *
 * 过滤规则（与侧边栏 filteredPasswords / 内联下拉 getMatchingAccounts 一致）：
 * - 本地开发域名（localhost 等）放行全部条目
 * - URL 为空的条目始终纳入
 * - 其余仅纳入与当前域名精确主机匹配的条目
 *
 * 排序规则：域名匹配优先 → 收藏置顶 → 指定排序字段（与侧边栏展示顺序一致，
 * 结果首条即侧边栏列表第一条）。供 quickFillHandler（填充首条）与
 * getMatchingAccounts（内联下拉列表）共用。
 *
 * @param passwords 全量密码条目
 * @param domain 当前页面域名（hostname）
 * @param sort 排序状态，默认侧边栏排序
 * @returns 过滤并排序后的新数组（不修改入参数组）
 */
export function filterAndSortEntriesForDomain(
  passwords: PasswordEntry[],
  domain: string,
  sort: SortState = DEFAULT_SIDEPANEL_SORT,
): PasswordEntry[] {
  const matched = passwords.filter(p => {
    if (isLocalDevDomain(domain)) return true;
    if (!p.url || p.url.trim() === '') return true;
    return isExactHostMatch(domain, p.url);
  });

  // 域名优先级（与侧边栏 getDomainPriority 一致）：0=匹配，1=不匹配
  const getDomainPriority = (entry: PasswordEntry): number => {
    if (!domain) return 0;
    const hasUrl = !!entry.url && entry.url.trim() !== '';
    if (hasUrl && isExactHostMatch(domain, entry.url)) return 0;
    return 1;
  };

  return sortPasswordEntries(matched, sort, getDomainPriority);
}
