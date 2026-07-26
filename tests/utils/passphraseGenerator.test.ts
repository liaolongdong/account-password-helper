/**
 * 助记词组密码生成器单元测试
 *
 * 覆盖：默认配置生成、自定义配置、边界值钳制、分隔符、
 * 首字母大写、追加数字、词库加载、同步/异步 API。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generatePassphrase,
  generatePassphraseSync,
  preloadWordList,
  isWordListLoaded,
  SEPARATOR_OPTIONS,
} from '@/utils/passphraseGenerator';

describe('passphraseGenerator', () => {
  beforeEach(async () => {
    // 确保词库已加载
    await preloadWordList();
  });

  describe('preloadWordList / isWordListLoaded', () => {
    it('预加载后 isWordListLoaded 返回 true', () => {
      expect(isWordListLoaded()).toBe(true);
    });
  });

  describe('generatePassphrase（异步）', () => {
    it('默认配置生成非空字符串', async () => {
      const result = await generatePassphrase();
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it('默认配置：4 词 + 分隔符 + 首字母大写 + 追加 2 位数字', async () => {
      const result = await generatePassphrase();
      // 格式：Word-Word-Word-WordNN
      const parts = result.split('-');
      expect(parts.length).toBe(4);
      // 每个词首字母大写
      for (const part of parts) {
        // 最后一个 part 末尾有数字
        const word = part.replace(/\d+$/, '');
        if (word) {
          expect(word[0]).toBe(word[0].toUpperCase());
        }
      }
      // 末尾有 2 位数字
      expect(result).toMatch(/\d{2}$/);
    });

    it('自定义单词数量', async () => {
      const result = await generatePassphrase({ wordCount: 6, appendNumber: false });
      const parts = result.split('-');
      expect(parts.length).toBe(6);
    });

    it('自定义分隔符为下划线', async () => {
      const result = await generatePassphrase({ separator: '_', appendNumber: false });
      expect(result).toContain('_');
      expect(result).not.toContain('-');
    });

    it('自定义分隔符为空格', async () => {
      const result = await generatePassphrase({ separator: ' ', appendNumber: false });
      expect(result).toContain(' ');
    });

    it('无分隔符', async () => {
      const result = await generatePassphrase({ separator: '', wordCount: 3, appendNumber: false });
      // 无分隔符时，结果是连续的大写开头单词
      expect(result).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+$/);
    });

    it('首字母不大写', async () => {
      const result = await generatePassphrase({ capitalize: false, appendNumber: false });
      const parts = result.split('-');
      for (const part of parts) {
        expect(part[0]).toBe(part[0].toLowerCase());
      }
    });

    it('不追加数字', async () => {
      const result = await generatePassphrase({ appendNumber: false });
      expect(result).not.toMatch(/\d/);
    });

    it('追加 4 位数字', async () => {
      const result = await generatePassphrase({ numberDigits: 4 });
      expect(result).toMatch(/\d{4}$/);
    });

    it('单词数量低于最小值时钳制为 3', async () => {
      const result = await generatePassphrase({ wordCount: 1, appendNumber: false });
      const parts = result.split('-');
      expect(parts.length).toBe(3);
    });

    it('单词数量超过最大值时钳制为 8', async () => {
      const result = await generatePassphrase({ wordCount: 20, appendNumber: false });
      const parts = result.split('-');
      expect(parts.length).toBe(8);
    });

    it('数字位数钳制在 1~4 范围', async () => {
      const result = await generatePassphrase({ numberDigits: 10 });
      // 钳制为 4
      expect(result).toMatch(/\d{4}$/);
    });

    it('多次生成结果不同（随机性验证）', async () => {
      const results = new Set<string>();
      for (let i = 0; i < 10; i++) {
        results.add(await generatePassphrase());
      }
      // 10 次生成至少应有 2 种不同结果
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('generatePassphraseSync（同步）', () => {
    it('词库已加载时可同步生成', () => {
      const result = generatePassphraseSync();
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it('同步生成遵循配置', () => {
      const result = generatePassphraseSync({
        wordCount: 5,
        separator: '.',
        capitalize: false,
        appendNumber: false,
      });
      const parts = result.split('.');
      expect(parts.length).toBe(5);
      expect(result).not.toMatch(/\d/);
    });
  });

  describe('SEPARATOR_OPTIONS', () => {
    it('包含 5 种分隔符选项', () => {
      expect(SEPARATOR_OPTIONS.length).toBe(5);
    });

    it('包含常用分隔符', () => {
      const values = SEPARATOR_OPTIONS.map(o => o.value);
      expect(values).toContain('-');
      expect(values).toContain('_');
      expect(values).toContain('.');
      expect(values).toContain(' ');
      expect(values).toContain('');
    });
  });
});
