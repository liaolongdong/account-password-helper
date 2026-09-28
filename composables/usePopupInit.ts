import { shallowRef, ref, computed, onMounted } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useShortcuts } from '@/composables/useShortcuts';
import { useVersionUpdate } from '@/composables/useVersionUpdate';
import { useSessionLock } from '@/composables/useSessionLock';
import { isExactHostMatch, isLocalDevDomain, resolveMatchTier, type DomainMatchMode } from '@/utils/domain';
import { DEFAULT_DOMAIN_MATCH_MODE } from '@/utils/storage/configManager';

/**
 * Popup 初始化编排 Composable
 * 协调会话状态检查、快捷键加载、版本更新检测、域名获取和密码列表加载。
 * 作为 Popup 的顶层 composable，组合 useShortcuts、useVersionUpdate、useSessionLock。
 */
export function usePopupInit() {
  // ==================== 组合子 composables ====================
  const { shortcuts, shortcutAssigned, loadShortcuts } = useShortcuts();
  const { currentVersion, updateInfo, initUpdateCheck, openUpdatePage } = useVersionUpdate();

  // ==================== 自身状态 ====================

  /** 会话是否有效 */
  const isSessionValid = shallowRef(false);

  /** 密码列表 */
  const allPasswords = ref<PasswordEntry[]>([]);

  /** 当前页面域名 */
  const currentDomain = shallowRef('');

  /**
   * 跨子域匹配档位（打开时读一次；读失败回落 `off`）
   *
   * Popup 只把它用于「此站已有账号数」的统计口径，不做列表、不加徽章。
   */
  const domainMatchMode = ref<DomainMatchMode>(DEFAULT_DOMAIN_MATCH_MODE);

  // ==================== 派生计算属性 ====================

  /** 密码总数 */
  const passwordCount = computed(() => allPasswords.value.length);

  /**
   * 当前域名匹配数
   *
   * 按用户所选档位统计，但继续排除空 URL 条目：这个数字表达的是「此站已有账号数」，
   * 不限站点的通用账号不算此站账号（与侧边栏的可见集口径有意不同）。
   * 本地开发域名沿用精确 host 口径，档位不参与。
   */
  const domainMatchCount = computed(() => {
    const domain = currentDomain.value;
    if (!domain) return 0;
    return allPasswords.value.filter(p => {
      if (!p.url?.trim()) return false;
      if (isLocalDevDomain(domain)) return isExactHostMatch(domain, p.url);
      return resolveMatchTier(domain, p.url, domainMatchMode.value) >= 0;
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
      // 并行加载：会话状态 + 快捷键 + 更新信息 + 跨子域匹配档位
      const [sessionValid] = await Promise.all([
        StorageUtils.isSessionValid(),
        loadShortcuts(),
        initUpdateCheck(),
        StorageUtils.getDomainMatchConfig()
          .then(config => {
            domainMatchMode.value = config.mode;
          })
          .catch(error => {
            logger.warn('Popup: 读取跨子域匹配档位失败，回落精确匹配', error);
            domainMatchMode.value = DEFAULT_DOMAIN_MATCH_MODE;
          }),
      ]);

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
    shortcutAssigned,
    currentVersion,
    updateInfo,
    lockLoading,
    // 方法
    lockSession,
    openUpdatePage,
  };
}
