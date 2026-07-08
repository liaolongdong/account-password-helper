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
        @open-github="openGithub"
        @open-help="showHelpDialog = true"
        @open-settings="handleOpenSettings"
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
        <h3 class="auth-title">会话已失效</h3>
        <p class="auth-desc">请在选项中验证主密码以解锁快速填充功能</p>
        <el-button
          class="auth-verify-btn"
          type="primary"
          :icon="BrandLogo"
          size="large"
          @click="openOptions"
        >
          去验证主密码
        </el-button>
      </div>
    </div>

    <!-- 已认证状态：搜索框 + 密码列表 -->
    <template v-else>
      <!-- 搜索卡片 -->
      <div class="search-card">
        <div class="search-section">
          <el-input
            ref="searchInputRef"
            v-model="searchKeyword"
            placeholder="搜索用户名、标签、备注、网址..."
            :prefix-icon="Search"
            clearable
            @input="handleSearch"
          />
          <el-tooltip
            :content="favoriteOnly ? '显示全部' : '只看收藏'"
            placement="top"
            :show-after="400"
          >
            <el-button
              :icon="favoriteOnly ? StarFilled : Star"
              circle
              size="small"
              :type="favoriteOnly ? 'warning' : 'default'"
              @click="favoriteOnly = !favoriteOnly"
            />
          </el-tooltip>
          <el-tooltip
            content="排序方式"
            placement="top"
            :show-after="400"
          >
            <el-dropdown
              trigger="click"
              popper-class="sort-dropdown-popper"
              @command="handleSortChange"
            >
              <el-button
                :icon="Sort"
                circle
                size="small"
              />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    command="lastUsedAt"
                    :class="{ 'is-active': sidepanelSortProp === 'lastUsedAt' }"
                  >
                    <el-icon class="sort-item-icon"><Timer /></el-icon>
                    <span>最近使用</span>
                    <el-icon
                      v-if="sidepanelSortProp === 'lastUsedAt'"
                      class="sort-check-icon"
                      ><Check
                    /></el-icon>
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="updateTime"
                    :class="{ 'is-active': sidepanelSortProp === 'updateTime' }"
                  >
                    <el-icon class="sort-item-icon"><Refresh /></el-icon>
                    <span>最近更新</span>
                    <el-icon
                      v-if="sidepanelSortProp === 'updateTime'"
                      class="sort-check-icon"
                      ><Check
                    /></el-icon>
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="username"
                    :class="{ 'is-active': sidepanelSortProp === 'username' }"
                  >
                    <el-icon class="sort-item-icon"><User /></el-icon>
                    <span>用户名</span>
                    <el-icon
                      v-if="sidepanelSortProp === 'username'"
                      class="sort-check-icon"
                      ><Check
                    /></el-icon>
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="url"
                    :class="{ 'is-active': sidepanelSortProp === 'url' }"
                  >
                    <el-icon class="sort-item-icon"><Link /></el-icon>
                    <span>网址</span>
                    <el-icon
                      v-if="sidepanelSortProp === 'url'"
                      class="sort-check-icon"
                      ><Check
                    /></el-icon>
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="createTime"
                    :class="{ 'is-active': sidepanelSortProp === 'createTime' }"
                  >
                    <el-icon class="sort-item-icon"><Clock /></el-icon>
                    <span>创建时间</span>
                    <el-icon
                      v-if="sidepanelSortProp === 'createTime'"
                      class="sort-check-icon"
                      ><Check
                    /></el-icon>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </el-tooltip>
        </div>
      </div>

      <!-- 密码列表卡片 -->
      <div class="list-card">
        <div class="password-list">
          <div
            v-if="loading"
            class="loading-state"
          >
            <el-icon class="is-loading loading-spinner"><Loading /></el-icon>
            <span>加载中...</span>
          </div>

          <div
            v-else-if="filteredPasswords.length === 0"
            class="empty-state"
          >
            <!-- 全部无数据：显示引导添加 -->
            <template v-if="passwords.length === 0">
              <div class="empty-icon-circle">
                <el-icon class="empty-icon"><Plus /></el-icon>
              </div>
              <h3 class="empty-title">还没有保存的密码</h3>
              <p class="empty-desc">在密码管理中导入或添加密码</p>
              <el-button
                type="primary"
                :icon="Plus"
                class="empty-add-btn"
                @click="openOptionsAndAdd"
              >
                去添加密码
              </el-button>
            </template>
            <!-- 搜索/过滤无结果 -->
            <template v-else>
              <div class="empty-icon-circle empty-icon-circle--muted">
                <el-icon class="empty-icon empty-icon--muted"><Search /></el-icon>
              </div>
              <h3 class="empty-title">暂无匹配的密码</h3>
              <p class="empty-desc">试试调整搜索关键词或筛选条件</p>
            </template>
          </div>

          <div
            v-else
            class="password-items"
          >
            <PasswordListItem
              v-for="(password, index) in filteredPasswords"
              :key="password.id"
              :password="password"
              :is-active="activeIndex === index"
              @fill="fillPassword"
              @fill-and-login="handleFillAndLogin"
              @edit="handleEditPassword"
              @toggle-favorite="toggleFavorite"
              @copy-username="copyUsername"
              @copy-password="copyPassword"
              @mouseenter="activeIndex = index"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- 底部操作 -->
    <div class="footer-card">
      <el-button
        :icon="BrandLogo"
        class="footer-manage-btn"
        @click="openOptions"
      >
        密码管理
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
import { ref, onMounted, computed, watch, nextTick, defineAsyncComponent } from 'vue';
import {
  Search,
  Loading,
  Star,
  StarFilled,
  Plus,
  Sort,
  Check,
  Timer,
  Refresh,
  User,
  Link,
  Lock,
  Clock,
} from '@element-plus/icons-vue';
import SidepanelHeader from '@/components/sidepanel/SidepanelHeader.vue';
import PasswordListItem from '@/components/sidepanel/PasswordListItem.vue';
import type { PasswordEntry } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { saveSidepanelSortConfig, getFavoriteLimit } from '@/utils/storage/configManager';
import { logger } from '@/utils/logger';
import { sortPasswordEntries, DEFAULT_SIDEPANEL_SORT, type SortState } from '@/utils/passwordSort';
import { useSidepanelData } from '@/composables/useSidepanelData';
import { useSidepanelFill } from '@/composables/useSidepanelFill';
import { isLocalDevDomain } from '@/utils/domain';

/** 操作指引弹窗——懒加载（仅在用户点击「帮助」时加载） */
const HelpDialog = defineAsyncComponent(() => import('@/components/sidepanel/HelpDialog.vue'));

/** 品牌 Logo——异步加载（纯 SVG，Footer 按钮 icon 使用） */
const BrandLogo = defineAsyncComponent(() => import('@/components/BrandLogo.vue'));

// ==================== 延迟加载模块（用户交互时触发，避免初始加载拉入 encryption.ts） ====================

/** 延迟加载的 passwordCrud 模块引用 */
let _passwordCrudModule: typeof import('@/utils/storage/passwordCrud') | null = null;

/** 延迟加载的 autoSaveManager 模块引用 */
let _autoSaveModule: typeof import('@/utils/storage/autoSaveManager') | null = null;

/** 获取 updatePasswordInSession（首次收藏/填充操作时加载） */
const getUpdatePasswordInSession = async () => {
  if (!_passwordCrudModule) {
    _passwordCrudModule = await import('@/utils/storage/passwordCrud');
  }
  return _passwordCrudModule.updatePasswordInSession;
};

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
} = useSidepanelData();

const { fillPassword, handleFillAndLogin, handleEditPassword, copyUsername, copyPassword } =
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
const activeIndex = ref(0);
const searchInputRef = ref();

/** 当前插件版本号，直接读取 manifest 避免加载 useVersionUpdate 的 192K JS + 56K CSS 依赖 */
const currentVersion = chrome.runtime.getManifest().version;

/** 操作指引弹窗可见性 */
const showHelpDialog = ref(false);

// ==================== 排序与过滤 ====================

/** 搜索 + 域名过滤 + 收藏过滤 + 排序的派生计算属性 */
const filteredPasswords = computed(() => {
  let result = [...passwords.value];

  // 域名过滤：只显示匹配当前域名的条目 + URL 为空的条目（与 getPasswordsByUrl 逻辑一致）
  // 本地开发域名（localhost / 127.0.0.1）跳过过滤，显示全部
  if (currentDomain.value && !isLocalDevDomain(currentDomain.value)) {
    const domain = currentDomain.value;
    result = result.filter(p => {
      if (!p.url || p.url.trim() === '') return true;
      return domain.includes(p.url) || p.url.includes(domain);
    });
  }

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

/** 收藏过滤变化时重置选中索引 */
watch(favoriteOnly, () => {
  activeIndex.value = 0;
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

/** 切换收藏状态（支持 LRU 淘汰：收藏数达上限时自动替换最近最少使用的收藏条目） */
const toggleFavorite = async (password: PasswordEntry) => {
  try {
    const newFav = !password.favorite;
    const entry = passwords.value.find(p => p.id === password.id);

    if (newFav) {
      // 收藏前检查是否已达上限，若达则先淘汰 LRU 条目（延迟加载 autoSaveManager）
      const evictFn = await getEvictLRUFavoriteIfNeeded();
      const evicted = await evictFn(passwords.value);
      if (evicted) {
        const limit = await getFavoriteLimit();
        ElMessage.info(`收藏已满（${limit} 条），已自动替换「${evicted.username}」`);
      }
      const now = Date.now();
      const updateFn = await getUpdatePasswordInSession();
      await updateFn(password.id, {
        favorite: true,
        favoriteUsedAt: now,
        updateTime: password.updateTime,
      });
      if (entry) {
        entry.favorite = true;
        entry.favoriteUsedAt = now;
      }
      ElMessage.success('已收藏');
    } else {
      const updateFn = await getUpdatePasswordInSession();
      await updateFn(password.id, {
        favorite: false,
        favoriteUsedAt: undefined,
        updateTime: password.updateTime,
      });
      if (entry) {
        entry.favorite = false;
        entry.favoriteUsedAt = undefined;
      }
      ElMessage.success('已取消收藏');
    }
  } catch (error) {
    logger.error('切换收藏失败:', error);
    ElMessage.error('操作失败');
  }
};

// ==================== 导航操作 ====================

/** 打开 GitHub 仓库 */
const openGithub = () => {
  chrome.tabs.create({ url: 'https://github.com/liaolongdong/account-password-helper' });
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

/** 跳转到密码管理页并自动打开添加密码弹窗 */
const openOptionsAndAdd = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_AND_ADD });
  } catch (error) {
    logger.error('SidePanel: 打开添加密码页面失败:', error);
  }
};

// ==================== 初始化 ====================

onMounted(async () => {
  // 性能埋点：测量 Vue mount 开始（main.ts performance.mark）→ onMounted 回调触发的间隔
  const _vueMountMeasure = performance.measure('vue-mount', 'vue-mount-start');
  const vueMountDuration = _vueMountMeasure?.duration ?? 0;
  if (_vueMountMeasure) {
    logger.debug(`SidePanel: Vue mount → onMounted ${vueMountDuration.toFixed(1)}ms`);
  }

  const _perfMountStart = performance.now();

  // 获取骨架屏元素（兄弟节点模式，Vue 挂载不会替换它）
  const skeletonEl = document.getElementById('app-loading');

  // 搜索框自动聚焦
  nextTick(() => {
    const inputEl = searchInputRef.value?.$el?.querySelector('input');
    if (inputEl) inputEl.focus();
  });

  await initSidepanelData();

  const _perfDataReady = performance.now();
  logger.debug(
    `SidePanel: 首屏数据就绪，initSidepanelData 耗时 ${(_perfDataReady - _perfMountStart).toFixed(1)}ms，总计 ${(_perfDataReady - (_vueMountMeasure?.startTime ?? 0)).toFixed(1)}ms`,
  );

  // 数据就绪后淡出骨架屏，实现 骨架屏 → 真实UI 的无缝过渡
  // 骨架屏作为兄弟节点保持可见直到此处，避免了中间的 loading spinner 闪烁
  if (skeletonEl) {
    skeletonEl.classList.add('fade-out');
    skeletonEl.addEventListener('transitionend', () => skeletonEl.remove(), { once: true });
    // 安全兜底：transitionend 未触发时强制移除（200ms = CSS transition 时长）
    setTimeout(() => skeletonEl.remove(), 250);
  }

  // 数据加载完成后，空闲时预加载设置弹窗模块（不阻塞首屏渲染）
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      void ensureSettingsModule();
    });
  } else {
    setTimeout(() => {
      void ensureSettingsModule();
    }, 1000);
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

/* ========== 卡片通用样式 ========== */
.header-card,
.search-card,
.list-card,
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

.search-card {
  margin-top: 8px;
  overflow: hidden;
}

.list-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  margin-top: 8px;
  overflow: hidden;
}

.footer-card {
  padding: 10px 16px;
  margin-top: 8px;
  margin-bottom: 8px;
  text-align: center;
}

.search-section {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
}

.search-section :deep(.el-input) {
  flex: 1;
}

.password-list {
  flex: 1;
  padding: 8px 0;

  /* hidden=水平裁剪，auto=垂直滚动 */
  overflow: hidden auto;
}

.loading-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: #6b7280;
}

.loading-spinner {
  margin-bottom: 8px;
  font-size: 24px;
}

/* ========== 空状态（列表内） ========== */
.empty-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  text-align: center;
}

.empty-icon-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  background: #f0fdf4;
  border-radius: 50%;
}

.empty-icon-circle--muted {
  background: #f1f5f9;
}

.empty-icon {
  font-size: 24px;
  color: #22c55e;
}

.empty-icon--muted {
  color: #94a3b8;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.empty-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: #6b7280;
}

/* 去添加密码按钮：圆角 + hover 上浮动效 */
:deep(.empty-add-btn) {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgb(64 158 255 / 25%);
  transition: all 0.25s ease;
}

:deep(.empty-add-btn:hover) {
  box-shadow: 0 4px 14px rgb(64 158 255 / 40%);
  transform: translateY(-1px);
}

/* 密码管理按钮：浅蓝背景 + hover 变实心蓝 */
:deep(.footer-manage-btn) {
  width: 100%;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: #409eff;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 8px;
  transition: all 0.25s ease;
}

:deep(.footer-manage-btn:hover) {
  color: #fff;
  background: #409eff;
  border-color: #409eff;
  box-shadow: 0 2px 8px rgb(64 158 255 / 30%);
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
  background: #ecf5ff;
  border-radius: 50%;
}

.auth-icon {
  font-size: 28px;
  color: #409eff;
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

/* 滚动条样式 */
.password-list::-webkit-scrollbar {
  width: 4px;
}

.password-list::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.password-list::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 2px;
}

.password-list::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 排序触发按钮：当选中非默认排序时显示微妙激活态 */
.search-section :deep(.el-dropdown) .el-button.is-active-sort {
  color: #409eff;
  background: #ecf5ff;
  border-color: #d9ecff;
}
</style>

<style>
/* 排序下拉菜单（popper teleported 到 body，无法使用 scoped） */
.sort-dropdown-popper {
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgb(0 0 0 / 10%) !important;
}

.sort-dropdown-popper .el-dropdown-menu {
  padding: 4px 0;
}

.sort-dropdown-popper .el-dropdown-menu__item {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 8px 12px;
  margin: 0 4px;
  font-size: 12px;
  color: #374151;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.sort-dropdown-popper .el-dropdown-menu__item .sort-item-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  font-size: 15px;
  color: #9ca3af;
  transition: color 0.2s ease;
}

.sort-dropdown-popper .el-dropdown-menu__item span {
  flex: 1;
  text-align: left;
}

.sort-dropdown-popper .el-dropdown-menu__item .sort-check-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  font-size: 14px;
  font-weight: 700;
  color: #409eff;
}

.sort-dropdown-popper .el-dropdown-menu__item:hover {
  color: #1f2937;
  background: #f5f7fa;
}

.sort-dropdown-popper .el-dropdown-menu__item:hover .sort-item-icon {
  color: #6b7280;
}

.sort-dropdown-popper .el-dropdown-menu__item.is-active {
  color: #409eff;
  background: #ecf5ff;
}

.sort-dropdown-popper .el-dropdown-menu__item.is-active .sort-item-icon {
  color: #409eff;
}

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
</style>
