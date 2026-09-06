/**
 * usePasswordStrength composable 行为等价测试
 *
 * 强度判定已下沉到 `utils/passwordStrengthCore.ts`，composable 退化为「贴标签薄层」。
 * 本文件锁定其对外契约与重构前**逐字段一致**：percentage / color / label / allPassed /
 * level 五个字段，以及规则清单的条数、顺序与文案 key，防止抽离过程改变既有 UI 表现。
 *
 * 说明：测试环境未注册 i18n 语言包，`t()` 对未注册 key 原样返回 key 本身，
 * 因此这里断言的是**文案 key**——既证明映射关系正确，也不受语言切换影响。
 */
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import {
  evaluatePasswordRules,
  evaluatePasswordStrength,
  usePasswordStrength,
} from '@/composables/usePasswordStrength';
import { evaluateStrengthRules } from '@/utils/passwordStrengthCore';

/** 强密码样本：四项规则全通过 */
const STRONG = 'Abcdef1!';

/** 重构前 evaluatePasswordRules 的规则文案 key 顺序 */
const RULE_KEYS = [
  'strength.ruleMinLength',
  'strength.ruleHasLetter',
  'strength.ruleHasNumber',
  'strength.ruleHasSymbol',
];

describe('evaluatePasswordStrength', () => {
  it('空密码：none 等级、灰色、空文案', () => {
    expect(evaluatePasswordStrength('')).toEqual({
      percentage: 0,
      color: '#e4e7ed',
      label: '',
      allPassed: false,
      level: 'none',
    });
  });

  it('仅通过 1 项：weak 等级、红色', () => {
    expect(evaluatePasswordStrength('abc')).toEqual({
      percentage: 25,
      color: '#f56c6c',
      label: 'strength.weak',
      allPassed: false,
      level: 'weak',
    });
  });

  it('通过 2 项：medium 等级、橙色', () => {
    expect(evaluatePasswordStrength('abc1')).toEqual({
      percentage: 50,
      color: '#e6a23c',
      label: 'strength.medium',
      allPassed: false,
      level: 'medium',
    });
  });

  it('通过 3 项仍为 medium（allPassed 才算 strong）', () => {
    expect(evaluatePasswordStrength('abcd1234')).toMatchObject({
      percentage: 75,
      color: '#e6a23c',
      level: 'medium',
      allPassed: false,
    });
  });

  it('四项全通过：strong 等级、绿色、allPassed 为 true', () => {
    expect(evaluatePasswordStrength(STRONG)).toEqual({
      percentage: 100,
      color: '#67c23a',
      label: 'strength.strong',
      allPassed: true,
      level: 'strong',
    });
  });

  it('等级与颜色始终成对匹配核心模块的色值契约', () => {
    const cases: Array<[string, string, string]> = [
      ['', 'none', '#e4e7ed'],
      ['abc', 'weak', '#f56c6c'],
      ['abc1', 'medium', '#e6a23c'],
      [STRONG, 'strong', '#67c23a'],
    ];
    for (const [pwd, level, color] of cases) {
      const result = evaluatePasswordStrength(pwd);
      expect(result.level, `${pwd} 的等级`).toBe(level);
      expect(result.color, `${pwd} 的颜色`).toBe(color);
    }
  });
});

describe('evaluatePasswordRules', () => {
  it('固定返回 4 条规则，文案 key 顺序与重构前一致', () => {
    expect(evaluatePasswordRules(STRONG).map(rule => rule.label)).toEqual(RULE_KEYS);
  });

  it('空密码不短路，4 条规则全部未通过（供 UI 渲染完整清单）', () => {
    const rules = evaluatePasswordRules('');
    expect(rules).toHaveLength(4);
    expect(rules.map(rule => rule.label)).toEqual(RULE_KEYS);
    expect(rules.every(rule => !rule.passed)).toBe(true);
  });

  it('强密码 4 条规则全部通过', () => {
    expect(evaluatePasswordRules(STRONG).every(rule => rule.passed)).toBe(true);
  });

  it('passed 标志与核心模块逐条一致（薄层只贴文案，不得改变判定）', () => {
    for (const pwd of ['', 'abc', 'abc1', 'abcd1234', STRONG]) {
      expect(
        evaluatePasswordRules(pwd).map(rule => rule.passed),
        `${pwd} 的逐条判定`,
      ).toEqual(evaluateStrengthRules(pwd).map(rule => rule.passed));
    }
  });
});

describe('usePasswordStrength', () => {
  it('初始 isBreached 为 false（watch 未使用 immediate，不触发异步字典校验）', () => {
    const { isBreached } = usePasswordStrength(ref(STRONG));
    expect(isBreached.value).toBe(false);
  });

  it('规则清单为 4 条基础规则 + 1 条字典规则', () => {
    const { rules } = usePasswordStrength(ref(STRONG));
    expect(rules.value).toHaveLength(5);
    expect(rules.value.slice(0, 4).map(rule => rule.label)).toEqual(RULE_KEYS);
    expect(rules.value[4]).toEqual({ label: 'strength.ruleNotBreached', passed: true });
  });

  it('未命中字典时 strength 与同步评估结果完全一致', () => {
    const { strength } = usePasswordStrength(ref(STRONG));
    expect(strength.value).toEqual(evaluatePasswordStrength(STRONG));
  });

  it('strength 随密码 ref 响应式更新', () => {
    const pwd = ref('');
    const { strength } = usePasswordStrength(pwd);
    expect(strength.value.level).toBe('none');

    pwd.value = 'abc';
    expect(strength.value).toMatchObject({ level: 'weak', percentage: 25 });

    pwd.value = STRONG;
    expect(strength.value).toMatchObject({ level: 'strong', percentage: 100, allPassed: true });
  });
});
