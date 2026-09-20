import type { AutoSavePasswordData, CheckCredentialStatusData, CredentialStatusResponse } from '@/utils/types';
import { logger } from '@/utils/logger';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';
import { ensureCredentialAccessAfterStartupRelock, invalidatePasswordCache } from './passwordCache';
import { tl } from '@/utils/i18n-lite';

/** 载荷校验结果：通过时返回字段类型已收口的载荷，失败时返回可直接展示给用户的文案 */
type AutoSavePayloadResult = { valid: true; payload: AutoSavePasswordData } | { valid: false; message: string };

/**
 * 在落盘前收口自动保存载荷的类型与字段容量
 *
 * 载荷由内容脚本从宿主页面 DOM 采集，属跨上下文不可信输入：超出条目容量的账号一旦落盘，
 * Options 表单在编辑态必然按同一组容量（`PASSWORD_FIELD_LIMITS`）拒绝保存，用户只能删条
 * 重建，因此宁可在写入前拒收并给出可读原因。
 *
 * `tag` 刻意不设长度上界：该字段在「密码已变更」分支会被弹窗预填为条目已有的标签串，而
 * 标签的真实口径由 Options 标签编辑器（`MAX_TAG_COUNT` × `MAX_TAG_LENGTH`，序列化串可长
 * 于 50）独占归一化。在此按快速添加通道的 50 截断，会把用户自己写的合法标签静默改短且
 * 不可恢复；标签也不是条目匹配键，超长只影响该条目的展示。
 *
 * @param data 原始载荷
 * @returns 校验结果
 */
function validateAutoSavePayload(data: AutoSavePasswordData): AutoSavePayloadResult {
  const { username, password, url } = data;
  const tag = data.tag ?? '';
  const remark = data.remark ?? '';

  if ([username, password, url, tag, remark].some(value => typeof value !== 'string')) {
    logger.warn('Background: 自动保存载荷字段类型异常，已拒收');
    return { valid: false, message: tl('bg.autoSave.failedGeneric') };
  }

  if (
    username.length > PASSWORD_FIELD_LIMITS.username ||
    password.length > PASSWORD_FIELD_LIMITS.password ||
    url.length > PASSWORD_FIELD_LIMITS.url ||
    remark.length > PASSWORD_FIELD_LIMITS.remark
  ) {
    return { valid: false, message: tl('bg.autoSave.tooLong') };
  }

  return {
    valid: true,
    payload: { ...data, username, password, url, tag, remark },
  };
}

/**
 * 处理保存密码请求
 * 由 content script 在用户确认后触发，执行会话校验、字段容量校验、域名匹配、去重更新和存储；
 * 侧边栏列表刷新由 storage watcher 承担（原因见下方成功分支注释）
 * @param data 自动保存密码数据
 * @returns 保存结果
 */
export async function handleAutoSavePassword(
  data: AutoSavePasswordData,
): Promise<{ success: boolean; message: string }> {
  try {
    if (!(await ensureCredentialAccessAfterStartupRelock())) {
      return { success: false, message: tl('bg.autoSave.failedGeneric') };
    }
    const payloadResult = validateAutoSavePayload(data);
    if (!payloadResult.valid) {
      return { success: false, message: payloadResult.message };
    }
    const payload = payloadResult.payload;
    // 动态导入 StorageUtils，将 storage 层（masterPassword/autoSaveManager 等）的
    // 模块初始化延迟到自动保存消息到达时（SW 产物被 WXT 内联为单文件，
    // 此懒加载不减少冷启动解析/编译量）。
    const { StorageUtils } = await import('@/utils/storage');
    const result = await StorageUtils.autoSavePassword(payload);
    if (result.success) {
      // 保存成功后使密码缓存失效，确保下次加载时获取最新数据
      invalidatePasswordCache();

      // 刻意不向 sidepanel port 发送刷新通知：autoSavePassword 的 storage 写入已触发
      // 侧边栏 storage watcher 静默重载（含 isMetadataOnlyChange 零解密快路径）。
      // 额外的 port 通知会让同一次保存跑两遍全量 AES-GCM 解密，属重复刷新而非兜底。
      // 详见 quickAddHandler.ts 同名注释。

      // 发送桌面通知提示用户已自动保存
      try {
        await chrome.notifications.create('auto-save-password', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon/128.png'),
          title: tl('bg.autoSave.savedTitle'),
          message: `${payload.username} - ${payload.url} ${result.message}`,
        });
      } catch (notifyError) {
        logger.warn('Background: 桌面通知发送失败（可能系统通知权限未开启）:', notifyError);
      }
    }
    return result;
  } catch (error) {
    logger.error('Background: 处理自动保存密码失败:', error);
    return { success: false, message: tl('bg.autoSave.failedGeneric') };
  }
}

/**
 * 处理保存前凭证状态预检查请求
 *
 * 由 content script 在捕获登录凭证后、弹窗前触发。沿用与 handleAutoSavePassword
 * 一致的动态 import 模式，延迟 storage 层的模块初始化执行。
 * 检查失败时保底返回 new，不阻断后续保存流程。
 * @param data 预检查请求数据
 * @returns 凭证状态响应
 */
export async function handleCheckCredentialStatus(data: CheckCredentialStatusData): Promise<CredentialStatusResponse> {
  try {
    if (!(await ensureCredentialAccessAfterStartupRelock())) return { status: 'locked' };
    const { StorageUtils } = await import('@/utils/storage');
    return await StorageUtils.checkCredentialStatus(data);
  } catch (error) {
    logger.error('Background: 处理保存前预检查失败:', error);
    return { status: 'new' };
  }
}
