<template>
  <div
    v-show="showSidepanel"
    class="sidepanel-container"
    @keydown="handleKeydown"
  >
    <!-- 头部卡片 -->
    <div
      ref="headerCardRef"
      class="header-card"
    >
      <SidepanelHeader
        :current-domain="currentDomain"
        :is-authenticated="isAuthenticated"
        :show-match-info="isAuthenticated && !!currentDomain && !isLoopbackHost(currentDomain)"
        :match-count="domainFilteredPasswords.length"
        :port-label="portChipLabel"
        :port-relaxed="portRelaxedTemporarily"
        :env-options="canBindEnv ? envChipOptions : []"
        :env-active-host="boundEnvHost ?? ''"
        :env-picker-open="envPickerOpen"
        @toggle-port-relax="togglePortRelax"
        @toggle-env-picker="toggleEnvPicker"
        @open-github="openGithub"
        @open-help="showHelpDialog = true"
        @open-settings="handleOpenSettings"
        @open-validity="openValiditySetting"
        @add-site-password="openQuickAddDialog"
      />
    </div>

    <!-- 环境选择条：展开时接管「绑哪个环境 / 收回绑定 / 确认线上」三个动作，
         位置在头部卡片之外，否则会被卡片的 overflow: hidden 裁掉 -->
    <div
      v-if="envPickerOpen && canBindEnv"
      ref="envBarEl"
    >
      <EnvPickerBar
        :options="envChipOptions"
        :active-host="boundEnvHost ?? ''"
        :pending-confirm-host="envPendingConfirm"
        @pick="handlePickEnv"
        @confirm="handleConfirmEnv"
        @cancel-confirm="envPendingConfirm = ''"
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
      v-model:search-scope="searchScope"
      :loading="loading"
      :filtered-passwords="filteredPasswords"
      :total-count="passwords.length"
      :load-failed="loadFailed"
      :undecryptable-count="undecryptableCount"
      :active-index="activeIndex"
      :auto-trigger-login="autoTriggerLogin"
      :sort-prop="sidepanelSortProp"
      :available-tags="availableTags"
      :global-match-count="globalMatchCount"
      :not-fillable-ids="notFillableIds"
      :cross-domain-ids="crossDomainIds"
      :port-mismatch-ids="portMismatchIds"
      :env-only-ids="envOnlyIds"
      :env-badge-label="envBadgeLabel"
      :cross-domain-hint-count="crossDomainHintCount"
      :port-hidden-hint-count="portHiddenHintCount"
      :active-keyword="activeSearchKeyword"
      @sort-change="handleSortChange"
      @search="handleSearch"
      @add-password="openQuickAddDialog"
      @add-site-password="openQuickAddDialog"
      @open-domain-match-setting="openDomainMatchSetting"
      @relax-ports="togglePortRelax"
      @retry="handleRetryLoad"
      @activate="index => (activeIndex = index)"
      @rendered="handleAuthViewRendered"
      @fill="fillPassword"
      @fill-and-login="handleFillAndLogin"
      @open-site="handleOpenSite"
      @edit="handleEditPassword"
      @toggle-favorite="toggleFavorite"
      @copy-username="copyUsername"
      @copy-password="copyPassword"
      @fill-totp="fillTotp"
      @copy-totp="copyTotp"
      @share-card="copyShareCard"
    />

    <!-- 底部操作：匹配信息带已上移至头部域名行（信息就近原则），底部只保留主操作，为密码列表释放垂直空间 -->
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

    <!-- 快速添加条目弹窗（委托 background 加密落盘，完整字段经底部入口跳转密码管理页）
         v-if 门控挂载：defineAsyncComponent 的 loader 在组件「渲染」时即触发，无条件渲染会让
         弹窗 chunk 落入锁屏态首帧窗口，与认证视图 / 资源预热争抢冷盘 IO。
         门控必须用独立的粘性标志而非 showQuickAddDialog（原因见 quickAddMounted 注释） -->
    <QuickAddDialog
      v-if="quickAddMounted"
      v-model="showQuickAddDialog"
      :default-url="currentSiteHost"
      @open-options-add="openOptionsAndAdd"
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
import EnvPickerBar from '@/components/sidepanel/EnvPickerBar.vue';
import BrandLogo from '@/components/BrandLogo.vue';
import type { EnvBindingResponse, PasswordEntry, RuntimeMessage, UpdatePasswordMetadataData } from '@/utils/types';
import { MessageType } from '@/utils/types';
import {
  saveSidepanelSortConfig,
  getFavoriteLimit,
  getFloatingButtonConfig,
  getDomainMatchConfig,
  DEFAULT_DOMAIN_MATCH_MODE,
  DEFAULT_PORT_SCOPE,
} from '@/utils/storage/configManager';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { sortPasswordEntries, DEFAULT_SIDEPANEL_SORT, type SortState } from '@/utils/passwordSort';
import {
  applyListFilters,
  filterEntriesByScope,
  matchesSiteScope,
  type ListFilterOptions,
  type ScopeContext,
  type SearchScope,
} from '@/utils/passwordFilter';
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
import { useKeywordDebounce } from '@/composables/useKeywordDebounce';
import {
  isLoopbackHost,
  toNavigableUrl,
  resolveMatchTier,
  isCrossSubdomainTier,
  isDomainMatchMode,
  isPortScope,
  isHiddenByPortOnly,
  effectiveEnvHost,
  isAdmittedByEnvOnly,
  siteRankWithEnv,
  rawPortOf,
  countSameMainDomainCandidates,
  countPortHiddenCandidates,
  type DomainMatchMode,
  type EffectiveSitePolicy,
  type PortScope,
  type SitePolicy,
} from '@/utils/domain';
import { collectEnvFamilies, toEnvChipOptions } from '@/utils/envFamily';
import { isEditableEventTarget, scrollBehavior } from '@/utils/a11y';
import { warmPinyinMatcher } from '@/utils/searchMatch/core';

/**
 * 操作指引弹窗——懒加载（仅在用户点击「帮助」时加载）
 *
 * 保持独立 chunk 不打进初始关键包（含较重的 el-dialog），避免拖慢首帧；
 * 首帧后由 onMounted 空闲预取该 chunk（见下方 preloadIdleModules），
 * 使 Windows 会话失效冷环境下首次点击「?」时 chunk 已温热、即时打开。
 */
const HelpDialog = defineAsyncComponent(() => import('@/components/sidepanel/HelpDialog.vue'));

/**
 * 快速添加条目弹窗——懒加载（模板处以粘性标志 quickAddMounted 做 v-if 门控，首次打开才触发 chunk loader）
 *
 * 与 HelpDialog 同为独立 chunk，不打进初始关键包。注意 defineAsyncComponent 的 loader
 * 在组件「渲染」时即触发，故必须配合模板 v-if 才能真正排除在首帧之外——否则锁屏态
 * （会话失效冷启动，首屏 JS 本应收敛至按钮 + 图标级依赖）也会在首帧拉取弹窗 chunk。
 * 首帧后由 preloadIdleModules 空闲预取该 chunk，使用户首次点击即时打开。
 */
const QuickAddDialog = defineAsyncComponent(() => import('@/components/sidepanel/QuickAddDialog.vue'));

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

/** 认证视图分包持续加载失败时的轻量可恢复兜底，避免骨架移除后留下空白区域。 */
const AuthViewError = () =>
  h('div', { class: 'sp-auth-view-error', role: 'alert' }, [
    h('span', t('sidepanel.viewLoadFailed')),
    h(
      'button',
      {
        type: 'button',
        class: 'sp-auth-view-error__retry',
        onClick: () => window.location.reload(),
      },
      t('sidepanel.retry'),
    ),
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
  errorComponent: AuthViewError,
  timeout: 8000,
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
  currentPagePort,
  showSidepanel,
  sortConfig,
  loadFailed,
  undecryptableCount,
  loadPasswords,
  initSidepanelData,
  getDomainPriority,
  runLocalOperation,
} = useSidepanelData();

const {
  fillPassword,
  handleFillAndLogin,
  fillTotp,
  copyTotp,
  handleEditPassword,
  copyUsername,
  copyPassword,
  copyShareCard,
} = useSidepanelFill(passwords);

/**
 * 重试加载密码列表（B8）：认证视图「加载失败·重试」按钮的出口。
 * 非静默全量重载，成功回填列表、失败再次落回失败态；与首次加载走同一 loadPasswords 链路。
 */
const handleRetryLoad = () => {
  void loadPasswords();
};

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
/**
 * 驱动列表过滤的关键词（`searchKeyword` 的防抖副本）
 *
 * 与输入框的即时回显解耦：连续击键期间只落地最后一次过滤，避免每键一次
 * 「整表重排 + 逐格高亮」。见 `composables/useKeywordDebounce`。
 * `flushSearchKeyword()` 是安全阀——键盘导航/回车填充前先把未落地的关键词同步进来，
 * 杜绝「字打完了、回车填的还是上一个列表」这类快机器上偶发的错位。
 */
const { debounced: activeSearchKeyword, flush: flushSearchKeyword } = useKeywordDebounce(searchKeyword);
/** 是否仅显示收藏条目 */
const favoriteOnly = ref(false);
/** 标签筛选选中集（命中任一即保留，与搜索/收藏过滤为叠加关系） */
const filterTags = ref<string[]>([]);
/**
 * 搜索范围（会话内状态，不持久化）
 *
 * 默认 `site`：侧边栏主用法是「当前站点快速填充」。切到 `all` 后列表放开为全库，
 * 不可填充的条目（外站 / 临时放宽带出的其他端口）降级为「打开站点 + 复制类操作」（见 notFillableIds / handleOpenSite）。
 * 每次打开侧边栏回到默认值，避免上一次的全站上下文被误当作当前站点工具。
 */
const searchScope = ref<SearchScope>('site');
const activeIndex = ref(0);

/** 本站模式下复用的空 ID 集（引用恒定，避免子组件 v-memo 因新对象失效） */
const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

/** 操作指引弹窗可见性 */
const showHelpDialog = ref(false);

/** 快速添加条目弹窗可见性 */
const showQuickAddDialog = ref(false);

/**
 * 快速添加弹窗是否已挂载（首次打开置 true 后不再回落）
 *
 * 与 showQuickAddDialog 分离是必需的：
 * - 性能侧——弹窗 chunk 必须被 v-if 门控在首帧之外，否则锁屏态冷启动会与认证视图、
 *   资源预热争抢磁盘 IO；
 * - 行为侧——若直接拿 showQuickAddDialog 做 v-if，关闭瞬间组件连同 el-dialog 内部的
 *   Transition 一并被卸载，dialog-fade 退场动画不会播放（弹窗「闪没」），
 *   与 Options 页各弹窗的关闭观感不一致。
 *
 * 粘性标志同时满足两者：首帧不加载 chunk，首次打开后组件常驻，
 * 退场动画与关闭时的表单明文清理（见 QuickAddDialog 内 watch）均保持原有语义。
 */
const quickAddMounted = ref(false);

/** 打开快速添加弹窗：同步置挂载标志与可见性，使弹窗以 modelValue=true 完成首次挂载 */
const openQuickAddDialog = (): void => {
  quickAddMounted.value = true;
  showQuickAddDialog.value = true;
};

// ==================== 排序与过滤 ====================

/**
 * 跨子域匹配档位
 *
 * 打开时读一次并随 storage.onChanged 更新；缺省 `off` 与引入跨子域之前的行为逐条一致。
 * 只作为筛选/排序的入参，不进入任何缓存键，切档因此不触发解密重算。
 */
const domainMatchMode = ref<DomainMatchMode>(DEFAULT_DOMAIN_MATCH_MODE);

/**
 * 端口隔离范围（持久化值）
 *
 * 与档位同一条读路径、同一个存储键（`domain_match_config`），因此同样不进缓存失效键：
 * 它只改过滤结果，不改任何明文内容。缺省 `loose` 即「端口隔离功能存在之前」的行为。
 */
const portScope = ref<PortScope>(DEFAULT_PORT_SCOPE);

/**
 * 本站临时放宽端口隔离（不落盘、切标签页复位）
 *
 * 存在的理由：strict 档下「同域名其他端口」的条目被挡在站外，用户点一次设置弹窗才能确认
 * 「不是我坏了，是被端口挡住了」。这一层只放宽**显示**，填充门控仍按持久化策略走
 * （见 `sitePolicy` 与 `notFillableIds`）——把 `:9090` 的凭证填进 `:8080` 的登录框，
 * 正是端口隔离要消除的那类混淆，不该被一次列表展开悄悄放开。
 */
const portRelaxedTemporarily = ref(false);

// ==================== 本地开发环境绑定 ====================

/**
 * 侧边栏持有的环境绑定镜像
 *
 * 事实来源在后台的 `chrome.storage.session`（内联下拉、一键填充、右键菜单都读它），
 * 这里只是「当前这一页」的一份读数：面板重开、切页面、切端口时按端点重新同步一次。
 */
const envHost = ref<string | null>(null);

/** 环境选择条是否展开（纯 UI 态，不落盘） */
const envPickerOpen = ref(false);

/** 头部卡片根节点：判断「按下的是不是芯片那一块」 */
const headerCardRef = ref<HTMLElement | null>(null);

/** 选择条包裹层：判断「按下的是不是选择条本身」 */
const envBarEl = ref<HTMLElement | null>(null);

/**
 * 待确认的线上环境主机
 *
 * 只能由后台的 `needsAck` 产生：带 prod/online 标签或认不出环境标签的主机，第一次绑必须先确认。
 * 判据留在后台，界面少写一次确认逻辑也不会把线上账号静默带进本地页。
 */
const envPendingConfirm = ref('');

/** 芯片候选：从库里条目的网址派生，用户不必为本地环境再维护一套账号或映射表 */
const envChipOptions = computed(() => toEnvChipOptions(collectEnvFamilies(passwords.value)));

/** 这一页能不能绑定：只有环回主机，且库里确有可识别的环境 */
const canBindEnv = computed(() => isLoopbackHost(currentDomain.value) && envChipOptions.value.length > 0);

/** 生效绑定：与 `effectiveEnvHost` 同一门禁，公网页面的残留值一律不参与判定 */
const boundEnvHost = computed(() => (canBindEnv.value ? effectiveEnvHost(currentDomain.value, envHost.value) : null));

/** 芯片与行内徽章上的环境文案（如 `fat · example.com`） */
const envBadgeLabel = computed(() => {
  const bound = boundEnvHost.value;
  if (!bound) return '';
  return envChipOptions.value.find(option => option.host === bound)?.label ?? bound;
});

/**
 * 当前端点指纹
 *
 * 取数与写回都是异步的，而「切标签页」会让两次同步并发：冷启动那次要从
 * `storage.session` 现读、反而更慢后落地。不比对指纹，上一页的绑定就会挂到当前页上——
 * 那是跨端点的凭证外显，比少显示严重得多。
 */
const envEndpointStamp = (): string => `${currentDomain.value}|${currentPagePort.value?.port ?? ''}`;

/** 按当前端点向后台取一次绑定（面板打开、切页面、候选集刚出现时） */
const syncEnvBinding = async (): Promise<void> => {
  const host = currentDomain.value;
  const port = currentPagePort.value?.port ?? null;
  const stamp = envEndpointStamp();
  if (!isLoopbackHost(host) || envChipOptions.value.length === 0) {
    envHost.value = null;
    return;
  }
  try {
    const response: EnvBindingResponse = await chrome.runtime.sendMessage({
      type: MessageType.GET_ENV_BINDING,
      data: { host, port },
    });
    if (stamp !== envEndpointStamp()) return;
    envHost.value = response?.success ? (response.data?.envHost ?? null) : null;
  } catch (error) {
    if (stamp !== envEndpointStamp()) return;
    logger.warn('SidePanel: 读取环境绑定失败，按未绑定处理:', error);
    envHost.value = null;
  }
};

/**
 * 写回绑定
 *
 * 三种结局各自处理：被拒要确认（原绑定**保持不变**，只亮确认条）、写入失败（明确告诉用户，
 * 不能把失败显示成「绑上了」）、成功（收回选择条，让列表回到主角位）。
 */
const applyEnvBinding = async (host: string | null, ack = false): Promise<void> => {
  const target = host || null;
  const stamp = envEndpointStamp();
  try {
    const response: EnvBindingResponse = await chrome.runtime.sendMessage({
      type: MessageType.SET_ENV_BINDING,
      data: { host: currentDomain.value, port: currentPagePort.value?.port ?? null, envHost: target, ack },
    });
    if (stamp !== envEndpointStamp()) return;
    if (!response?.success) {
      logger.warn('SidePanel: 环境绑定写入失败:', response?.error);
      ElMessage.error(t('sidepanel.env.bindFailed'));
      return;
    }
    if (response.data?.needsAck) {
      // 后台没有动原绑定，界面也不能动：否则侧边栏已经收回 fat，内联下拉与一键填充
      // 还在按 fat 服务，正是这条链路反复被钉住的「两个入口结论相反」
      envPendingConfirm.value = target ?? '';
      envPickerOpen.value = true;
      return;
    }
    envPendingConfirm.value = '';
    envHost.value = response.data?.envHost ?? null;
    envPickerOpen.value = false;
  } catch (error) {
    if (stamp !== envEndpointStamp()) return;
    logger.warn('SidePanel: 环境绑定写入异常:', error);
    ElMessage.error(t('sidepanel.env.bindFailed'));
  }
};

/** 读取站点匹配策略；失败回落双缺省，宁可少显示条目也不放宽匹配边界 */
const loadSitePolicy = async (): Promise<void> => {
  try {
    const config = await getDomainMatchConfig();
    domainMatchMode.value = config.mode;
    portScope.value = config.portScope;
  } catch (error) {
    logger.warn('SidePanel: 读取站点匹配策略失败，回落精确匹配与不限端口', error);
    domainMatchMode.value = DEFAULT_DOMAIN_MATCH_MODE;
    portScope.value = DEFAULT_PORT_SCOPE;
  }
};

/** 当前活动标签页的域名匹配上下文（供范围过滤与「能否填充当前页」判定共用） */
const scopeContext = computed<ScopeContext>(() => ({
  domain: currentDomain.value,
  page: currentPagePort.value,
  envHost: boundEnvHost.value,
}));

/**
 * 「本站」预填串：域名加上非默认端口
 *
 * 添加/快速添加入口带的是**条目网址**，端口隔离开启时用户点的正是
 * 「给这个端口的服务单独存一条」，只给域名会存成对所有端口都可见的泛条目。
 * 协议默认端口在 `location.host` 里本就省略，因此默认端口场景下与改动前逐字一致。
 */
const currentSiteHost = computed(() => {
  const domain = currentDomain.value;
  if (!domain) return '';
  const port = rawPortOf(currentPagePort.value);
  return port ? `${domain}:${port}` : domain;
});

/** 持久化策略：填充门控与徽章的唯一口径 */
const sitePolicy = computed<SitePolicy>(() => ({
  mode: domainMatchMode.value,
  portScope: portScope.value,
}));

/**
 * 展示策略：持久化策略在「本站临时放宽」时把端口轴降为 `relaxed`
 *
 * 只有列表可见性读它；任何「能不能填到当前页」的判定一律用 `sitePolicy`，
 * 否则放宽一次显示就会顺带放宽填充，把两个语义不同的东西绑在一起。
 * 刻意不复用 `loose`：环回主机在 `loose` 下仍按端点过滤（那是本地既有的缺省意图），
 * 用 `loose` 表达放宽会让本地页面上的这个开关点了没反应。
 */
const displayPolicy = computed<EffectiveSitePolicy>(() =>
  portRelaxedTemporarily.value ? { mode: sitePolicy.value.mode, portScope: 'relaxed' } : sitePolicy.value,
);

/**
 * 本站范围条目（按档位与端口分层的本站条目 + 空 URL 通用条目）
 * 抽离为独立 computed：头部匹配数、标签候选集与全站命中数共用同一过滤结果，避免重复计算
 */
const domainFilteredPasswords = computed(() =>
  filterEntriesByScope(passwords.value, 'site', scopeContext.value, displayPolicy.value),
);

/**
 * 当前搜索范围内的候选集
 *
 * 本站模式直接复用 domainFilteredPasswords 缓存（默认路径零额外计算，守住首屏 SLA）；
 * 全站模式仅做一次浅拷贝——sortPasswordEntries 为就地排序，必须与 passwords 解耦，
 * 否则会打乱全量列表这一事实来源的顺序。
 */
const scopeFilteredPasswords = computed(() =>
  searchScope.value === 'all' ? [...passwords.value] : domainFilteredPasswords.value,
);

/** 列表级过滤条件（搜索词 / 标签 / 只看收藏），供列表与全站命中数共用同一份判定 */
const listFilterOptions = computed<ListFilterOptions>(() => ({
  keyword: activeSearchKeyword.value,
  tags: filterTags.value,
  favoriteOnly: favoriteOnly.value,
}));

/** 可选标签集：取自当前搜索范围内的条目（标签候选随范围收敛，避免选出必然空结果的标签） */
const availableTags = computed(() => {
  const set = new Set<string>();
  for (const p of scopeFilteredPasswords.value) {
    for (const tag of parseTags(p.tag)) {
      set.add(tag);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

/**
 * 列表排序的域名优先级
 *
 * 权重来自 `utils/domain.ts` 的 `siteRankOf`：**关联度决定先后，档位决定可见**，两者互不越界。
 * 阶梯为 当前端点 → 同主机其他端口 → 通配 → 主域 apex → 同主域其他子域 → 空 URL 通用 → 无关站点，
 * 于是「全站」范围里 `dev.example.com` 与 `localhost:4000` 都不会被 `github.com` 压在上面；
 * 「本站」可见集里只有当前端点与通用两类，相对顺序与改动前逐字一致。
 * 「同主机其他端口」紧跟在当前端点之后（{@link siteRankOf} 内部按持久化端口档分界）：
 * 本机另一个服务比任何跨主机关系都更相关，但它仍排在精确条目之后，首条依旧可填充。
 * 当前页无域名时没有「本站」可收敛，退回二值口径。
 *
 * 判据一律取**持久化**策略而不是展示策略：临时放宽会把展示口径降成只存在于显示层的
 * `relaxed`，若在此处读展示策略，同主机其他端口的条目就会被抬到当前端点之前——实测过一次：
 * 同域名的门面地址排到首位，而回车并不会填它。
 *
 * 环境绑定参与排序但不越权：绑定轴上「精确命中环境主机」同样是 0，与本机当前端点并列，
 * 谁先谁后仍由「收藏置顶 → 排序字段」决定，避免再发明一层「绑了就永远第一」的隐式权重。
 */
const domainPriorityOf = (entry: PasswordEntry): number => {
  const domain = currentDomain.value;
  if (!domain) return getDomainPriority(entry);
  return siteRankWithEnv(entry.url, domain, scopeContext.value.page, sitePolicy.value, boundEnvHost.value);
};

/** 搜索 + 范围过滤 + 标签过滤 + 收藏过滤 + 排序的派生计算属性 */
const filteredPasswords = computed(() => {
  const result = applyListFilters(scopeFilteredPasswords.value, listFilterOptions.value);

  // 应用排序：域名优先级 + 收藏置顶 + 字段排序（复用公共比较器）
  const sortState: SortState = sortConfig.value
    ? { prop: sortConfig.value.prop, order: (sortConfig.value.order || null) as SortState['order'] }
    : DEFAULT_SIDEPANEL_SORT;
  sortPasswordEntries(result, sortState, domainPriorityOf);

  return result;
});

/**
 * 全库命中数（仅用于本站无结果时的空态引导）
 *
 * 惰性求值：computed 仅在空态分支实际读取时才遍历全量列表，本站有结果时短路返回 0，
 * 不给默认路径增加任何开销。
 */
const globalMatchCount = computed(() => {
  if (searchScope.value === 'all' || filteredPasswords.value.length > 0) return 0;
  return applyListFilters(passwords.value, listFilterOptions.value).length;
});

/**
 * 空态引导用：放宽到「同主域名」后可额外带出的同主域条目数
 *
 * 与 `globalMatchCount` 同样惰性求值，只在「本站无结果但全站有命中」的空态分支被读取，
 * 不给默认路径增加遍历开销；计数口径与内联下拉共用 `countSameMainDomainCandidates`。
 */
const crossDomainHintCount = computed(() => {
  if (searchScope.value === 'all' || globalMatchCount.value === 0) return 0;
  return countSameMainDomainCandidates(passwords.value, currentDomain.value, sitePolicy.value, currentPagePort.value);
});

/**
 * 空态引导用：被端口隔离挡在本站之外的同域名条目数
 *
 * 只数「主机已经匹配、纯粹栽在端口门上」的条目，与 `crossDomainHintCount` 互补：
 * 前者说明「放宽跨子域能看到多少」，本数说明「放宽端口限制能看到多少」。
 * 同样惰性求值；公网 + `loose` 结构上不存在被端口挡住的条目，计数函数自己就返回 0。
 */
const portHiddenHintCount = computed(() => {
  if (searchScope.value === 'all' || globalMatchCount.value === 0) return 0;
  if (portRelaxedTemporarily.value) return 0;
  return countPortHiddenCandidates(passwords.value, currentDomain.value, sitePolicy.value, currentPagePort.value);
});

/**
 * 被端口轴挡在本站外的条目数（芯片是否出现的判据）
 *
 * 与上面的 `portHiddenHintCount` 刻意分开：那一句属于**空态引导**，只在「本站一条都不剩」时
 * 才数（`globalMatchCount` 那一支决定这件事），列表有结果时恒为 0。芯片要的判据是
 * 「这一页到底有没有东西可放宽」，而列表非空时恰恰最需要它——真机实测过一次：本地开发页面上
 * `:3000` 的账号正常显示着，被端口挡掉的 `:4000` 账号因此一个提示都没有，因为芯片复用了空态计数、
 * 永远数出 0。
 */
const portHiddenTotal = computed(() => {
  if (portRelaxedTemporarily.value || searchScope.value === 'all') return 0;
  return countPortHiddenCandidates(passwords.value, currentDomain.value, sitePolicy.value, currentPagePort.value);
});

/**
 * 端口芯片是否该出现
 *
 * - `strict`：沿用既有判据（当前页确实带着非默认端口），公网场景的呈现逐条不变；
 * - 环回主机 + `loose`：本地端点同样会按端口把同主机条目挡在站外，那正是「悄悄少了几条
 *   且无处可问」的高发场景，因此数出有被挡住的条目时才出现；
 * - 放宽态自身必须继续渲染，否则用户没有收回的入口（此时计数已归零）。
 */
const showPortChip = computed(() => {
  if (portScope.value === 'strict') return !!currentPagePort.value && !currentPagePort.value.atDefaultPort;
  return portRelaxedTemporarily.value || (isLoopbackHost(currentDomain.value) && portHiddenTotal.value > 0);
});

/**
 * 当前可见列表中「非精确层级」（通配条目 / 主域条目 / 同主域其他子域）的条目 ID 集
 *
 * 行内「跨子域」来源徽章的唯一事实来源：档位判定只在 App.vue 做一次，
 * 子组件按 ID 查表，避免每行重复解析域名。`off` 档下本站可见集里不存在非精确条目，
 * 直接返回共享空集（引用恒定），默认路径零额外遍历。
 */
const crossDomainIds = computed<ReadonlySet<string>>(() => {
  const domain = currentDomain.value;
  if (domainMatchMode.value === DEFAULT_DOMAIN_MATCH_MODE) return EMPTY_ID_SET;
  if (!domain) return EMPTY_ID_SET;

  const mode = domainMatchMode.value;
  const ids = new Set<string>();
  for (const entry of scopeFilteredPasswords.value) {
    const tier = resolveMatchTier(domain, entry.url, mode);
    // tier 4（空 URL 通用条目）不带徽章：它今天本来就出现在任何站点，不是跨子域放宽带来的
    if (isCrossSubdomainTier(tier)) ids.add(entry.id);
  }
  return ids;
});

/**
 * 当前可见列表中「同域名但端口不同」的条目 ID 集
 *
 * 只有临时放宽才会让它们现身，因此这一集与「显示其他端口」的开关同生同灭；
 * 徽章与关联度分层共用它，避免出现「标了其他端口却排在精确条目前面」的自相矛盾。
 */
const portMismatchIds = computed<ReadonlySet<string>>(() => {
  if (!portRelaxedTemporarily.value) return EMPTY_ID_SET;
  const domain = currentDomain.value;
  if (!domain) return EMPTY_ID_SET;

  const policy = sitePolicy.value;
  const page = currentPagePort.value;
  const ids = new Set<string>();
  for (const entry of filteredPasswords.value) {
    if (isHiddenByPortOnly(entry.url, domain, page, policy)) ids.add(entry.id);
  }
  return ids;
});

/**
 * 仅因环境绑定才出现在本站的条目 ID 集
 *
 * 判据与放开门禁同源（`isAdmittedByEnvOnly`），因此不会出现「标了环境却是本机条目」或
 * 「fat 的账号没有来源标记」。这一集为空时整个遍历短路返回共享空集，默认路径零开销。
 */
const envOnlyIds = computed<ReadonlySet<string>>(() => {
  const bound = boundEnvHost.value;
  const domain = currentDomain.value;
  if (!bound || !domain) return EMPTY_ID_SET;

  const policy = sitePolicy.value;
  const page = currentPagePort.value;
  const ids = new Set<string>();
  for (const entry of filteredPasswords.value) {
    if (isAdmittedByEnvOnly(entry.url, domain, page, policy, bound)) ids.add(entry.id);
  }
  return ids;
});

/**
 * 不可填充到当前页的条目 ID 集
 *
 * 两种来源共用这一判据：全站搜索模式下的外站条目、以及临时放宽带出的「同域名其他端口」条目。
 * 两者都是「主机或端口对不上眼前这个登录框」，因此动作降级（隐藏填充并登录 / 填充验证码，
 * 整行点击改为打开站点）也同构。判据恒用持久化策略：放宽只放宽显示，不放宽填充。
 * 两种情形都不成立时返回共享空集（引用恒定），默认路径零额外遍历。
 */
const notFillableIds = computed<ReadonlySet<string>>(() => {
  if (searchScope.value !== 'all' && !portRelaxedTemporarily.value) return EMPTY_ID_SET;
  const ctx = scopeContext.value;
  const policy = sitePolicy.value;
  const ids = new Set<string>();
  for (const entry of filteredPasswords.value) {
    if (!matchesSiteScope(entry, ctx, policy)) ids.add(entry.id);
  }
  return ids;
});

/** 收藏/标签/搜索范围变化时重置选中索引（过滤条件变化后旧索引可能越界或指向其它条目） */
watch([favoriteOnly, filterTags, searchScope], () => {
  activeIndex.value = 0;
});

/**
 * 切换活动标签页后回到本站范围
 *
 * 新页面上下文下继续全站搜索会让「打开站点」与当前页填充语义混淆，
 * 且用户切站后的心智模型已回到「填这个站」。
 *
 * 必须同时监听端口：本地开发域名切换端口（localhost:3000 → localhost:5173）时
 * currentDomain 不变而 matchesSiteScope 的判定已变，只监听域名会漏掉本次重置。
 * 档位与端口范围同理：切档后本站范围会扩容或收窄，继续停留在全站搜索会让「本站」按钮语义悬空。
 */
watch([currentDomain, currentPagePort, domainMatchMode, portScope], () => {
  searchScope.value = 'site';
});

/**
 * 页面上下文或端口隔离策略变化时收回「临时放宽」
 *
 * 放宽的作用域是「当前这个端点」，换了页面或用户已就策略本身做出新选择，
 * 继续沿用会把它变成看不见的常驻状态——那正是设置项该管的事。
 */
watch([currentDomain, currentPagePort, portScope], () => {
  portRelaxedTemporarily.value = false;
});

/**
 * 端点或候选集变化时重新同步环境绑定
 *
 * 绑定的作用域是「这一个 host:port」，因此域名或端口任一变化都要重取：沿用上一页的绑定
 * 等于把 A 环境的账号带到 B 页面上，那正是这条作用域要防的事。
 * `canBindEnv` 也在依赖里——库里条目刚加载完时候选集才从空变非空，此时才该去读绑定。
 * 展开态与待确认项一并收回：确认条属于某一个端点，换页后不应残留。
 */
watch([currentDomain, currentPagePort, canBindEnv], () => {
  envPickerOpen.value = false;
  envPendingConfirm.value = '';
  void syncEnvBinding();
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

/**
 * 搜索处理：击键即把选中索引归零
 *
 * 归零挂在「击键」而非「防抖落地」上是有意为之：击键时索引先回 0，
 * 之后任何一次键盘导航都会先 `flushSearchKeyword()` 再取列表，
 * 因此落点必然属于最新列表。若改为监听防抖值落地后归零，
 * 那次归零会在 pre-flush 队列里覆盖同一按键刚设好的新索引，把 ↓ 吃掉。
 */
const handleSearch = () => {
  activeIndex.value = 0;
};

/** 键盘导航处理 */
const handleKeydown = (e: KeyboardEvent) => {
  // 输入法合成期间（中文/日文选词）的 Enter 是「上屏」、↑↓ 是「候选翻页」，
  // 容器冒泡到这里若继续接管，会在确认候选词的同时误填充密码，故整段放行给 IME。
  if (e.isComposing) return;

  // 关键词防抖未落地时先同步：否则本次操作以「上一个列表」为准，
  // 会出现刚打完字就按 ↓ 却停在旧结果、按回车填了上一条的错位。
  // 放在 `filteredPasswords` 读取之前，同一次按键内看到的即是最过滤后的列表。
  flushSearchKeyword();

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
    case 'Enter': {
      e.preventDefault();
      const entry = list[activeIndex.value];
      if (!entry) break;
      // 与整行点击保持一致：本站本站点条目填充当前页，被降级的条目（外站 / 其他端口）打开其站点
      // 策略必须显式传入，且恒用持久化值——临时放宽只放宽显示，回车不该填进另一个端口的服务
      if (matchesSiteScope(entry, scopeContext.value, sitePolicy.value)) {
        fillPassword(entry);
      } else {
        handleOpenSite(entry);
      }
      break;
    }
    case 'Escape':
      e.preventDefault();
      window.close();
      break;
    case 'c':
    case 'C':
      if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift+C: 复制密码 暂不需要（注释，别删除）
      } else if (e.ctrlKey) {
        // 焦点在搜索框等可编辑元素内时让路：否则 preventDefault 会吃掉浏览器原生复制，
        // 用户选中搜索词按 Ctrl+C 得到的却是高亮条目的用户名
        if (isEditableEventTarget(e.target)) break;
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
      activeEl.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
    }
  });
};

/**
 * 每个条目最近一次收藏操作的代际号
 *
 * 连续快速切换收藏时，早先请求可能晚于后续请求失败返回；若其回滚无条件写回发起时的旧值，
 * 会覆盖更晚一次已完成操作的状态与 favoriteUsedAt。用「最新代际」守卫回滚：只有仍是该条目
 * 最新一次操作的失败才回滚，迟到的旧失败静默忽略（持久化真值以 SW 单写队列为准）。
 */
const favoriteOpSeq = new Map<string, number>();

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
    // 乐观更新前的原值：委托写入失败时据此回滚，否则星标停在已翻转态、刷新后又"复活"
    const prevFavorite = entry?.favorite ?? false;
    const prevFavoriteUsedAt = entry?.favoriteUsedAt;
    // 本次操作的代际：晚到的旧请求失败时据此判定是否仍是最新操作，避免覆盖更晚的新状态
    const seq = (favoriteOpSeq.get(password.id) ?? 0) + 1;
    favoriteOpSeq.set(password.id, seq);
    const restoreFavorite = () => {
      if (!entry || favoriteOpSeq.get(password.id) !== seq) return;
      entry.favorite = prevFavorite;
      entry.favoriteUsedAt = prevFavoriteUsedAt;
    };

    /** 委托 SW 持久化元数据（取消收藏的 favoriteUsedAt 传 null，由 SW 侧转换为字段删除） */
    const persistMetadata = (updates: UpdatePasswordMetadataData['updates']) =>
      chrome.runtime
        .sendMessage({
          type: MessageType.UPDATE_PASSWORD_METADATA,
          data: { id: password.id, updates },
        } as RuntimeMessage)
        .catch(error => {
          logger.error('切换收藏失败:', error);
          restoreFavorite();
          ElMessage.error(t('sidepanel.favoriteSaveFailed'));
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
 * 打开条目所属站点（全站搜索模式下外站条目的整行动作）
 *
 * 外站条目无法填充到当前页（页面上没有对应输入框），改为新标签页打开其站点，
 * 用户到达后可在新页面上重新用侧边栏/悬浮按钮填充（此时该条目已变为本站范围）。
 *
 * 安全边界：URL 先经 toNavigableUrl 白名单校验（仅放行 http/https），
 * 杜绝条目中可能存在的 javascript: / chrome: 等协议被浏览器执行。
 * 未发生填充，故不写 lastUsedAt（「最近使用」仍严格表达填充行为）。
 */
const handleOpenSite = (password: PasswordEntry) => {
  const url = toNavigableUrl(password.url);
  if (!url) {
    ElMessage.warning(t('sidepanel.openSiteInvalidUrl'));
    return;
  }

  /** 同步抛出与 Promise reject 两条失败路径共用同一反馈（不静默吞掉用户可见错误） */
  const reportFailure = (error: unknown) => {
    logger.error('SidePanel: 打开条目站点失败:', error);
    ElMessage.error(t('sidepanel.openSiteFailed'));
  };

  try {
    void chrome.tabs.create({ url }).catch(reportFailure);
  } catch (error) {
    reportFailure(error);
  }
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
 * 空态深链：打开密码管理页并直达「跨子域匹配」设置对话框
 *
 * 与「点时间 = 续期」同样的直达心智；不携带域名等自报参数，收口在 Options 侧按当前标签页取值。
 */
const openDomainMatchSetting = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH });
  } catch (error) {
    logger.error('SidePanel: 打开跨子域匹配设置失败:', error);
  }
};

/**
 * 头部端口芯片文案（当前端口，如 `:3000`）
 *
 * `strict` 下只在当前页确实带着非默认端口时给出——处于默认端口时端口隔离不改变任何可见集合，
 * 摆一个点不动的芯片只会让人以为它坏了；环回主机在 `loose` 下则由「本页是否真有条目被端口挡住」
 * 决定（见 `showPortChip`），芯片本身只报端口号与被挡住的数量在哪能看见，数字出现在空态那句里。
 */
const portChipLabel = computed(() => {
  if (!showPortChip.value) return '';
  return `:${currentPagePort.value?.port ?? ''}`;
});

/**
 * 切换「本站临时显示全部端口」
 *
 * 就地翻转即可，无需任何落盘：`displayPolicy` / `notFillableIds` / `portMismatchIds`
 * 都由这一个开关派生，切标签页或改动持久化策略时自动收回（见相应 watch）。
 */
const togglePortRelax = (): void => {
  portRelaxedTemporarily.value = !portRelaxedTemporarily.value;
};

/**
 * 展开/收起环境选择条（芯片自己的手势）
 *
 * 「点外面收起」不在这里做，见 `handleEnvOutsidePointer`：芯片在选择条之外，
 * 若由选择条监听全局按下并直接收起，同一次点击的后续 `click` 会把它再打开，
 * 面板永远收不起来，且会把待确认的线上绑定一起抹掉。
 */
const toggleEnvPicker = (): void => {
  envPickerOpen.value = !envPickerOpen.value;
  if (!envPickerOpen.value) envPendingConfirm.value = '';
};

/** 收起选择条：一次未完成的确认随之作废（它属于这一次点选） */
const closeEnvPicker = (): void => {
  if (!envPickerOpen.value) return;
  envPickerOpen.value = false;
  envPendingConfirm.value = '';
};

/** 选择条展开时接管「点外面」与 Esc，两者都在收起时注销 */
const handleEnvOutsidePointer = (event: MouseEvent): void => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  // 头部卡片（芯片所在）与选择条内部的按下都不算「外面」
  if (headerCardRef.value?.contains(target)) return;
  if (envBarEl.value?.contains(target)) return;
  closeEnvPicker();
};

const handleEnvEscape = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return;
  // 截在捕获阶段：容器上的键盘导航同样把 Esc 当作「关面板」，选择条开着时 Esc 只收选择条
  event.stopPropagation();
  closeEnvPicker();
};

watch(envPickerOpen, open => {
  const method = open ? document.addEventListener : document.removeEventListener;
  method('mousedown', handleEnvOutsidePointer, true);
  method('keydown', handleEnvEscape, true);
});

/**
 * 选定环境
 *
 * 再点一次当前环境即清除绑定：本地页切回「只看这台机器」是高频收尾动作，
 * 不该藏在第二个按钮里。
 */
const handlePickEnv = (host: string): void => {
  void applyEnvBinding(host && host === boundEnvHost.value ? null : host);
};

/** 确认「把这个环境的账号带到本地页」，带上 ack 重发同一次绑定 */
const handleConfirmEnv = (): void => {
  const host = envPendingConfirm.value;
  envPendingConfirm.value = '';
  if (host) void applyEnvBinding(host, true);
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
 * data 可选携带当前站点（P1-6）：新增表单 URL 字段自动预填本站域名（含非默认端口），
 * 无域名场景（本地开发域名跳过过滤时仍可能有值，空则不预填）行为与旧版一致
 */
const openOptionsAndAdd = async () => {
  try {
    const data = currentSiteHost.value ? { url: currentSiteHost.value } : undefined;
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_AND_ADD, data });
  } catch (error) {
    logger.error('SidePanel: 打开添加密码页面失败:', error);
  }
};

// ==================== 全局配置变更同步 ====================

/** 全局「自动触发登录」开关：开启时侧边栏点条目即等于「填充并登录」，隐藏每条冗余的「填充并登录」按钮 */
const autoTriggerLogin = ref(false);

/**
 * chrome.storage.local 变更监听：把「在别处改了、侧边栏需即时生效」的配置收敛到一处处理，
 * 避免为每个键各挂一个 listener——悬浮按钮/侧边栏设置弹窗内切换「自动触发登录」，
 * 以及 Options 页切换跨子域匹配档位，都不需要重开侧边栏。
 */
const handleLocalConfigChange = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => {
  if (areaName !== 'local') return;

  if (STORAGE_KEYS.FLOATING_BUTTON_CONFIG in changes) {
    const next = changes[STORAGE_KEYS.FLOATING_BUTTON_CONFIG].newValue as { autoTriggerLogin?: boolean } | undefined;
    autoTriggerLogin.value = next?.autoTriggerLogin ?? false;
  }

  if (STORAGE_KEYS.DOMAIN_MATCH_CONFIG in changes) {
    const next = changes[STORAGE_KEYS.DOMAIN_MATCH_CONFIG].newValue as
      { mode?: unknown; portScope?: unknown } | undefined;
    domainMatchMode.value = isDomainMatchMode(next?.mode) ? next.mode : DEFAULT_DOMAIN_MATCH_MODE;
    portScope.value = isPortScope(next?.portScope) ? next.portScope : DEFAULT_PORT_SCOPE;
  }
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
  if (!skeletonEl) {
    logger.warn('SidePanel: 骨架屏元素不存在，跳过淡出逻辑');
  }

  // 读取全局「自动触发登录」与跨子域匹配档位，并监听后续变更；均不阻塞首屏
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleLocalConfigChange);
  }
  void getFloatingButtonConfig()
    .then(cfg => {
      autoTriggerLogin.value = cfg.autoTriggerLogin;
    })
    .catch(error => logger.error('SidePanel: 读取自动触发登录配置失败:', error));
  void loadSitePolicy();

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

    // 空闲预取：设置弹窗模块 + HelpDialog + QuickAddDialog + TotpCode + 认证视图 chunk（不阻塞首屏渲染），
    // 冷环境（Windows 会话失效期 / 浏览器重启引导期）下用户首次交互时 chunk 已温热、即时打开；
    // 认证视图 chunk 在锁屏态被跳过立即预取（见 onMounted 前段），此处补齐使解锁切换零等待；
    // 未取完前触发则退化为按需加载，无回退风险；预取失败静默吞掉（交互时按需加载兜底）
    const preloadIdleModules = () => {
      void ensureSettingsModule().catch(() => {});
      // 与 defineAsyncComponent 使用同一 import specifier，Vite 复用同一 chunk
      void import('@/components/sidepanel/SidepanelAuthView.vue').catch(() => {});
      void import('@/components/sidepanel/HelpDialog.vue').catch(() => {});
      void import('@/components/sidepanel/QuickAddDialog.vue').catch(() => {});
      void import('@/components/TotpCode.vue').catch(() => {});
      // 预热拼音匹配模块（独立 chunk，不进首屏关键路径）：就绪后过滤 computed 自动重算补齐拼音命中
      void warmPinyinMatcher();
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
      // 锁屏态立即预取 HelpDialog chunk（fire-and-forget）：
      // 锁屏快速路径命中后主线程快速释放，但 requestIdleCallback 仍可能延迟 1-3 秒
      // （数据竞速瀑布阻塞 storage.local 冷读），用户点击帮助时 chunk 尚未加载。
      // 直接 import 使 chunk 加载与骨架屏淡出并行，用户点击时 chunk 已温热；
      // 与 defineAsyncComponent / preloadIdleModules 使用同一 specifier，Vite 复用同一 chunk
      void import('@/components/sidepanel/HelpDialog.vue').catch(() => {});
      // 窗口被遮挡/不可见时 Chrome 会冻结 rAF，加 100ms 定时兜底（finishOpen 幂等，先到者生效）；
      // 活跃视窗下 rAF 一帧内（~16ms）必触发，兜底仅在 rAF 冻结时生效，
      // 此前取 500ms 过于保守——锁屏卡片为内联模板挂载即就绪，无需多留骨架屏
      setTimeout(finishOpen, 100);
      nextTick(() => requestAnimationFrame(finishOpen));
    })
    .catch(() => {});

  // 将已在 onMounted 起点发起的轻量判定复用给本地回退路径；仅作为 chunk
  // 预拉提示，完整会话验证仍由 useSidepanelData 内部执行。
  const initMeta = await initSidepanelData(quickInvalidPromise);

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
    chrome.storage.onChanged.removeListener(handleLocalConfigChange);
  }
  // 环境选择条的文档级监听只在展开期间挂着；面板销毁时若还开着，必须补一次注销
  if (envPickerOpen.value) {
    document.removeEventListener('mousedown', handleEnvOutsidePointer, true);
    document.removeEventListener('keydown', handleEnvEscape, true);
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

.sp-auth-view-error {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  margin: 8px 8px 0;
  color: #6b7280;
  background: #fff;
  border-radius: 12px;
}

.sp-auth-view-error__retry {
  padding: 8px 18px;
  color: #fff;
  cursor: pointer;
  background: var(--aph-primary);
  border: 0;
  border-radius: 8px;
}

.sp-auth-view-error__retry:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 2px;
}

.sp-auth-view-error__retry:hover {
  background: var(--aph-primary-hover);
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

@media (prefers-reduced-motion: reduce) {
  .sp-auth-view-loading__spinner {
    animation: none;
  }
}
</style>
