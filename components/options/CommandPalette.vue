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
          @mousemove="onPointerMove"
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
              @click="emit('run', item.index)"
            >
              <!-- 图标取自头部同名菜单项，纯装饰：无障碍名仍由同行文本承担 -->
              <el-icon
                class="cp-item-icon"
                aria-hidden="true"
              >
                <component :is="item.action.icon" />
              </el-icon>
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
          <span class="cp-hint">
            <ShortcutKeyCap text="↑↓" />
            {{ t('options.commandPalette.hintNavigate') }}
          </span>
          <span class="cp-hint">
            <ShortcutKeyCap text="Enter" />
            {{ t('options.commandPalette.hintSelect') }}
          </span>
          <span class="cp-hint">
            <ShortcutKeyCap text="Esc" />
            {{ t('options.commandPalette.hintClose') }}
          </span>
          <!-- 面板里本来就有「快捷键」这条命令，但从这里用到它要走 3 步（关面板 → 帮助 → 快捷键）；
               入口摆在提示条上，省掉那 3 步。文案复用头部那颗菜单项的 key，与清单里同源。 -->
          <button
            type="button"
            class="cp-footer__action"
            @keydown.enter.stop.prevent="emit('openShortcuts')"
            @click="emit('openShortcuts')"
          >
            {{ t('options.header.shortcuts') }}
          </button>
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
import ShortcutKeyCap from '@/components/ShortcutKeyCap.vue';

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
  /**
   * 请求打开「快捷键一览」
   *
   * 与清单里 `id: 'shortcuts'` 那条指向同一个弹窗，但收尾要由调用方补齐（先收面板再开弹窗）——
   * 面板本身不知道弹窗的存在，这里只负责把意图报上去。
   */
  openShortcuts: [];
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

/**
 * 指针**真的移动**时才接管活动项
 *
 * 此前是逐行 `@mouseenter`，而活动项一变就 `scrollIntoView()`：列表一滚，另一行被搬到静止
 * 的指针底下，Chromium 重算 hover 并补发 `mouseenter`，把键盘游标改回指针那一行——实测连按
 * ↓ 会 `4 → 3`、`5 → 4` 地倒退。滚动**不会**补发 `mousemove`，所以把判定收在容器的
 * `mousemove` 上：鼠标真的动了照样接管游标（鼠标用户不损失任何便利），键盘导航引起的滚动
 * 则改不动它。索引未变时不写 ref，免得高频事件触发无谓重渲染。
 */
const onPointerMove = (event: MouseEvent) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const item = target?.closest<HTMLElement>('[data-index]');
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index) || index === props.activeIndex) return;
  emit('update:activeIndex', index);
};

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

  /*
   * 面板是模态层，滚轮不该推动底下的列表。实测三个落点全部穿透（起点 150、一格 deltaY=800，
   * 各自到 950）：遮罩空白处、面板内的非滚动区（搜索框 / 底部提示条）、列表滚到底之后的那一格。
   * 根因只有一处 —— 遮罩此前是 `overflow: visible`，连滚动容器都不是，`overscroll-behavior`
   * 写在它身上也不生效，滚轮直接交给文档。先让它成为滚动容器，再用 `contain` 把链剪断在
   * 自己身上，与 `entrypoints/options/App.vue` 里 `.el-overlay-dialog` 那条同构。
   * 判据见 `e2e/dialog-scroll-isolation.spec.ts` 第 6 条。列表自己那格越界**不需要**再补一份
   * `contain`：变异验证摘掉它之后位移判据照旧绿，链先落到遮罩就被拦住了。
   */
  overflow: auto;
  overscroll-behavior: contain;
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

/*
 * 4px 细条，与偏好设置弹窗同一口径。macOS 默认下滚动条是 overlay（不占位、只在滚动时浮现），
 * 而 `::-webkit-scrollbar` 会把这一处改回经典渲染：常驻占 4px，换来一个不滚动也看得见的
 * 「下面还有」信号。刻意与弹窗取同色值，两处注入式/扩展式面板共用一套滚动条观感。
 */
.cp-list::-webkit-scrollbar {
  width: 4px;
}

.cp-list::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 4px;
}

.cp-list::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}

/* 分组之间给一条断点：30 条一屏滚下来，只有灰字标题时五个组会糊成一片 */
.cp-group + .cp-group {
  margin-top: 4px;
  border-top: 1px solid var(--aph-surface-line);
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

/* 图标取自头部同名菜单项，未选中时退到次要色，选中才跟文字一起走主色 */
.cp-item-icon {
  flex-shrink: 0;
  margin-right: 9px;
  font-size: 15px;
  color: var(--aph-icon-muted);
}

.cp-item--active .cp-item-icon {
  color: var(--aph-primary);
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
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--aph-text-muted);
  border-top: 1px solid var(--aph-surface-line);
}

.cp-hint {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

/*
 * footer 里的「快捷键」入口：与提示文字同权重，但必须看得出可点。
 * 只换颜色与描边，不做位移——hover 位移在这种密集提示条里会被读成抖动，
 * 也不属于需要 `prefers-reduced-motion` 兜底的那一档运动量。
 */
.cp-footer__action {
  padding: 2px 8px;
  margin-left: auto;
  font-family: inherit;
  font-size: 12px;
  color: var(--aph-text-secondary);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--aph-surface-line);
  border-radius: 5px;
}

.cp-footer__action:hover {
  color: var(--aph-primary);
  border-color: var(--aph-primary-border);
}

.cp-footer__action:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 1px;
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
