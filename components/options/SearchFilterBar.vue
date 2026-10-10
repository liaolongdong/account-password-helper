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
      批量操作按钮紧跟搜索框、收藏按钮锚定右侧：按钮随选中态显隐时，
      由 flex:1 的搜索框吸收宽度变化，右侧收藏按钮位置保持稳定。
      标签与站点两项筛选已搬去左侧分类栏（`CategoryRail.vue`），这里不再放筛选下拉。
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
 * 承载关键词搜索、批量操作按钮（编辑标签 / 导出 / 删除）与收藏过滤开关。
 * 布局上收藏按钮锚定右侧、批量按钮随选中态显隐并由搜索框吸收宽度变化，
 * 保证右侧控件位置稳定。标签与站点筛选不在这里——它们是常驻的左侧分类栏。
 */
defineProps<{
  /** 搜索关键词 */
  searchKeyword: string;
  /** 是否仅显示收藏 */
  favoriteOnly: boolean;
  /** 已选中条目数量 */
  selectedCount: number;
}>();

defineEmits<{
  'update:searchKeyword': [value: string];
  'update:favoriteOnly': [value: boolean];
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
  margin-bottom: 20px;
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

/* 响应式：窄屏纵向排列（左右外边距由 `.vault-layout` 统一持有） */
@media (width <= 768px) {
  .filters {
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }
}
</style>
