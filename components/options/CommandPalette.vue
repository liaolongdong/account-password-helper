<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="cp-overlay"
      @mousedown.self="emit('update:modelValue', false)"
    >
      <div
        ref="panelRef"
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
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls="cp-listbox"
            :aria-expanded="String(filtered.length > 0)"
            :aria-activedescendant="activeDescendantId"
            @update:model-value="emit('update:keyword', $event)"
          />
        </div>

        <div
          id="cp-listbox"
          ref="listRef"
          class="cp-list"
          role="listbox"
          :aria-label="t('options.commandPalette.listLabel')"
        >
          <!--
            分组以 `role="group"` 包裹：`role="listbox"` 的合法子元素只有 `option` 与
            `group`，此前分组标题是裸 `div`，读屏会把列表结构整个丢掉（选项数、当前项全播报不出）。
            标题本身 `aria-hidden`，分组名由 `aria-label` 承担，可见文本不变。
          -->
          <div
            v-for="section in grouped"
            :key="section.group"
            class="cp-group"
            role="group"
            :aria-label="t(`options.commandPalette.group.${section.group}`)"
          >
            <div
              class="cp-group-title"
              aria-hidden="true"
            >
              {{ t(`options.commandPalette.group.${section.group}`) }}
            </div>
            <div
              v-for="item in section.items"
              :id="`cp-option-${item.index}`"
              :key="item.action.id"
              class="cp-item"
              :class="{ 'cp-item--active': item.index === activeIndex }"
              :data-index="item.index"
              role="option"
              :aria-selected="item.index === activeIndex"
              @mouseenter="emit('update:activeIndex', item.index)"
              @click="emit('run', item.index)"
            >
              <SearchHighlight
                class="cp-item-label"
                :text="item.action.label"
                :keyword="keyword"
              />
            </div>
          </div>

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
import { ref, computed, watch, nextTick } from 'vue';
import { Search } from '@element-plus/icons-vue';
import type { CommandAction } from '@/utils/commandPalette';
import { useFocusTrap } from '@/composables/useFocusTrap';
import { useI18n } from '@/utils/i18n';
import SearchHighlight from '@/components/SearchHighlight.vue';

/**
 * 命令面板覆盖层组件（Options 页 Ctrl/Cmd+K）
 *
 * 纯展示层：搜索关键词、过滤结果与活动项索引由父级（App.vue 装配 useCommandPalette）
 * 通过 props 下传，交互经 emits 上报。键盘导航（方向键 / Enter / Esc）由父级 composable
 * 的全局监听统一处理，本组件只负责渲染、输入同步、鼠标点选与自动聚焦。
 *
 * 模态语义由本组件收口：面板声明了 `aria-modal="true"`，因此必须真的把 Tab 关在里头，
 * 并在关闭时把焦点还给唤起方——这一职责落在 {@link useFocusTrap} 上。
 * 活动项由输入框的 `aria-activedescendant` 指向，
 * ↑↓ 换项时读屏才会念出条目名（此前只有视觉高亮，屏幕上是静默的）。
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
/** 面板根节点（Tab 陷阱的作用域） */
const panelRef = ref<HTMLElement | null>(null);

/** 面板可见性（焦点陷阱的开关） */
const visible = computed(() => props.modelValue);

// 模态焦点语义：Tab 关在面板内，关闭后把焦点还给唤起方。
// 原主焦点由该 composable 在可见性翻转的同步阶段记录，早于下面 `nextTick` 里的聚焦。
useFocusTrap(panelRef, visible);

/**
 * 按分组把扁平结果切成连续段
 *
 * 切分口径与原先的 `index === 0 || filtered[index - 1].group !== action.group` 一致
 * （同组不相邻时会出现两个同名分组，这是既有行为，不随本次改动），
 * 但每段保留原始 `index`，父级的 `activeIndex` / `run(index)` 语义完全不变。
 */
const grouped = computed(() => {
  const sections: { group: string; items: { action: CommandAction; index: number }[] }[] = [];
  props.filtered.forEach((action, index) => {
    const current = sections[sections.length - 1];
    if (current && current.group === action.group) current.items.push({ action, index });
    else sections.push({ group: action.group, items: [{ action, index }] });
  });
  return sections;
});

/** 活动项的 DOM id；无匹配项或索引越界时返回 undefined（属性整体消失，不留悬空引用） */
const activeDescendantId = computed(() =>
  props.filtered[props.activeIndex] ? `cp-option-${props.activeIndex}` : undefined,
);

// 打开时聚焦输入框（Tab 陷阱与焦点归还由 useFocusTrap 承担）
watch(visible, isVisible => {
  if (isVisible) void nextTick(() => inputRef.value?.focus());
});

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
