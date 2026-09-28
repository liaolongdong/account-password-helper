import { describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_MAX_LENGTH, sanitizeFields, sanitizeText } from '@/utils/cloudSync/sanitize';

/**
 * 文本清洗测试（设计规格 §5.5、§14）
 *
 * 锁定：控制字符过滤（保留 \r\n\t）、零宽/双向控制符移除、超长截断与事件记录、
 * 截断事件绝不含原始内容、不修改入参（本地原始数据不被污染）。
 * sanitize 为纯函数，无 IO 与全局依赖，直接断言。
 */

describe('sanitizeText：控制字符过滤', () => {
  it('移除 NUL/DEL 等不可打印控制字符，但保留 \\r\\n\\t', () => {
    const input = 'a\u0000b\u001Fc\u007Fd\te\nf\r\ng';
    const result = sanitizeText(input);
    // \u0000 \u001F \u007F 被移除；\t \n \r 保留
    expect(result.value).toBe('abcd\te\nf\r\ng');
    expect(result.truncated).toBe(false);
  });

  it('保留可打印 ASCII 与中文', () => {
    expect(sanitizeText('hello 世界 123!@#').value).toBe('hello 世界 123!@#');
  });

  it('undefined / null 归一为空串且不截断', () => {
    expect(sanitizeText(undefined)).toEqual({ value: '', truncated: false, originalLength: 0 });
    expect(sanitizeText(null)).toEqual({ value: '', truncated: false, originalLength: 0 });
  });

  it('数字入参转字符串后清洗', () => {
    expect(sanitizeText(12345).value).toBe('12345');
  });
});

describe('sanitizeText：零宽与双向控制符移除', () => {
  it('移除零宽空格/连接符/BOM', () => {
    const input = 'a\u200Bb\u200Cc\u200Dd\uFEFFe';
    expect(sanitizeText(input).value).toBe('abcde');
  });

  it('移除双向控制符（U+202A~U+202E）与词连接符（U+2060）', () => {
    const input = 'x\u202Ay\u202Ez\u2060w';
    expect(sanitizeText(input).value).toBe('xyzw');
  });
});

describe('sanitizeText：超长截断', () => {
  it('超过 maxLength 截断并标记 truncated', () => {
    const result = sanitizeText('a'.repeat(100), 40);
    expect(result.value).toBe('a'.repeat(40));
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(100);
  });

  it('长度恰等于 maxLength 不截断（<= 判定）', () => {
    const result = sanitizeText('a'.repeat(40), 40);
    expect(result.truncated).toBe(false);
    expect(result.value.length).toBe(40);
  });

  it('截断基于清洗后长度：脏字符不计入 originalLength', () => {
    // 'a' + 10 个 NUL + 'b'，清洗后为 'ab'（长度 2），maxLength=5 不触发截断
    const result = sanitizeText('a' + '\u0000'.repeat(10) + 'b', 5);
    expect(result.value).toBe('ab');
    expect(result.truncated).toBe(false);
    expect(result.originalLength).toBe(2);
  });

  it('默认阈值为 DEFAULT_FIELD_MAX_LENGTH', () => {
    const result = sanitizeText('a'.repeat(DEFAULT_FIELD_MAX_LENGTH + 10));
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(DEFAULT_FIELD_MAX_LENGTH);
  });
});

describe('sanitizeFields：批量清洗与截断事件', () => {
  it('数字字段原样透传，不清洗不转字符串', () => {
    const { fields } = sanitizeFields({ n: 12345, s: 'text' });
    expect(fields.n).toBe(12345);
    expect(typeof fields.n).toBe('number');
    expect(fields.s).toBe('text');
  });

  it('截断事件仅含字段名与长度，绝不含原始内容', () => {
    const { truncated } = sanitizeFields({ remark: 'a'.repeat(100) }, 40);
    expect(truncated).toEqual([{ field: 'remark', originalLength: 100, truncatedLength: 40 }]);
    // 安全硬约束：事件对象不得出现任何 value/content 字段
    expect(Object.keys(truncated[0]).sort()).toEqual(['field', 'originalLength', 'truncatedLength']);
    expect(JSON.stringify(truncated)).not.toContain('aaaa');
  });

  it('多字段截断事件按插入顺序收集', () => {
    const { truncated } = sanitizeFields({ a: 'x'.repeat(50), b: 'y'.repeat(50) }, 10);
    expect(truncated.map(event => event.field)).toEqual(['a', 'b']);
  });

  it('不修改入参对象（本地原始数据不被污染）', () => {
    const input = { remark: 'a\u0000'.repeat(60), keep: 'ok' };
    const snapshot = structuredClone(input);
    sanitizeFields(input, 40);
    expect(input).toEqual(snapshot);
  });

  it('无截断时 truncated 为空数组', () => {
    const { truncated } = sanitizeFields({ a: 'short', b: 1 });
    expect(truncated).toEqual([]);
  });
});
