<template>
  <div
    class="sort-header"
    role="button"
    tabindex="0"
    :aria-label="ariaLabel"
    @click.stop="$emit('sort', prop)"
    @keydown.enter.stop.prevent="$emit('sort', prop)"
    @keydown.space.stop.prevent="$emit('sort', prop)"
  >
    <span class="sort-header__label">{{ label }}</span>
    <span
      v-if="priority > 1"
      class="sort-header__priority"
      >{{ priority }}</span
    >
    <!-- 常显上下双箭头：未排序两枚皆淡灰，排序时高亮当前方向（对齐 el-table 原生观感） -->
    <span class="sort-header__caret-wrapper">
      <i
        class="sort-header__caret sort-header__caret--up"
        :class="{ 'is-active': criterion?.order === 'ascending' }"
      />
      <i
        class="sort-header__caret sort-header__caret--down"
        :class="{ 'is-active': criterion?.order === 'descending' }"
      />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SortCriterion } from '@/utils/passwordSort';
import { useI18n } from '@/utils/i18n';

/**
 * 可排序列表头单元格
 *
 * el-table 原生排序只能高亮单列，无法表达多列排序链，故自绘表头：
 * 常显上下双箭头（未排序时两枚淡灰作为「可排序」提示，排序时高亮当前方向），
 * 当该列处于排序链且非首位时追加优先级序号。点击/键盘触发向父级上抛 sort 事件，
 * 具体的 升 → 降 → 移除 循环逻辑由 composable 统一处理。
 */
const props = defineProps<{
  /** 列标签文本（已翻译） */
  label: string;
  /** 列字段名 */
  prop: string;
  /** 当前排序链（数组顺序即优先级） */
  chain: readonly SortCriterion[];
}>();

defineEmits<{
  sort: [prop: string];
}>();

const { t } = useI18n();

/** 该列在排序链中的条件（不在链中为 undefined） */
const criterion = computed(() => props.chain.find(item => item.prop === props.prop));

/** 该列的优先级序号（1 起；不在链中为 0） */
const priority = computed(() => {
  const index = props.chain.findIndex(item => item.prop === props.prop);
  return index === -1 ? 0 : index + 1;
});

/** 无障碍标签：说明列名与当前排序状态，未排序时提示可点击排序 */
const ariaLabel = computed(() => {
  if (!criterion.value) return t('options.sort.ariaNone', { label: props.label });
  const dir = criterion.value.order === 'ascending' ? t('options.sort.ariaAsc') : t('options.sort.ariaDesc');
  return t('options.sort.ariaActive', { label: props.label, dir, priority: priority.value });
});
</script>

<style scoped>
.sort-header {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.sort-header:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 60%);
  outline-offset: 1px;
  border-radius: 2px;
}

.sort-header__priority {
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: var(--el-color-primary);
}

/* 双箭头容器：上下两枚三角叠放，居中于列标签右侧 */
.sort-header__caret-wrapper {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 14px;
}

.sort-header__caret {
  width: 0;
  height: 0;
  border-right: 5px solid transparent;
  border-left: 5px solid transparent;
  transition: border-color 0.2s ease;
}

.sort-header__caret--up {
  margin-bottom: 3px;
  border-bottom: 5px solid var(--el-text-color-placeholder);
}

.sort-header__caret--down {
  border-top: 5px solid var(--el-text-color-placeholder);
}

.sort-header__caret--up.is-active {
  border-bottom-color: var(--el-color-primary);
}

.sort-header__caret--down.is-active {
  border-top-color: var(--el-color-primary);
}
</style>
