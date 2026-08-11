<template>
  <div
    v-show="showSidepanel"
    class="sidepanel-container"
    @keydown="handleKeydown"
  >
    <!-- 头部卡片 -->
    <div class="header-card">
      <SidepanelHeader
        :current-version="currentVersion"
        :current-domain="currentDomain"
        :is-authenticated="isAuthenticated"
        @open-github="openGithub"
        @open-help="showHelpDialog = true"
        @open-settings="handleOpenSettings"
        @open-validity="openValiditySetting"
      />
    </div>

    <!-- 未验证状态 -->
    <div
      v-if="!isAuthenticated"
      class="auth-card"
    >
      <div class="auth-card-content">
        <div class="auth-icon-circle">
          <el-icon class="auth-icon"><Lock /></el-icon>
        </div>
        <h3 class="auth-title">{{ t('sidepanel.sessionExpired') }}</h3>
        <p class="auth-desc">{{ t('sidepanel.sessionExpiredDesc') }}</p>
        <el-button
          class="auth-verify-btn"
          type="primary"
          :icon="BrandLogo"
          size="large"
          @click="openOptions"
        >
          {{ t('sidepanel.verifyPassword') }}
        </el-button>
      </div>
    </div>

    <!-- 已认证状态：搜索框 + 密码列表（异步组件，锁屏态不加载其 Element Plus 重依赖） -->
    <SidepanelAuthView
      v-else
      v-model:search-keyword="searchKeyword"
      v-model:favorite-only="favoriteOnly"
      v-model:filter-tags="filterTags"
      :loading="loading"
      :filtered-passwords="filteredPasswords"
      :total-count="passwords.length"
      :active-index="activeIndex"
      :auto-trigger-login="autoTriggerLogin"
      :sort-prop="sidepanelSortProp"
      :available-tags="availableTags"
      @sort-change="handleSortChange"
      @search="handleSearch"
      @add-password="openOptionsAndAdd"
      @add-site-password="openOptionsAndAdd"
      @activate="index => (activeIndex = index)"
      @rendered="handleAuthViewRendered"
      @fill="fillPassword"
      @fill-and-login="handleFillAndLogin"
      @edit="handleEditPassword"
      @toggle-favorite="toggleFavorite"
      @copy-username="copyUsername"
      @copy-password="copyPassword"
      @fill-totp="fillTotp"
      @copy-totp="copyTotp"
    />

    <!-- 底部操作 -->
    <div class="footer-card">
      <el-button
        :icon="BrandLogo"
        class="footer-manage-btn"
        @click="openOptions"
      >
        {{ t('sidepanel.manage') }}
      </el-button>
    </div>

    <!-- 操作指引与常见问题弹窗 -->
    <HelpDialog
      v-model="showHelpDialog"
      @go-to-options="openOptions"
    />

    <!-- 悬浮按钮设置弹窗（与悬浮按钮共用同一套 HTML/CSS/事件） -->
    <div
      v-if="showSettingsDialog"
      class="sp-settings-host"
    >
      <div
        ref="settingsOverlayEl"
        class="settings-overlay visible"
      ></div>
      <div
        ref="settingsPanelEl"
        class="settings-panel visible"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, defineAsyncComponent, h } from 'vue';
import { Lock } from '@element-plus/icons-vue';
import SidepanelHeader from '@/components/sidepanel/SidepanelHeader.vue';
import BrandLogo from '@/components/BrandLogo.vue';
import type { PasswordEntry, RuntimeMessage, UpdatePasswordMetadataData } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { saveSidepanelSortConfig, getFavoriteLimit, getFloatingButtonConfig } from '@/utils/storage/configManager';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { sortPasswordEntries, DEFAULT_SIDEPANEL_SORT, type SortState } from '@/utils/passwordSort';
import { parseTags } from '@/utils/tagUtils';
import {
  markPerf,
  measurePerf,
  recordSidepanelOpenMetrics,
  SP_PERF_MARKS,
  type SidepanelInitMeta,
} from '@/utils/perfMetrics';
import { useSidepanelData, isSessionQuicklyKnownInvalid } from '@/composables/useSidepanelData';
import { useSidepanelFill } from '@/composables/useSidepanelFill';
import { isExactHostMatch, isLocalDevDomain } from '@/utils/domain';

/**
 * 操作指引弹窗——懒加载（仅在用户点击「帮助」时加载）
 *
 * 保持独立 chunk 不打进初始关键包（含较重的 el-dialog），避免拖慢首帧；
 * 首帧后由 onMounted 空闲预取该 chunk（见下方 preloadIdleModules），
 * 使 Windows 会话失效冷环境下首次点击「?」时 chunk 已温热、即时打开。
 */
const HelpDialog = defineAsyncComponent(() => import('@/components/sidepanel/HelpDialog.vue'));

/**
 * 认证视图 chunk 加载占位（函数式组件，经 defineAsyncComponent 默认 200ms delay 后显示）：
 * 热路径 chunk 秒开不闪烁；Windows 冷盘极端场景（chunk 加载超 2.5s 骨架屏兜底淡出）
 * 由本占位接管列表区，避免露出空白窗口。样式见底部全局样式块（h() 渲染无 scoped 作用域）。
 */
const AuthViewLoading = () =>
  h('div', { class: 'sp-auth-view-loading' }, [
    h('span', { class: 'sp-auth-view-loading__spinner' }),
    h('span', t('sidepanel.loading')),
  ]);

/**
 * 认证态视图（搜索卡片 + 密码列表卡片）——异步加载
 *
 * 将 el-input/el-dropdown/el-tooltip 与 PasswordListItem 依赖链从入口关键 chunk
 * 中剥离，锁屏态（Windows 会话失效冷启动的头号白屏场景）首屏 JS 收敛至按钮 +
 * 图标级依赖；onMounted 即发起预取（见下方）与数据竞速加载重叠，
 * 会话有效态挂载时 chunk 已就绪，无可感知延迟。
 * onError 重试加固：扩展版本更新瞬间旧页面动态 import 可能 404，重试 2 次降低列表区空白风险。
 */
const SidepanelAuthView = defineAsyncComponent({
  loader: () => import('@/components/sidepanel/SidepanelAuthView.vue'),
  loadingComponent: AuthViewLoading,
  onError(error, retry, fail, attempts) {
    if (attempts <= 2) {
      logger.warn(`SidePanel: 认证视图 chunk 加载失败，重试第 ${attempts} 次:`, error);
      retry();
    } else {
      fail();
    }
  },
});

// ==================== 延迟加载模块（用户交互时触发，避免初始加载拉入 encryption.ts） ====================

/** 延迟加载的 autoSaveManager 模块引用 */
let _autoSaveModule: typeof import('@/utils/storage/autoSaveManager') | null = null;

/** 获取 evictLRUFavoriteIfNeeded（首次收藏操作时加载） */
const getEvictLRUFavoriteIfNeeded = async () => {
  if (!_autoSaveModule) {
    _autoSaveModule = await import('@/utils/storage/autoSaveManager');
  }
  return _autoSaveModule.evictLRUFavoriteIfNeeded;
};

// ==================== 组合 composables ====================

const {
  passwords,
  loading,
  isAuthenticated,
  currentDomain,
  showSidepanel,
  sortConfig,
  initSidepanelData,
  getDomainPriority,
  runLocalOperation,
} = useSidepanelData();

const { fillPassword, handleFillAndLogin, fillTotp, copyTotp, handleEditPassword, copyUsername, copyPassword } =
  useSidepanelFill(passwords);

/** 设置弹窗 DOM 引用（本地声明以确保 vue-tsc 可追踪模板引用） */
const settingsPanelEl = ref<HTMLElement | null>(null);
const settingsOverlayEl = ref<HTMLElement | null>(null);

/** 设置弹窗可见性（本地 ref，与延迟加载的 composable 同步） */
const showSettingsDialog = ref(false);

/** 设置弹窗相关方法（延迟加载，减小初始包体积，加快首屏渲染） */
let _openSettingsDialog: (() => Promise<void>) | null = null;

/** 延迟加载设置弹窗模块，首次调用时动态导入 */
const ensureSettingsModule = async () => {
  if (!_openSettingsDialog) {
    const { useSidepanelSettings } = await import('@/composables/useSidepanelSettings');
    const settings = useSidepanelSettings(settingsPanelEl, settingsOverlayEl);
    _openSettingsDialog = settings.openSettingsDialog;
    // 同步 composable 内部的 showSettingsDialog 状态到本地 ref
    watch(settings.showSettingsDialog, val => {
      showSettingsDialog.value = val;
    });
    settings.injectSettingsViewStyles();
  }
};

/** 打开设置弹窗（首次调用时自动延迟加载模块） */
const handleOpenSettings = async () => {
  await ensureSettingsModule();
  await _openSettingsDialog!();
};

// ==================== 本地状态（与 UI 模板紧密耦合） ====================

const searchKeyword = ref('');
/** 是否仅显示收藏条目 */
const favoriteOnly = ref(false);
/** 标签筛选选中集（命中任一即保留，与搜索/收藏过滤为叠加关系） */
const filterTags = ref<string[]>([]);
const activeIndex = ref(0);

/** 当前插件版本号，直接读取 manifest 避免加载 useVersionUpdate 的 192K JS + 56K CSS 依赖 */
const currentVersion = chrome.runtime.getManifest().version;

/** 操作指引弹窗可见性 */
const showHelpDialog = ref(false);

// ==================== 排序与过滤 ====================

/**
 * 域名过滤后的条目（当前域名精确匹配 + 空 URL 始终展示）
 * 抽离为独立 computed：标签筛选候选集与最终列表共用同一过滤结果，避免重复计算
 */
const domainFilteredPasswords = computed(() => {
  let result = [...passwords.value];
  // 域名过滤：只显示与当前域名精确匹配（完整 hostname）的条目 + URL 为空的条目
  // 复用 isExactHostMatch，与 getPasswordsByUrl / 后台 getMatchingAccounts 匹配逻辑保持一致
  // 不做子域名/主域名模糊匹配，确保 fat/uat 等多测试环境账号严格隔离
  // 本地开发域名（localhost / 127.0.0.1）跳过过滤，显示全部
  if (currentDomain.value && !isLocalDevDomain(currentDomain.value)) {
    const domain = currentDomain.value;
    result = result.filter(p => {
      if (!p.url || p.url.trim() === '') return true;
      return isExactHostMatch(domain, p.url);
    });
  }
  return result;
});

/** 可选标签集：取自域名过滤后的条目（侧边栏只展示当前域名 + 空域名条目，标签候选同域收敛） */
const availableTags = computed(() => {
  const set = new Set<string>();
  for (const p of domainFilteredPasswords.value) {
    for (const tag of parseTags(p.tag)) {
      set.add(tag);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

/** 搜索 + 域名过滤 + 标签过滤 + 收藏过滤 + 排序的派生计算属性 */
const filteredPasswords = computed(() => {
  let result = domainFilteredPasswords.value;

  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      p =>
        p.username.toLowerCase().includes(keyword) ||
        p.tag.toLowerCase().includes(keyword) ||
        p.remark.toLowerCase().includes(keyword) ||
        p.url.toLowerCase().includes(keyword),
    );
  }

  if (filterTags.value.length > 0) {
    result = result.filter(p => parseTags(p.tag).some(tag => filterTags.value.includes(tag)));
  }

  if (favoriteOnly.value) {
    result = result.filter(p => p.favorite);
  }

  // 应用排序：域名优先级 + 收藏置顶 + 字段排序（复用公共比较器）
  const sortState: SortState = sortConfig.value
    ? { prop: sortConfig.value.prop, order: (sortConfig.value.order || null) as SortState['order'] }
    : DEFAULT_SIDEPANEL_SORT;
  sortPasswordEntries(result, sortState, getDomainPriority);

  return result;
});

/** 收藏/标签过滤变化时重置选中索引（过滤条件变化后旧索引可能越界或指向其它条目） */
watch([favoriteOnly, filterTags], () => {
  activeIndex.value = 0;
});

/** 域名切换导致候选标签集变化时，剔除已不存在的筛选标签，避免隐形空过滤 */
watch(availableTags, tags => {
  if (filterTags.value.some(selected => !tags.includes(selected))) {
    filterTags.value = filterTags.value.filter(selected => tags.includes(selected));
  }
});

// ==================== 排序切换 ====================

/** 当前排序字段（派生自 sortConfig，用于 UI 高亮选中项） */
const sidepanelSortProp = computed(() => sortConfig.value?.prop ?? DEFAULT_SIDEPANEL_SORT.prop);

/** 排序下拉切换处理 */
const handleSortChange = async (prop: string) => {
  const config = { prop, order: 'descending' as const };
  sortConfig.value = config;
  try {
    await saveSidepanelSortConfig(config);
  } catch (error) {
    logger.error('SidePanel: 保存排序配置失败:', error);
  }
};

// ==================== UI 交互方法 ====================

/** 搜索处理 */
const handleSearch = () => {
  activeIndex.value = 0;
};

/** 键盘导航处理 */
const handleKeydown = (e: KeyboardEvent) => {
  const list = filteredPasswords.value;
  if (!list.length) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      activeIndex.value = Math.min(activeIndex.value + 1, list.length - 1);
      scrollToActiveItem();
      break;
    case 'ArrowUp':
      e.preventDefault();
      activeIndex.value = Math.max(activeIndex.value - 1, 0);
      scrollToActiveItem();
      break;
    case 'Enter':
      e.preventDefault();
      if (activeIndex.value >= 0 && activeIndex.value < list.length) {
        fillPassword(list[activeIndex.value]);
      }
      break;
    case 'Escape':
      e.preventDefault();
      window.close();
      break;
    case 'c':
    case 'C':
      if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift+C: 复制密码 暂不需要（注释，别删除）
      } else if (e.ctrlKey) {
        // Ctrl+C: 复制用户名
        e.preventDefault();
        if (activeIndex.value >= 0 && activeIndex.value < list.length) {
          copyUsername(list[activeIndex.value].username);
        }
      }
      break;
  }
};

/** 滚动到当前选中条目 */
const scrollToActiveItem = () => {
  nextTick(() => {
    const activeEl = document.querySelector('.password-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
};

/**
 * 切换收藏状态（支持 LRU 淘汰：收藏数达上限时自动替换最近最少使用的收藏条目）
 *
 * 持久化与填充路径对称：经 UPDATE_PASSWORD_METADATA 委托 SW 上下文的防抖队列落盘，
 * 避免收藏后关闭面板时页面上下文的防抖定时器随卸载销毁导致收藏静默丢失，
 * 并使所有元数据写入收敛到 SW 单一 read-modify-write 队列，消除跨上下文双写丢更新。
 */
const toggleFavorite = async (password: PasswordEntry) => {
  try {
    const newFav = !password.favorite;
    const entry = passwords.value.find(p => p.id === password.id);

    /** 委托 SW 持久化元数据（取消收藏的 favoriteUsedAt 传 null，由 SW 侧转换为字段删除） */
    const persistMetadata = (updates: UpdatePasswordMetadataData['updates']) =>
      chrome.runtime
        .sendMessage({
          type: MessageType.UPDATE_PASSWORD_METADATA,
          data: { id: password.id, updates },
        } as RuntimeMessage)
        .catch(error => {
          logger.error('切换收藏失败:', error);
          ElMessage.error(t('message.operationFailed'));
        });

    if (newFav) {
      // 收藏前需先处理 LRU 淘汰（需 evicted 结果用于提示），淘汰写入放在守卫内
      const evictFn = await getEvictLRUFavoriteIfNeeded();
      void runLocalOperation(async () => {
        const evicted = await evictFn(passwords.value);
        if (evicted) {
          const limit = await getFavoriteLimit();
          ElMessage.info(t('sidepanel.favoriteEvicted', { limit, username: evicted.username }));
        }
        const now = Date.now();
        // 乐观更新：先就地更新 UI 与提示，避免受委托写入延迟造成的交互卡顿
        if (entry) {
          entry.favorite = true;
          entry.favoriteUsedAt = now;
        }
        ElMessage.success(t('sidepanel.favorited'));
        await persistMetadata({
          favorite: true,
          favoriteUsedAt: now,
          updateTime: password.updateTime,
        });
      }).catch(error => {
        logger.error('切换收藏失败:', error);
        ElMessage.error(t('message.operationFailed'));
      });
    } else {
      // 乐观更新：先就地更新 UI 与提示（取消收藏无淘汰逻辑，可立即反馈）
      if (entry) {
        entry.favorite = false;
        entry.favoriteUsedAt = undefined;
      }
      ElMessage.success(t('sidepanel.unfavorited'));
      // favoriteUsedAt 传 null：跨上下文消息无法传递 undefined，由 SW 侧转换为删除该字段落盘
      void persistMetadata({
        favorite: false,
        favoriteUsedAt: null,
        updateTime: password.updateTime,
      });
    }
  } catch (error) {
    logger.error('切换收藏失败:', error);
    ElMessage.error(t('message.operationFailed'));
  }
};

// ==================== 导航操作 ====================

/** 打开 GitHub 仓库 */
const openGithub = () => {
  chrome.tabs.create({ url: 'https://github.com/liaolongdong/account-password-helper' });
};

/**
 * 点击会话倒计时胶囊：打开密码管理页并直达「有效期设置」对话框
 * 与 Popup / options 头部徽标「点时间 = 续期」的交互心智保持一致
 */
const openValiditySetting = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_AND_VALIDITY });
  } catch (error) {
    logger.error('打开有效期设置失败:', error);
  }
};

/**
 * 打开选项页面
 * 统一由 background 的 OPEN_OPTIONS_PAGE 处理
 */
const openOptions = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_PAGE });
  } catch (error) {
    logger.error('SidePanel: 打开选项页面失败:', error);
  }
};

/**
 * 跳转到密码管理页并自动打开添加密码弹窗
 * data 可选携带当前域名（P1-6）：新增表单 URL 字段自动预填本站域名，
 * 无域名场景（本地开发域名跳过过滤时仍可能有值，空则不预填）行为与旧版一致
 */
const openOptionsAndAdd = async () => {
  try {
    const data = currentDomain.value ? { url: currentDomain.value } : undefined;
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_AND_ADD, data });
  } catch (error) {
    logger.error('SidePanel: 打开添加密码页面失败:', error);
  }
};

// ==================== 全局「自动触发登录」同步 ====================

/** 全局「自动触发登录」开关：开启时侧边栏点条目即等于「填充并登录」，隐藏每条冗余的「填充并登录」按钮 */
const autoTriggerLogin = ref(false);

/**
 * chrome.storage 变化监听：在悬浮按钮/侧边栏设置弹窗内切换「自动触发登录」时实时同步，
 * 使列表项「填充并登录」按钮显隐即时生效，无需重开侧边栏。
 */
const handleFloatingConfigChange = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => {
  if (areaName !== 'local' || !(STORAGE_KEYS.FLOATING_BUTTON_CONFIG in changes)) return;
  const next = changes[STORAGE_KEYS.FLOATING_BUTTON_CONFIG].newValue as { autoTriggerLogin?: boolean } | undefined;
  autoTriggerLogin.value = next?.autoTriggerLogin ?? false;
};

// ==================== 初始化 ====================

/**
 * 首屏打开收尾回调（由 onMounted 内赋值，幂等）：
 * - 锁屏快速路径：轻量会话判定确认失效后立即触发（不等数据竞速）
 * - 认证态由 SidepanelAuthView 首帧渲染完成（rendered 事件）触发
 * - 兜底计时器自 onMounted 即启动，封顶骨架屏最长停留时长
 */
let _finishOpen: (() => void) | null = null;

/** 认证视图首帧实际渲染条目数（分片渲染下与过滤后全量可能不同，供埋点精确归因） */
let _authRenderedCount: number | null = null;

/** 认证视图首帧渲染完成（含会话中途恢复场景，收尾回调自身幂等） */
const handleAuthViewRendered = (renderedCount: number) => {
  _authRenderedCount = renderedCount;
  _finishOpen?.();
};

/**
 * 骨架屏兜底计时周期（毫秒）
 *
 * 自 onMounted 即启动的总兜底：已确认锁屏/竞速已返回的场景一个周期后强制淡出；
 * 会话状态未判定（竞速进行中）时续期一个周期（总封顶 2 周期 = 5s，覆盖竞速
 * bg 800ms + 本地 3000ms 的确定性上限），避免误露「会话已过期」卡片。
 * 此前兜底计时器在 await initSidepanelData() 之后才启动，Windows 会话失效
 * 冷环境下竞速瀑布（bg 800ms 超时 + 本地 3000ms 兜底）会先行阻塞 ≈3.8s。
 */
const SKELETON_MAX_LIFETIME_MS = 2500;

onMounted(async () => {
  // 性能埋点：首帧已渲染（onMounted 触发）+ 测量 Vue mount 开始 → onMounted 的间隔
  markPerf(SP_PERF_MARKS.MOUNTED);
  // measurePerf 内部已容错（mark 缺失时返回 null），与 perfMetrics 模块容错风格一致
  const vueMountDuration = measurePerf('vue-mount', 'vue-mount-start');
  if (vueMountDuration !== null) {
    logger.debug(`SidePanel: Vue mount → onMounted ${vueMountDuration.toFixed(1)}ms`);
  }

  const _perfMountStart = performance.now();

  // 轻量会话判定提前发起（单次 storage.local IPC，毫秒级），一次判定双用途：
  // ① 锁屏快速路径（见下方）；② 认证态视图 chunk 的预取调度
  const quickInvalidPromise = isSessionQuicklyKnownInvalid().catch(() => false);

  // 预取认证态视图 chunk（fire-and-forget）：按会话判定调度——
  // 可能有效（含判定失败）时立即预取，与数据竞速加载并行重叠，挂载零等待；
  // 已确认失效时跳过（锁屏首帧用不到该 chunk + Element Plus 重依赖 ≈89KB，
  // 冷盘环境立即预取会与锁屏首帧绘制/竞速关键路径争抢磁盘 IO），
  // 延后至首屏收尾后的空闲预取（preloadIdleModules），解锁前通常已温热。
  // 与 defineAsyncComponent 使用同一 import specifier，Vite 复用同一 chunk；
  // 吞掉加载失败（扩展更新瞬间旧页面 404），避免 unhandled rejection（组件侧有 onError 重试兜底）
  void quickInvalidPromise.then(knownInvalid => {
    if (!knownInvalid) {
      void import('@/components/sidepanel/SidepanelAuthView.vue').catch(() => {});
    }
  });

  // 获取骨架屏元素（兄弟节点模式，Vue 挂载不会替换它）
  const skeletonEl = document.getElementById('app-loading');

  // 读取全局「自动触发登录」以决定每条「填充并登录」按钮显隐，并监听后续变更；均不阻塞首屏
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleFloatingConfigChange);
  }
  void getFloatingButtonConfig()
    .then(cfg => {
      autoTriggerLogin.value = cfg.autoTriggerLogin;
    })
    .catch(error => logger.error('SidePanel: 读取自动触发登录配置失败:', error));

  // ==================== 首屏收尾编排（先于数据竞速定义，快速路径/兜底可提前触发） ====================
  // 1. 打 sp-list-rendered 埋点，数据就绪后写入性能环形日志（含列表渲染段分解）
  // 2. 淡出骨架屏，实现 骨架屏 → 真实UI 的无缝过渡（骨架屏作为兄弟节点保持可见直到此处）
  // 3. 空闲预取按需模块（设置弹窗 / HelpDialog / TotpCode）
  let _opened = false;
  let _renderFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** 数据竞速元信息（initSidepanelData 完成后赋值；锁屏快速路径下晚于骨架屏淡出到达） */
  let _initMeta: SidepanelInitMeta | null = null;
  let _metricsRecorded = false;
  /** 锁屏快速路径已确认会话失效（兜底计时器据此区分「已确认失效」与「状态未判定」） */
  let _quickKnownInvalid = false;

  /**
   * 写入性能环形日志（幂等）：需同时满足「骨架屏已淡出」与「竞速元信息已就绪」。
   * 锁屏快速路径下骨架屏先淡出、竞速后台完成后补记，埋点归因维度不缺失
   * （dataToRenderMs 为负值即标识「渲染先于数据就绪」的快速路径场景）
   */
  const recordMetricsOnce = () => {
    if (_metricsRecorded || !_opened || !_initMeta) return;
    _metricsRecorded = true;
    // 优先采用认证视图回传的实际首帧渲染数（分片渲染下首帧上限 30 条），
    // 兜底/锁屏态回退为过滤后全量（锁屏态恒为 0）
    recordSidepanelOpenMetrics({
      ..._initMeta,
      renderedItemCount: _authRenderedCount ?? filteredPasswords.value.length,
    });
  };

  const finishOpen = () => {
    if (_opened) return;
    _opened = true;
    if (_renderFallbackTimer) {
      clearTimeout(_renderFallbackTimer);
      _renderFallbackTimer = null;
    }

    markPerf(SP_PERF_MARKS.LIST_RENDERED);
    recordMetricsOnce();

    if (skeletonEl) {
      skeletonEl.classList.add('fade-out');
      skeletonEl.addEventListener('transitionend', () => skeletonEl.remove(), { once: true });
      // 安全兜底：transitionend 未触发时强制移除（200ms = CSS transition 时长）
      setTimeout(() => skeletonEl.remove(), 250);
    }

    // 空闲预取：设置弹窗模块 + HelpDialog + TotpCode + 认证视图 chunk（不阻塞首屏渲染），
    // 冷环境（Windows 会话失效期 / 浏览器重启引导期）下用户首次交互时 chunk 已温热、即时打开；
    // 认证视图 chunk 在锁屏态被跳过立即预取（见 onMounted 前段），此处补齐使解锁切换零等待；
    // 未取完前触发则退化为按需加载，无回退风险；预取失败静默吞掉（交互时按需加载兜底）
    const preloadIdleModules = () => {
      void ensureSettingsModule().catch(() => {});
      // 与 defineAsyncComponent 使用同一 import specifier，Vite 复用同一 chunk
      void import('@/components/sidepanel/SidepanelAuthView.vue').catch(() => {});
      void import('@/components/sidepanel/HelpDialog.vue').catch(() => {});
      void import('@/components/TotpCode.vue').catch(() => {});
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(preloadIdleModules);
    } else {
      setTimeout(preloadIdleModules, 1000);
    }
  };
  _finishOpen = finishOpen;

  // 总兜底计时器提前至数据竞速之前启动：封顶骨架屏最长停留时长，
  // 消除「竞速瀑布阻塞收尾启动」的白屏叠加（Windows 会话失效态白屏主因）。
  // 会话状态尚未判定时（快速路径未确认失效、竞速未返回）不能直接淡出——
  // 模板初始 isAuthenticated=false 会误露「会话已过期」卡片（实际可能有效），
  // 此时一次性续期等待竞速决出（竞速自身有 bg 800ms + 本地 3000ms 确定性上限，
  // 续期后总封顶 5s 足以覆盖），仅对「已确认失效/竞速已返回」的场景立即淡出
  let _fallbackExtended = false;
  const onSkeletonFallback = () => {
    if (_opened) return;
    if (_initMeta === null && !_quickKnownInvalid && !_fallbackExtended) {
      _fallbackExtended = true;
      _renderFallbackTimer = setTimeout(onSkeletonFallback, SKELETON_MAX_LIFETIME_MS);
      return;
    }
    finishOpen();
  };
  _renderFallbackTimer = setTimeout(onSkeletonFallback, SKELETON_MAX_LIFETIME_MS);

  // ==================== 锁屏快速路径（Windows 会话失效态白屏根治） ====================
  // 轻量判定（复用 onMounted 前段发起的 quickInvalidPromise）确认会话已失效时，
  // 立即淡出骨架屏：锁屏卡片为内联模板（isAuthenticated 初始 false），挂载即已渲染就绪、
  // 无需任何数据。完整竞速继续在后台执行：结果为失效时状态不变；极小概率窗口内会话
  // 恰好恢复有效则由竞速结果静默切换到列表态（与既有「迟到结果采纳」路径行为一致）。
  // 判定方向仅可能「提前展示锁屏」（fail-locked），无误判解锁风险。
  void quickInvalidPromise
    .then(knownInvalid => {
      if (!knownInvalid || _opened) return;
      _quickKnownInvalid = true;
      logger.debug(`SidePanel: 锁屏快速路径命中，${(performance.now() - _perfMountStart).toFixed(1)}ms 淡出骨架屏`);
      // 窗口被遮挡/不可见时 Chrome 会冻结 rAF，加 500ms 定时兜底（finishOpen 幂等，先到者生效）
      setTimeout(finishOpen, 500);
      nextTick(() => requestAnimationFrame(finishOpen));
    })
    .catch(() => {});

  const initMeta = await initSidepanelData();

  // 性能埋点：首屏数据就绪（User Timing API 不受生产构建 drop console 影响）
  markPerf(SP_PERF_MARKS.DATA_READY);

  const _perfDataReady = performance.now();
  logger.debug(
    `SidePanel: 首屏数据就绪，initSidepanelData 耗时 ${(_perfDataReady - _perfMountStart).toFixed(1)}ms，总计 ${_perfDataReady.toFixed(1)}ms`,
  );

  // 竞速元信息就绪：骨架屏已先行淡出（快速路径/兜底）则立即补记性能日志
  _initMeta = initMeta;
  recordMetricsOnce();

  if (!initMeta.sessionValid && !_opened) {
    // 锁屏态（快速路径未命中，如 storage 读取失败）：同步视图，DOM flush + 首帧绘制后收尾；
    // rAF 冻结场景由已运行的总兜底计时器封顶
    nextTick(() => requestAnimationFrame(finishOpen));
  }
  // 认证态：等待异步认证视图首帧渲染完成（rendered 事件，见 handleAuthViewRendered）后收尾，
  // 避免骨架屏提前淡出露出空白列表区；chunk 加载异常由总兜底计时器封顶
});

onUnmounted(() => {
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.removeListener(handleFloatingConfigChange);
  }
});
</script>

<style scoped>
.sidepanel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f0f2f5;
}

/* ========== 卡片通用样式（search-card/list-card 已随认证态视图迁至 SidepanelAuthView） ========== */
.header-card,
.footer-card {
  margin: 0 8px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
}

.header-card {
  margin-top: 8px;
  overflow: hidden;
}

.footer-card {
  padding: 10px 16px;
  margin-top: 8px;
  margin-bottom: 8px;
  text-align: center;
}

/* 密码管理按钮：浅蓝背景 + hover 变实心蓝 */
:deep(.footer-manage-btn) {
  width: 100%;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border: 1px solid var(--aph-primary-border);
  border-radius: 8px;
  transition: all 0.25s ease;
}

:deep(.footer-manage-btn:hover) {
  color: #fff;
  background: var(--aph-primary);
  border-color: var(--aph-primary);
  box-shadow: 0 2px 8px rgb(var(--aph-primary-rgb) / 30%);
  transform: translateY(-1px);
}

:deep(.footer-manage-btn .el-icon) {
  font-size: 18px;
}

/* ========== 会话失效卡片 ========== */
.auth-card {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  margin: 8px 8px 0;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
}

.auth-card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 32px;
  text-align: center;
}

.auth-icon-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 20px;
  background: var(--aph-primary-bg);
  border-radius: 50%;
}

.auth-icon {
  font-size: 28px;
  color: var(--aph-primary);
}

.auth-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.auth-desc {
  margin: 0 0 24px;
  font-size: 13px;
  line-height: 1.6;
  color: #6b7280;
}

/* 去验证主密码按钮：放大钥匙图标并与文字拉开间距 */
.auth-verify-btn :deep(.el-icon) {
  margin-right: -4px;
  font-size: 20px;
}

.auth-verify-btn :deep(.el-icon svg) {
  width: 1em;
  height: 1em;
}
</style>

<style>
html,
body {
  height: 100%;
  padding: 0;
  margin: 0;
  overflow: hidden;
}

#app {
  height: 100%;
}

/* ========== 认证视图 chunk 加载占位（h() 渲染的函数式组件，无 scoped 作用域） ========== */
.sp-auth-view-loading {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  margin: 8px 8px 0;
  font-size: 13px;
  color: #6b7280;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
}

.sp-auth-view-loading__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid #e5e7eb;
  border-top-color: var(--aph-primary);
  border-radius: 50%;
  animation: sp-auth-loading-spin 0.8s linear infinite;
}

@keyframes sp-auth-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
