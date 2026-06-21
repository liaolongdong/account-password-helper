import { shallowRef, nextTick } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';

/**
 * useSessionLock 配置选项
 */
interface UseSessionLockOptions {
  /**
   * 锁定成功后的回调函数
   * 由调用方传入，用于重置本地状态（如 isSessionValid、allPasswords），
   * 保持数据流单向：composable 不直接修改外部状态
   */
  onLocked: () => void;
}

/**
 * 会话锁定 Composable
 * 封装完整的会话锁定流程：清除会话 → 通知 background 使密码缓存失效 →
 * 广播 SESSION_EXPIRED 到所有上下文（sidepanel、options）。
 */
export function useSessionLock(options: UseSessionLockOptions) {
  /** 锁定操作 loading 状态 */
  const lockLoading = shallowRef(false);

  /**
   * 执行会话锁定
   * 1. 清除本地会话数据
   * 2. 调用 onLocked 回调重置调用方状态
   * 3. 通知 background 使密码缓存失效
   * 4. 广播会话过期到所有上下文
   */
  const lockSession = async () => {
    lockLoading.value = true;
    await nextTick(); // 确保 Vue 先渲染 loading 状态，再执行重 PBKDF2 操作
    try {
      await StorageUtils.clearSession();

      // 通知调用方重置状态（isSessionValid、allPasswords 等）
      options.onLocked();

      // 通知 background 使密码缓存失效
      try {
        await chrome.runtime.sendMessage({ type: MessageType.INVALIDATE_PASSWORD_CACHE });
      } catch {
        // background 可能未就绪，忽略
      }

      // 广播会话过期到所有上下文（sidepanel、options），确保各处立即切换到未验证状态
      try {
        await chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
      } catch {
        // 无监听者时忽略
      }

      ElMessage.success('已锁定');
    } catch (error) {
      logger.error('锁定失败:', error);
    } finally {
      lockLoading.value = false;
    }
  };

  return { lockLoading, lockSession };
}
