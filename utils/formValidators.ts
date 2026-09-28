/**
 * 表单校验工具函数
 *
 * 提供可复用的校验器工厂函数与表单规则工厂，供多个表单组件共享校验逻辑。
 */
import type { FormRules } from 'element-plus';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';
import { splitWildcardHost } from '@/utils/domain';

/**
 * 创建 URL/域名格式校验器
 *
 * 支持完整 URL（https://example.com）和纯域名（example.com / localhost）格式。
 * 纯域名形态额外接受最左通配条目（`*.qq.com`），用于跨子域匹配的适用范围声明。
 * 空值通过校验（选填字段）。
 *
 * @param t 国际化翻译函数
 * @returns Element Plus 表单校验器函数
 */
export function createUrlValidator(t: (key: string) => string) {
  return (_rule: unknown, value: string, callback: (error?: Error) => void) => {
    if (!value || !value.trim()) {
      callback();
      return;
    }
    const trimmed = value.trim();
    try {
      if (trimmed.includes('://')) {
        const url = new URL(trimmed);
        // 剥掉最左通配段后仍为空（`https://*.`）即无有效主机；非通配输入 rest 恒等于 hostname
        if (!splitWildcardHost(url.hostname).rest) {
          callback(new Error(t('form.invalidUrl')));
          return;
        }
      } else {
        // 非通配输入 rest 即原值，通配输入只剩 `*.` 之后的主机：两者共用下面这条既有正则。
        // `*.`、`*.*.x`、`a.*.x` 之类非法形态被同一个正则拒掉，
        // 不为通配条目另立第二套域名口径
        const { rest } = splitWildcardHost(trimmed);
        const domainPattern =
          /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})(:\d{1,5})?$/;
        if (!domainPattern.test(rest)) {
          callback(new Error(t('form.invalidUrlExample')));
          return;
        }
      }
      callback();
    } catch {
      callback(new Error(t('form.invalidUrl')));
    }
  };
}

/** 可按下放宽容量的字段（`tag` 无规则、TOTP 由调用方单独定义，均不在其列） */
export type BoundedPasswordField = 'username' | 'password' | 'url' | 'remark';

/**
 * 编辑态的「条目原有长度」，单位：字符
 *
 * 只用于把某字段的校验上限放宽到不小于原值，缺省（或传 undefined）即按标准容量校验。
 */
export type InitialFieldLengths = Partial<Record<BoundedPasswordField, number>>;

/**
 * 创建密码表单通用校验规则（用户名 / 密码 / 网址 / 备注）
 *
 * Options 密码管理页与 SidePanel 快速添加弹窗共用同一工厂，
 * 保证字段校验规则（必填、长度、URL 格式）从单一源产生，杜绝两处定义不一致的风险。
 * 调用方按需追加额外字段（如 TOTP）。
 *
 * 刻意不包含 `tag` 规则：该字段的约束不归校验层，而归各自的写入通道——
 * Options 侧由 `usePasswordManagement` 的 `tagArray` computed setter 独占归一化
 * （`MAX_TAG_COUNT` 个 x `MAX_TAG_LENGTH` 字符，超限即时提示），序列化后的标签串
 * 最长可达 92 字符；SidePanel 侧由输入框 `PASSWORD_FIELD_LIMITS.tag` 与 background
 * 落盘兜底双层约束。若在此按序列化串长度另设上限，会与实际容量口径
 * 冲突并误拦合法组合（历史缺陷：`max: 50` 使含 2 个 25 字符标签的条目在编辑态
 * 被 `validate()` 拒绝，用户无法保存任何改动）。
 *
 * @param t 国际化翻译函数
 * @param initialLengths 编辑态条目的原字段长度；提供时该字段上限取 `max(容量, 原长)`。
 *   导入闸门刻意比表单容量宽（`utils/backup/constants.ts`：为保证任何自导出文件都能回灌，
 *   超容量字段既不拒收也不截断），于是库里可能存在超出容量的条目。这些字段在输入框里
 *   带 `maxlength=容量`，浏览器对超限值只拦增不拦存，按原容量硬拒会让用户改任何字段都
 *   存不下（与 `tag` 同一缺陷类）。放宽只覆盖「不变得更长」这一区间，容量本身未被削弱。
 * @returns Element Plus FormRules（不含 tag 与 TOTP 等扩展字段）
 */
export function createPasswordFormRules(
  t: (key: string, named?: Record<string, string | number>) => string,
  initialLengths: InitialFieldLengths = {},
): FormRules {
  const urlValidator = createUrlValidator(t);
  /** 字段校验上限：标准容量恒为下限，编辑态按条目原长度放宽（负数等非法原长回落到容量） */
  const capacityOf = (field: BoundedPasswordField): number =>
    Math.max(PASSWORD_FIELD_LIMITS[field], initialLengths[field] ?? 0);

  return {
    username: [
      { required: true, message: t('form.usernameRequired'), trigger: 'blur' },
      { max: capacityOf('username'), message: t('form.usernameMax'), trigger: 'blur' },
    ],
    password: [
      {
        max: capacityOf('password'),
        message: t('form.passwordMax', { max: capacityOf('password') }),
        trigger: 'blur',
      },
    ],
    url: [
      { max: capacityOf('url'), message: t('form.urlMax'), trigger: 'blur' },
      { validator: urlValidator, trigger: 'blur' },
    ],
    remark: [{ max: capacityOf('remark'), message: t('form.remarkMax'), trigger: 'blur' }],
  };
}
