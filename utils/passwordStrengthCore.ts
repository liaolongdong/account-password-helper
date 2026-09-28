/**
 * 密码强度规则核心（纯函数，零 i18n、零 Vue 依赖）
 *
 * 强度判定规则的单一事实来源。刻意不依赖 `@/utils/i18n`（Vue 完整 i18n）：
 * background Service Worker 与 content script 都需要判定密码强度，若规则住在
 * `composables/usePasswordStrength.ts` 里，引用它会把 Vue i18n 拖进 SW / 内容脚本包，
 * 违反首屏与包体积约束。
 *
 * 分层约定：
 * - 本模块只输出**规则标识与数值结果**，不含任何展示文案与颜色语义之外的表现层内容；
 * - `composables/usePasswordStrength.ts` 在其上贴附 i18n 文案，供 Vue UI 消费；
 * - 两侧共用同一套判定，禁止各自复制正则或阈值。
 *
 * @module utils/passwordStrengthCore
 */

/** 密码强度等级 */
export type StrengthLevel = 'none' | 'weak' | 'medium' | 'strong';

/**
 * 强度规则标识（数组顺序即 UI 展示顺序）
 *
 * 与 `utils/i18n/locales/{zh-CN,en}/strength.json` 的 `strength.rule*` key 一一对应，
 * 标识到文案的映射由 composable 侧的 `ruleLabel()` 持有。
 */
export type StrengthRuleId = 'minLength' | 'hasLetter' | 'hasNumber' | 'hasSymbol';

/** 单条规则的校验结果（不含展示文案，文案由调用方按各自 i18n 体系贴附） */
export interface StrengthRuleResult {
  /** 规则标识 */
  id: StrengthRuleId;
  /** 是否通过 */
  passed: boolean;
}

/** 强度核心结果（仅数值与等级，不含文案/颜色等表现层字段） */
export interface StrengthCore {
  /** 通过的规则数 */
  passedCount: number;
  /** 规则总数 */
  total: number;
  /** 通过率百分比（0~100，四舍五入） */
  percentage: number;
  /** 是否全部规则通过 */
  allPassed: boolean;
  /** 强度等级 */
  level: StrengthLevel;
}

/** 规则标识顺序（即 UI 展示顺序，历史行为保持不变） */
const RULE_IDS: readonly StrengthRuleId[] = ['minLength', 'hasLetter', 'hasNumber', 'hasSymbol'];

/**
 * 各等级对应色值（与 Element Plus 语义色一致）
 *
 * 取值即重构前 `evaluatePasswordStrength` 内联的字面量，逐一对应，未作任何调整。
 */
export const STRENGTH_COLORS: Record<StrengthLevel, string> = {
  none: '#e4e7ed',
  weak: '#f56c6c',
  medium: '#e6a23c',
  strong: '#67c23a',
};

/** 规则标识 → 判定谓词（正则与阈值为历史取值，改动会同时影响 UI 校验与安全体检口径） */
const RULE_PREDICATES: Record<StrengthRuleId, (pwd: string) => boolean> = {
  minLength: pwd => pwd.length >= 8,
  hasLetter: pwd => /[a-zA-Z]/.test(pwd),
  hasNumber: pwd => /\d/.test(pwd),
  hasSymbol: pwd => /[!@#$%^&*()_+\-={[\]};':"\\|,.<>/?~`]/.test(pwd),
};

/**
 * 逐条校验密码规则（纯函数，不含展示文案）
 *
 * 空字符串不短路：与重构前行为一致，逐条谓词对空串自然全部返回 false，
 * 使调用方在空密码时仍能渲染完整的规则清单。
 *
 * @param pwd 待校验的密码明文
 * @returns 按 {@link StrengthRuleId} 固定顺序排列的校验结果
 */
export function evaluateStrengthRules(pwd: string): StrengthRuleResult[] {
  return RULE_IDS.map(id => ({ id, passed: RULE_PREDICATES[id](pwd) }));
}

/**
 * 计算密码强度核心结果（纯函数）
 *
 * 等级映射与重构前完全一致：空密码为 `none`；全部通过为 `strong`；
 * 通过数 ≥ 2 为 `medium`；其余为 `weak`。
 *
 * @param pwd 待评估的密码明文
 * @returns 通过数、百分比、全通过标志与强度等级
 */
export function evaluateStrengthCore(pwd: string): StrengthCore {
  const total = RULE_IDS.length;

  if (!pwd) {
    return { passedCount: 0, total, percentage: 0, allPassed: false, level: 'none' };
  }

  const passedCount = evaluateStrengthRules(pwd).filter(rule => rule.passed).length;
  const allPassed = passedCount === total;

  let level: StrengthLevel = 'weak';
  if (allPassed) {
    level = 'strong';
  } else if (passedCount >= 2) {
    level = 'medium';
  }

  return {
    passedCount,
    total,
    percentage: Math.round((passedCount / total) * 100),
    allPassed,
    level,
  };
}

/**
 * 判定密码是否属于弱密码（纯函数）
 *
 * 供无 Vue i18n 的上下文（background 保存前预检查等）复用与 UI 完全一致的弱密码口径，
 * 避免各处自行编写阈值判定导致安全体检与实际提示不一致。
 *
 * 注意：不含常见泄露密码字典校验——字典需异步懒加载，会给调用方热路径引入延迟；
 * 需要字典维度时使用 `composables/usePasswordStrength.ts` 的异步评估或安全体检。
 *
 * @param pwd 待判定的密码明文
 * @returns 强度等级为 `weak` 时返回 true；空密码为 `none`，返回 false
 */
export function isWeakPassword(pwd: string): boolean {
  return evaluateStrengthCore(pwd).level === 'weak';
}
