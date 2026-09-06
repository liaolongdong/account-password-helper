import type { QuickAddPasswordData } from '@/utils/types';
import { logger } from '@/utils/logger';
import { ensureCredentialAccessAfterStartupRelock, invalidatePasswordCache } from './passwordCache';
import { tl } from '@/utils/i18n-lite';

/** 各字段长度上限（与前端表单 maxlength / 校验规则一致，纵深防御） */
const FIELD_LIMITS = {
  username: 50,
  password: 50,
  url: 100,
  tag: 50,
  remark: 1000,
} as const;

/**
 * 处理侧边栏快速添加条目请求
 *
 * 由 SidePanel 快速添加弹窗发起（发起方为扩展页面，无 sender.tab，
 * URL 为用户自报域名仅作展示）。执行会话校验、字段校验后加密落盘，
 * 成功时失效 background 密码缓存；侧边栏列表刷新由 storage watcher 承担
 * （原因见落盘处注释），此处不额外发送 port 通知。
 * @param data 快速添加数据（消息载荷为不可信输入，需边界校验）
 * @returns 保存结果（供侧边栏直接展示提示文案）
 */
export async function handleQuickAddPassword(
  data: QuickAddPasswordData,
): Promise<{ success: boolean; message: string }> {
  try {
    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    const password = typeof data?.password === 'string' ? data.password : '';
    const url = typeof data?.url === 'string' ? data.url.trim() : '';
    const tag = typeof data?.tag === 'string' ? data.tag.trim() : '';
    const remark = typeof data?.remark === 'string' ? data.remark.trim() : '';

    // 密码允许为空（与密码管理页添加条目行为一致），仅用户名为空或字段超长时拒绝
    if (!username) {
      logger.warn('Background: 快速添加条目字段校验失败（用户名为空）');
      return { success: false, message: tl('bg.quickAdd.invalidFields') };
    }
    if (
      username.length > FIELD_LIMITS.username ||
      password.length > FIELD_LIMITS.password ||
      url.length > FIELD_LIMITS.url ||
      tag.length > FIELD_LIMITS.tag ||
      remark.length > FIELD_LIMITS.remark
    ) {
      logger.warn('Background: 快速添加条目字段校验失败（字段超长）');
      return { success: false, message: tl('bg.quickAdd.tooLong') };
    }

    if (!(await ensureCredentialAccessAfterStartupRelock())) {
      return { success: false, message: tl('bg.quickAdd.locked') };
    }

    // 动态导入 StorageUtils，与 autoSaveHandler 保持一致的懒加载模式
    const { StorageUtils } = await import('@/utils/storage');
    const now = Date.now();
    await StorageUtils.savePassword({
      username,
      password,
      url,
      tag,
      remark,
      createTime: now,
      updateTime: now,
    });

    // 保存成功后使密码缓存失效，确保下次加载时获取最新数据
    invalidatePasswordCache();

    // 刻意不向 sidepanel port 发送刷新通知：savePassword 的 storage 写入已触发侧边栏
    // storage watcher 静默重载，且该路径独有 isMetadataOnlyChange 零解密快路径、
    // _sessionKnownExpired 与本地操作守卫。额外的 port 通知会让同一次保存跑两遍
    // 全量 AES-GCM 解密（_passwordLoadSequence 只保证最后一次提交，不去重开销），
    // 属重复刷新而非兜底。回归守卫见 tests/background/quickAddHandler.test.ts。

    return { success: true, message: tl('bg.quickAdd.success') };
  } catch (error) {
    logger.error('Background: 处理快速添加条目失败:', error);
    return { success: false, message: tl('bg.quickAdd.failed') };
  }
}
