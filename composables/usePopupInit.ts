import { shallowRef, ref, computed, onMounted } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useShortcuts } from '@/composables/useShortcuts';
import { useVersionUpdate } from '@/composables/useVersionUpdate';
import { useSessionLock } from '@/composables/useSessionLock';

/**
 * Popup 初始化编排 Composable
 * 协调会话状态检查、快捷键加载、版本更新检测、域名获取和密码列表加载。
 * 作为 Popup 的顶层 composable，组合 useShortcuts、useVersionUpdate、useSessionLock。
 */
export function usePopupInit() {
  // ==================== 组合子 composables ====================
  const { shortcuts, loadShortcuts } = useShortcuts();
  const { currentVersion, updateInfo, initUpdateCheck, openUpdatePage } = useVersionUpdate();

  // ==================== 自身状态 ====================

  /** 会话是否有效 */
  const isSessionValid = shallowRef(false);

  /** 密码列表 */
  const allPasswords = ref<PasswordEntry[]>([]);

  /** 当前页面域名 */
  const currentDomain = shallowRef('');

  // ==================== 派生计算属性 ====================

  /** 密码总数 */
  const passwordCount = computed(() => allPasswords.value.length);

  /** 当前域名匹配数 */
  const domainMatchCount = computed(() => {
    if (!currentDomain.value) return 0;
    return allPasswords.value.filter(p => {
      if (!p.url) return false;
      return currentDomain.value.includes(p.url) || p.url.includes(currentDomain.value);
    }).length;
  });

  // ==================== 会话锁定（传入 onLocked 回调重置本地状态） ====================

  const { lockLoading, lockSession } = useSessionLock({
    onLocked: () => {
      isSessionValid.value = false;
      allPasswords.value = [];
    },
  });

  // ==================== 初始化编排 ====================

  onMounted(async () => {
    try {
      // 并行加载：会话状态 + 快捷键 + 更新信息
      const [sessionValid] = await Promise.all([StorageUtils.isSessionValid(), loadShortcuts(), initUpdateCheck()]);

      isSessionValid.value = sessionValid;

      // 获取当前域名
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        try {
          const url = new URL(tab.url);
          currentDomain.value = url.hostname;
        } catch {
          // URL 解析失败，忽略
        }
      }

      // 加载密码列表
      if (isSessionValid.value) {
        allPasswords.value = await StorageUtils.getAllPasswords();
      }
    } catch (error) {
      logger.error('Popup: 初始化失败:', error);
    }
  });

  return {
    // 会话与密码状态
    isSessionValid,
    allPasswords,
    currentDomain,
    passwordCount,
    domainMatchCount,
    // 子 composable 暴露
    shortcuts,
    currentVersion,
    updateInfo,
    lockLoading,
    // 方法
    lockSession,
    openUpdatePage,
  };
}
