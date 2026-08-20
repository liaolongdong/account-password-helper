<script setup lang="ts">
/**
 * 侧边栏认证态视图（搜索卡片 + 密码列表卡片）
 *
 * 从 App.vue 抽离为独立异步组件（defineAsyncComponent 加载）：
 * 本组件携带的 Element Plus 重组件（el-input/el-dropdown/el-tooltip）与
 * PasswordListItem 依赖链不再进入侧边栏入口关键 chunk，锁屏态（会话失效）
 * 首屏 JS 收敛为按钮 + 图标级依赖，显著缩短 Windows 冷盘环境的白屏时间。
 * 数据与业务状态（filteredPasswords/activeIndex 等）仍由 App.vue 编排，
 * 本组件只负责认证态 UI 渲染与事件转发，保持原有交互完全一致。
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
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
  Key,
} from '@element-plus/icons-vue';
import PasswordListItem from '@/components/sidepanel/PasswordListItem.vue';
import type { PasswordEntry } from '@/utils/types';
import { getTagColor } from '@/utils/tagUtils';
import { getPinyinRenderMemoDependency } from '@/utils/searchMatch';
import { t } from '@/utils/i18n';

interface Props {
  /** 数据加载中状态 */
  loading: boolean;
  /** 过滤 + 排序后的密码列表（域名/搜索/收藏过滤由父级 computed 完成） */
  filteredPasswords: PasswordEntry[];
  /** 全量密码条目数（区分「无数据引导」与「搜索无结果」空状态） */
  totalCount: number;
  /** 当前键盘导航选中索引 */
  activeIndex: number;
  /** 全局「自动触发登录」是否开启（开启时隐藏每条冗余的「填充并登录」按钮） */
  autoTriggerLogin: boolean;
  /** 当前排序字段（用于下拉菜单高亮选中项） */
  sortProp: string;
  /** 可选标签集（取自域名过滤后的条目；为空时隐藏标签筛选行） */
  availableTags: string[];
}

interface Emits {
  /** 排序字段切换 */
  sortChange: [prop: string];
  /** 搜索输入（父级重置选中索引） */
  search: [];
  /** 空状态「去添加密码」 */
  addPassword: [];
  /** 无结果态「添加本站账号」（携带当前域名预填） */
  addSitePassword: [];
  /** 鼠标悬停激活条目 */
  activate: [index: number];
  /** 认证视图首帧渲染完成（DOM flush + 首帧绘制，回传实际首帧渲染条目数，供性能埋点与骨架屏收尾） */
  rendered: [renderedCount: number];
  /** 以下为 PasswordListItem 事件透传 */
  fill: [password: PasswordEntry];
  fillAndLogin: [password: PasswordEntry];
  edit: [password: PasswordEntry];
  toggleFavorite: [password: PasswordEntry];
  copyUsername: [username: string];
  copyPassword: [password: string];
  fillTotp: [password: PasswordEntry];
  copyTotp: [password: PasswordEntry];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** 搜索关键字（双向绑定至父级） */
const searchKeyword = defineModel<string>('searchKeyword', { required: true });

/** 是否仅显示收藏条目（双向绑定至父级） */
const favoriteOnly = defineModel<boolean>('favoriteOnly', { required: true });

/** 标签筛选选中集（双向绑定至父级，命中任一即保留） */
const filterTags = defineModel<string[]>('filterTags', { required: true });

/**
 * 仅在存在有效搜索词时订阅拼音模块就绪状态；空搜索下模块预热不触发全列表更新。
 */
const pinyinRenderMemoDependency = computed(() => getPinyinRenderMemoDependency(searchKeyword.value));

/**
 * 切换单个筛选标签的选中态（点击即切，无需下拉选择）
 * @param tag 目标标签
 */
const toggleFilterTag = (tag: string) => {
  const current = filterTags.value;
  filterTags.value = current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag];
};

/**
 * 筛选 chip 的主题色 CSS 变量（与列表条目标签同源 HSL 配色）
 * @param tag 标签文本
 * @returns 供样式消费的 --tag-* 变量集
 */
const tagChipVars = (tag: string): Record<string, string> => {
  const { background, text, border } = getTagColor(tag);
  return { '--tag-bg': background, '--tag-text': text, '--tag-border': border };
};

const searchInputRef = ref();

// ==================== 大列表分片渲染 ====================

/** 首屏渲染条目数：覆盖常见可视区高度，超出部分经 rAF 分批放开 */
const INITIAL_RENDER_COUNT = 30;

/** 每帧追加渲染的条目数：数百条列表约 2-4 帧内补齐，快于用户滚动/翻页速度 */
const RENDER_BATCH_SIZE = 60;

/**
 * 当前渲染上限（只增不减）：
 * 首帧只渲染前 INITIAL_RENDER_COUNT 条压缩首屏渲染耗时（大库用户 Windows 低端机
 * 首渲可达数百 ms），其余条目在后续动画帧分批放开；完整放开后维持上限不再收缩，
 * 使搜索/过滤切换即时全量渲染，避免二次分片闪烁。
 */
const renderCount = ref(INITIAL_RENDER_COUNT);

/** 分片渲染中标志（防止并发 rAF 扩容循环） */
let _expanding = false;

/** rAF 句柄（组件卸载时取消，避免卸载后 ref 写入） */
let _expandRafId = 0;

/** 首屏可见条目切片（渲染上限覆盖全量后直接复用原数组引用，零拷贝） */
const visiblePasswords = computed(() =>
  props.filteredPasswords.length > renderCount.value
    ? props.filteredPasswords.slice(0, renderCount.value)
    : props.filteredPasswords,
);

/** 逐帧扩容渲染上限直至覆盖全量列表 */
const expandRenderCount = () => {
  if (_expanding) return;
  _expanding = true;
  const step = () => {
    if (renderCount.value >= props.filteredPasswords.length) {
      _expanding = false;
      return;
    }
    renderCount.value += RENDER_BATCH_SIZE;
    _expandRafId = requestAnimationFrame(step);
  };
  _expandRafId = requestAnimationFrame(step);
};

/** 列表长度超出渲染上限时启动分批放开（含首帧） */
watch(
  () => props.filteredPasswords.length,
  len => {
    if (len > renderCount.value) expandRenderCount();
  },
  { immediate: true },
);

/**
 * 键盘导航越界防护：选中索引超出渲染上限时同步扩容，
 * 确保 App.vue 的 scrollToActiveItem 在 nextTick 时目标 DOM 已存在
 */
watch(
  () => props.activeIndex,
  index => {
    if (index + 1 > renderCount.value) {
      renderCount.value = index + RENDER_BATCH_SIZE;
    }
  },
);

// ==================== 挂载收尾 ====================

onMounted(() => {
  // 搜索框自动聚焦（本组件仅在认证态挂载，聚焦时机与视图可见性天然对齐）
  nextTick(() => {
    const inputEl = searchInputRef.value?.$el?.querySelector('input');
    if (inputEl) inputEl.focus();
  });

  // 首帧渲染完成通知：DOM flush（nextTick）+ 首帧绘制（rAF）后上报实际渲染条目数
  // （分片渲染下首帧上限为 INITIAL_RENDER_COUNT，非过滤后全量），
  // 供 App.vue 打 sp-list-rendered 埋点并收尾骨架屏过渡
  nextTick(() => {
    requestAnimationFrame(() => emit('rendered', visiblePasswords.value.length));
  });
});

onUnmounted(() => {
  if (_expandRafId) cancelAnimationFrame(_expandRafId);
  _expanding = false;
});
</script>

<template>
  <!-- 搜索卡片 -->
  <div class="search-card">
    <div class="search-section">
      <el-input
        ref="searchInputRef"
        v-model="searchKeyword"
        :placeholder="t('sidepanel.searchPlaceholder')"
        :prefix-icon="Search"
        clearable
        @input="emit('search')"
      />
      <el-tooltip
        :content="favoriteOnly ? t('sidepanel.showAll') : t('sidepanel.favoritesOnly')"
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
        :content="t('sidepanel.sortBy')"
        placement="top"
        :show-after="400"
      >
        <el-dropdown
          trigger="click"
          popper-class="sort-dropdown-popper"
          @command="(prop: string) => emit('sortChange', prop)"
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
                :class="{ 'is-active': sortProp === 'lastUsedAt' }"
              >
                <el-icon class="sort-item-icon"><Timer /></el-icon>
                <span>{{ t('sidepanel.recentlyUsed') }}</span>
                <el-icon
                  v-if="sortProp === 'lastUsedAt'"
                  class="sort-check-icon"
                  ><Check
                /></el-icon>
              </el-dropdown-item>
              <el-dropdown-item
                command="updateTime"
                :class="{ 'is-active': sortProp === 'updateTime' }"
              >
                <el-icon class="sort-item-icon"><Refresh /></el-icon>
                <span>{{ t('sidepanel.recentlyUpdated') }}</span>
                <el-icon
                  v-if="sortProp === 'updateTime'"
                  class="sort-check-icon"
                  ><Check
                /></el-icon>
              </el-dropdown-item>
              <el-dropdown-item
                command="username"
                :class="{ 'is-active': sortProp === 'username' }"
              >
                <el-icon class="sort-item-icon"><User /></el-icon>
                <span>{{ t('sidepanel.username') }}</span>
                <el-icon
                  v-if="sortProp === 'username'"
                  class="sort-check-icon"
                  ><Check
                /></el-icon>
              </el-dropdown-item>
              <el-dropdown-item
                command="url"
                :class="{ 'is-active': sortProp === 'url' }"
              >
                <el-icon class="sort-item-icon"><Link /></el-icon>
                <span>{{ t('sidepanel.url') }}</span>
                <el-icon
                  v-if="sortProp === 'url'"
                  class="sort-check-icon"
                  ><Check
                /></el-icon>
              </el-dropdown-item>
              <el-dropdown-item
                command="createTime"
                :class="{ 'is-active': sortProp === 'createTime' }"
              >
                <el-icon class="sort-item-icon"><Clock /></el-icon>
                <span>{{ t('sidepanel.createTime') }}</span>
                <el-icon
                  v-if="sortProp === 'createTime'"
                  class="sort-check-icon"
                  ><Check
                /></el-icon>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-tooltip>
    </div>
    <!-- 标签筛选：仅在域名过滤后的条目存在标签时显示，不占用无标签用户的空间；
         直接点选的主题色 chip（与列表条目标签同源配色），替代下拉选择更直观 -->
    <div
      v-if="availableTags.length > 0"
      class="tag-filter-section"
    >
      <button
        v-for="tag in availableTags"
        :key="tag"
        type="button"
        class="tag-chip"
        :class="{ 'tag-chip--active': filterTags.includes(tag) }"
        :style="tagChipVars(tag)"
        :title="tag"
        @click="toggleFilterTag(tag)"
      >
        <span class="tag-chip__label">{{ tag }}</span>
      </button>
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
        <span>{{ t('sidepanel.loading') }}</span>
      </div>

      <div
        v-else-if="filteredPasswords.length === 0"
        class="empty-state"
      >
        <!-- 全部无数据：显示引导添加 -->
        <template v-if="totalCount === 0">
          <div class="empty-icon-circle">
            <el-icon class="empty-icon"><Key /></el-icon>
          </div>
          <h3 class="empty-title">{{ t('sidepanel.noPasswords') }}</h3>
          <p class="empty-desc">{{ t('sidepanel.noPasswordsDesc') }}</p>
          <el-button
            type="primary"
            :icon="Plus"
            class="empty-add-btn"
            @click="emit('addPassword')"
          >
            {{ t('sidepanel.addPassword') }}
          </el-button>
        </template>
        <!-- 搜索/过滤无结果：提供行动出口，空屏即邀请 -->
        <template v-else>
          <div class="empty-icon-circle empty-icon-circle--muted">
            <el-icon class="empty-icon empty-icon--muted"><Search /></el-icon>
          </div>
          <h3 class="empty-title">{{ t('sidepanel.noMatch') }}</h3>
          <p class="empty-desc">{{ t('sidepanel.noMatchDesc') }}</p>
          <el-button
            type="primary"
            plain
            :icon="Plus"
            class="empty-add-site-btn"
            @click="emit('addSitePassword')"
          >
            {{ t('sidepanel.addSiteAccount') }}
          </el-button>
        </template>
      </div>

      <div
        v-else
        class="password-items"
      >
        <PasswordListItem
          v-for="(password, index) in visiblePasswords"
          :key="password.id"
          v-memo="[
            activeIndex === index,
            password.favorite,
            password.updateTime,
            autoTriggerLogin,
            searchKeyword,
            pinyinRenderMemoDependency,
          ]"
          :password="password"
          :is-active="activeIndex === index"
          :auto-login-enabled="autoTriggerLogin"
          :search-keyword="searchKeyword"
          @fill="p => emit('fill', p)"
          @fill-and-login="p => emit('fillAndLogin', p)"
          @edit="p => emit('edit', p)"
          @toggle-favorite="p => emit('toggleFavorite', p)"
          @copy-username="u => emit('copyUsername', u)"
          @copy-password="p => emit('copyPassword', p)"
          @fill-totp="p => emit('fillTotp', p)"
          @copy-totp="p => emit('copyTotp', p)"
          @mouseenter="emit('activate', index)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ========== 卡片样式（与 App.vue header-card/footer-card 保持一致） ========== */
.search-card,
.list-card {
  margin: 0 8px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
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

.search-section {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
}

.search-section :deep(.el-input) {
  flex: 1;
}

/* 标签筛选 chip 行：仅在有标签时渲染，与搜索行同宽内边距保持卡片节奏一致 */
.tag-filter-section {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 12px;
}

/* 未选中：中性描边；选中：切换为标签自身主题色（--tag-* 变量由组件注入）；
   截断省略号作用于内层 span（button 匿名盒上 text-overflow 不可靠） */
.tag-chip {
  display: inline-flex;
  align-items: center;
  max-width: 140px;
  padding: 2px 10px;
  font-size: 12px;
  line-height: 18px;
  color: #64748b;
  cursor: pointer;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  transition: all 0.2s ease;
}

.tag-chip__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-chip:hover {
  color: var(--tag-text);
  border-color: var(--tag-border);
}

.tag-chip--active {
  color: var(--tag-text);
  background: var(--tag-bg);
  border-color: color-mix(in srgb, var(--tag-text) 45%, transparent);
}

.tag-chip:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

/* 无结果态「添加本站账号」：轻量描边样式，与全空态主按钮区分层级 */
:deep(.empty-add-site-btn) {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 18px;
  transition: all 0.25s ease;
}

:deep(.empty-add-site-btn:hover) {
  box-shadow: 0 2px 10px rgb(var(--aph-primary-rgb) / 25%);
  transform: translateY(-1px);
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
  background: rgb(var(--aph-primary-rgb) / 8%);
  border-radius: 50%;
}

.empty-icon-circle--muted {
  background: #f1f5f9;
}

.empty-icon {
  font-size: 24px;
  color: var(--aph-primary);
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
  box-shadow: 0 2px 8px rgb(var(--aph-primary-rgb) / 25%);
  transition: all 0.25s ease;
}

:deep(.empty-add-btn:hover) {
  box-shadow: 0 4px 14px rgb(var(--aph-primary-rgb) / 40%);
  transform: translateY(-1px);
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
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border-color: var(--aph-primary-border);
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
  color: var(--aph-primary);
}

.sort-dropdown-popper .el-dropdown-menu__item:hover {
  color: #1f2937;
  background: #f5f7fa;
}

.sort-dropdown-popper .el-dropdown-menu__item:hover .sort-item-icon {
  color: #6b7280;
}

.sort-dropdown-popper .el-dropdown-menu__item.is-active {
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
}

.sort-dropdown-popper .el-dropdown-menu__item.is-active .sort-item-icon {
  color: var(--aph-primary);
}
</style>
