import { ref } from 'vue';
import { getPasswordHistory } from '@/utils/storage/passwordHistory';
import { logger } from '@/utils/logger';
import { lazyImport } from '@/utils/lazyImport';

const _getEncryption = lazyImport(() => import('@/utils/encryption'));

/** 延迟加载会话数据密钥获取 */
const _getSessionDataKey = lazyImport(() => import('@/utils/storage/facades'));

/**
 * 密码修改历史 Composable
 *
 * 为编辑弹窗提供历史记录加载与解密能力。
 */
export function usePasswordHistory() {
  const historyList = ref<{ password: string; changedAt: number; loading: boolean }[]>([]);
  const historyLoading = ref(false);

  /**
   * 加载指定条目的密码修改历史
   *
   * @param entryId 密码条目 ID
   */
  const loadHistory = async (entryId: string) => {
    if (!entryId) {
      historyList.value = [];
      return;
    }
    historyLoading.value = true;
    try {
      const records = await getPasswordHistory(entryId);
      historyList.value = records.map(r => ({
        password: r.password,
        changedAt: r.changedAt,
        loading: false,
      }));
    } catch (error) {
      logger.error('加载密码历史失败:', error);
      historyList.value = [];
    } finally {
      historyLoading.value = false;
    }
  };

  /**
   * 解密某条历史密码并返回明文
   *
   * @param encryptedPassword 加密态的历史密码
   * @returns 明文密码，解密失败时返回 null
   */
  const decryptHistoryPassword = async (encryptedPassword: string): Promise<string | null> => {
    try {
      const enc = await _getEncryption();
      const facades = await _getSessionDataKey();
      const key = await facades.getSessionDataKey();
      if (!key) {
        throw new Error('会话已过期，无法解密');
      }
      return await enc.decryptData(encryptedPassword, key);
    } catch (error) {
      logger.error('解密历史密码失败:', error);
      return null;
    }
  };

  return {
    historyList,
    historyLoading,
    loadHistory,
    decryptHistoryPassword,
  };
}
