import { shallowRef, ref, computed, onMounted } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useShortcuts } from '@/composables/useShortcuts';
import { useVersionUpdate } from '@/composables/useVersionUpdate';
import { useSessionLock } from '@/composables/useSessionLock';
import { matchesSiteEndpoint, parsePagePortContext, type PagePortContext, type SitePolicy } from '@/utils/domain';
import { DEFAULT_DOMAIN_MATCH_MODE, DEFAULT_PORT_SCOPE } from '@/utils/storage/configManager';

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
   * 站点匹配策略（打开时读一次；读失败回落双缺省）
   *
   * Popup 只把它用于「此站已有账号数」的统计口径，不做列表、不加徽章。
   * 缺省值合起来即「端口隔离功能存在之前」的口径；本地开发域名此前完全不感知端口
   * （数出的条数与侧边栏本站列表不一致），现在与侧边栏走同一判据。
   */
  const sitePolicy = ref<SitePolicy>({ mode: DEFAULT_DOMAIN_MATCH_MODE, portScope: DEFAULT_PORT_SCOPE });

  /** 当前页面端口上下文（与 currentDomain 同一次 URL 解析得到，供端口轴判定使用） */
  const currentPagePort = shallowRef<PagePortContext | null>(null);

  // ==================== 派生计算属性 ====================

  /** 密码总数 */
  const passwordCount = computed(() => allPasswords.value.length);

  /**
   * 当前域名匹配数
   *
   * 按用户所选档位与端口范围统计，但继续排除空 URL 条目：这个数字表达的是「此站已有账号数」，
   * 不限站点的通用账号不算此站账号（与侧边栏的可见集口径有意不同）。
   * 判据与侧边栏 `matchesSiteScope` 同源（`matchesSiteEndpoint`：主机门 ∧ 端口门），
   * 因此环回主机上也按端点计数——改前这里只看主机、侧边栏只看端口，同一页面上两个入口
   * 会给出相反的结论。
   */
  const domainMatchCount = computed(() => {
    const domain = currentDomain.value;
    if (!domain) return 0;
    const policy = sitePolicy.value;
    return allPasswords.value.filter(p => {
      if (!p.url?.trim()) return false;
      return matchesSiteEndpoint(p.url, domain, currentPagePort.value, policy);
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
      // 并行加载：会话状态 + 快捷键 + 更新信息 + 站点匹配策略
      const [sessionValid] = await Promise.all([
        StorageUtils.isSessionValid(),
        loadShortcuts(),
        initUpdateCheck(),
        StorageUtils.getDomainMatchConfig()
          .then(config => {
            sitePolicy.value = config;
          })
          .catch(error => {
            logger.warn('Popup: 读取站点匹配策略失败，回落精确匹配与不限端口', error);
            sitePolicy.value = { mode: DEFAULT_DOMAIN_MATCH_MODE, portScope: DEFAULT_PORT_SCOPE };
          }),
      ]);

      isSessionValid.value = sessionValid;

      // 获取当前域名与端口上下文（同一次 URL 解析，端口轴判定依赖后者）
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        try {
          const url = new URL(tab.url);
          currentDomain.value = url.hostname;
          currentPagePort.value = parsePagePortContext(tab.url);
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
