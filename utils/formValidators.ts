/**
 * 表单校验工具函数
 *
 * 提供可复用的校验器工厂函数与表单规则工厂，供多个表单组件共享校验逻辑。
 */
import type { FormRules } from 'element-plus';

/**
 * 创建 URL/域名格式校验器
 *
 * 支持完整 URL（https://example.com）和纯域名（example.com / localhost）格式。
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
        if (!url.hostname) {
          callback(new Error(t('form.invalidUrl')));
          return;
        }
      } else {
        const domainPattern =
          /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})(:\d{1,5})?$/;
        if (!domainPattern.test(trimmed)) {
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

/**
 * 创建密码表单通用校验规则（用户名 / 密码 / 网址 / 标签 / 备注）
 *
 * Options 密码管理页与 SidePanel 快速添加弹窗共用同一工厂，
 * 保证字段校验规则（必填、长度、URL 格式）从单一源产生，杜绝两处定义不一致的风险。
 * 调用方按需追加额外字段（如 TOTP）。
 *
 * @param t 国际化翻译函数
 * @returns Element Plus FormRules（不含 TOTP 等扩展字段）
 */
export function createPasswordFormRules(t: (key: string) => string): FormRules {
  const urlValidator = createUrlValidator(t);
  return {
    username: [
      { required: true, message: t('form.usernameRequired'), trigger: 'blur' },
      { max: 50, message: t('form.usernameMax'), trigger: 'blur' },
    ],
    password: [{ max: 50, message: t('form.passwordMax'), trigger: 'blur' }],
    url: [
      { max: 100, message: t('form.urlMax'), trigger: 'blur' },
      { validator: urlValidator, trigger: 'blur' },
    ],
    tag: [{ max: 50, message: t('form.tagMax'), trigger: 'blur' }],
    remark: [{ max: 1000, message: t('form.remarkMax'), trigger: 'blur' }],
  };
}
