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
 *
 * 同一缺陷类还出现在「导入上界宽于表单容量」的历史条目上，由 `initialLengths` 参数处理，
 * 见 `createPasswordFormRules 的 initialLengths` 一节。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FormItemRule, FormRules } from 'element-plus';
import { createPasswordFormRules, createUrlValidator } from '@/utils/formValidators';
import { PASSWORD_FIELD_LIMITS, PASSWORD_FIELD_MAX_LENGTH } from '@/utils/constants';
import { MAX_PASSWORD_LEN, MAX_REMARK_LEN, MAX_URL_LEN, MAX_USERNAME_LEN } from '@/utils/backup/constants';
import { MAX_TAG_COUNT, MAX_TAG_LENGTH } from '@/composables/usePasswordManagement';
import { MAX_PASSPHRASE_LENGTH } from '@/utils/passphraseGenerator';
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
    expect(rulesOf(rules, 'password')).toEqual([
      { max: PASSWORD_FIELD_MAX_LENGTH, message: 'form.passwordMax', trigger: 'blur' },
    ]);
    expect(rulesOf(rules, 'remark')).toEqual([{ max: 1000, message: 'form.remarkMax', trigger: 'blur' }]);

    const urlRules = rulesOf(rules, 'url');
    expect(urlRules[0]).toEqual({ max: 100, message: 'form.urlMax', trigger: 'blur' });
    expect(urlRules[1].trigger).toBe('blur');
    expect(typeof urlRules[1].validator).toBe('function');
  });

  it('password 上限可容纳生成器最长输出（长助记词组编辑态不被拒）', () => {
    // 与 tag 字段同一缺陷类：validate() 在 trigger 为空时放行全部规则，
    // 故 max 小于生成器上限会让已有长口令条目的任何改动都存不下。
    const rules = createPasswordFormRules(t);
    const passwordMax = rulesOf(rules, 'password')[0].max as number;

    expect(MAX_PASSPHRASE_LENGTH).toBeGreaterThan(50);
    expect(passwordMax).toBeGreaterThanOrEqual(MAX_PASSPHRASE_LENGTH);
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

/**
 * 编辑态容量放宽（`initialLengths`）
 *
 * 回归背景：导入闸门（`utils/backup/constants.ts`）刻意比表单容量宽——为保证任何自导出
 * 文件都能回灌，超容量字段既不拒收也不截断。库里因此可能存在 remark 长 1200 之类的条目，
 * 而 `form.validate()` 不看 trigger 会放行全部规则，按原容量硬拒会让用户改任何字段都存不下
 * （与 `tag`、`password` 同一缺陷类）。放宽不影响容量本身：四个输入框的 `maxlength` 仍是
 * 标准容量，超限值只拦增不拦存，所以 `max(容量, 原长)` 不给用户任何变长的能力。
 */
describe('createPasswordFormRules 的 initialLengths', () => {
  beforeEach(() => {
    requestedKeys.length = 0;
  });

  /** 取出某字段 max 规则的上限 */
  const maxOf = (rules: FormRules, field: string): number =>
    rulesOf(rules, field).find(r => r.max !== undefined)!.max as number;

  it('缺省与空对象产出同一套标准容量规则（放宽是显式 opt-in）', () => {
    // JSON 会丢弃 validator 函数（每次调用新建闭包、引用不等），其余字段按值比较
    const toComparable = (rules: FormRules) => JSON.parse(JSON.stringify(rules));

    expect(toComparable(createPasswordFormRules(t, {}))).toEqual(toComparable(createPasswordFormRules(t)));
    expect(maxOf(createPasswordFormRules(t, {}), 'username')).toBe(PASSWORD_FIELD_LIMITS.username);
    expect(maxOf(createPasswordFormRules(t, {}), 'remark')).toBe(PASSWORD_FIELD_LIMITS.remark);
  });

  it('超容量原长只抬高对应字段，其余字段口径分毫不动', () => {
    const rules = createPasswordFormRules(t, { remark: 1200 });

    expect(maxOf(rules, 'remark')).toBe(1200);
    expect(maxOf(rules, 'username')).toBe(PASSWORD_FIELD_LIMITS.username);
    expect(maxOf(rules, 'password')).toBe(PASSWORD_FIELD_MAX_LENGTH);
    expect(maxOf(rules, 'url')).toBe(PASSWORD_FIELD_LIMITS.url);
  });

  it('容量恒为下限：短于容量的原长不会收紧上限，负数原长回落标准口径', () => {
    expect(maxOf(createPasswordFormRules(t, { remark: 10 }), 'remark')).toBe(PASSWORD_FIELD_LIMITS.remark);
    expect(maxOf(createPasswordFormRules(t, { username: -1 }), 'username')).toBe(PASSWORD_FIELD_LIMITS.username);
  });

  it('四个受约束字段都支持放宽', () => {
    const rules = createPasswordFormRules(t, { username: 80, password: 400, url: 150, remark: 1200 });

    expect(maxOf(rules, 'username')).toBe(80);
    expect(maxOf(rules, 'password')).toBe(400);
    expect(maxOf(rules, 'url')).toBe(150);
    expect(maxOf(rules, 'remark')).toBe(1200);
  });

  it('password 文案里的 {max} 跟随放宽后的上限，不报出与实际判定不符的数字', () => {
    const seen: Array<[string, Record<string, string | number> | undefined]> = [];
    const spyT = (key: string, named?: Record<string, string | number>) => {
      seen.push([key, named]);
      return key;
    };

    createPasswordFormRules(spyT, { password: 400 });

    expect(seen.find(([key]) => key === 'form.passwordMax')?.[1]).toEqual({ max: 400 });
  });

  it('放宽所针对的超容量场景真实存在：导入上界高于表单容量', () => {
    // 若有人把导入上界收到与容量齐平，本参数的存在意义即消失，此断言会提醒重新评估
    expect(MAX_REMARK_LEN).toBeGreaterThan(PASSWORD_FIELD_LIMITS.remark);
    expect(MAX_USERNAME_LEN).toBeGreaterThan(PASSWORD_FIELD_LIMITS.username);
    expect(MAX_URL_LEN).toBeGreaterThan(PASSWORD_FIELD_LIMITS.url);
    expect(MAX_PASSWORD_LEN).toBeGreaterThan(PASSWORD_FIELD_MAX_LENGTH);
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

/**
 * 最左通配条目（`*.qq.com`）
 *
 * 通配段是跨子域匹配的「适用范围」声明，只在用户显式写成该形态时生效，
 * 因此录入侧必须只接受这一种最左写法：`*.` 之后要跟一个合法主机，
 * 中间段/末段出现 `*`、或整体只剩 `*.` 都要拒（这类值存进去在匹配侧是死条目，
 * 但会让用户以为已经开启了跨子域）。
 *
 * 实现口径是「剥掉最左 `*.` 后仍用原来那条正则判定」，不新增第二套域名口径，
 * 所以 `*.evil`（无点裸主机）与 `example` 一样被拒，`*.example.com.cn` 与
 * `example.com.cn` 一样被放行。
 */
describe('createUrlValidator 的最左通配条目', () => {
  it.each(['*.qq.com', '*.example.com.cn', '*.localhost:3000', 'https://*.qq.com/login'])('%s 通过', value => {
    expect(validateUrl(value)).toBeUndefined();
  });

  it.each(['*.', '*.*.qq.com', 'mail.*.qq.com', '*.evil', 'qq.*.com', '**.qq.com', 'https://*.'])('%s 拒绝', value => {
    expect(validateUrl(value)).toBeDefined();
  });

  it('通配段不改变其余判定口径：与非通配输入同规则', () => {
    // 端口、ccTLD 跟随原正则；原正则不收路径，带通配段后同样不收
    expect(validateUrl('*.sub.example.co.uk')).toBeUndefined();
    expect(validateUrl('*.example.com:8080')).toBeUndefined();
    expect(validateUrl('*.example.com/path')).toBe('form.invalidUrlExample');
  });
});
