/**
 * 分面候选内核回归测试（utils/facet）
 *
 * 左栏的每一段（标签 / 站点）都是「按某个键给条目计数」得到的候选集，两段共用同一份
 * 计数与排序口径，因此这里钉的是**跨段一致性**——若两段排序规则不同，
 * 用户会在同一屏里看到两套互不相容的「哪个排在前面」的答案。
 *
 * 排序刻意不用 `localeCompare`：它的结果随宿主平台 ICU 数据漂移，
 * 同一份库在不同机器上会给出不同的候选顺序。
 */
import { describe, expect, it } from 'vitest';
import { FACET_VISIBLE_LIMIT, countFacet, resolveFacetView, type FacetOption } from '@/utils/facet';

describe('facet.countFacet', () => {
  it('按值计数，条目多的排前面', () => {
    expect(countFacet(['a', 'b', 'a', 'a', 'b'])).toEqual([
      { value: 'a', count: 3 },
      { value: 'b', count: 2 },
    ]);
  });

  it('同数量时按值正序，保证候选顺序稳定', () => {
    expect(countFacet(['d.com', 'b.com', 'c.com', 'a.com'])).toEqual([
      { value: 'a.com', count: 1 },
      { value: 'b.com', count: 1 },
      { value: 'c.com', count: 1 },
      { value: 'd.com', count: 1 },
    ]);
  });

  it('空值与纯空白不计入候选（它们代表「未归类」，不是一个分面值）', () => {
    expect(countFacet(['', 'x', '   ', 'x'])).toEqual([{ value: 'x', count: 2 }]);
  });

  it('区分大小写：值已由调用方归一，这里不再二次加工', () => {
    // 站点键在进入前已由 normalizeToHostname 转小写，标签则刻意保留用户原样
    // （`Work` 与 `work` 是两个标签，与 parseTags 的既有口径一致）。
    expect(countFacet(['Work', 'work'])).toEqual([
      { value: 'Work', count: 1 },
      { value: 'work', count: 1 },
    ]);
  });

  it('空输入得到空候选集', () => {
    expect(countFacet([])).toEqual([]);
  });

  it('接受任意可迭代输入（调用方可直接传 flatMap / Set 的结果）', () => {
    expect(countFacet(new Set(['only']))).toEqual([{ value: 'only', count: 1 }]);
  });
});

describe('facet.resolveFacetView', () => {
  const build = (n: number, prefix = 's'): FacetOption[] =>
    Array.from({ length: n }, (_, index) => ({ value: `${prefix}${index}`, count: index + 1 }));

  /**
   * 「已按计数倒序排好」的候选集——`resolveFacetView` 的前提就是入参来自 `countFacet`，
   * 因此索引即展示顺序。钉选相关的用例必须用这份夹具，否则「靠后的项」含义相反。
   */
  const sorted = (n: number): FacetOption[] => build(n).reverse();

  it('无查询词且未展开时，按上限截断并标记还有未显示项', () => {
    const view = resolveFacetView(build(FACET_VISIBLE_LIMIT + 10), '', false);

    expect(view.items).toHaveLength(FACET_VISIBLE_LIMIT);
    expect(view.total).toBe(FACET_VISIBLE_LIMIT + 10);
    expect(view.truncated).toBe(true);
  });

  it('展开后给出全部命中项，但仍如实报告截断过', () => {
    const view = resolveFacetView(build(FACET_VISIBLE_LIMIT + 10), '', true);

    expect(view.items).toHaveLength(FACET_VISIBLE_LIMIT + 10);
    expect(view.truncated).toBe(true);
  });

  it('候选数不超过上限时不截断，也不该出现「显示全部」按钮', () => {
    const view = resolveFacetView(build(3), '', false);

    expect(view.items).toHaveLength(3);
    expect(view.total).toBe(3);
    expect(view.truncated).toBe(false);
  });

  it('查询词在小写化的全集上匹配，不受上限影响而漏掉靠后的项', () => {
    // 排在末尾的项计数最大、位置最靠后，若实现只在前 50 项里搜就会漏掉它
    const options = [...build(FACET_VISIBLE_LIMIT + 5, 'site'), { value: 'zeta.com', count: 9999 }];
    const view = resolveFacetView(options, 'zeta', false);

    expect(view.items).toEqual([{ value: 'zeta.com', count: 9999 }]);
    expect(view.total).toBe(1);
    expect(view.truncated).toBe(false);
  });

  it('查询词大小写不敏感，且两侧空白不参与匹配', () => {
    const options: FacetOption[] = [
      { value: 'GitHub.com', count: 2 },
      { value: 'gitlab.com', count: 1 },
      { value: 'qq.com', count: 1 },
    ];

    // 大写查询命中两个小写值，说明匹配两侧都归一过；qq.com 不命中说明匹配的是子串而非「有输入就全放行」
    expect(resolveFacetView(options, '  GIT  ', false).items).toEqual([
      { value: 'GitHub.com', count: 2 },
      { value: 'gitlab.com', count: 1 },
    ]);
  });

  it('纯空白查询词等同于没有查询词', () => {
    const view = resolveFacetView(build(3), '   ', false);

    expect(view.items).toHaveLength(3);
  });

  it('命中数超过上限时同样截断，让用户继续收窄查询而不是铺开整表', () => {
    const view = resolveFacetView(build(FACET_VISIBLE_LIMIT + 20, 'git'), 'git', false);

    expect(view.items).toHaveLength(FACET_VISIBLE_LIMIT);
    expect(view.total).toBe(FACET_VISIBLE_LIMIT + 20);
    expect(view.truncated).toBe(true);
  });

  it('零命中返回空视图', () => {
    expect(resolveFacetView(build(3), 'nope', false)).toEqual({ items: [], total: 0, truncated: false });
  });

  it('收起态下选中的候选即使排在截断线之后也保持可见（不制造隐形过滤）', () => {
    const options = sorted(FACET_VISIBLE_LIMIT + 10);
    const tail = options[options.length - 1];

    const view = resolveFacetView(options, '', false, [tail.value]);

    expect(view.items).toHaveLength(FACET_VISIBLE_LIMIT + 1);
    expect(view.items.map(option => option.value)).toContain(tail.value);
  });

  it('钉选按候选原本的顺序落位，而不是按点击顺序追加到末尾', () => {
    const options = sorted(FACET_VISIBLE_LIMIT + 4);
    // 窗口外的两项，故意**倒着**传入选中集：视图必须按候选顺序给，才能证明它没跟着点击顺序跑
    const earlier = options[FACET_VISIBLE_LIMIT + 1];
    const later = options[FACET_VISIBLE_LIMIT + 3];

    const values = resolveFacetView(options, '', false, [later.value, earlier.value]).items.map(option => option.value);

    expect(values).toEqual([...options.slice(0, FACET_VISIBLE_LIMIT), earlier, later].map(option => option.value));
  });

  it('查询词与选中同时存在时尊重查询：没命中查询的选中项不被钉回来', () => {
    const options = sorted(FACET_VISIBLE_LIMIT + 10);
    const tail = options[options.length - 1];

    const view = resolveFacetView(options, 's1', false, [tail.value]);

    // s1 前缀命中的是 s1、s10…s19，排在末位的 s0 不在其中
    expect(view.items.map(option => option.value)).not.toContain(tail.value);
    expect(view.items.map(option => option.value)).toContain('s1');
  });

  it('展开态不需要钉选，也不会因此把选中项重复渲染', () => {
    const options = sorted(FACET_VISIBLE_LIMIT + 3);
    const view = resolveFacetView(options, '', true, [options[0].value]);

    expect(view.items).toHaveLength(FACET_VISIBLE_LIMIT + 3);
    expect(new Set(view.items.map(option => option.value)).size).toBe(view.items.length);
  });
});
