import { openMasterPasswordVerifyDialog } from '@/utils/masterPasswordVerifyController';

/**
 * 弹出主密码验证对话框并验证
 *
 * 通过自定义 MasterPasswordVerifyDialog 组件实现，支持：
 * - 校验失败后保持弹窗，用户可多次重试
 * - 内联错误提示 + 输入框抖动反馈
 * - 连续错误 3 次后显示重置提示
 *
 * 调用方需在 options 页面模板中挂载 <MasterPasswordVerifyDialog /> 组件。
 *
 * @param title 弹窗标题
 * @param description 提示文本（如"导出密码列表需要验证主密码，请输入主密码："）
 * @returns 验证通过返回主密码明文，用户取消返回 null
 */
export async function promptAndVerifyMasterPassword(title: string, description: string): Promise<string | null> {
  return openMasterPasswordVerifyDialog(title, description);
}
