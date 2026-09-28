import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 拼音匹配区间记忆缓存回归测试（utils/searchMatch/core.ts）
 *
 * 为什么单独立一个文件：本仓库其余用例走真实 pinyin-match，无法分辨「命中缓存」与
 * 「重算得到同一结果」。这里打桩计数匹配器调用次数，把缓存的存在性变成可断言的事实。
 *
 * 缓存动机与口径（issue #89 大列表路径）：拼音匹配是多音字 DP，同一文本会在
 * 每次列表重排、每次筛选条件变化、每个文本单元格渲染中被反复询问；600 条 × 4 个字段
 * 的一次过滤就是 2400 次 DP，筛选/收藏/排序任一变化都要再来一轮。
 * 记忆键只取文本，关键词作为「代际」——换关键词即整把清空，因此下面既验
 * 「同文本同关键词只算一次」，也验「同文本换关键词必须重算」。
 *
 * 口径约束：只有子串未命中、模块已就绪、且未被 ASCII 等价短路跳过的文本才进缓存；
 * 就绪状态因此无需参与键值。短路判据的等价性由
 * `searchMatchCore.pinyinSkip.test.ts` 用真实 pinyin-match 做差分守卫。
 */

const { matchSpy } = vi.hoisted(() => ({ matchSpy: vi.fn() }));

vi.mock('pinyin-match', () => ({ default: { match: matchSpy } }));

const { findMatchRange, highlightSegments, matchesKeyword, warmPinyinMatcher, isPinyinMatcherReady } =
  await import('@/utils/searchMatch/core');

describe('findMatchRange 的拼音结果记忆缓存', () => {
  beforeEach(() => {
    matchSpy.mockReset();
    matchSpy.mockReturnValue([0, 1]);
  });

  it('预热后就绪，同一 (文本, 关键词) 重复查询只调用匹配器一次', async () => {
    await warmPinyinMatcher();
    expect(isPinyinMatcherReady()).toBe(true);

    const first = findMatchRange('工作日志', 'gz');
    const second = findMatchRange('工作日志', 'gz');

    expect(first).toEqual([0, 1]);
    expect(second).toEqual(first);
    expect(matchSpy).toHaveBeenCalledTimes(1);
  });

  it('未命中结果同样记忆，负查询不会反复跑 DP', async () => {
    await warmPinyinMatcher();
    matchSpy.mockReturnValue(false);

    expect(findMatchRange('张三的账号', 'lisi')).toBeNull();
    expect(matchesKeyword(['张三的账号', '', '备注', ''], 'lisi')).toBe(false);
    // 仅「备注」是新键；「张三的账号」已在缓存中，空字段被跳过
    expect(matchSpy).toHaveBeenCalledTimes(2);

    matchSpy.mockClear();
    expect(matchesKeyword(['张三的账号', '', '备注', ''], 'lisi')).toBe(false);
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('子串命中走短路，不进缓存也不调用匹配器', async () => {
    await warmPinyinMatcher();

    expect(findMatchRange('GitHub账号', 'github')).toEqual([0, 5]);
    expect(findMatchRange('GitHub账号', 'github')).toEqual([0, 5]);
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('文本或关键词任一不同即视为不同查询', async () => {
    await warmPinyinMatcher();

    findMatchRange('拼音-甲', 'gz');
    findMatchRange('拼音-甲', 'gzr');
    findMatchRange('拼音-乙', 'gz');

    expect(matchSpy).toHaveBeenCalledTimes(3);
  });

  it('缓存有界：超出上限按插入顺序淘汰，仍返回等价结果', async () => {
    await warmPinyinMatcher();
    findMatchRange('有界-最早', 'zz');
    expect(matchSpy).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 2002; i += 1) {
      findMatchRange(`有界-填充-${i}`, 'zz');
    }
    matchSpy.mockClear();

    // 已被淘汰 → 重新调用匹配器，但结果等价（淘汰只影响性能，不影响渲染口径）
    expect(findMatchRange('有界-最早', 'zz')).toEqual([0, 1]);
    expect(matchSpy).toHaveBeenCalledTimes(1);
    // 最近一次查询仍在缓存
    matchSpy.mockClear();
    findMatchRange('有界-填充-2001', 'zz');
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('高亮分段沿用缓存结果，重复渲染不再切分', async () => {
    await warmPinyinMatcher();
    matchSpy.mockReturnValue([0, 1]);

    expect(highlightSegments('拼音-丙', 'gz')).toEqual([
      { text: '拼音', hit: true },
      { text: '-丙', hit: false },
    ]);
    expect(highlightSegments('拼音-丙', 'gz')).toEqual([
      { text: '拼音', hit: true },
      { text: '-丙', hit: false },
    ]);
    expect(matchSpy).toHaveBeenCalledTimes(1);
  });
});
