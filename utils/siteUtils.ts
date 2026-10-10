/**
 * 站点维度聚合纯函数
 *
 * 把「这条账号属于哪个站点」变成可直接筛选的候选集，让管理页在不引入层级分组的
 * 前提下拿到自动归类：站点的真值是条目里已经存在的 `url`，因此不需要用户再维护
 * 第二套组织结构，也不会出现「分组树里有条目、标签里也有条目」的双写。
 *
 * 与侧边栏的「本站」范围（`utils/passwordFilter.ts` 的 `matchesSiteScope`）刻意不同：
 * 那里回答的是「这条能不能填到当前页」，需要档位化的跨子域宽松匹配；这里回答的是
 * 「把全库按站点摊开成可点选的桶」，所以只做**精确 hostname 分桶**，不读跨子域档位。
 * 若把档位语义混进来，筛选结果会随另一个弹窗里的设置变化，用户无法预期。
 *
 * 空 `url` 的通用条目不进候选集，但在任何站点筛选下都保留（见 `matchesSiteFilter`）：
 * 它对任意站点都可用，藏起来等于让用户以为库里没有。
 */
import type { PasswordEntry } from '@/utils/types';
import { normalizeToHostname } from '@/utils/domain';

/** 站点筛选候选项 */
export interface SiteOption {
  /** 站点键：`normalizeToHostname` 归一后的 hostname（通配条目保留 `*.` 前缀） */
  site: string;
  /** 该站点下的条目数，供下拉展示规模、并作为排序主键 */
  count: number;
}

/**
 * 取条目所属的站点键
 *
 * `url` 允许是完整 URL、带端口、纯域名或通配形态，统一由 `normalizeToHostname` 收敛，
 * 因此同一个站点的 `https://x.com/login` 与 `x.com` 落在同一个桶里。
 *
 * @param url - 条目的网址字段
 * @returns 站点键；空网址或归一后为空时返回空串（即「通用条目」）
 */
export const siteKeyOf = (url: string | undefined | null): string => normalizeToHostname(url ?? '');

/**
 * 聚合全库条目，得到按站点分桶的筛选候选集
 *
 * 排序为「条目数倒序 → 站点键正序」：常用站点排在前面，同数量站点顺序稳定
 * （比较器不用 `localeCompare`，避免不同平台 locale 规则给出不同顺序）。
 * 空 `url` 的通用条目被跳过——它是「所有站点」而非某个站点，进候选集只会产生一个
 * 选了等于没选的空转选项。
 *
 * @param entries - 密码条目（只读 `url` 字段）
 * @returns 站点候选集；无任何带网址条目时为空数组
 */
export const collectSiteOptions = (entries: readonly Pick<PasswordEntry, 'url'>[]): SiteOption[] => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = siteKeyOf(entry.url);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts, ([site, count]) => ({ site, count })).sort(
    (a, b) => b.count - a.count || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0),
  );
};

/**
 * 判定条目是否落在选中的站点集合内
 *
 * 未选中任何站点即放行（不参与筛选）；通用条目（空 `url`）恒放行，理由见模块头。
 * 多个选中站点之间是「命中任一即保留」的或关系，与标签筛选一致。
 *
 * @param url - 条目的网址字段
 * @param selectedSites - 选中的站点键集合
 * @returns 是否保留该条目
 */
export const matchesSiteFilter = (url: string | undefined | null, selectedSites: readonly string[]): boolean => {
  if (selectedSites.length === 0) return true;
  const key = siteKeyOf(url);
  return !key || selectedSites.includes(key);
};
