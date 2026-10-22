/**
 * 侧边栏列表过滤纯函数
 *
 * 从 `entrypoints/sidepanel/App.vue` 的派生 computed 中抽离出与 Vue 响应式无关的
 * 过滤判定，使其可被单元测试独立覆盖，同时作为侧边栏「搜索范围」与「能否填充当前页」
 * 的唯一判据来源，避免这两处在侧边栏内部各自演化出分歧。
 *
 * 域名匹配语义完全复用 `utils/domain.ts` 的 `matchesSiteEndpoint`（内部即 `resolveMatchTier`
 * 的主机门叠加端口轴的门），本模块不再自行判定任何主机或端口规则；
 * 策略里两项的缺省值合起来即「端口隔离功能存在之前」的行为，逐条一致。
 *
 * 作用边界：本模块只服务侧边栏。内联下拉与一键填充走
 * `utils/passwordSort.ts` 的 `filterAndSortEntriesForDomain`，两者仅在「当前页无域名」
 * 一支语义相反——那里只放行空 URL 通用条目，这里放行全库（见 `matchesSiteScope`）。
 * 这是既有产品行为，不是待收敛的缺陷：无域名时侧边栏没有「本站」可收敛，全库列表本身
 * 就是它的降级形态；而下拉需要贴在当前页上，展示外站条目没有可填充的目标。
 */
import type { PasswordEntry } from '@/utils/types';
import { matchesSiteEndpoint, type EffectiveSitePolicy, type PagePortContext } from '@/utils/domain';
import { filterByKeyword, type KeywordMatcher } from '@/utils/keywordMatch';
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
  /**
   * 当前标签页的端口上下文（由 `tab.url` 一次解析得到，见 `parsePagePortContext`）
   *
   * 刻意不再单独存 `URL.port`：端口隔离要同时知道「有效端口」与「页面是否在默认端口」，
   * 而原始 port 可由这两者反推（见 `rawPortOf`），并列存放就是两个事实来源。
   */
  page: PagePortContext | null;
}

/** 列表级过滤条件（三者为叠加关系） */
export interface ListFilterOptions {
  /** 搜索关键词，匹配用户名/标签/备注/URL（支持拼音） */
  keyword?: string;
  /** 标签筛选集，命中任一即保留 */
  tags?: string[];
  /** 是否仅保留收藏条目 */
  favoriteOnly?: boolean;
  /**
   * 关键词匹配器，缺省 {@link matchesKeyword}（子串 + 拼音）
   *
   * 供无法引用拼音内核的调用方（如内容脚本世界）注入自己的匹配器，
   * 从而复用同一份「检索字段清单 + 保序过滤」口径；字段清单不接受定制。
   */
  matcher?: KeywordMatcher;
}

/**
 * 判定条目是否属于「本站」范围
 *
 * 同时充当「该条目能否填充到当前页」的判据：填充依赖当前页面存在对应输入框，
 * 域名或端口不匹配的条目填充必然失败（或把另一个服务上的凭证填进眼前这个登录框），
 * 故两者共用同一判定。
 *
 * 匹配规则全部下沉到 `utils/domain.ts` 的 `matchesSiteEndpoint`（主机门 ∧ 端口门），
 * 与内联下拉 / 一键填充同源；本模块只保留「当前页无域名」这一支的侧边栏语义：
 * 此刻没有「本站」可收敛，全库列表本身就是它的降级形态，故放行全部。
 *
 * @param entry - 待判定的密码条目
 * @param ctx - 当前标签页域名上下文
 * @param policy - 站点匹配策略（档位 + 端口范围），**必传**：这两轴漏传都会静默退化成最宽松口径，
 *                 而缺陷只在非默认档下暴露，让编译器拦住比靠自觉可靠
 * @returns 是否属于本站范围
 */
export function matchesSiteScope(entry: PasswordEntry, ctx: ScopeContext, policy: EffectiveSitePolicy): boolean {
  if (!ctx.domain) return true;
  return matchesSiteEndpoint(entry.url, ctx.domain, ctx.page, policy);
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
 * @param policy - 站点匹配策略，必传（理由同 `matchesSiteScope`）
 * @returns 范围内的条目副本
 */
export function filterEntriesByScope(
  entries: readonly PasswordEntry[],
  scope: SearchScope,
  ctx: ScopeContext,
  policy: EffectiveSitePolicy,
): PasswordEntry[] {
  if (scope === 'all') return [...entries];
  return entries.filter(entry => matchesSiteScope(entry, ctx, policy));
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
  const { keyword, tags, favoriteOnly, matcher = matchesKeyword } = options;

  let result: PasswordEntry[] = [...entries];

  if (keyword) {
    // 智能匹配：子串（大小写不敏感）优先，拼音模块预热后自动补齐全拼/首字母命中；
    // 「搜哪几个字段」与「保序」由 utils/keywordMatch 单点定义，内联下拉共用同一清单
    result = filterByKeyword(result, keyword, matcher);
  }

  if (tags && tags.length > 0) {
    result = result.filter(p => parseTags(p.tag).some(tag => tags.includes(tag)));
  }

  if (favoriteOnly) {
    result = result.filter(p => p.favorite);
  }

  return result;
}
