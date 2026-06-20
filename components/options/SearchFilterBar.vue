<template>
  <div class="filters">
    <el-input
      :model-value="searchKeyword"
      placeholder="搜索用户名、标签、备注或网址"
      :prefix-icon="Search"
      clearable
      @update:model-value="$emit('update:searchKeyword', $event)"
    />
    <el-tooltip
      :content="favoriteOnly ? '显示全部' : '只看收藏'"
      placement="top"
      :show-after="400"
    >
      <el-button
        :icon="favoriteOnly ? StarFilled : Star"
        circle
        :type="favoriteOnly ? 'warning' : 'default'"
        @click="$emit('update:favoriteOnly', !favoriteOnly)"
      />
    </el-tooltip>
    <el-button
      v-if="selectedCount > 0"
      :icon="Delete"
      type="danger"
      @click="$emit('batchDelete')"
    >
      批量删除 ({{ selectedCount }})
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { Search, Delete, Star, StarFilled } from '@element-plus/icons-vue';

/**
 * 搜索与筛选栏组件
 *
 * 包含关键词搜索框、收藏过滤按钮和批量删除按钮，
 * 支持 v-model 双向绑定搜索关键词和收藏过滤状态。
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
}>();
</script>

<style scoped>
.filters {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 20px;
  margin: 0 32px 20px;
  background: white;
  border: 1px solid #e3f2fd;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(64 158 255 / 8%);
}

/* 搜索框占据剩余空间 */
.filters > :deep(.el-input) {
  flex: 1;
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
