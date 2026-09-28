import { describe, expect, it } from 'vitest';
import {
  validateCardExpiry,
  validateCardNumber,
  validateCvv,
  validateEmail,
  validateIdNumber,
  validatePhone,
} from '@/utils/identity/validators';

/**
 * 身份信息校验器单元测试（纯函数，无 i18n / 无 Vue / 无 storage）
 *
 * 核心是钉死两级严格度：
 * - 格式类非法、18 位大陆身份证校验位/地区码/出生日期不符 → level:'error'（阻止保存）；
 * - 卡号 Luhn、有效期过期 → level:'warning'（允许保存）。
 * 必须覆盖「合法但不过校验位」的真实数据：社保卡/门禁卡（Luhn）；护照/港澳台通行证
 * 因非 18 位数字形态，不进入身份证校验分支，仍返回 null。
 */

describe('validateIdNumber（证件号码，两级）', () => {
  it('空值返回 null（可选字段）', () => {
    expect(validateIdNumber('')).toBeNull();
    expect(validateIdNumber('   ')).toBeNull();
  });

  it('合法 18 位身份证返回 null', () => {
    expect(validateIdNumber('11010519491231002X')).toBeNull();
  });

  it('非字母数字（空格/连字符）或长度越界 → 格式类 error', () => {
    expect(validateIdNumber('E123 4567')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberFormat',
    });
    expect(validateIdNumber('1234')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberFormat',
    });
    expect(validateIdNumber('1234567890123456789012345678901')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberFormat',
    });
  });

  it('护照/通行证等含字母的其它证件号 → null（跳过校验位，不误杀）', () => {
    expect(validateIdNumber('E12345678')).toBeNull();
    expect(validateIdNumber('1101051949123100A0')).toBeNull();
  });

  it('非 18 位 GB 格式的纯数字证件号 → null（其它证件类型）', () => {
    expect(validateIdNumber('11010519491231')).toBeNull();
    expect(validateIdNumber('1101051949123100200')).toBeNull();
  });

  it('格式对但校验位不符 → error（阻止保存）', () => {
    // 末位应为 X，改为 0/1 触发校验位失败
    expect(validateIdNumber('110105194912310020')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberChecksum',
    });
    expect(validateIdNumber('110105194912310021')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberChecksum',
    });
  });

  it('出生日期非法 → error（阻止保存）', () => {
    // 19491331：13 月不存在
    expect(validateIdNumber('110105194913310020')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberChecksum',
    });
  });

  it('地区码段全零 → error（阻止保存）', () => {
    expect(validateIdNumber('000000194912310020')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.idNumberChecksum',
    });
  });
});

describe('validateCardNumber（银行卡号，Luhn）', () => {
  it('空值返回 null', () => {
    expect(validateCardNumber('')).toBeNull();
  });

  it('Luhn 合法的 16 位卡号返回 null', () => {
    expect(validateCardNumber('4111111111111111')).toBeNull();
  });

  it('含非数字字符 → 格式类 error', () => {
    expect(validateCardNumber('4111-1111-1111-1111')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.cardNoFormat',
    });
  });

  it('位长不符（<13 或 >19）→ 格式类 error', () => {
    expect(validateCardNumber('1234')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.cardNoFormat',
    });
    expect(validateCardNumber('12345678901234567890')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.cardNoFormat',
    });
  });

  it('位长对但 Luhn 不过（社保卡/门禁卡等）→ warning（允许保存）', () => {
    expect(validateCardNumber('4111111111111112')).toEqual({
      level: 'warning',
      messageKey: 'identity.validation.cardNoChecksum',
    });
  });
});

describe('validateCardExpiry（有效期 MM/YY）', () => {
  it('空值返回 null', () => {
    expect(validateCardExpiry('')).toBeNull();
  });

  it('合法且未过期返回 null', () => {
    expect(validateCardExpiry('12/99')).toBeNull();
  });

  it('格式非法 → error', () => {
    expect(validateCardExpiry('13/25')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.cardExpiryFormat',
    });
    expect(validateCardExpiry('1225')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.cardExpiryFormat',
    });
  });

  it('格式对但已过期 → warning（允许保存）', () => {
    expect(validateCardExpiry('01/00')).toEqual({
      level: 'warning',
      messageKey: 'identity.validation.cardExpiryExpired',
    });
    expect(validateCardExpiry('12/20')).toEqual({
      level: 'warning',
      messageKey: 'identity.validation.cardExpiryExpired',
    });
  });
});

describe('validatePhone（宽松格式 + 大陆手机号精准校验）', () => {
  it('空值返回 null', () => {
    expect(validatePhone('')).toBeNull();
  });

  it('大陆手机号 / 带区号 / 带分隔符均合法', () => {
    expect(validatePhone('13812345678')).toBeNull();
    expect(validatePhone('+8613812345678')).toBeNull();
    expect(validatePhone('+86 138 1234 5678')).toBeNull();
  });

  it('11 位纯数字、1 开头但第二位非 3-9 → error（大陆手机号形态非法）', () => {
    expect(validatePhone('12345678901')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.phoneMobileFormat',
    });
    expect(validatePhone('10012345678')).toEqual({
      level: 'error',
      messageKey: 'identity.validation.phoneMobileFormat',
    });
  });

  it('含字母或过短 → error', () => {
    expect(validatePhone('abc')).toEqual({ level: 'error', messageKey: 'identity.validation.phoneFormat' });
    expect(validatePhone('12345')).toEqual({ level: 'error', messageKey: 'identity.validation.phoneFormat' });
  });
});

describe('validateEmail（格式类）', () => {
  it('空值返回 null', () => {
    expect(validateEmail('')).toBeNull();
  });

  it('合法邮箱返回 null', () => {
    expect(validateEmail('a@b.com')).toBeNull();
  });

  it('缺失 @ / 缺失域名 / 含空格 → error', () => {
    expect(validateEmail('ab.com')).toEqual({ level: 'error', messageKey: 'identity.validation.emailFormat' });
    expect(validateEmail('a@b')).toEqual({ level: 'error', messageKey: 'identity.validation.emailFormat' });
    expect(validateEmail('a b@c.com')).toEqual({ level: 'error', messageKey: 'identity.validation.emailFormat' });
  });
});

describe('validateCvv（3–4 位数字）', () => {
  it('空值返回 null', () => {
    expect(validateCvv('')).toBeNull();
  });

  it('3 位或 4 位数字返回 null', () => {
    expect(validateCvv('123')).toBeNull();
    expect(validateCvv('1234')).toBeNull();
  });

  it('位数不符或含字母 → error', () => {
    expect(validateCvv('12')).toEqual({ level: 'error', messageKey: 'identity.validation.cvvFormat' });
    expect(validateCvv('12345')).toEqual({ level: 'error', messageKey: 'identity.validation.cvvFormat' });
    expect(validateCvv('12a')).toEqual({ level: 'error', messageKey: 'identity.validation.cvvFormat' });
  });
});
