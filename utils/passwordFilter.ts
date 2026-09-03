/**
 * 侧边栏列表过滤纯函数
 *
 * 从 `entrypoints/sidepanel/App.vue` 的派生 computed 中抽离出与 Vue 响应式无关的
 * 过滤判定，使其可被单元测试独立覆盖，同时作为「搜索范围」与「能否填充当前页」
 * 的唯一判据来源，避免两处逻辑各自演化出分歧。
 *
 * 域名匹配语义完全复用 `utils/domain.ts`，与既有的当前域名过滤行为保持一致。
 */
import type { PasswordEntry } from '@/utils/types';
import { isExactHostMatch, isLocalDevDomain, matchesPortForLocalDev } from '@/utils/domain';
import { matchesKeyword } from '@/utils/searchMatch';
import { parseTags } from '@/utils/tagUtils';

/**
 * 侧边栏搜索范围
 *
 * - `site`：仅当前域名匹配条目 + 空 URL 通用条目（默认，面向「当前站填充」）
 * - `all`：全库条目（面向「跨站查找」，命中的外站条目降级为打开站点 + 复制类操作）
 */
export type SearchScope = 'site' | 'all';

/** 当前活动标签页的域名匹配上下文 */
export interface ScopeContext {
  /** 当前标签页 hostname，空串表示新标签页等无域名场景 */
  domain: string;
  /** 当前标签页端口，仅本地开发域名参与过滤 */
  port: string;
}

/** 列表级过滤条件（三者为叠加关系） */
export interface ListFilterOptions {
  /** 搜索关键词，匹配用户名/标签/备注/URL（支持拼音） */
  keyword?: string;
  /** 标签筛选集，命中任一即保留 */
  tags?: string[];
  /** 是否仅保留收藏条目 */
  favoriteOnly?: boolean;
}

/**
 * 判定条目是否属于「本站」范围
 *
 * 同时充当「该条目能否填充到当前页」的判据：填充依赖当前页面存在对应输入框，
 * 域名不匹配的条目填充必然失败，故两者共用同一判定。
 *
 * 匹配规则与既有当前域名过滤保持一致：
 * - 无域名（新标签页等）→ 放行全部
 * - 本地开发域名（localhost / 127.0.0.1）→ 按端口过滤，当前页无端口时放行全部
 * - 空 URL 条目 → 始终放行（通用条目不限站点）
 * - 其余 → 精确 hostname 匹配（不跨子域名、不跨环境）
 *
 * @param entry - 待判定的密码条目
 * @param ctx - 当前标签页域名上下文
 * @returns 是否属于本站范围
 */
export function matchesSiteScope(entry: PasswordEntry, ctx: ScopeContext): boolean {
  if (!ctx.domain) return true;
  if (isLocalDevDomain(ctx.domain)) {
    return matchesPortForLocalDev(entry.url, ctx.port);
  }
  if (!entry.url || entry.url.trim() === '') return true;
  return isExactHostMatch(ctx.domain, entry.url);
}

/**
 * 按搜索范围过滤条目
 *
 * 始终返回新数组：`sortPasswordEntries` 为就地排序，若 `all` 直接返回上游数组引用，
 * 排序会打乱全量列表这一事实来源的顺序。
 *
 * @param entries - 全量条目（如侧边栏缓存的完整密码列表）
 * @param scope - 搜索范围
 * @param ctx - 当前标签页域名上下文
 * @returns 范围内的条目副本
 */
export function filterEntriesByScope(
  entries: readonly PasswordEntry[],
  scope: SearchScope,
  ctx: ScopeContext,
): PasswordEntry[] {
  if (scope === 'all') return [...entries];
  return entries.filter(entry => matchesSiteScope(entry, ctx));
}

/**
 * 应用关键词、标签、收藏三项过滤
 *
 * 关键词过滤仅在 keyword 为真值时执行：`matchesKeyword` 内部订阅拼音模块就绪状态，
 * 无条件调用会让空搜索场景也在拼音预热完成后触发全列表重算，拖累首屏。
 *
 * 返回值始终为新数组，调用方可安全就地排序。
 *
 * @param entries - 候选条目
 * @param options - 过滤条件
 * @returns 过滤后的条目副本
 */
export function applyListFilters(entries: readonly PasswordEntry[], options: ListFilterOptions): PasswordEntry[] {
  const { keyword, tags, favoriteOnly } = options;

  let result: PasswordEntry[] = [...entries];

  if (keyword) {
    // 智能匹配：子串（大小写不敏感）优先，拼音模块预热后自动补齐全拼/首字母命中
    result = result.filter(p => matchesKeyword([p.username, p.tag, p.remark, p.url], keyword));
  }

  if (tags && tags.length > 0) {
    result = result.filter(p => parseTags(p.tag).some(tag => tags.includes(tag)));
  }

  if (favoriteOnly) {
    result = result.filter(p => p.favorite);
  }

  return result;
}
