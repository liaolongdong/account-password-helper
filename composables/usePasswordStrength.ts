import { computed, ref, watch, type Ref } from 'vue';
import { isCommonPassword } from '@/utils/weakPasswordDict';
import { t } from '@/utils/i18n';
import {
  STRENGTH_COLORS,
  evaluateStrengthCore,
  evaluateStrengthRules,
  type StrengthLevel,
  type StrengthRuleId,
} from '@/utils/passwordStrengthCore';

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
 * 取强度规则的展示文案
 *
 * 刻意保留 `t('...')` 字面量调用（而非把 key 存入映射表再索引）：
 * `tests/utils/i18nBundles.test.ts` 靠静态扫描源码中的 `t('key')` 校验命名空间
 * 注册完整性，key 一旦脱离字面量形式就会从扫描与 grep 审计中隐身。
 * 逐次调用（而非模块加载期求值）也保证了语言切换的响应式生效。
 *
 * @param id 规则标识
 * @returns 对应语言的规则文案
 */
function ruleLabel(id: StrengthRuleId): string {
  switch (id) {
    case 'minLength':
      return t('strength.ruleMinLength');
    case 'hasLetter':
      return t('strength.ruleHasLetter');
    case 'hasNumber':
      return t('strength.ruleHasNumber');
    case 'hasSymbol':
      return t('strength.ruleHasSymbol');
  }
}

/**
 * 取强度等级的展示文案
 *
 * `none`（空密码）不展示文案，返回空串——与重构前行为一致。
 *
 * @param level 强度等级
 * @returns 对应语言的等级文案；`none` 等级返回空串
 */
function levelLabel(level: StrengthLevel): string {
  switch (level) {
    case 'none':
      return '';
    case 'weak':
      return t('strength.weak');
    case 'medium':
      return t('strength.medium');
    case 'strong':
      return t('strength.strong');
  }
}

/**
 * 逐条校验密码规则（供 Vue 模板渲染）
 *
 * 判定逻辑完全委托 `utils/passwordStrengthCore.ts`，本函数只负责贴附 i18n 文案，
 * 禁止在此处重新编写正则或阈值，以免与 background / 安全体检的口径发生漂移。
 * 保留 {@link usePasswordStrength} 与批量健康统计（`utils/passwordHealth.ts`）共用。
 *
 * @param pwd 待校验的密码明文
 * @returns 规则逐条校验结果（顺序与核心模块一致）
 */
export function evaluatePasswordRules(pwd: string): PasswordRuleItem[] {
  return evaluateStrengthRules(pwd).map(rule => ({
    label: ruleLabel(rule.id),
    passed: rule.passed,
  }));
}

/**
 * 计算密码强度评估结果（纯函数）
 *
 * 数值与等级委托核心模块，本函数只负责映射颜色与 i18n 文案：空密码返回 `none`，
 * 否则按通过规则数映射为弱/中/强，供表单实时校验与批量健康统计共用。
 * 返回字段与重构前逐字段一致。
 *
 * @param pwd 待评估的密码明文
 * @returns 强度百分比、颜色、等级文本与等级枚举
 */
export function evaluatePasswordStrength(pwd: string): PasswordStrengthResult {
  const core = evaluateStrengthCore(pwd);
  return {
    percentage: core.percentage,
    color: STRENGTH_COLORS[core.level],
    label: levelLabel(core.level),
    allPassed: core.allPassed,
    level: core.level,
  };
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
      color: STRENGTH_COLORS.weak,
      label: levelLabel('weak'),
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
        color: STRENGTH_COLORS.weak,
        label: levelLabel('weak'),
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
