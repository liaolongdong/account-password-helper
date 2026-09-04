<template>
  <div class="password-list">
    <el-table
      ref="localTableRef"
      v-loading="loading"
      :element-loading-text="t('options.table.loading')"
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
        :label="t('common.username')"
        min-width="150"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <SearchHighlight
            :text="row.username"
            :keyword="searchKeyword ?? ''"
          />
        </template>
      </el-table-column>
      <el-table-column
        prop="password"
        :label="t('common.password')"
        min-width="110"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <div class="password-cell">
            <span v-if="!row.showPassword">{{ '*'.repeat(8) }}</span>
            <span v-else>{{ row.password }}</span>
            <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
            <el-button
              :icon="row.showPassword ? Hide : View"
              :aria-label="row.showPassword ? t('common.hidePassword') : t('common.showPassword')"
              link
              @click="$emit('togglePassword', row)"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        :label="t('common.totp')"
        min-width="120"
      >
        <template #default="{ row }">
          <TotpCode
            v-if="row.totp"
            :secret="row.totp"
            copyable
          />
          <span
            v-else
            class="no-tag"
            >-</span
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="url"
        :label="t('common.url')"
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
              <!-- 网站图标（Chrome 本地缓存，零网络），无图标/加载失败时降级为原有链接图标 -->
              <SiteFavicon
                :url="row.url"
                :size="14"
              >
                <el-icon class="url-link__icon"><Link /></el-icon>
              </SiteFavicon>
              <span class="url-link__text">
                <SearchHighlight
                  :text="row.url"
                  :keyword="searchKeyword ?? ''"
                />
              </span>
            </a>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        prop="tag"
        :label="t('common.tag')"
        min-width="100"
        class-name="tag-col"
        sortable="custom"
      >
        <template #default="{ row }">
          <template v-if="parseTags(row.tag).length">
            <el-tooltip
              v-for="tagName in parseTags(row.tag)"
              :key="tagName"
              :content="tagName"
              placement="top"
              :show-after="300"
              :disabled="!isTagOverflowed(tagName)"
              :popper-style="{ maxWidth: '500px', wordBreak: 'break-word' }"
            >
              <el-tag
                :style="getTagFullStyle(tagName)"
                size="small"
                class="tag-item"
                @mouseenter="(e: MouseEvent) => checkTagOverflow(e, tagName)"
              >
                <SearchHighlight
                  :text="tagName"
                  :keyword="searchKeyword ?? ''"
                />
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
        :label="t('common.remark')"
        min-width="150"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <SearchHighlight
            v-if="row.remark"
            :text="row.remark"
            :keyword="searchKeyword ?? ''"
          />
          <span
            v-else
            class="no-tag"
            >-</span
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="createTime"
        :label="t('sidepanel.createTime')"
        min-width="100"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatDate(row.createTime) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="updateTime"
        :label="t('options.table.updateTime')"
        min-width="100"
        sortable="custom"
        :sort-orders="['descending', 'ascending', null]"
      >
        <template #default="{ row }">
          {{ formatDate(row.updateTime) }}
        </template>
      </el-table-column>
      <el-table-column
        :label="t('common.actions')"
        header-align="center"
        width="210"
        fixed="right"
      >
        <template #default="{ row }">
          <div
            class="operation-buttons"
            @click="closeAllTooltips"
          >
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              :content="t('options.detail.viewDetail')"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="View"
                :aria-label="t('options.detail.viewDetail')"
                circle
                size="small"
                @click="$emit('viewDetail', row)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              :content="t('options.table.copyEntry')"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="CopyDocument"
                :aria-label="t('options.table.copyEntry')"
                circle
                size="small"
                @click="$emit('copy', row)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              :content="t('common.edit')"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="Edit"
                :aria-label="t('common.edit')"
                circle
                size="small"
                @click="$emit('edit', row)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              :content="row.favorite ? t('common.unfavorite') : t('common.favorite')"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="row.favorite ? StarFilled : Star"
                :aria-label="row.favorite ? t('common.unfavorite') : t('common.favorite')"
                circle
                size="small"
                :type="row.favorite ? 'warning' : 'default'"
                @click="$emit('toggleFavorite', row.id)"
              />
            </el-tooltip>
            <el-tooltip
              :ref="(el: any) => collectTooltipRef(el)"
              :content="t('common.delete')"
              placement="top"
              :show-after="400"
            >
              <el-button
                :icon="Delete"
                :aria-label="t('common.delete')"
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
import { getTagFullStyle, parseTags } from '@/utils/tagUtils';
import { useTagOverflow } from '@/composables/useTagOverflow';
import TotpCode from '@/components/TotpCode.vue';
import SiteFavicon from '@/components/SiteFavicon.vue';
import SearchHighlight from '@/components/SearchHighlight.vue';
import { useI18n } from '@/utils/i18n';

/**
 * 密码列表表格组件
 *
 * 展示密码数据的完整表格，包含搜索排序、标签渲染、
 * 密码显隐切换和操作按钮（查看详情/复制/编辑/收藏/删除）。
 */
defineProps<{
  /** 表格数据 */
  data: PasswordEntry[];
  /** 加载状态 */
  loading: boolean;
  /** 行类名函数 */
  rowClassName?: (data: { row: PasswordEntry; rowIndex: number }) => string;
  /** 当前搜索关键词（用于命中高亮，空串时不高亮） */
  searchKeyword?: string;
}>();

defineEmits<{
  selectionChange: [selection: PasswordEntry[]];
  sortChange: [state: { prop: string; order: string }];
  togglePassword: [row: PasswordEntry];
  viewDetail: [row: PasswordEntry];
  copy: [row: PasswordEntry];
  edit: [row: PasswordEntry];
  toggleFavorite: [id: string];
  deletePassword: [id: string];
}>();

const { t } = useI18n();

/** Tag 标签溢出检测 */
const { checkTagOverflow, isTagOverflowed } = useTagOverflow();

/** 表格引用（暴露给父组件） */
const localTableRef = ref();

/** Tooltip 组件实例接口（仅声明本组件使用的最小方法集） */
interface TooltipInstance {
  onClose: () => void;
}

/**
 * 操作栏 Tooltip 引用集合
 * 用于在操作触发时主动关闭残留 tooltip，避免 popper 残留在视口中
 */
const tooltipRefs = ref<TooltipInstance[]>([]);

/**
 * 收集 tooltip 组件引用（函数式 ref，每次渲染时调用）
 * @param el tooltip 组件实例
 */
const collectTooltipRef = (el: TooltipInstance | null) => {
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
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
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
  box-shadow: 0 2px 8px rgb(var(--aph-primary-rgb) / 20%);
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

  /* 上限 110px，同时不超过所在单元格宽度：窄列时随之收缩，避免标签溢出单元格导致右侧圆角被相邻列覆盖/裁切 */
  max-width: min(110px, 100%);
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

/* 标签内高亮：沿用标签自身配色，仅加粗强调，避免主题色与标签底色冲突 */
.tag-item :deep(.search-hit) {
  font-weight: 700;
  color: inherit;
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
  position: relative;
  width: 28px;
  height: 28px;
  padding: 0;
  margin-left: 10px;
}

/* 扩大触控热区至约 38px（视觉尺寸不变）；inset 5px 与按钮间距 10px 匹配，相邻热区恰好相接不重叠 */
.operation-buttons .el-button::after {
  position: absolute;
  inset: -5px;
  content: '';
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
