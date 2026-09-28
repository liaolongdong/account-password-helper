/**
 * 身份信息表单校验规则工厂（贴附 i18n，与 validators 分文件）
 *
 * `utils/identity/validators.ts` 保持零 i18n / 零 Vue，只输出
 * `{ level, messageKey }`；本模块据此产出 Element Plus `FormRules`（error 级
 * 阻止保存）与 `collectIdentityWarnings`（warning 级允许保存但提示）。
 * 对标 `utils/formValidators.ts` 的 `createPasswordFormRules(t)` 口径。
 *
 * @module utils/identity/formRules
 */
import type { FormRules } from 'element-plus';
import type { IdentityPayload } from './types';
import {
  validateCardExpiry,
  validateCardNumber,
  validateCvv,
  validateEmail,
  validateIdNumber,
  validatePhone,
  type IdentityValidationResult,
} from './validators';

/** 单个字段校验器工厂：把 validators 的 error 级结果转成 EP 校验错误 */
function errorRule(t: (key: string) => string, fn: (value: string) => IdentityValidationResult | null) {
  return (_rule: unknown, value: string, callback: (error?: Error) => void) => {
    if (!value || !value.trim()) {
      callback();
      return;
    }
    const result = fn(value);
    if (result && result.level === 'error') {
      callback(new Error(t(result.messageKey)));
    } else {
      callback();
    }
  };
}

/**
 * 创建身份表单的 Element Plus 校验规则（仅 error 级，warning 级不阻塞）
 *
 * 可选字段空值一律放行；凡 `level:'error'` 均阻止保存（含格式类、18 位大陆身份证
 * 校验位、大陆手机号形态），`level:'warning'`（卡号 Luhn / 有效期过期）交给
 * {@link collectIdentityWarnings} 提示。
 *
 * @param t 国际化翻译函数
 * @returns FormRules（键与 IdentityPayload 的可校验字段一一对应）
 */
export function createIdentityFormRules(t: (key: string) => string): FormRules {
  return {
    idNumber: [{ validator: errorRule(t, validateIdNumber), trigger: 'blur' }],
    cardNo: [{ validator: errorRule(t, validateCardNumber), trigger: 'blur' }],
    cardExpiry: [{ validator: errorRule(t, validateCardExpiry), trigger: 'blur' }],
    phone: [{ validator: errorRule(t, validatePhone), trigger: 'blur' }],
    email: [{ validator: errorRule(t, validateEmail), trigger: 'blur' }],
    cardCvv: [{ validator: errorRule(t, validateCvv), trigger: 'blur' }],
  };
}

/**
 * 收集 payload 全部字段的 warning 级校验提示（返回 messageKey，调用方翻译）
 *
 * 只有卡号 Luhn、有效期已过期会产生 warning（允许保存）；18 位大陆身份证校验位
 * 已升级为 error，由 el-form 规则内联阻止保存，不在此列。
 *
 * @param payload 表单负载
 * @returns warning 级 messageKey 列表（去重后的出现顺序）
 */
export function collectIdentityWarnings(payload: IdentityPayload): string[] {
  const keys: string[] = [];
  // 可选字段空值不产生 warning（validators 以非空 string 为入参）
  const results = [
    payload.cardNo ? validateCardNumber(payload.cardNo) : null,
    payload.cardExpiry ? validateCardExpiry(payload.cardExpiry) : null,
  ];
  for (const result of results) {
    if (result && result.level === 'warning' && !keys.includes(result.messageKey)) {
      keys.push(result.messageKey);
    }
  }
  return keys;
}
