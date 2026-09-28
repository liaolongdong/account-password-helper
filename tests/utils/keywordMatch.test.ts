import { describe, it, expect, vi } from 'vitest';
import {
  MAX_SEARCH_KEYWORD_LENGTH,
  filterByKeyword,
  keywordFieldsOf,
  normalizeSearchKeyword,
  substringMatcher,
  toFieldText,
  type KeywordMatcher,
  type KeywordSearchable,
} from '@/utils/keywordMatch';

/**
 * `utils/keywordMatch.ts` 检索口径单元测试
 *
 * 这个模块是侧边栏与内联下拉「搜哪几个字段、空关键词算什么」的唯一真源，
 * 两侧只替换匹配器实现（拼音版 / 子串版）。因此这里锁定的不是算法，而是口径：
 * 字段清单闭合且顺序固定、外部关键词在边界处归一、过滤只做减法不重排。
 * 任一条被破坏，表现都是「同一个词侧边栏搜得到、内联搜不到」这类静默分歧。
 */

/** 构造最小可检索条目（只关心四个检索字段，其余字段与本模块无关） */
const entry = (overrides: Partial<KeywordSearchable>): KeywordSearchable => ({
  username: '',
  tag: '',
  remark: '',
  url: '',
  ...overrides,
});

describe('normalizeSearchKeyword（外部关键词的边界归一）', () => {
  it('非字符串一律按「无关键词」处理', () => {
    expect(normalizeSearchKeyword(undefined)).toBe('');
    expect(normalizeSearchKeyword(null)).toBe('');
    expect(normalizeSearchKeyword(123)).toBe('');
    expect(normalizeSearchKeyword({ keyword: 'zs' })).toBe('');
    expect(normalizeSearchKeyword(['zs'])).toBe('');
  });

  it('两端空白先剔除，因此不会占用长度预算', () => {
    expect(normalizeSearchKeyword('   ')).toBe('');
    expect(normalizeSearchKeyword('  zhang  ')).toBe('zhang');
    expect(normalizeSearchKeyword(' 张三 ')).toBe('张三');
  });

  it('超长关键词截断到上限（拼音 DP 成本随长度上升，且关键词参与缓存键）', () => {
    const long = 'a'.repeat(MAX_SEARCH_KEYWORD_LENGTH + 10);
    expect(normalizeSearchKeyword(long)).toHaveLength(MAX_SEARCH_KEYWORD_LENGTH);
    // 恰好等于上限时原样保留，避免边界上「少一个字符也被切」
    expect(normalizeSearchKeyword('b'.repeat(MAX_SEARCH_KEYWORD_LENGTH))).toBe('b'.repeat(MAX_SEARCH_KEYWORD_LENGTH));
    // 前导空白先 trim 再截断：第 65 个有效字符仍会被保留到上限内
    expect(normalizeSearchKeyword(`   ${'c'.repeat(MAX_SEARCH_KEYWORD_LENGTH)}`)).toBe(
      'c'.repeat(MAX_SEARCH_KEYWORD_LENGTH),
    );
  });

  it('多字节字符按字符数而非字节数计算，不会切出代理对残片', () => {
    const chinese = '张三的生产环境备注'.repeat(10);
    const normalized = normalizeSearchKeyword(chinese);
    expect(normalized).toHaveLength(MAX_SEARCH_KEYWORD_LENGTH);
    expect(normalized).toBe(chinese.slice(0, MAX_SEARCH_KEYWORD_LENGTH));
  });
});

describe('keywordFieldsOf（两侧共同的字段清单）', () => {
  it('字段顺序为 用户名 / 标签 / 备注 / 网址', () => {
    expect(keywordFieldsOf(entry({ username: 'u', tag: 't', remark: 'r', url: 'example.com' }))).toEqual([
      'u',
      't',
      'r',
      'example.com',
    ]);
  });

  it('缺失或非字符串字段按空串下发，不会把 undefined 带进匹配器', () => {
    const legacy = { username: undefined, tag: 42, remark: null } as unknown as KeywordSearchable;
    expect(keywordFieldsOf(legacy)).toEqual(['', '', '', '']);
  });

  it('toFieldText 只接受字符串，其余（含字符串对象之外的类型）归空串', () => {
    expect(toFieldText('abc')).toBe('abc');
    expect(toFieldText('')).toBe('');
    expect(toFieldText(undefined)).toBe('');
    expect(toFieldText(null)).toBe('');
    expect(toFieldText(0)).toBe('');
    expect(toFieldText({ toString: () => 'x' })).toBe('');
  });
});

describe('substringMatcher（内容脚本侧的安全档位）', () => {
  it('空白关键词等价于不过滤：任何条目都算命中', () => {
    expect(substringMatcher(['abc'], '')).toBe(true);
    expect(substringMatcher(['abc'], '   ')).toBe(true);
    expect(substringMatcher([], 'kw')).toBe(false);
  });

  it('大小写不敏感子串命中任一字段即为真', () => {
    expect(substringMatcher(['GitHub账号'], 'github')).toBe(true);
    expect(substringMatcher(['', '', '', 'EXAMPLE.com'], 'example')).toBe(true);
    expect(substringMatcher(['张三', '工作'], 'zs')).toBe(false); // 子串档不含拼音能力
  });

  it('关键词自身的首尾空白不参与匹配', () => {
    expect(substringMatcher(['svc'], '  svc ')).toBe(true);
  });
});

describe('filterByKeyword（只做减法、不重排）', () => {
  const list = [
    entry({ username: 'alpha', url: 'a.com' }),
    entry({ username: 'beta', url: 'b.com' }),
    entry({ username: 'gamma', url: 'g.com' }),
  ];

  it('空白关键词返回全部条目的副本，且不复用入参数组', () => {
    const result = filterByKeyword(list, '   ', substringMatcher);
    expect(result).toEqual(list);
    expect(result).not.toBe(list);
  });

  it('命中顺序与入参一致（排序由上游 passwordSort 单点决定）', () => {
    const reordered = [list[2]!, list[0]!, list[1]!];
    expect(filterByKeyword(reordered, 'a', substringMatcher).map(e => e.username)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('注入的匹配器拿到的字段清单始终是 keywordFieldsOf 的结果', () => {
    // 拼音侧与子串侧的唯一差异是「怎么判断命中」，这里证明「判断哪些字段」完全一致
    const matcher = vi.fn<KeywordMatcher>(() => false);
    const target = entry({ username: 'u', tag: 't', remark: 'r', url: 'example.com' });

    filterByKeyword([target], 'kw', matcher);

    expect(matcher).toHaveBeenCalledTimes(1);
    expect(matcher.mock.calls[0]![0]).toEqual(keywordFieldsOf(target));
    expect(matcher.mock.calls[0]![1]).toBe('kw');
  });

  it('不修改入参数组', () => {
    const snapshot = [...list];
    filterByKeyword(list, 'zzz-no-match', substringMatcher);
    expect(list).toEqual(snapshot);
  });
});
