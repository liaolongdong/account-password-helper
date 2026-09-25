<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="cp-overlay"
      @mousedown.self="emit('update:modelValue', false)"
    >
      <div
        class="cp-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="t('options.commandPalette.title')"
      >
        <div class="cp-search">
          <el-input
            ref="inputRef"
            :model-value="keyword"
            :placeholder="t('options.commandPalette.placeholder')"
            :prefix-icon="Search"
            clearable
            @update:model-value="emit('update:keyword', $event)"
          />
        </div>

        <div
          ref="listRef"
          class="cp-list"
          role="listbox"
          :aria-label="t('options.commandPalette.title')"
        >
          <template
            v-for="(action, index) in filtered"
            :key="action.id"
          >
            <div
              v-if="index === 0 || filtered[index - 1].group !== action.group"
              class="cp-group-title"
            >
              {{ t(`options.commandPalette.group.${action.group}`) }}
            </div>
            <div
              class="cp-item"
              :class="{ 'cp-item--active': index === activeIndex }"
              :data-index="index"
              role="option"
              :aria-selected="index === activeIndex"
              @mouseenter="emit('update:activeIndex', index)"
              @click="emit('run', index)"
            >
              <SearchHighlight
                class="cp-item-label"
                :text="action.label"
                :keyword="keyword"
              />
            </div>
          </template>

          <div
            v-if="filtered.length === 0"
            class="cp-empty"
          >
            {{ t('options.commandPalette.empty') }}
          </div>
        </div>

        <div class="cp-footer">
          {{ t('options.commandPalette.hint') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { Search } from '@element-plus/icons-vue';
import type { CommandAction } from '@/utils/commandPalette';
import { useI18n } from '@/utils/i18n';
import SearchHighlight from '@/components/SearchHighlight.vue';

/**
 * 命令面板覆盖层组件（Options 页 Ctrl/Cmd+K）
 *
 * 纯展示层：搜索关键词、过滤结果与活动项索引由父级（App.vue 装配 useCommandPalette）
 * 通过 props 下传，交互经 emits 上报。键盘导航（方向键 / Enter / Esc）由父级 composable
 * 的全局监听统一处理，本组件只负责渲染、输入同步、鼠标点选与自动聚焦。
 *
 * 覆盖层经 Teleport 挂到 body，独立于既有 el-dialog，不改动任何现有弹窗的结构或层级。
 * 命中高亮复用 SearchHighlight（与密码列表同一套匹配口径）。
 */
const props = defineProps<{
  /** 面板是否可见（v-model） */
  modelValue: boolean;
  /** 过滤后的动作列表 */
  filtered: CommandAction[];
  /** 检索关键词（v-model:keyword） */
  keyword: string;
  /** 当前活动项索引（v-model:activeIndex） */
  activeIndex: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:keyword': [value: string];
  'update:activeIndex': [value: number];
  /** 点击某条动作 */
  run: [index: number];
}>();

const { t } = useI18n();

/** 搜索输入框引用（打开时自动聚焦） */
const inputRef = ref<{ focus: () => void } | null>(null);
/** 列表容器引用（活动项滚动进可视区） */
const listRef = ref<HTMLElement | null>(null);

// 打开时聚焦输入框并滚动活动项回顶部
watch(
  () => props.modelValue,
  visible => {
    if (!visible) return;
    void nextTick(() => inputRef.value?.focus());
  },
);

// 活动项变化时确保其滚动进入可视区（列表可滚动且结果多于可视高度时）
watch(
  () => props.activeIndex,
  index => {
    const container = listRef.value;
    if (!container) return;
    container.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  },
);
</script>

<style scoped>
.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px 16px;
  background: rgb(15 23 42 / 45%);
  animation: cp-fade 0.12s ease;
}

.cp-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  overflow: hidden;
  background: var(--aph-surface);
  border: 1px solid var(--aph-surface-line);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 24%);
}

.cp-search {
  padding: 12px 14px;
  border-bottom: 1px solid var(--aph-surface-line);
}

.cp-list {
  max-height: 52vh;
  padding: 6px;
  overflow-y: auto;
}

.cp-group-title {
  padding: 8px 10px 4px;
  font-size: 12px;
  color: var(--aph-text-muted);
}

.cp-item {
  display: flex;
  align-items: center;
  padding: 9px 10px;
  font-size: 14px;
  color: var(--aph-text-primary);
  cursor: pointer;
  border-radius: 8px;
}

.cp-item:hover {
  background: var(--aph-surface-hover);
}

.cp-item--active {
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
}

.cp-empty {
  padding: 24px 10px;
  font-size: 14px;
  color: var(--aph-text-muted);
  text-align: center;
}

.cp-footer {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--aph-text-muted);
  border-top: 1px solid var(--aph-surface-line);
}

@keyframes cp-fade {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cp-overlay {
    animation: none;
  }
}
</style>
