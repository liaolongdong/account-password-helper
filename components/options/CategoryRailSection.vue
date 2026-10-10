<template>
  <section
    class="rail-section"
    :aria-label="title"
  >
    <h3 class="rail-section__title">{{ title }}</h3>
    <el-input
      v-if="searchable"
      v-model="query"
      class="rail-section__search"
      size="small"
      :placeholder="searchPlaceholder"
      :prefix-icon="Search"
      clearable
    />
    <ul class="rail-list">
      <li
        v-for="option in view.items"
        :key="option.value"
      >
        <button
          type="button"
          class="rail-item"
          :class="{ 'is-active': isSelected(option.value) }"
          :aria-pressed="isSelected(option.value)"
          @click="toggle(option.value)"
        >
          <span
            v-if="colorDot"
            class="rail-item__dot"
            :style="{ background: getTagColor(option.value).text }"
          />
          <span class="rail-item__label">{{ option.value }}</span>
          <span class="rail-item__count">{{ option.count }}</span>
        </button>
      </li>
    </ul>
    <p
      v-if="view.items.length === 0"
      class="rail-section__empty"
    >
      {{ t('common.noData') }}
    </p>
    <button
      v-if="view.truncated"
      type="button"
      class="rail-section__more"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('options.rail.collapse') : t('options.rail.showAll', { count: view.total }) }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';
import { FACET_VISIBLE_LIMIT, resolveFacetView, type FacetOption } from '@/utils/facet';
import { getTagColor } from '@/utils/tagUtils';

/**
 * 分类栏的单段候选列表（标签段 / 站点段共用）
 *
 * 自己持有「搜索词」与「是否已展开全部」两段局部状态：它们只影响本段的渲染，
 * 提到父级只会让两个维度互相看见彼此不该看见的东西。选中集合仍由父级持有——
 * 它是筛选条件，属于列表链路而不是这一栏。
 */
const props = withDefaults(
  defineProps<{
    /** 段落标题，同时作为该段的无障碍分组名 */
    title: string;
    /** 搜索框占位文案 */
    searchPlaceholder: string;
    /** 已按「计数倒序 → 值正序」排好的候选集 */
    options: readonly FacetOption[];
    /** 当前选中的候选值集合 */
    modelValue: readonly string[];
    /** 是否在行首渲染标签色点（只有标签段需要） */
    colorDot?: boolean;
  }>(),
  { colorDot: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const { t } = useI18n();

const query = ref('');
const expanded = ref(false);

/**
 * 候选数没超过可见上限时不出现搜索框：小库一屏看完，
 * 摆一个用不上的搜索框只会让左栏显得比它实际承载的东西更重。
 */
const searchable = computed(() => props.options.length > FACET_VISIBLE_LIMIT);

const view = computed(() => resolveFacetView(props.options, query.value, expanded.value, props.modelValue));

const isSelected = (value: string): boolean => props.modelValue.includes(value);

/** 点一下是加入、再点一下是移出：同一维度内的多个值是「或」关系 */
const toggle = (value: string): void => {
  emit(
    'update:modelValue',
    isSelected(value) ? props.modelValue.filter(item => item !== value) : [...props.modelValue, value],
  );
};
</script>

<style scoped>
.rail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rail-section + .rail-section {
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--aph-surface-line);
}

.rail-section__title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--aph-text-muted);
}

.rail-section__search {
  margin-bottom: 2px;
}

.rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.rail-item {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 5px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--aph-text-primary);
  text-align: left;
  cursor: pointer;
  background: none;
  border: 0;
  border-radius: 6px;
}

.rail-item:hover {
  background: var(--aph-surface-hover);
}

.rail-item:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
}

.rail-item.is-active {
  font-weight: 500;
  color: var(--aph-primary);
  background: rgb(var(--aph-primary-rgb) / 10%);
}

.rail-item__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.rail-item__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-item__count {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--aph-text-muted);
}

.rail-section__empty {
  margin: 2px 0;
  font-size: 12px;
  color: var(--aph-text-muted);
}

.rail-section__more {
  padding: 2px 8px;
  font: inherit;
  font-size: 12px;
  color: var(--aph-primary);
  text-align: left;
  cursor: pointer;
  background: none;
  border: 0;
  border-radius: 6px;
}

.rail-section__more:hover {
  color: var(--aph-primary-hover);
}
</style>
