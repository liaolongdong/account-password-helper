<script setup lang="ts">
import { computed } from 'vue';
import { highlightSegments } from '@/utils/searchMatch';

/**
 * 搜索命中高亮文本组件
 *
 * 将文本按搜索关键词命中区间切分渲染：命中分段以主题强调色展示。
 * 匹配策略由 utils/searchMatch 统一提供（子串优先，拼音模块预热后
 * 自动补齐全拼/首字母命中）；highlightSegments 内部依赖
 * pinyinMatcherReady 响应式标志，预热完成后无需刷新即自动重渲染。
 * 关键词为空时等价于纯文本渲染，零额外开销。
 */
const props = defineProps<{
  /** 待渲染文本 */
  text: string;
  /** 搜索关键词（空串时不高亮） */
  keyword: string;
}>();

/** 高亮分段（拼接后等于原文） */
const segments = computed(() => highlightSegments(props.text, props.keyword));
</script>

<template>
  <template v-for="(seg, index) in segments">
    <span
      v-if="seg.hit"
      :key="index"
      class="search-hit"
      >{{ seg.text }}</span
    >
    <template v-else>{{ seg.text }}</template>
  </template>
</template>

<style scoped>
/* 命中分段：主题色 + 加粗，与表格/列表现有强调风格一致 */
.search-hit {
  font-weight: 600;
  color: var(--aph-primary, var(--el-color-primary));
}
</style>
