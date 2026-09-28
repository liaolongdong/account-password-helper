/**
 * 密码强度规则核心测试
 *
 * 覆盖：
 * - evaluateStrengthRules：规则条数、固定顺序、各谓词判定与空密码不短路；
 * - evaluateStrengthCore：等级映射（none/weak/medium/strong）与百分比计算；
 * - isWeakPassword：与核心等级判定同口径；
 * - STRENGTH_COLORS：锁定色值契约，防止调色板意外漂移影响既有 UI。
 *
 * 本模块是 UI 表单校验、设置页安全体检与 background 保存前预检查的共同判定源，
 * 任何阈值或正则变化都会同时改变三处口径，故在此固化行为基线。
 */
import { describe, expect, it } from 'vitest';
import {
  STRENGTH_COLORS,
  evaluateStrengthCore,
  evaluateStrengthRules,
  isWeakPassword,
} from '@/utils/passwordStrengthCore';

/** 强密码样本：长度、字母、数字、特殊字符四项全通过 */
const STRONG = 'Abcdef1!';

describe('evaluateStrengthRules', () => {
  it('固定返回 4 条规则且顺序为 minLength → hasLetter → hasNumber → hasSymbol', () => {
    expect(evaluateStrengthRules(STRONG).map(rule => rule.id)).toEqual([
      'minLength',
      'hasLetter',
      'hasNumber',
      'hasSymbol',
    ]);
  });

  it('四项全通过时逐条 passed 均为 true', () => {
    expect(evaluateStrengthRules(STRONG).every(rule => rule.passed)).toBe(true);
  });

  it('空密码不短路，仍返回 4 条且全部未通过', () => {
    const rules = evaluateStrengthRules('');
    expect(rules).toHaveLength(4);
    expect(rules.every(rule => !rule.passed)).toBe(true);
  });

  it('长度阈值以 8 为界：7 位不通过、8 位通过', () => {
    expect(evaluateStrengthRules('abcdefg').find(r => r.id === 'minLength')?.passed).toBe(false);
    expect(evaluateStrengthRules('abcdefgh').find(r => r.id === 'minLength')?.passed).toBe(true);
  });

  it('各谓词独立判定，不因其它维度缺失而互相影响', () => {
    const cases: Array<[string, string, boolean]> = [
      ['abcdefgh', 'hasLetter', true],
      ['12345678', 'hasLetter', false],
      ['12345678', 'hasNumber', true],
      ['abcdefgh', 'hasNumber', false],
      ['!@#$%^&*', 'hasSymbol', true],
      ['abcdefgh', 'hasSymbol', false],
    ];
    for (const [pwd, id, expected] of cases) {
      expect(evaluateStrengthRules(pwd).find(r => r.id === id)?.passed, `${pwd} 的 ${id}`).toBe(expected);
    }
  });
});

describe('evaluateStrengthCore', () => {
  it('空密码返回 none 等级、0 百分比', () => {
    expect(evaluateStrengthCore('')).toEqual({
      passedCount: 0,
      total: 4,
      percentage: 0,
      allPassed: false,
      level: 'none',
    });
  });

  it('四项全通过时为 strong 且 allPassed 为 true', () => {
    expect(evaluateStrengthCore(STRONG)).toEqual({
      passedCount: 4,
      total: 4,
      percentage: 100,
      allPassed: true,
      level: 'strong',
    });
  });

  it('通过 3 项时为 medium（allPassed 优先于通过数判定）', () => {
    // 8 位字母数字，缺特殊字符
    expect(evaluateStrengthCore('abcd1234')).toMatchObject({ passedCount: 3, percentage: 75, level: 'medium' });
  });

  it('通过 2 项时为 medium', () => {
    // 字母 + 数字，长度不足且无特殊字符
    expect(evaluateStrengthCore('abc1')).toMatchObject({ passedCount: 2, percentage: 50, level: 'medium' });
    // 长度 + 数字，无字母无特殊字符
    expect(evaluateStrengthCore('12345678')).toMatchObject({ passedCount: 2, percentage: 50, level: 'medium' });
  });

  it('仅通过 1 项时为 weak', () => {
    expect(evaluateStrengthCore('abc')).toMatchObject({ passedCount: 1, percentage: 25, level: 'weak' });
    expect(evaluateStrengthCore('1')).toMatchObject({ passedCount: 1, percentage: 25, level: 'weak' });
    expect(evaluateStrengthCore('!')).toMatchObject({ passedCount: 1, percentage: 25, level: 'weak' });
  });

  it('百分比按四舍五入映射通过数', () => {
    expect([0, 25, 50, 75, 100]).toEqual([
      evaluateStrengthCore('').percentage,
      evaluateStrengthCore('abc').percentage,
      evaluateStrengthCore('abc1').percentage,
      evaluateStrengthCore('abcd1234').percentage,
      evaluateStrengthCore(STRONG).percentage,
    ]);
  });
});

describe('isWeakPassword', () => {
  it('仅 weak 等级返回 true', () => {
    expect(isWeakPassword('abc')).toBe(true);
  });

  it('medium / strong 等级返回 false', () => {
    expect(isWeakPassword('abc1')).toBe(false);
    expect(isWeakPassword(STRONG)).toBe(false);
  });

  it('空密码为 none 等级，返回 false（避免把「未输入」误报为弱密码）', () => {
    expect(isWeakPassword('')).toBe(false);
  });

  it('与 evaluateStrengthCore 的等级判定始终一致', () => {
    for (const pwd of ['', 'a', 'abc', 'abc1', 'abcd1234', STRONG, '12345678']) {
      expect(isWeakPassword(pwd)).toBe(evaluateStrengthCore(pwd).level === 'weak');
    }
  });
});

describe('STRENGTH_COLORS', () => {
  it('锁定四个等级的色值契约（与重构前 evaluatePasswordStrength 内联字面量一致）', () => {
    expect(STRENGTH_COLORS).toEqual({
      none: '#e4e7ed',
      weak: '#f56c6c',
      medium: '#e6a23c',
      strong: '#67c23a',
    });
  });

  it('每个等级都有对应色值，无遗漏', () => {
    for (const level of ['none', 'weak', 'medium', 'strong'] as const) {
      expect(STRENGTH_COLORS[level]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
