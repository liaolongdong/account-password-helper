<template>
  <div class="filters">
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
    <el-select
      v-if="availableTags.length > 0"
      :model-value="filterTags"
      multiple
      collapse-tags
      collapse-tags-tooltip
      clearable
      class="tag-filter"
      :placeholder="t('options.filter.tagPlaceholder')"
      @update:model-value="$emit('update:filterTags', $event)"
      @visible-change="$emit('tagFilterVisibleChange', $event)"
    >
      <el-option
        v-for="tag in availableTags"
        :key="tag"
        :label="tag"
        :value="tag"
      />
    </el-select>
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

/**
 * 搜索与筛选栏组件
 *
 * 包含关键词搜索框、批量操作按钮（编辑标签/导出/删除）、标签筛选与收藏过滤按钮，
 * 支持 v-model 双向绑定搜索关键词、收藏过滤状态与标签筛选集。
 * 布局上筛选控件锚定右侧、批量按钮随选中态显隐并由搜索框吸收宽度变化，
 * 保证标签筛选下拉触发器位置稳定。
 */
defineProps<{
  /** 搜索关键词 */
  searchKeyword: string;
  /** 是否仅显示收藏 */
  favoriteOnly: boolean;
  /** 已选中条目数量 */
  selectedCount: number;
  /** 可选标签集（为空时隐藏标签筛选下拉） */
  availableTags: string[];
  /** 标签筛选选中集（命中任一即保留） */
  filterTags: string[];
}>();

defineEmits<{
  'update:searchKeyword': [value: string];
  'update:favoriteOnly': [value: boolean];
  'update:filterTags': [value: string[]];
  /** 标签筛选下拉展开/收起（供父级延迟清空选中，避免交互中途布局跳动） */
  tagFilterVisibleChange: [visible: boolean];
  batchDelete: [];
  batchEditTags: [];
  batchExportSelected: [];
}>();

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
