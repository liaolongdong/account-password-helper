<template>
  <div
    class="filters"
    data-tour="search"
  >
    <el-input
      :model-value="searchKeyword"
      :placeholder="t('options.filter.searchPlaceholder')"
      :prefix-icon="Search"
      clearable
      @update:model-value="$emit('update:searchKeyword', $event)"
    />
    <!--
      批量操作按钮置于标签筛选左侧：按钮随选中态显隐时，
      由 flex:1 的搜索框吸收宽度变化，右侧筛选控件位置保持稳定，
      避免标签筛选触发器位移导致其下拉面板错位
    -->
    <el-button
      v-if="selectedCount > 0"
      :icon="PriceTag"
      @click="$emit('batchEditTags')"
    >
      {{ t('options.filter.batchEditTags', { count: selectedCount }) }}
    </el-button>
    <el-button
      v-if="selectedCount > 0"
      :icon="Download"
      @click="$emit('batchExportSelected')"
    >
      {{ t('options.filter.batchExportSelected', { count: selectedCount }) }}
    </el-button>
    <el-button
      v-if="selectedCount > 0"
      :icon="Delete"
      type="danger"
      @click="$emit('batchDelete')"
    >
      {{ t('options.filter.batchDelete', { count: selectedCount }) }}
    </el-button>
    <!--
      标签 / 站点两个下拉同构：都用虚拟列表 `el-select-v2` + `filterable`，
      行内右对齐放条目数，闭合态的选中标签只显示标签 / 域名本身。
      用 select-v2 的原因：候选集规模上界是条目数（大库可达上千个不同标签或站点），
      普通 `el-select` 的 `persistent` 默认 true 会让每个候选常驻一个 option 组件并重演 O(T²)
      （见 docs/reports/PERF_LARGE_VAULT_EVALUATION.md §3 第 4 条），select-v2 只实例化可视窗口的行。
      计数放在 option 的默认插槽里，不进 `label`——否则闭合态的选中标签会带上数字。
    -->
    <el-select-v2
      v-if="availableTagOptions.length > 0"
      :model-value="filterTags"
      :options="availableTagOptions"
      :props="TAG_OPTION_PROPS"
      multiple
      filterable
      collapse-tags
      collapse-tags-tooltip
      clearable
      class="tag-filter"
      popper-class="tag-filter-popper"
      :placeholder="t('options.filter.tagPlaceholder')"
      @update:model-value="$emit('update:filterTags', $event)"
      @visible-change="$emit('filterDropdownVisibleChange', $event)"
    >
      <template #default="{ item }">
        <div
          class="facet-option"
          :title="item.tag"
        >
          <span class="facet-option__text">{{ item.tag }}</span>
          <span class="facet-option__count">{{ item.count }}</span>
        </div>
      </template>
    </el-select-v2>
    <el-select-v2
      v-if="availableSites.length > 0"
      :model-value="filterSites"
      :options="availableSites"
      :props="SITE_OPTION_PROPS"
      multiple
      filterable
      collapse-tags
      collapse-tags-tooltip
      clearable
      class="site-filter"
      popper-class="site-filter-popper"
      :placeholder="t('options.filter.sitePlaceholder')"
      @update:model-value="$emit('update:filterSites', $event)"
      @visible-change="$emit('filterDropdownVisibleChange', $event)"
    >
      <template #default="{ item }">
        <!--
          title 是截断的唯一兜底：面板宽度按最长 label 量出（select-v2 的 calculateLabelMaxWidth），
          不会把同一行的计数列算进去，最长的那一条因此必然显示成省略号。
          不用 el-tooltip：普通 select 的 option 常驻、虚拟列表的行随滚动回收，
          两种情况下按候选数实例化 tooltip 都是净增开销。
        -->
        <div
          class="facet-option"
          :title="item.site"
        >
          <span class="facet-option__text">{{ item.site }}</span>
          <span class="facet-option__count">{{ item.count }}</span>
        </div>
      </template>
    </el-select-v2>
    <el-tooltip
      :content="favoriteOnly ? t('sidepanel.showAll') : t('sidepanel.favoritesOnly')"
      placement="top"
      :show-after="400"
    >
      <el-button
        :icon="favoriteOnly ? StarFilled : Star"
        :aria-label="favoriteOnly ? t('sidepanel.showAll') : t('sidepanel.favoritesOnly')"
        circle
        :type="favoriteOnly ? 'warning' : 'default'"
        @click="$emit('update:favoriteOnly', !favoriteOnly)"
      />
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { Search, Delete, Star, StarFilled, PriceTag, Download } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';
import type { SiteOption } from '@/utils/siteUtils';
import type { TagOption } from '@/utils/tagUtils';

/**
 * 搜索与筛选栏组件
 *
 * 包含关键词搜索框、批量操作按钮（编辑标签/导出/删除）、标签筛选、站点筛选与收藏过滤按钮，
 * 支持 v-model 双向绑定搜索关键词、收藏过滤状态、标签筛选集与站点筛选集。
 * 布局上筛选控件锚定右侧、批量按钮随选中态显隐并由搜索框吸收宽度变化，
 * 保证标签筛选下拉触发器位置稳定。
 *
 * 两个筛选下拉同构（虚拟列表 + 键入过滤 + 行内条目数 + 整行 `title`），
 * 候选的计数口径都是**全库条目数**，与当前筛选结果无关。
 */
defineProps<{
  /** 搜索关键词 */
  searchKeyword: string;
  /** 是否仅显示收藏 */
  favoriteOnly: boolean;
  /** 已选中条目数量 */
  selectedCount: number;
  /** 可选标签集（带条目数、按条目数倒序；为空时隐藏标签筛选下拉） */
  availableTagOptions: TagOption[];
  /** 标签筛选选中集（命中任一即保留） */
  filterTags: string[];
  /** 可选站点集（为空时隐藏站点筛选下拉） */
  availableSites: SiteOption[];
  /** 站点筛选选中集（命中任一即保留，通用条目恒保留） */
  filterSites: string[];
}>();

defineEmits<{
  'update:searchKeyword': [value: string];
  'update:favoriteOnly': [value: boolean];
  'update:filterTags': [value: string[]];
  'update:filterSites': [value: string[]];
  /** 筛选下拉（标签 / 站点）展开或收起（供父级延迟清空选中，避免交互中途布局跳动） */
  filterDropdownVisibleChange: [visible: boolean];
  batchDelete: [];
  batchEditTags: [];
  batchExportSelected: [];
}>();

/** `el-select-v2` 的候选字段映射：标签键同时充当 value 与 label，计数只进插槽 */
const TAG_OPTION_PROPS = { label: 'tag', value: 'tag' };
/** `el-select-v2` 的候选字段映射：站点键同时充当 value 与 label，计数只进插槽 */
const SITE_OPTION_PROPS = { label: 'site', value: 'site' };

const { t } = useI18n();
</script>

<style scoped>
.filters {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 20px;
  margin: 0 32px 20px;
  background: white;
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
}

/* 搜索框占据剩余空间 */
.filters > :deep(.el-input) {
  flex: 1;
}

/* 行内间距统一由 gap 提供：抵消 Element Plus 相邻按钮默认的 12px 外边距。
   否则批量按钮之间为 12 + 12 = 24px（其余控件 12px），
   窄屏纵向排列时该外边距还会使批量按钮偏离居中对齐 */
.filters :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* 标签筛选：固定宽度，避免多标签撑开挤压搜索框 */
.filters .tag-filter {
  flex-shrink: 0;
  width: 200px;
}

/* 站点筛选：与标签筛选同族（同为右侧锚定的多选虚拟列表下拉），略宽以容纳域名；
   闭合态选中标签靠省略号 + collapse-tags-tooltip 兜住长 hostname */
.filters .site-filter {
  flex-shrink: 0;
  width: 220px;
}

/* 候选行：标签 / 站点共用一份结构，文本吃掉剩余宽度，条目数右对齐 */
.facet-option {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

/* min-width:0 是省略号生效的前提：flex 子项默认 min-width:auto，长标签 / 长域名会把行撑宽 */
.facet-option__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facet-option__count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--aph-text-muted);
}

/* 响应式 */
@media (width <= 768px) {
  .filters {
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    margin: 0 16px 20px;
  }
}
</style>
