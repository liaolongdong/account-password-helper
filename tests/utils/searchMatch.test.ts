import { describe, it, expect, beforeAll } from 'vitest';
import {
  findMatchRange,
  matchesKeyword,
  highlightSegments,
  warmPinyinMatcher,
  pinyinMatcherReady,
} from '@/utils/searchMatch';

describe('searchMatch', () => {
  describe('findMatchRange（子串匹配，模块加载前即可用）', () => {
    it('应大小写不敏感命中子串并返回闭区间', () => {
      expect(findMatchRange('GitHub账号', 'github')).toEqual([0, 5]);
      expect(findMatchRange('test@example.com', 'EXAMPLE')).toEqual([5, 11]);
    });

    it('未命中时应返回 null', () => {
      expect(findMatchRange('张三', 'lisi')).toBeNull();
    });

    it('空文本或空关键词应返回 null', () => {
      expect(findMatchRange('', 'abc')).toBeNull();
      expect(findMatchRange('abc', '')).toBeNull();
      expect(findMatchRange('abc', '   ')).toBeNull();
    });
  });

  describe('拼音匹配（预热后生效）', () => {
    beforeAll(async () => {
      await warmPinyinMatcher();
    });

    it('预热后拼音模块应就绪', () => {
      expect(pinyinMatcherReady.value).toBe(true);
    });

    it('应支持首字母缩写命中中文', () => {
      expect(findMatchRange('工作日志', 'gz')).toEqual([0, 1]);
      expect(findMatchRange('北京欢迎你', 'bjhyn')).toEqual([0, 4]);
    });

    it('应支持全拼命中中文', () => {
      const range = findMatchRange('张三的账号', 'zhangsan');
      expect(range).toEqual([0, 1]);
    });

    it('应支持中英混合文本匹配', () => {
      expect(findMatchRange('测试Test', 'test')).toEqual([2, 5]);
    });

    it('拼音未命中时仍返回 null', () => {
      expect(findMatchRange('工作', 'xx')).toBeNull();
    });

    it('重复预热应幂等无副作用', async () => {
      await warmPinyinMatcher();
      expect(pinyinMatcherReady.value).toBe(true);
    });
  });

  describe('matchesKeyword', () => {
    it('任一字段命中即返回 true', () => {
      expect(matchesKeyword(['张三', '', '备注'], 'zhangsan')).toBe(true);
      expect(matchesKeyword(['张三', '工作'], 'gz')).toBe(true);
    });

    it('全部未命中返回 false', () => {
      expect(matchesKeyword(['张三', 'https://a.com'], 'lisi')).toBe(false);
    });

    it('空关键词应返回 true（不过滤）', () => {
      expect(matchesKeyword(['张三'], '')).toBe(true);
    });

    it('全空字段 + 非空关键词应返回 false', () => {
      expect(matchesKeyword(['', '', ''], 'abc')).toBe(false);
    });
  });

  describe('highlightSegments', () => {
    it('命中时应切分为 前缀/命中/后缀 三段', () => {
      expect(highlightSegments('admin@work.com', 'work')).toEqual([
        { text: 'admin@', hit: false },
        { text: 'work', hit: true },
        { text: '.com', hit: false },
      ]);
    });

    it('命中在首尾时应省略空前缀/后缀', () => {
      expect(highlightSegments('工作日志', 'gz')).toEqual([
        { text: '工作', hit: true },
        { text: '日志', hit: false },
      ]);
      expect(highlightSegments('abc', 'c')).toEqual([
        { text: 'ab', hit: false },
        { text: 'c', hit: true },
      ]);
    });

    it('未命中时应返回单段非高亮文本', () => {
      expect(highlightSegments('张三', 'lisi')).toEqual([{ text: '张三', hit: false }]);
    });

    it('空关键词/空文本应安全降级', () => {
      expect(highlightSegments('张三', '')).toEqual([{ text: '张三', hit: false }]);
      expect(highlightSegments('', 'abc')).toEqual([]);
    });

    it('分段拼接后应等于原文（不丢字符）', () => {
      const text = '北京欢迎你Test';
      const segments = highlightSegments(text, 'bjhyn');
      expect(segments.map(s => s.text).join('')).toBe(text);
      expect(segments.some(s => s.hit)).toBe(true);
    });
  });
});
