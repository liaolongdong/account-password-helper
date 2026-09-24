<template>
  <div
    v-if="pageCount > 1 || showPageSizeChooser"
    class="password-pagination"
  >
    <div class="pagination__state">
      <span v-if="pageCount > 1">{{ t('options.pagination.pageOf', { current: currentPage, total: pageCount }) }}</span>
      <!--
        跨页选中提示：翻页不会清掉选中（这是分页后仍能一次批量处理上百条的前提），
        因此必须说清「有多少条不在眼前」，否则批量按钮上的计数会变成隐性误导。
      -->
      <el-text
        v-if="offPageSelectedCount > 0"
        type="warning"
        size="small"
      >
        {{ t('options.pagination.selectedOffPage', { count: selectedCount, offPage: offPageSelectedCount }) }}
      </el-text>
    </div>

    <div class="pagination__controls">
      <el-select
        v-if="showPageSizeChooser"
        :model-value="pageSize"
        class="pagination__size"
        :aria-label="t('options.pagination.pageSize')"
        @update:model-value="onPageSizeChange"
      >
        <el-option
          v-for="size in PAGE_SIZE_OPTIONS"
          :key="size"
          :value="size"
          :label="t('options.pagination.pageSizeLabel', { size })"
        />
      </el-select>

      <el-button
        :icon="ArrowLeft"
        :aria-label="t('options.pagination.prevPage')"
        :disabled="currentPage <= 1"
        @click="goTo(currentPage - 1)"
      />
      <!--
        省略号渲染成 `span` 而不是禁用按钮：它是纯占位读数，做成可聚焦的按钮会让键盘
        用户在两个页码之间多停一次、且按下去毫无反应（`aria-hidden` 同时把它移出读屏序列）。
      -->
      <template
        v-for="(item, pagerIndex) in pagerItems"
        :key="`pager-${pagerIndex}`"
      >
        <span
          v-if="typeof item !== 'number'"
          class="pagination__ellipsis"
          aria-hidden="true"
          >…</span
        >
        <button
          v-else
          class="pagination__page"
          :class="{ 'is-current': item === currentPage }"
          :disabled="item === currentPage"
          :aria-current="item === currentPage ? 'page' : undefined"
          :aria-label="t('options.pagination.pageNumber', { page: item })"
          @click="goTo(item)"
        >
          {{ item }}
        </button>
      </template>
      <el-button
        :icon="ArrowRight"
        :aria-label="t('options.pagination.nextPage')"
        :disabled="currentPage >= pageCount"
        @click="goTo(currentPage + 1)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue';
import { PAGE_SIZE_OPTIONS, buildPagerItems, pageForSizeChange } from '@/utils/vaultPagination';
import { useI18n } from '@/utils/i18n';

/**
 * Vault 列表的通用分页条
 *
 * 只呈现与翻页，不持有任何分页状态（页码与每页条数由 `useVaultListPagination` 拥有），
 * 因此它不参与列表的过滤、排序与选中逻辑。密码表与回收站弹窗共用这一条：
 * 两者的分页语义完全一致（同一份命中列表按引用切片），差异只在「有没有跨页选中」，
 * 因此 `selectedCount` / `offPageSelectedCount` 是可缺省的——回收站不勾选条目，不传即为 0。
 *
 * 为什么不用 `el-pagination`：本仓库没有挂 Element Plus 的 locale provider，
 * 其内置的「Total / /page / Go to」恒为英文，而项目规则要求所有用户可见文案中英同步；
 * 这里用既有令牌自绘一条轻量的页码条，文案全部走 `options.pagination.*`。
 */
const props = withDefaults(
  defineProps<{
    /** 当前页码（从 1 开始） */
    currentPage: number;
    /** 总页数 */
    pageCount: number;
    /** 每页条数 */
    pageSize: number;
    /** 命中总条数，用于决定「每页条数」选择器是否需要出现 */
    totalCount: number;
    /** 已选中的条目数（无选中概念的列表可不传） */
    selectedCount?: number;
    /** 已选中但不在当前页的条目数（无选中概念的列表可不传） */
    offPageSelectedCount?: number;
  }>(),
  { selectedCount: 0, offPageSelectedCount: 0 },
);

const emit = defineEmits<{
  'update:currentPage': [page: number];
  'update:pageSize': [size: number];
}>();

const { t } = useI18n();

/** 可见页码序列（首尾 + 当前页邻域，中间折叠为省略号） */
const pagerItems = computed(() => buildPagerItems(props.currentPage, props.pageCount));

/** 只有一页时不必给出「每页多少条」的选择器 */
const showPageSizeChooser = computed(() => props.totalCount > PAGE_SIZE_OPTIONS[0]);

/**
 * 翻页：越界读数直接夹紧，避免调用方在渲染期读到非法页码
 *
 * @param page 目标页码
 */
const goTo = (page: number) => {
  const clamped = Math.min(Math.max(1, page), props.pageCount);
  if (clamped !== props.currentPage) emit('update:currentPage', clamped);
};

/**
 * 切换每页条数
 *
 * 换算规则交给 `pageForSizeChange`：页码按「当前页首条在新档位下的落点」重算，
 * 并且新总页数要在那函数里就地算——这里的 `props.pageCount` 还是旧档位的值，
 * 用它钳位会把用户送到别的位置（250 条 / 每页 200 / 第 2 页改 50 会落到第 2 页而非第 5 页）。
 *
 * @param size 新的每页条数
 */
const onPageSizeChange = (size: number) => {
  if (size === props.pageSize) return;
  emit('update:pageSize', size);
  const firstIndexOfPage = (props.currentPage - 1) * props.pageSize;
  emit('update:currentPage', pageForSizeChange(firstIndexOfPage, size, props.totalCount));
};
</script>

<style scoped>
.password-pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--aph-text-secondary);
  background: var(--aph-surface-2);
  border-top: 1px solid var(--aph-surface-line);
}

.pagination__state {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-height: 24px;
}

.pagination__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.pagination__size {
  width: 118px;
}

/* 页码按钮：与 el-button 同高同圆角，选中态用主题主色实心填充 */
.pagination__page {
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  font-size: 13px;
  color: var(--aph-text-primary);
  cursor: pointer;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--aph-primary-border);
  border-radius: 6px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}

/* 省略号：与页码同高，只作占位读数，不参与交互 */
.pagination__ellipsis {
  min-width: 16px;
  font-size: 13px;
  line-height: 32px;
  color: var(--aph-text-secondary);
  text-align: center;
}

.pagination__page:hover:not(:disabled) {
  color: var(--aph-primary);
  border-color: var(--aph-primary);
}

.pagination__page:disabled {
  cursor: default;
}

.pagination__page.is-current {
  color: #fff;
  background: var(--aph-primary);
  border-color: var(--aph-primary);
}

.pagination__page:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
}
</style>
