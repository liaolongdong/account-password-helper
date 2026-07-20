import { computed, type Ref } from 'vue';

/** 密码强度等级 */
export type StrengthLevel = 'none' | 'weak' | 'medium' | 'strong';

/** 密码规则校验项 */
export interface PasswordRuleItem {
  /** 规则描述 */
  label: string;
  /** 是否通过 */
  passed: boolean;
}

/** 密码强度评估结果 */
export interface PasswordStrengthResult {
  /** 百分比（0~100） */
  percentage: number;
  /** 进度条颜色 */
  color: string;
  /** 等级文本 */
  label: string;
  /** 是否全部规则通过 */
  allPassed: boolean;
  /** 强度等级 */
  level: StrengthLevel;
}

/**
 * 逐条校验密码规则（纯函数）
 *
 * 抽离自 {@link usePasswordStrength}，使响应式 Composable 与批量健康统计
 *（`utils/passwordHealth.ts`）等非响应式场景共享同一套规则，避免逻辑重复。
 *
 * @param pwd 待校验的密码明文
 * @returns 规则逐条校验结果
 */
export function evaluatePasswordRules(pwd: string): PasswordRuleItem[] {
  return [
    { label: '至少 8 个字符', passed: pwd.length >= 8 },
    { label: '包含字母（a-z 或 A-Z）', passed: /[a-zA-Z]/.test(pwd) },
    { label: '包含数字（0-9）', passed: /\d/.test(pwd) },
    {
      label: '包含特殊字符（如 !@#$%...）',
      passed: /[!@#$%^&*()_+\-={[\]};':"\\|,.<>/?~`]/.test(pwd),
    },
  ];
}

/**
 * 计算密码强度评估结果（纯函数）
 *
 * 与旧版 Composable 内联逻辑行为完全一致：空密码返回 `none`，否则按
 * 通过规则数映射为弱/中/强，供表单实时校验与批量健康统计共用。
 *
 * @param pwd 待评估的密码明文
 * @returns 强度百分比、颜色、等级文本与等级枚举
 */
export function evaluatePasswordStrength(pwd: string): PasswordStrengthResult {
  if (!pwd) {
    return { percentage: 0, color: '#e4e7ed', label: '', allPassed: false, level: 'none' };
  }

  const rules = evaluatePasswordRules(pwd);
  const passedCount = rules.filter(r => r.passed).length;
  const total = rules.length;
  const percentage = Math.round((passedCount / total) * 100);
  const allPassed = passedCount === total;

  let color = '#f56c6c';
  let label = '弱';
  let level: StrengthLevel = 'weak';

  if (allPassed) {
    color = '#67c23a';
    label = '强';
    level = 'strong';
  } else if (passedCount >= 2) {
    color = '#e6a23c';
    label = '中';
    level = 'medium';
  }

  return { percentage, color, label, allPassed, level };
}

/**
 * 密码强度校验 Composable
 *
 * 对传入的密码 ref 实时计算强度等级、规则逐条校验结果、进度条百分比与颜色。
 * 可在主密码设置、密码表单等多处复用。
 *
 * @param passwordRef 密码值的响应式引用
 * @returns 强度计算结果与规则列表
 */
export function usePasswordStrength(passwordRef: Ref<string>) {
  /** 密码规则逐条校验结果 */
  const rules = computed<PasswordRuleItem[]>(() => evaluatePasswordRules(passwordRef.value));

  /** 密码强度计算结果 */
  const strength = computed<PasswordStrengthResult>(() => evaluatePasswordStrength(passwordRef.value));

  return { rules, strength };
}
