<template>
  <aside
    v-if="hasFacets"
    class="category-rail"
    :aria-label="t('options.rail.ariaLabel')"
  >
    <button
      type="button"
      class="rail-all"
      :class="{ 'is-active': !hasActiveFacet }"
      :aria-pressed="!hasActiveFacet"
      @click="resetFacets"
    >
      <span class="rail-all__label">{{ t('options.rail.all') }}</span>
      <span class="rail-all__count">{{ totalCount }}</span>
    </button>

    <CategoryRailSection
      v-if="tagOptions.length > 0"
      :title="t('options.rail.tags')"
      :search-placeholder="t('options.rail.searchTags')"
      :options="tagOptions"
      :model-value="filterTags"
      color-dot
      @update:model-value="$emit('update:filterTags', $event)"
    />

    <CategoryRailSection
      v-if="siteOptions.length > 0"
      :title="t('options.rail.sites')"
      :search-placeholder="t('options.rail.searchSites')"
      :options="siteOptions"
      :model-value="filterSites"
      @update:model-value="$emit('update:filterSites', $event)"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CategoryRailSection from './CategoryRailSection.vue';
import { useI18n } from '@/utils/i18n';
import type { FacetOption } from '@/utils/facet';

/**
 * 管理页左侧分类栏
 *
 * 把「按标签」和「按站点」两段候选从筛选栏的多选下拉搬到这里常驻：
 * 计数是这一栏的主要信息量，而下拉要先点开才看得见，可用户判断「我的库是怎么分布的」
 * 恰恰发生在还没决定要筛什么的时候。
 *
 * 两段候选都是**派生视图**，不是新的组织结构：标签读条目已有的 `tag`，
 * 站点读条目已有的 `url`（见 `utils/siteUtils.ts`）。库里因此只有一套分类真值，
 * 不存在「分组树里有条目、标签里也有条目」的双写，也不需要备份格式升版。
 *
 * 与筛选栏的关系是叠加：这一栏管「按哪类值收拢」，关键词与「只看收藏」仍在上方，
 * 段内多个值是「或」、段与段之间是「且」。
 */
const props = defineProps<{
  /** 标签段候选（带计数） */
  tagOptions: readonly FacetOption[];
  /** 站点段候选（带计数） */
  siteOptions: readonly FacetOption[];
  /** 标签段选中集 */
  filterTags: readonly string[];
  /** 站点段选中集 */
  filterSites: readonly string[];
  /** 库内条目总数，挂在「全部条目」一行右侧 */
  totalCount: number;
}>();

const emit = defineEmits<{
  'update:filterTags': [value: string[]];
  'update:filterSites': [value: string[]];
}>();

const { t } = useI18n();

/** 两段候选都为空时整栏不出现：只剩一个「全部条目」的行没有信息量 */
const hasFacets = computed(() => props.tagOptions.length > 0 || props.siteOptions.length > 0);

const hasActiveFacet = computed(() => props.filterTags.length > 0 || props.filterSites.length > 0);

/**
 * 两段一起清空。
 *
 * 只清其中一段会让「另一段仍有值」的中间态被列表读到一次多余的空白重排；
 * 已经是未筛状态时不发事件，避免无意义的响应式写入。
 */
const resetFacets = (): void => {
  if (!hasActiveFacet.value) return;
  emit('update:filterTags', []);
  emit('update:filterSites', []);
};
</script>

<style scoped>
.category-rail {
  position: sticky;
  top: 16px;
  flex-shrink: 0;
  width: 232px;
  max-height: calc(100vh - 32px);
  padding: 12px;
  overflow-y: auto;
  background: white;
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
}

.rail-all {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 5px 8px;
  margin-bottom: 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--aph-text-primary);
  text-align: left;
  cursor: pointer;
  background: none;
  border: 0;
  border-radius: 6px;
}

.rail-all:hover {
  background: var(--aph-surface-hover);
}

.rail-all:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
}

.rail-all.is-active {
  color: var(--aph-primary);
  background: rgb(var(--aph-primary-rgb) / 10%);
}

.rail-all__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-all__count {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--aph-text-muted);
}

/*
  窄屏时 `.vault-layout` 改成纵向堆叠（断点写在其定义处，两处必须同值）：
  吸附定位在堆叠态没有意义，退化成一张普通卡片。
  这里必须同时收「宽度」和「高度」：父级是 `align-items: flex-start`，
  不显式给宽度就只撑到内容宽（右侧留一大片空白），而不收高度时
  几十行候选会把表格整个推到首屏之外——用户为了勾一个筛选条件得先滚过整栏。
*/
@media (width <= 900px) {
  .category-rail {
    position: static;
    width: 100%;
    max-width: 420px;
    max-height: 40vh;
  }
}
</style>
