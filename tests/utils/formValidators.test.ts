/**
 * 表单校验规则工厂测试（createPasswordFormRules / createUrlValidator）
 *
 * 核心是锁定 `tag` 字段的所有权边界：标签约束不归校验层，而归各自的写入通道
 * （Options 由 `usePasswordManagement` 的 `tagArray` setter 归一化，SidePanel 由
 * 输入框 `maxlength` + background `FIELD_LIMITS` 兜底）。
 *
 * 回归背景：工厂曾产出 `tag: [{ max: 50 }]`，而 `tagArray` 的合法容量是
 * `MAX_TAG_COUNT × MAX_TAG_LENGTH + (MAX_TAG_COUNT - 1)` = 92 字符。Element Plus 的
 * `form.validate()` 走 `validateField(undefined)`，其 `getFilteredRule` 在 trigger 为空时
 * 放行全部规则（`if (!rule.trigger || !trigger) return true`），因此含 2 个 25 字符标签
 * （序列化后 51 字符）的条目在编辑态会被 `validate()` 直接拒绝——用户改任何字段都存不下。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FormItemRule, FormRules } from 'element-plus';
import { createPasswordFormRules, createUrlValidator } from '@/utils/formValidators';
import { MAX_TAG_COUNT, MAX_TAG_LENGTH } from '@/composables/usePasswordManagement';
import { stringifyTags } from '@/utils/tagUtils';

/** 工厂实际请求过的 i18n 键（用于断言其文案面，防止已删除的死键被重新引用） */
const requestedKeys: string[] = [];

/** 记录型翻译函数：原样返回 key，使规则的 message 即为 i18n 键名 */
const t = (key: string): string => {
  requestedKeys.push(key);
  return key;
};

/**
 * 取出某字段的规则数组
 *
 * 工厂对每个字段都产出数组，此处兼容 `FormRules` 允许的单条写法以完成类型收窄。
 *
 * @param rules 规则集合
 * @param field 字段名
 * @returns 规则数组（字段不存在时为空数组）
 */
function rulesOf(rules: FormRules, field: string): FormItemRule[] {
  const rule = rules[field];
  if (!rule) return [];
  return Array.isArray(rule) ? rule : [rule as FormItemRule];
}

/**
 * 执行 URL 校验器并返回错误消息
 *
 * @param value 待校验的网址输入
 * @returns 错误消息（即 i18n 键）；通过校验时为 undefined
 */
function validateUrl(value: string): string | undefined {
  let message: string | undefined;
  createUrlValidator(t)(undefined, value, error => {
    message = error?.message;
  });
  return message;
}

describe('createPasswordFormRules', () => {
  beforeEach(() => {
    requestedKeys.length = 0;
  });

  it('只约束 username / password / url / remark，不含 tag', () => {
    expect(Object.keys(createPasswordFormRules(t)).sort()).toEqual(['password', 'remark', 'url', 'username']);
  });

  it('消费的 i18n 键与保留字段一一对应（不含已删除的 form.tagMax）', () => {
    createPasswordFormRules(t);

    expect([...new Set(requestedKeys)].sort()).toEqual([
      'form.passwordMax',
      'form.remarkMax',
      'form.urlMax',
      'form.usernameMax',
      'form.usernameRequired',
    ]);
  });

  it('各字段长度上限与必填约束保持不变', () => {
    const rules = createPasswordFormRules(t);

    expect(rulesOf(rules, 'username')).toEqual([
      { required: true, message: 'form.usernameRequired', trigger: 'blur' },
      { max: 50, message: 'form.usernameMax', trigger: 'blur' },
    ]);
    expect(rulesOf(rules, 'password')).toEqual([{ max: 50, message: 'form.passwordMax', trigger: 'blur' }]);
    expect(rulesOf(rules, 'remark')).toEqual([{ max: 1000, message: 'form.remarkMax', trigger: 'blur' }]);

    const urlRules = rulesOf(rules, 'url');
    expect(urlRules[0]).toEqual({ max: 100, message: 'form.urlMax', trigger: 'blur' });
    expect(urlRules[1].trigger).toBe('blur');
    expect(typeof urlRules[1].validator).toBe('function');
  });

  it('tagArray 允许的最长标签串不受任何规则约束', () => {
    // 合法上限：MAX_TAG_COUNT 个互异标签，每个最长 MAX_TAG_LENGTH 字符
    const longestLegalTags = Array.from({ length: MAX_TAG_COUNT }, (_, index) =>
      String.fromCharCode(65 + index).repeat(MAX_TAG_LENGTH),
    );
    const longestLegalTag = stringifyTags(longestLegalTags);

    expect(longestLegalTag).toHaveLength(MAX_TAG_COUNT * MAX_TAG_LENGTH + (MAX_TAG_COUNT - 1));
    // 92 字符远超修复前规则的 max: 50，正是当时误拦合法组合的根因
    expect(longestLegalTag.length).toBeGreaterThan(50);
    expect(createPasswordFormRules(t)).not.toHaveProperty('tag');
  });
});

describe('createUrlValidator', () => {
  beforeEach(() => {
    requestedKeys.length = 0;
  });

  it('空值与纯空白通过（网址为选填字段）', () => {
    expect(validateUrl('')).toBeUndefined();
    expect(validateUrl('   ')).toBeUndefined();
  });

  it('完整 URL 通过', () => {
    expect(validateUrl('https://example.com')).toBeUndefined();
    expect(validateUrl('https://example.com/path?a=1#frag')).toBeUndefined();
    expect(validateUrl('http://127.0.0.1:8080/admin')).toBeUndefined();
  });

  it('纯域名与带端口的 IP 通过', () => {
    expect(validateUrl('example.com')).toBeUndefined();
    expect(validateUrl('sub.example.co.uk')).toBeUndefined();
    expect(validateUrl('localhost')).toBeUndefined();
    expect(validateUrl('127.0.0.1:8080')).toBeUndefined();
  });

  it('首尾空白不影响判定', () => {
    expect(validateUrl('  example.com  ')).toBeUndefined();
  });

  it('无协议的非法字符串给出带示例的提示', () => {
    expect(validateUrl('not a url')).toBe('form.invalidUrlExample');
    expect(validateUrl('example')).toBe('form.invalidUrlExample');
    expect(validateUrl('-bad.com')).toBe('form.invalidUrlExample');
  });

  it('有协议但无法解析出主机名时提示网址无效', () => {
    expect(validateUrl('https://')).toBe('form.invalidUrl');
    expect(validateUrl('https://exa mple.com')).toBe('form.invalidUrl');
  });
});
