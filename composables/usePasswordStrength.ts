import { computed, ref, watch, type Ref } from 'vue';
import { isCommonPassword } from '@/utils/weakPasswordDict';
import { t } from '@/utils/i18n';

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
    { label: t('strength.ruleMinLength'), passed: pwd.length >= 8 },
    { label: t('strength.ruleHasLetter'), passed: /[a-zA-Z]/.test(pwd) },
    { label: t('strength.ruleHasNumber'), passed: /\d/.test(pwd) },
    {
      label: t('strength.ruleHasSymbol'),
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
  let label = t('strength.weak');
  let level: StrengthLevel = 'weak';

  if (allPassed) {
    color = '#67c23a';
    label = t('strength.strong');
    level = 'strong';
  } else if (passedCount >= 2) {
    color = '#e6a23c';
    label = t('strength.medium');
    level = 'medium';
  }

  return { percentage, color, label, allPassed, level };
}

/**
 * 含字典校验的异步密码强度评估（纯函数）
 *
 * 在同步规则基础上追加「是否为常见泄露密码」判定（懒加载字典，零联网）。
 * 用于安全体检批量场景或需要完整强度结果的异步上下文。
 *
 * @param pwd 待评估的密码明文
 * @returns 包含字典校验的完整强度结果
 */
export async function evaluatePasswordStrengthAsync(
  pwd: string,
): Promise<PasswordStrengthResult & { isBreached: boolean }> {
  const baseResult = evaluatePasswordStrength(pwd);
  if (!pwd) {
    return { ...baseResult, isBreached: false };
  }

  const breached = await isCommonPassword(pwd);

  // 命中字典：无论其他规则如何，强制降级为 weak
  if (breached) {
    return {
      percentage: Math.min(baseResult.percentage, 25),
      color: '#f56c6c',
      label: t('strength.weak'),
      allPassed: false,
      level: 'weak',
      isBreached: true,
    };
  }

  return { ...baseResult, isBreached: false };
}

/**
 * 密码强度校验 Composable
 *
 * 对传入的密码 ref 实时计算强度等级、规则逐条校验结果、进度条百分比与颜色。
 * 新增字典校验：异步懒加载 top-1000 常见泄露密码列表，命中时强制判定为弱密码。
 * 可在主密码设置、密码表单等多处复用。
 *
 * @param passwordRef 密码值的响应式引用
 * @returns 强度计算结果与规则列表
 */
export function usePasswordStrength(passwordRef: Ref<string>) {
  /** 密码规则逐条校验结果（同步，不含字典规则） */
  const baseRules = computed<PasswordRuleItem[]>(() => evaluatePasswordRules(passwordRef.value));

  /** 字典校验结果（异步更新） */
  const isBreached = ref(false);

  /** 含字典规则的完整规则列表 */
  const rules = computed<PasswordRuleItem[]>(() => [
    ...baseRules.value,
    { label: t('strength.ruleNotBreached'), passed: !isBreached.value },
  ]);

  /** 密码强度计算结果（字典命中时强制降级为 weak） */
  const strength = computed<PasswordStrengthResult>(() => {
    const base = evaluatePasswordStrength(passwordRef.value);
    if (isBreached.value) {
      return {
        percentage: Math.min(base.percentage, 25),
        color: '#f56c6c',
        label: t('strength.weak'),
        allPassed: false,
        level: 'weak',
      };
    }
    return base;
  });

  // 异步校验字典：仅在密码变化时触发。
  // 注意：禁止使用 { immediate: true }——它会在 composable 调用瞬间立即求值
  // passwordRef（computed getter），若调用方的 getter 闭包引用了后声明的变量
  //（如 App.vue 中的 setupForm）会触发 TDZ ReferenceError 导致整页白屏。
  // 初始密码为空时 isBreached 默认 false 即为正确初值，无需立即校验。
  //
  // 竞态保护：用户快速输入时异步字典校验可能乱序返回，
  // 使用递增计数器确保只有最新一次调用的结果才写入 isBreached。
  let checkId = 0;
  watch(passwordRef, async pwd => {
    const id = ++checkId;
    if (!pwd) {
      isBreached.value = false;
      return;
    }
    const result = await isCommonPassword(pwd);
    if (id === checkId) {
      isBreached.value = result;
    }
  });

  return { rules, strength, isBreached };
}
