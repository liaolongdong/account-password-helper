<template>
  <div class="password-list">
    <el-table
      ref="localTableRef"
      v-loading="loading"
      element-loading-text="加载数据中..."
      :data="data"
      style="width: 100%"
      stripe
      row-key="id"
      :row-class-name="rowClassName"
      :default-sort="{ prop: 'updateTime', order: 'descending' }"
      @selection-change="(selection: PasswordEntry[]) => $emit('selectionChange', selection)"
      @sort-change="(state: any) => $emit('sortChange', state)"
    >
      <el-table-column
        type="selection"
        width="36"
        fixed="left"
      />
      <el-table-column
        prop="username"
        label="用户名"
        min-width="150"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{ row.username }}
        </template>
      </el-table-column>
      <el-table-column
        prop="password"
        label="密码"
        min-width="110"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <div class="password-cell">
            <span v-if="!row.showPassword">{{ '*'.repeat(8) }}</span>
            <span v-else>{{ row.password }}</span>
            <el-button
              :icon="row.showPassword ? Hide : View"
              link
              @click="$emit('togglePassword', row)"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        prop="url"
        label="网址"
        min-width="200"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <template v-if="row.url">
            <a
              :href="normalizeUrl(row.url)"
              class="url-link"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
            >
              <el-icon class="url-link__icon"><Link /></el-icon>
              <span class="url-link__text">{{ row.url }}</span>
            </a>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        prop="tag"
        label="标签"
        min-width="100"
        class-name="tag-col"
        sortable="custom"
      >
        <template #default="{ row }">
          <template v-if="parseTags(row.tag).length">
            <el-tooltip
              v-for="t in parseTags(row.tag)"
              :key="t"
              :content="t"
              placement="top"
              :show-after="300"
              :disabled="!isTagOverflowed(t)"
              :popper-style="{ maxWidth: '500px', wordBreak: 'break-word' }"
            >
              <el-tag
                :color="getTagColor(t).background"
                :style="getTagStyle(t)"
                size="small"
                class="tag-item"
                @mouseenter="(e: MouseEvent) => checkTagOverflow(e, t)"
              >
                {{ t }}
              </el-tag>
            </el-tooltip>
          </template>
          <span
            v-else
            class="no-tag"
            >-</span
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="remark"
        label="备注"
        min-width="150"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{ row.remark || '-' }}
        </template>
      </el-table-column>
      <el-table-column
        prop="createTime"
        label="创建时间"
        min-width="110"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatDate(row.createTime) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="updateTime"
        label="更新时间"
        min-width="110"
        sortable="custom"
        :sort-orders="['descending', 'ascending', null]"
      >
        <template #default="{ row }">
          {{ formatDate(row.updateTime) }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        header-align="center"
        width="180"
        fixed="right"
      >
        <template #default="{ row }">
          <div
            class="operation-buttons"
            @click="closeAllTooltips"
          >
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              content="复制条目"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="CopyDocument"
                circle
                size="small"
                @click="$emit('copy', row)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              content="编辑"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="Edit"
                circle
                size="small"
                @click="$emit('edit', row)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              :content="row.favorite ? '取消收藏' : '收藏'"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="row.favorite ? StarFilled : Star"
                circle
                size="small"
                :type="row.favorite ? 'warning' : 'default'"
                @click="$emit('toggleFavorite', row.id)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              content="删除"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="Delete"
                circle
                size="small"
                type="danger"
                @click="$emit('deletePassword', row.id)"
              />
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUpdate } from 'vue';
import { CopyDocument, Edit, Delete, View, Hide, Star, StarFilled, Link } from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import { formatDate } from '@/utils/dateFormat';
import { getTagColor, parseTags } from '@/utils/tagUtils';
import { useTagOverflow } from '@/composables/useTagOverflow';

/**
 * 获取标签的合并样式对象
 * 避免模板中对同一标签多次调用 getTagColor
 * @param tag 标签文本
 * @returns 包含 color 和 borderColor 的 CSSStyleDeclaration 子集
 */
const getTagStyle = (tag: string): Record<string, string> => {
  const { text, border } = getTagColor(tag);
  return { color: text, borderColor: border };
};

/**
 * 密码列表表格组件
 *
 * 展示密码数据的完整表格，包含搜索排序、标签渲染、
 * 密码显隐切换和操作按钮（复制/编辑/收藏/删除）。
 */
defineProps<{
  /** 表格数据 */
  data: PasswordEntry[];
  /** 加载状态 */
  loading: boolean;
  /** 行类名函数 */
  rowClassName?: (data: { row: PasswordEntry; rowIndex: number }) => string;
}>();

defineEmits<{
  selectionChange: [selection: PasswordEntry[]];
  sortChange: [state: { prop: string; order: string }];
  togglePassword: [row: PasswordEntry];
  copy: [row: PasswordEntry];
  edit: [row: PasswordEntry];
  toggleFavorite: [id: string];
  deletePassword: [id: string];
}>();

/** Tag 标签溢出检测 */
const { checkTagOverflow, isTagOverflowed } = useTagOverflow();

/** 表格引用（暴露给父组件） */
const localTableRef = ref();

/**
 * 操作栏 Tooltip 引用集合
 * 用于在操作触发时主动关闭残留 tooltip，避免 popper 残留在视口中
 */
const tooltipRefs = ref<any[]>([]);

/**
 * 收集 tooltip 组件引用（函数式 ref，每次渲染时调用）
 * @param el tooltip 组件实例
 */
const collectTooltipRef = (el: any) => {
  if (el) tooltipRefs.value.push(el);
};

/**
 * 主动关闭所有操作栏 tooltip
 * 用于操作按钮点击时兜底关闭，避免弹窗/重渲染导致的 tooltip 残留
 */
const closeAllTooltips = () => {
  for (const t of tooltipRefs.value) {
    t?.onClose?.();
  }
};

/** 每次重新渲染前先关闭已打开 tooltip 再清空引用，避免旧 tooltip 实例因引用丢失而残留 */
onBeforeUpdate(() => {
  closeAllTooltips();
  tooltipRefs.value = [];
});

/**
 * 将 URL 文本归一化为可跳转的完整链接
 * @param url 原始 URL 文本
 * @returns 带协议的完整 URL
 */
const normalizeUrl = (url: string): string => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
};

/** 暴露表格引用供父组件调用 sort 等方法 */
defineExpose({ tableRef: localTableRef });
</script>

<style scoped>
/* 密码列表容器 */
.password-list {
  margin: 0 32px 32px;
  overflow: hidden;
  background: white;
  border: 1px solid #e3f2fd;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(64 158 255 / 8%);
}

.password-cell {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

/* 表格行动画 */
:deep(.el-table__body-wrapper .el-table__row) {
  transition: all 0.3s ease;
}

:deep(.el-table__body-wrapper .el-table__row:hover) {
  box-shadow: 0 2px 8px rgb(64 158 255 / 20%);
  transform: translateY(-2px);
}

/* 新增条目高亮动画 */
:deep(.el-table__body-wrapper .el-table__row.new-item) {
  animation: fade-in 1s linear;
}

@keyframes fade-in {
  0% {
    transform: translateY(-20px);
  }
  50% {
    transform: translateY(-10px);
  }
  100% {
    transform: translateY(0);
  }
}

:deep(.el-table__body-wrapper .el-table__row.new-item td) {
  border-bottom: 2px solid var(--el-color-success);
}

/** 删除密码列表动效 */
:deep(.el-table__body-wrapper .el-table__row.del-item) {
  animation: fade-out 1s ease-in-out;
}

@keyframes fade-out {
  0% {
    opacity: 1;
    transform: translateX(0);
  }
  100% {
    opacity: 0;
    transform: translateX(800px);
  }
}

/* 表格操作栏样式 */
:deep(.el-table-fixed-column--right .cell) {
  padding: 0 8px;
}

/* 标签列单元格允许溢出 */
:deep(.tag-col .cell) {
  overflow: visible;
}

/* 标签样式 */
.tag-item {
  box-sizing: border-box;
  max-width: 110px;
  padding: 0 8px;
  margin: 0;
  overflow: visible !important;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  cursor: default;
  border-radius: 4px;
}

.tag-item :deep(.el-tag__content) {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-item + .tag-item {
  margin-left: 4px;
}

.no-tag {
  font-size: 12px;
  font-style: italic;
  color: #c0c4cc;
}

/* 操作按钮样式 */
.operation-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.operation-buttons .el-button {
  width: 28px;
  height: 28px;
  padding: 0;
}

:deep(.operation-buttons .el-button--danger:hover) {
  color: #fff;
  background: #e04040;
  border-color: #e04040;
}

/* URL 链接样式 */
.url-link {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  max-width: 100%;
  color: var(--el-color-primary);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s;
}

.url-link:hover {
  color: var(--el-color-primary-light-3);
  text-decoration: underline;
}

.url-link__icon {
  flex-shrink: 0;
  font-size: 14px;
}

.url-link__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 响应式 */
@media (width <= 768px) {
  .password-list {
    margin: 0 16px 16px;
  }
}
</style>
