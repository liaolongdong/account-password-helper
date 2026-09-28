/**
 * 身份信息字段校验器（纯函数，零 i18n、零 Vue 依赖）
 *
 * 对标 `utils/passwordStrengthCore.ts` 的分层口径：本模块只输出「级别 + 文案 key」，
 * 不产出任何展示文案；`utils/identity/formRules.ts` 在其上贴附 i18n 翻译，
 * 据此决定是阻止保存（error）还是仅提示（warning）。
 *
 * 两级严格度：
 * - 格式类（长度/字符集明显非法）与 18 位大陆身份证校验位（GB11643 mod 11）→ level:'error'，阻止保存；
 * - 卡号 Luhn、有效期已过期 → level:'warning'，允许保存。
 * 理由：真实用户会存社保卡/门禁卡（不过 Luhn），硬阻止等于这些人根本存不进去；误杀合法数据的
 * 代价 > 放过一个用户自己看得见的错字。而 18 位数字形态（`^\d{17}[\dXx]$`）几乎只对应大陆居民身份证，
 * 其校验位不符基本可判定为录入笔误，故升级为 error；护照、港澳台通行证等含字母证件号不进入该分支，不受影响。
 *
 * @module utils/identity/validators
 */

/** 校验结果级别：error 阻止保存，warning 允许保存但提示 */
export type IdentityValidationLevel = 'error' | 'warning';

/** 校验结果：通过返回 null，失败返回级别与 i18n 文案 key（见 identity.json） */
export interface IdentityValidationResult {
  level: IdentityValidationLevel;
  messageKey: string;
}

// ── 通用 ──────────────────────────────────────────────

/** 空值视为「未填」：可选字段跳过校验 */
function isEmpty(value: string | undefined | null): boolean {
  return value == null || value.trim() === '';
}

// ── 证件号码（GB11643-1999） ──────────────────────────

/** GB11643 mod 11 权重 */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;

/** GB11643 mod 11 校验码表 */
const ID_CHECK_CODES = '10X98765432';

/** 判断 y/m/d 是否为真实日历日期（避免 Feb 30 → Mar 2 这类溢出） */
function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  return d <= daysInMonth;
}

/**
 * 校验证件号码（格式类 + 校验位类两级）
 *
 * - 空值 → null（可选字段）；
 * - 非 `^[A-Za-z0-9]{5,30}$`（含空格、连字符等非常规字符或长度越界）→ error（阻止保存）；
 * - 形如 18 位大陆居民身份证（`^\d{17}[\dXx]$`）才做 GB11643 校验位/地区码/出生日期检查，
 *   不符 → error（阻止保存；此类形态几乎只可能是身份证，校验位不符即视为录入笔误）；
 * - 护照号、港澳台通行证号等含字母的其它证件号 → null（跳过校验位，不误杀）。
 *
 * @param value 证件号码
 */
export function validateIdNumber(value: string): IdentityValidationResult | null {
  if (isEmpty(value)) return null;
  if (!/^[A-Za-z0-9]{5,30}$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.idNumberFormat' };
  }
  if (!/^\d{17}[\dXx]$/.test(value)) {
    return null;
  }

  const body = value.slice(0, 17);
  const last = value[17].toUpperCase();

  // 地区码段（前 6 位）非全零
  const region = value.slice(0, 6);
  // 出生日期段（第 7-14 位，YYYYMMDD）须为真实日期
  const year = Number(value.slice(6, 10));
  const month = Number(value.slice(10, 12));
  const day = Number(value.slice(12, 14));
  // mod 11 校验位
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body[i]) * ID_WEIGHTS[i];
  const expected = ID_CHECK_CODES[sum % 11];

  if (region === '000000' || !isValidDate(year, month, day) || expected !== last) {
    return { level: 'error', messageKey: 'identity.validation.idNumberChecksum' };
  }
  return null;
}

// ── 银行卡号（Luhn） ───────────────────────────────────

/** Luhn 校验（右起偶位翻倍、>9 减 9） */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * 校验银行卡号（13–19 位数字 + Luhn）
 *
 * - 空值 → null；
 * - 非 13–19 位纯数字 → error（阻止保存）；
 * - 位长对但 Luhn 不过（社保卡/公交卡/门禁卡等）→ warning（允许保存）。
 * 刻意不做 IIN/BIN 前缀归属校验（易误报）。
 *
 * @param value 银行卡号
 */
export function validateCardNumber(value: string): IdentityValidationResult | null {
  if (isEmpty(value)) return null;
  if (!/^\d{13,19}$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.cardNoFormat' };
  }
  if (!luhnCheck(value)) {
    return { level: 'warning', messageKey: 'identity.validation.cardNoChecksum' };
  }
  return null;
}

// ── 银行卡有效期（MM/YY） ─────────────────────────────

/**
 * 校验银行卡有效期（MM/YY）
 *
 * - 空值 → null；
 * - 非 `MM/YY` → error（阻止保存）；
 * - 格式对但已过期 → warning（允许保存，仅提示）。
 *
 * @param value 有效期
 */
export function validateCardExpiry(value: string): IdentityValidationResult | null {
  if (isEmpty(value)) return null;
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.cardExpiryFormat' };
  }
  const month = Number(value.slice(0, 2));
  const year = 2000 + Number(value.slice(3, 5));
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { level: 'warning', messageKey: 'identity.validation.cardExpiryExpired' };
  }
  return null;
}

// ── 手机号 / 邮箱 / CVV ───────────────────────────────

/**
 * 校验手机号（两级：宽松国际格式 + 大陆手机号精准校验）
 *
 * - 空值 → null（可选字段）；
 * - 非 `^\+?[\d\s-]{6,20}$`（含非法字符或长度越界）→ error（阻止保存）；
 * - 恰为 11 位纯数字且以 1 开头（大陆手机号形态）但第二位不在 3-9 → error（阻止保存）；
 * - 其余（含 + 区号、空格、短横的国际号码，或非大陆形态）→ null（不误杀）。
 *
 * @param value 手机号
 */
export function validatePhone(value: string): IdentityValidationResult | null {
  if (isEmpty(value)) return null;
  if (!/^\+?[\d\s-]{6,20}$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.phoneFormat' };
  }
  if (/^1\d{10}$/.test(value) && !/^1[3-9]\d{9}$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.phoneMobileFormat' };
  }
  return null;
}

/**
 * 校验邮箱（格式类，就地写正则）
 *
 * 正则来源：`utils/emailBackup.ts` 既有校验同款，为避免反向依赖备份模块
 * 制造跨域耦合，在此复制同一正则并注明来源。
 *
 * @param value 邮箱
 */
export function validateEmail(value: string): IdentityValidationResult | null {
  if (isEmpty(value)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.emailFormat' };
  }
  return null;
}

/**
 * 校验 CVV（3–4 位数字）
 *
 * @param value CVV
 */
export function validateCvv(value: string): IdentityValidationResult | null {
  if (isEmpty(value)) return null;
  if (!/^\d{3,4}$/.test(value)) {
    return { level: 'error', messageKey: 'identity.validation.cvvFormat' };
  }
  return null;
}
