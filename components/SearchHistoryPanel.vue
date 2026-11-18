<script setup lang="ts">
import { t } from '@/utils/i18n';

/**
 * 最近搜索候选面板（展示层）
 *
 * 只负责头部（标题 + 清除）与关键词 chip 列表；定位、底色、边框由消费端
 * 通过 fallthrough class 决定——当前唯一消费端是管理页筛选栏（无裁切，
 * 走输入框下方悬浮层）。侧边栏只记录不展示，历史候选不在快速填充场景出现。
 *
 * chip 与清除按钮的 `pointerdown.prevent` 阻止焦点离开搜索框：
 * 否则 blur 先于 click 触发，消费端的 blur 收起会让点击落空。
 */
defineProps<{
  /** 最近搜索词（新→旧，已由 composable 去重截断） */
  history: string[];
  /** 是否展开（消费端按「点击空框 / 清空关键词」规则控制） */
  visible: boolean;
}>();

const emit = defineEmits<{
  select: [query: string];
  clear: [];
}>();
</script>

<template>
  <Transition name="search-history">
    <div
      v-if="visible && history.length > 0"
      class="search-history-panel"
      role="group"
      :aria-label="t('sidepanel.recentSearches')"
    >
      <div class="search-history-head">
        <span class="search-history-title">{{ t('sidepanel.recentSearches') }}</span>
        <button
          type="button"
          class="search-history-clear"
          @pointerdown.prevent
          @click="emit('clear')"
        >
          {{ t('sidepanel.clearRecentSearches') }}
        </button>
      </div>
      <div class="search-history-chips">
        <button
          v-for="item in history"
          :key="item"
          type="button"
          class="search-history-chip"
          :title="item"
          @pointerdown.prevent
          @click="emit('select', item)"
        >
          {{ item }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.search-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.search-history-title {
  font-size: 12px;
  color: var(--aph-text-muted);
}

.search-history-clear {
  padding: 0;
  font-size: 12px;
  color: var(--aph-text-muted);
  cursor: pointer;
  background: none;
  border: none;
  transition: color var(--aph-duration-fast) ease;
}

.search-history-clear:hover {
  color: var(--aph-primary);
}

.search-history-clear:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
}

.search-history-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.search-history-chip {
  max-width: 100%;
  padding: 3px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1.5;
  color: var(--aph-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  background: var(--aph-surface-2);
  border: 1px solid var(--aph-surface-line);
  border-radius: 999px;
  transition:
    color var(--aph-duration-fast) ease,
    border-color var(--aph-duration-fast) ease;
}

.search-history-chip:hover {
  color: var(--aph-primary);
  border-color: var(--aph-primary);
}

.search-history-chip:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
}

.search-history-enter-active,
.search-history-leave-active {
  transition:
    opacity var(--aph-duration-fast) ease,
    transform var(--aph-duration-fast) ease;
}

.search-history-enter-from,
.search-history-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .search-history-enter-active,
  .search-history-leave-active,
  .search-history-chip,
  .search-history-clear {
    transition: none;
  }
}
</style>
