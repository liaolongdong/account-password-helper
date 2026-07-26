import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';

/**
 * 弹出主密码验证对话框并验证
 *
 * 封装重复的「弹窗输入主密码 → 校验 → 返回结果」流程，
 * 供导出、备份、有效期修改等多处复用。
 *
 * @param title 弹窗标题
 * @param description 提示文本（如"导出密码列表需要验证主密码，请输入主密码："）
 * @returns 验证通过返回主密码明文，用户取消或验证失败返回 null
 */
export async function promptAndVerifyMasterPassword(title: string, description: string): Promise<string | null> {
  try {
    const { value: masterPassword } = await ElMessageBox.prompt(description, title, {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputType: 'password',
      inputPlaceholder: t('auth.verifyPasswordPlaceholder'),
      inputValidator: (v: string) => (!v || !v.trim() ? t('verify.passwordEmpty') : true),
    });

    const trimmed = masterPassword.trim();
    const isValid = await StorageUtils.verifyMasterPassword(trimmed);
    if (!isValid) {
      ElMessage.error(t('verify.wrongPassword'));
      return null;
    }

    return trimmed;
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      logger.error('主密码验证流程异常:', error);
    }
    return null;
  }
}
