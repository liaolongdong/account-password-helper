import { shallowRef } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';

/**
 * 闲置锁定设置 Composable
 * 加载自动锁定配置并暴露闲置锁定分钟数，供 UI 展示锁定相关动态文案
 * （如 popup 锁按钮 tooltip）。0 表示从不闲置锁定。
 */
export function useIdleLockSettings() {
  /** 闲置多少分钟后自动锁定，0 表示从不锁定 */
  const idleLockMinutes = shallowRef(0);

  /**
   * 从存储加载闲置锁定配置
   * 加载失败时保持默认值 0，不阻塞 UI 渲染
   */
  const loadIdleLockSettings = async (): Promise<void> => {
    try {
      const config = await StorageUtils.getIdleLockConfig();
      idleLockMinutes.value = config.idleLockMinutes;
    } catch (error) {
      logger.error('useIdleLockSettings: 加载闲置锁定配置失败:', error);
    }
  };

  return { idleLockMinutes, loadIdleLockSettings };
}
