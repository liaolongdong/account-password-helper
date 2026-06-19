import { onMounted, onUnmounted } from 'vue';
import { STORAGE_KEYS } from '@/utils/encryption';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { logger } from '@/utils/logger';

/**
 * 需要重跑认证判定的 storage key 集合。
 * 外部（如 DevTools）清空或变更这些 key 时，需要同步重新评估主密码/会话状态。
 */
const AUTH_RELATED_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.MASTER_PASSWORD,
  STORAGE_KEYS.PASSWORDS,
  SESSION_STORAGE_KEYS.MASTER_PASSWORD,
  SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
  SESSION_STORAGE_KEYS.VALIDITY_HOURS,
]);

/**
 * Storage 与可见性变化监听 Composable
 *
 * 封装 chrome.storage.onChanged 和 document.visibilitychange 监听逻辑，
 * 在认证相关 key 变动时触发认证检查，在密码数据变化时触发列表刷新，
 * 并在页面重新可见时触发认证状态检查。
 */
export function useStorageWatcher(options: {
  /** 认证相关 storage 变化时的回调 */
  onAuthChange: () => void;
  /** 密码数据变化时的回调 */
  onPasswordDataChange: () => void;
}) {
  const { onAuthChange, onPasswordDataChange } = options;

  /** chrome.storage 变化监听 */
  const handleStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== 'local') return;
    const hasAuthChange = Object.keys(changes).some(key => AUTH_RELATED_STORAGE_KEYS.has(key));
    if (!hasAuthChange) return;
    logger.debug('StorageWatcher: 检测到认证相关 storage 变动，重新检查认证状态');
    onAuthChange();
    // 密码数据变化时，重新加载密码列表
    if (STORAGE_KEYS.PASSWORDS in changes) {
      logger.debug('StorageWatcher: 检测到密码数据变动，重新加载密码列表');
      onPasswordDataChange();
    }
  };

  /** 可见性变化监听：页面重新可见时重跑认证检查 */
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    logger.debug('StorageWatcher: 页面重新可见，重新检查认证状态');
    onAuthChange();
  };

  onMounted(() => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChanged);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onUnmounted(() => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(handleStorageChanged);
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
}
