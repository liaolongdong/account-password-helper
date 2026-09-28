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
 * 为编辑弹窗与详情抽屉提供历史记录加载与解密能力。状态是**每次调用各一份**
 * （`historyList` 等都在函数体内创建），两个消费端互不串数据。
 *
 * 弹窗会来回开关、还会在旧请求未回来时就换到另一条条目，因此这里按本仓
 * 「异步提交受最新请求序号保护」的既有口径给读取加代际：只有最新一次读取的结果
 * 允许落地，被取代的旧结果连同它的异常一起作废。
 */
export function usePasswordHistory() {
  const historyList = ref<{ password: string; changedAt: number; loading: boolean }[]>([]);
  const historyLoading = ref(false);

  /** 读取序号：换条目读取与关闭清理都会推进它，在飞的旧读取据此判自己是否已被取代 */
  let requestSeq = 0;

  /**
   * 清空历史并作废在飞读取（调用方关闭弹窗 / 换看另一条条目时调，而非 `historyList.value = []`）
   *
   * 只清数组不推进序号的话，晚到的旧结果会把**上一条条目**的历史重新填回已关闭或已换目标的界面。
   */
  const resetHistory = (): void => {
    requestSeq += 1;
    historyList.value = [];
    historyLoading.value = false;
  };

  /**
   * 加载指定条目的密码修改历史
   *
   * @param entryId 密码条目 ID
   */
  const loadHistory = async (entryId: string): Promise<void> => {
    const seq = ++requestSeq;
    if (!entryId) {
      // 本调用已是最新一次：清列表的同时熄灯，否则上一条在飞读取被取代后
      // 再也不会走自己的 finally，遮罩会永久停在 loading
      historyList.value = [];
      historyLoading.value = false;
      return;
    }

    historyLoading.value = true;
    try {
      const records = await getPasswordHistory(entryId);
      if (seq !== requestSeq) return;
      historyList.value = records.map(r => ({
        password: r.password,
        changedAt: r.changedAt,
        loading: false,
      }));
    } catch (error) {
      if (seq !== requestSeq) return;
      logger.error('加载密码历史失败:', error);
      historyList.value = [];
    } finally {
      // 遮罩只由最新一次读取熄灭：被取代的那次若在此处熄灯，会把仍在加载的新读取显示成"已完成"
      if (seq === requestSeq) historyLoading.value = false;
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
    resetHistory,
    decryptHistoryPassword,
  };
}
