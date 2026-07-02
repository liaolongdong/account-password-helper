<template>
  <div
    v-show="showSidepanel"
    class="sidepanel-container"
    @keydown="handleKeydown"
  >
    <!-- 头部 -->
    <SidepanelHeader
      :current-version="currentVersion"
      :current-domain="currentDomain"
      @open-github="openGithub"
      @open-help="showHelpDialog = true"
      @open-settings="handleOpenSettings"
    />

    <!-- 初始化 loading 过渡态：避免先闪现"需要验证主密码"再切换到密码列表 -->
    <div
      v-if="initializing"
      class="loading"
    >
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <!-- 未验证状态 -->
    <div
      v-else-if="!isAuthenticated"
      class="auth-required"
    >
      <el-empty
        :image-size="100"
        description="需要验证主密码"
      >
        <template #description>
          <div class="auth-description">
            <p>请先验证主密码以使用快速填充功能</p>
            <p class="auth-tip">验证后即可搜索和填充保存的密码</p>
          </div>
        </template>
        <el-button
          class="auth-verify-btn"
          type="primary"
          :icon="BrandLogo"
          size="large"
          @click="openOptions"
        >
          去验证主密码
        </el-button>
      </el-empty>
    </div>

    <!-- 已认证状态：搜索框 + 密码列表 -->
    <template v-else>
      <!-- 搜索框 -->
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

      <!-- 密码列表 -->
      <div class="password-list">
        <div
          v-if="loading"
          class="loading"
        >
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>

        <div
          v-else-if="filteredPasswords.length === 0"
          class="empty"
        >
          <!-- 全部无数据：显示引导添加 -->
          <el-empty
            v-if="passwords.length === 0"
            :image-size="80"
            description="还没有保存的密码，点击下方按钮添加吧"
          >
            <el-button
              type="primary"
              :icon="Plus"
              class="empty-add-btn"
              @click="openOptionsAndAdd"
            >
              去添加密码
            </el-button>
          </el-empty>
          <!-- 搜索/过滤无结果 -->
          <el-empty
            v-else
            :image-size="80"
            description="暂无匹配的密码"
          />
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
    </template>

    <!-- 底部操作 -->
    <div class="footer">
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
import { ref, onMounted, computed, watch, nextTick } from 'vue';
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
  Clock,
} from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import HelpDialog from '@/components/sidepanel/HelpDialog.vue';
import SidepanelHeader from '@/components/sidepanel/SidepanelHeader.vue';
import PasswordListItem from '@/components/sidepanel/PasswordListItem.vue';
import type { PasswordEntry } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { sortPasswordEntries, DEFAULT_SIDEPANEL_SORT, type SortState } from '@/utils/passwordSort';
import { useSidepanelData } from '@/composables/useSidepanelData';
import { useSidepanelFill } from '@/composables/useSidepanelFill';
import { useVersionUpdate } from '@/composables/useVersionUpdate';
import { REPO_GITHUB_URL } from '@/utils/constants';

// ==================== 组合 composables ====================

const {
  passwords,
  loading,
  initializing,
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

/** 当前插件版本号（复用 useVersionUpdate） */
const { currentVersion } = useVersionUpdate();

/** 操作指引弹窗可见性 */
const showHelpDialog = ref(false);

// ==================== 排序与过滤 ====================

/** 搜索 + 过滤 + 排序的派生计算属性 */
const filteredPasswords = computed(() => {
  let result = [...passwords.value];

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
    await StorageUtils.saveSidepanelSortConfig(config);
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
      // 收藏前检查是否已达上限，若达则先淘汰 LRU 条目
      const evicted = await StorageUtils.evictLRUFavoriteIfNeeded(passwords.value);
      if (evicted) {
        const limit = await StorageUtils.getFavoriteLimit();
        ElMessage.info(`收藏已满（${limit} 条），已自动替换「${evicted.username}」`);
      }
      const now = Date.now();
      await StorageUtils.updatePassword(password.id, {
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
      await StorageUtils.updatePassword(password.id, {
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
  chrome.tabs.create({ url: REPO_GITHUB_URL });
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
  // 搜索框自动聚焦
  nextTick(() => {
    const inputEl = searchInputRef.value?.$el?.querySelector('input');
    if (inputEl) inputEl.focus();
  });

  await initSidepanelData();

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
  background: #f8f9fa;
}

.search-section {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.search-section :deep(.el-input) {
  flex: 1;
}

.password-list {
  flex: 1;

  /* hidden=水平裁剪，auto=垂直滚动 */
  overflow: hidden auto;
}

.loading {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: #6b7280;
}

.loading .el-icon {
  margin-bottom: 8px;
  font-size: 24px;
}

.empty {
  padding: 20px;
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

.footer {
  padding: 10px 16px;
  text-align: center;
  background: white;
  border-top: none;
  box-shadow: 0 -2px 8px rgb(0 0 0 / 4%);
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

/* 未验证状态样式 */
.auth-required {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 40px 20px;
  background: #f8f9fa;
}

.auth-description {
  margin-bottom: 20px;
  text-align: center;
}

.auth-description p {
  margin: 8px 0;
  font-size: 14px;
  color: #666;
}

.auth-tip {
  font-size: 12px !important;
  color: #999 !important;
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
