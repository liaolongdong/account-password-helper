import type { QuickAddPasswordData } from '@/utils/types';
import { logger } from '@/utils/logger';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';
import { ensureCredentialAccessAfterStartupRelock, invalidatePasswordCache } from './passwordCache';
import { tl } from '@/utils/i18n-lite';
// 只引零依赖的容量模块（不引 `@/utils/storage` 门面）：保持本文件对存储图的懒加载不变。
import { isVaultCapacityError, MAX_PASSWORD_ENTRIES } from '@/utils/storage/vaultCapacity';

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
      username.length > PASSWORD_FIELD_LIMITS.username ||
      password.length > PASSWORD_FIELD_LIMITS.password ||
      url.length > PASSWORD_FIELD_LIMITS.url ||
      tag.length > PASSWORD_FIELD_LIMITS.tag ||
      remark.length > PASSWORD_FIELD_LIMITS.remark
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
    // 上限拒绝与真正的写入失败要分文：前者需要用户先清理条目，反复点「添加」不会成功。
    return {
      success: false,
      message: isVaultCapacityError(error)
        ? tl('bg.quickAdd.capacityReached', { max: MAX_PASSWORD_ENTRIES })
        : tl('bg.quickAdd.failed'),
    };
  }
}
