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
 * 归一后网址为空串的条目（`''`、`'   '`、`'///'` 这类）汇成一个末位候选桶
 * （见 `GENERIC_SITE_KEY`），它和其他站点一样**只有被勾选才参与结果**——与同一条过滤链上的
 * 标签筛选同口径（`parseTags(...).some(选中)`）。勾了站点却带出一批没填网址的条目，
 * 读起来就是「筛选没生效」。这批条目并没有因此失去落点：下拉里恒有「（无网址）」一档并标着
 * 条数，勾它即只看这批，「把网址没填的条目挑出来补全」照旧可达。至于「这个站点上会出现哪些
 * 条目」，那是填充场景的问题，由侧边栏的 `matchesSiteScope` 回答（那里空网址条目任何站点都带出），
 * 管理页不替它作答。
 * 畸形网址**不一定**进这一桶：`normalizeToHostname` 只做收敛、不判合法性，
 * `http://`、`not a url` 这类归一后是非空残值的网址各自成一个候选桶。
 */
import type { PasswordEntry } from '@/utils/types';
import { normalizeToHostname } from '@/utils/domain';

/** 站点筛选候选项 */
export interface SiteOption {
  /** 站点键：`normalizeToHostname` 归一后的 hostname（通配条目保留 `*.` 前缀，畸形网址为归一残值），通用条目桶为 `GENERIC_SITE_KEY` */
  site: string;
  /** 该站点下的条目数，供下拉展示规模、并作为排序主键 */
  count: number;
}

/**
 * 通用条目（归一后网址为空串）桶的哨兵键
 *
 * 它占候选集的一个位置，但不是一个 hostname。选 `/` 开头的串作哨兵是因为
 * `normalizeToHostname` 的两条分支都产不出含斜杠的结果——URL 解析出的 hostname 不带斜杠，
 * 畸形网址的回退分支先按 `/` 切掉路径——所以任何条目的站点键都不可能与它相等，
 * 这个桶只可能由用户主动勾选，不会被某条真实网址顺带命中。
 *
 * 展示文案由消费侧用 i18n 渲染（本模块是与 Vue 生命周期无关的纯函数，不持文案）。
 */
export const GENERIC_SITE_KEY = '/no-url';

/**
 * 取条目所属的站点键
 *
 * `url` 允许是完整 URL、带端口、纯域名或通配形态，统一由 `normalizeToHostname` 收敛，
 * 因此同一个站点的 `https://x.com/login` 与 `x.com` 落在同一个桶里。
 *
 * @param url - 条目的网址字段
 * @returns 站点键；网址为空或归一后为空串时返回空串（即「通用条目」）；
 *          畸形网址返回归一后的非空残值（`http://` → `http:`、`/qq.com` → `qq.com`）
 */
export const siteKeyOf = (url: string | undefined | null): string => normalizeToHostname(url ?? '');

/**
 * 聚合全库条目，得到按站点分桶的筛选候选集
 *
 * 排序为「条目数倒序 → 站点键正序」：常用站点排在前面，同数量站点顺序稳定
 * （比较器不用 `localeCompare`，避免不同平台 locale 规则给出不同顺序）。
 * 归一后为空串的条目汇成 `GENERIC_SITE_KEY` 一桶，**固定在末位**、不参与上面的
 * 排序：它不是一个站点，跟着计数在列表里跳位会让用户每次打开下拉都要重新找它。
 *
 * @param entries - 密码条目（只读 `url` 字段）
 * @returns 站点候选集；库里每一条的网址都归一为空串时，只返回通用条目这一桶
 */
export const collectSiteOptions = (entries: readonly Pick<PasswordEntry, 'url'>[]): SiteOption[] => {
  const counts = new Map<string, number>();
  let genericCount = 0;
  for (const entry of entries) {
    const key = siteKeyOf(entry.url);
    if (!key) {
      genericCount += 1;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const options = Array.from(counts, ([site, count]) => ({ site, count })).sort(
    (a, b) => b.count - a.count || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0),
  );
  if (genericCount > 0) options.push({ site: GENERIC_SITE_KEY, count: genericCount });
  return options;
};

/**
 * 判定条目是否落在选中的站点集合内
 *
 * 未选中任何站点即放行（不参与筛选）；一旦选中，归一后网址为空串的条目也按「它自己的桶」
 * 判定——也就是 `GENERIC_SITE_KEY` 有没有被勾选。恒放行会让「筛了等于没筛」，理由见模块头。
 * 多个选中站点之间是「命中任一即保留」的或关系，与标签筛选一致。
 *
 * 只勾 `GENERIC_SITE_KEY` 时结果恰好就是这批通用条目——真实站点的键永远不等于哨兵，
 * 于是「把网址没填的条目挑出来补全」有了落点。
 *
 * @param url - 条目的网址字段
 * @param selectedSites - 选中的站点键集合
 * @returns 是否保留该条目
 */
export const matchesSiteFilter = (url: string | undefined | null, selectedSites: readonly string[]): boolean => {
  if (selectedSites.length === 0) return true;
  // 空键映射成哨兵，让「没填网址」在选中集里走和其他站点同一条判定，而不是另开一条恒保留的旁路
  return selectedSites.includes(siteKeyOf(url) || GENERIC_SITE_KEY);
};
