/**
 * 拼音短路与「按关键词代际记忆」的结果等价性（utils/searchMatch/core.ts）
 *
 * 这两项优化都不该改变任何一个命中区间：短路的成立条件是「文本为可见 ASCII 且无空格、
 * 关键词无空白」时拼音 DP 必然不带来新命中；代际缓存的成立条件是「同一关键词下同一文本
 * 的结果可复用，换关键词即作废」。两条都是从 `pinyin-match` 实现细节推出来的判据，
 * 只靠 mock 用例证不出来，因此这里用**真实模块**做差分：
 * 把内核算出的区间与「无短路、无缓存」的参照实现逐对对照。
 *
 * 参照实现刻意不复用内核代码：短路判据一旦写错（例如漏了「文本含空格时 'username'
 * 可以命中 'user name'」这一反例），差分就会立刻指出分歧，而不是跟着一起错。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import pinyinMatch from 'pinyin-match';
import {
  findMatchRange,
  isPinyinMatcherReady,
  clearPinyinRangeCache,
  warmPinyinMatcher,
} from '@/utils/searchMatch/core';

/** 参照实现：子串短路 + 无条件跑真实拼音匹配（无短路判据、无记忆缓存） */
function referenceRange(text: string, keyword: string): [number, number] | null {
  const trimmed = keyword.trim();
  if (!text || !trimmed) return null;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index !== -1) return [index, index + trimmed.length - 1];
  const result = pinyinMatch.match(text, trimmed);
  return result === false ? null : [result[0], result[1]];
}

/**
 * 与内核同口径的短路判据
 *
 * 只用于统计「差分到底覆盖了多少被短路的组合」，不参与任何期望值的计算。
 */
const SKIPPABLE_TEXT = /^[\x21-\x7e]+$/;
function isSkippedPair(text: string, keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!text || !trimmed) return false;
  return SKIPPABLE_TEXT.test(text) && !/\s/.test(trimmed) && text.toLowerCase().indexOf(trimmed.toLowerCase()) === -1;
}

/** 条目字段形态：用户名 / 标签 / 备注 / 网址，覆盖纯 ASCII、中文、中英混合、含空格、带标点 */
const TEXTS = [
  'zhangsan@gmail.com',
  'li.young-01',
  'GitHub账号',
  'user name',
  'workspace 2024',
  'https://example.com/a/b?x=1',
  '张三',
  '重庆小面馆',
  '银行 账户 备用',
  '密码本-工作',
  '邮箱：a@b.com',
  'CAfé 门店',
  '李ss的支付宝',
  'chongqing',
  'cq',
  '2024-09-24 备份',
  '运维/root',
  '微信公众号',
  'wx-official',
  '支付宝商户',
  'a-b c-d',
  '中文 English 混排',
  '！全角标点！',
  'abc',
];

/** 关键词形态：子串、大小写变体、全拼、首字母缩写、中英混合、含空白、中文 */
const KEYWORDS = [
  'abc',
  'ABC',
  'a-b',
  'a b',
  'github',
  'GITHUB',
  'user',
  'username',
  'name',
  'zhangsan',
  'zs',
  'cq',
  'chongqing',
  'yan',
  '支付宝',
  '支付',
  'ali',
  '备份',
  'root',
  '运维',
  'wx',
  'official',
  '2024',
  '09-24',
  'a@b.com',
  'example',
  'café',
  'cafe',
  '门店',
  '混排',
  'English',
  'eng',
  '',
  '   ',
];

describe('拼音短路与代际缓存的结果等价性（真实 pinyin-match 差分）', () => {
  beforeAll(async () => {
    await warmPinyinMatcher();
    expect(isPinyinMatcherReady(), '拼音模块未能温热，差分将退化为只比子串分支').toBe(true);
  });

  it('逐对差分：内核区间与「无短路、无缓存」参照实现完全一致', () => {
    const divergences: string[] = [];
    let skippedPairs = 0;
    let pinyinHits = 0;

    for (const text of TEXTS) {
      for (const keyword of KEYWORDS) {
        const expected = referenceRange(text, keyword);
        const actual = findMatchRange(text, keyword);
        if (expected) pinyinHits += 1;
        if (isSkippedPair(text, keyword)) skippedPairs += 1;
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          divergences.push(
            `${JSON.stringify(text)} / ${JSON.stringify(keyword)} → 参照 ${JSON.stringify(expected)}，内核 ${JSON.stringify(actual)}`,
          );
        }
      }
    }

    expect(divergences, `出现结果分叉：\n${divergences.join('\n')}`).toEqual([]);
    // 差分本身要有覆盖：既要有真正落到拼音分支的命中，也要有被短路跳过的组合，
    // 否则这条用例只是「两个 null 相等」的空转。
    expect(pinyinHits, '差分语料里没有任何命中，用例已空转').toBeGreaterThan(30);
    expect(skippedPairs, '差分语料里没有触发短路的组合，判据未被覆盖').toBeGreaterThan(10);
  });

  it('反例仍成立：含空格文本可由去空白关键词命中（这正是不能按 ASCII 一律短路的原因）', () => {
    // 文本里的空格被 DP 跳过、不消费关键词字符，因此 ASCII 文本**含空格**时必须照常走拼音。
    expect(findMatchRange('user name', 'username')).not.toBeNull();
    expect(findMatchRange('de mo', 'demo')).not.toBeNull();
    // 而连字符不是空格，不享受这个跳过：'a-b c-d' 无法被 'abcd' 命中，
    // 说明「含空格的 ASCII 文本」这一保留条件的确不可省——省掉就会把上面的 'de mo' 误短路。
    expect(findMatchRange('a-b c-d', 'abcd')).toBeNull();
  });

  it('换关键词不会读到上一轮的区间（代际缓存的核心正确性）', () => {
    clearPinyinRangeCache();
    const zhang = findMatchRange('张三的账号', 'zhangsan');
    const account = findMatchRange('张三的账号', 'zhangh');
    expect(zhang).toEqual(referenceRange('张三的账号', 'zhangsan'));
    expect(account).toEqual(referenceRange('张三的账号', 'zhangh'));
    // 同一文本、不同关键词必须各自求解：若缓存只以文本为键且代际判定失效，
    // 第二次查询会拿到第一次的区间
    expect(findMatchRange('张三的账号', 'zhangsan')).toEqual(zhang);
  });

  it('清空缓存后结果不变（清理只丢记忆，不丢口径）', () => {
    const before = findMatchRange('重庆小面馆', 'cqxm');
    clearPinyinRangeCache();
    expect(findMatchRange('重庆小面馆', 'cqxm')).toEqual(before);
  });
});
