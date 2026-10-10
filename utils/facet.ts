/**
 * 分面（facet）候选内核
 *
 * 管理页左侧分类栏的每一段（标签 / 站点）都是同一件事：「按某个键给条目计数，
 * 再把计数结果做成可点选的候选」。把计数、排序与截断这三步收在一处，
 * 两段候选才不会出现「同一个库里两套排序规则」的分裂。
 *
 * 本模块刻意不认识「站点」和「标签」这两个业务概念——键怎么从条目上取（是否归一大小写、
 * 是否按逗号拆分）由调用方决定，这里只处理已经取好的值集合。
 */

/** 分面候选项 */
export interface FacetOption {
  /** 候选值，同时作为筛选条件的键与展示文本 */
  value: string;
  /** 命中该候选值的条目数 */
  count: number;
}

/**
 * 单段候选默认可见上限
 *
 * 接近 2000 条上限时，站点段的候选数上界就是条目数（每条一个独立域名）。
 * 分类栏是常驻 DOM，整段铺开会把渲染成本压进管理页首屏的「可看 → 铺满」那一档，
 * 因此默认只渲染前若干项，超出部分由搜索或「显示全部」触达。
 */
export const FACET_VISIBLE_LIMIT = 50;

/**
 * 按值计数并排序
 *
 * 空值（含纯空白）不计入候选：它代表「这条没有归类」，而不是一个分类值。
 * 排序为「计数倒序 → 值正序」，同数量时顺序必须稳定，否则同一份库两次打开
 * 候选顺序就会变；值比较用 `<`/`>` 而不是 `localeCompare`，后者随宿主平台
 * ICU 数据漂移，跨机器给不出同一份顺序。
 *
 * @param values - 已取好的候选值（可重复、可含空值）
 * @returns 去空值、合并计数后的候选集
 */
export const countFacet = (values: Iterable<string>): FacetOption[] => {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
};

/** 一段候选在当前查询词与展开态下的渲染视图 */
export interface FacetView {
  /** 实际要渲染的候选（未展开且超出上限时为前 `FACET_VISIBLE_LIMIT` 项，外加窗口外的已选项） */
  items: readonly FacetOption[];
  /** 匹配查询词的候选总数，供「显示全部 (N)」读数使用 */
  total: number;
  /** 是否存在被上限挡住、需要展开才能看到的候选 */
  truncated: boolean;
}

/**
 * 解析一段候选要渲染的内容
 *
 * 查询词是在**全集**上匹配的，而不是只在前 `FACET_VISIBLE_LIMIT` 项里搜——否则排在截断线之后的
 * 站点永远搜不出来，「显示全部」也就成了唯一出路。命中数本身超过上限时同样截断，
 * 让用户继续收窄查询而不是把整表铺开。
 *
 * 收起态里落在窗口外的**已选项会被钉回来**：否则「展开 → 选中靠后的候选 → 收起」会留下
 * 一个生效中却看不见的筛选——列表已经被过滤，左栏却找不出任何一行是选中的。这与
 * `usePasswordManagement` 里剔除失效候选值防的是同一个缺陷（隐形过滤），只是成因换成
 * 了用户自己把窗口收起来。钉回来的项停在窗口末尾之后，与它们在排序中的位置一致。
 *
 * @param options - 已按「计数倒序 → 值正序」排好的候选集
 * @param query - 用户在该段的搜索框里输入的文本，大小写与首尾空白不参与匹配
 * @param expanded - 是否已点「显示全部」
 * @param selected - 当前选中的候选值，用于把窗口外的选中项钉回视图
 * @returns items / total / truncated 三元视图
 */
export const resolveFacetView = (
  options: readonly FacetOption[],
  query: string,
  expanded: boolean,
  selected: readonly string[] = [],
): FacetView => {
  const keyword = query.trim().toLowerCase();
  const matched = keyword ? options.filter(option => option.value.toLowerCase().includes(keyword)) : options;
  const truncated = matched.length > FACET_VISIBLE_LIMIT;
  if (expanded || !truncated) return { items: matched, total: matched.length, truncated };

  const window = matched.slice(0, FACET_VISIBLE_LIMIT);
  const selectedSet = new Set(selected);
  const pinned = matched.slice(FACET_VISIBLE_LIMIT).filter(option => selectedSet.has(option.value));

  return { items: pinned.length > 0 ? [...window, ...pinned] : window, total: matched.length, truncated };
};
