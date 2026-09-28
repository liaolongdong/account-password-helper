<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.shortcuts.title')"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <p class="shortcut-intro">{{ t('options.shortcuts.intro') }}</p>

      <ul class="shortcut-list">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="shortcut-item"
        >
          <div class="shortcut-item__row">
            <span class="shortcut-item__name">{{ t(COMMAND_LABEL_KEYS[entry.id]) }}</span>
            <ShortcutKeyCap
              :text="entry.shortcut"
              :muted="!entry.assigned"
              :label="keycapLabel(entry)"
            />
            <el-text
              :type="entry.assigned ? 'success' : 'warning'"
              size="small"
              class="shortcut-item__status"
            >
              {{ entry.assigned ? t('options.shortcuts.statusActive') : t('options.shortcuts.statusInactive') }}
            </el-text>
          </div>
          <p
            v-if="!entry.assigned"
            class="shortcut-item__hint"
          >
            {{ t('options.shortcuts.inactiveHint') }}
          </p>
        </li>
      </ul>

      <!-- Firefox 无 chrome://extensions/shortcuts 页面，改键入口降级为文案指引 -->
      <p
        v-if="isFirefox"
        class="shortcut-intro"
      >
        {{ t('options.shortcuts.firefoxHint') }}
      </p>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.close') }}
        </el-button>
        <el-button
          v-if="!isFirefox"
          type="primary"
          size="large"
          @click="handleEdit"
        >
          {{ t('options.shortcuts.editAction') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import ShortcutKeyCap from '@/components/ShortcutKeyCap.vue';
import { useShortcuts, type ShortcutEntry } from '@/composables/useShortcuts';
import { isFirefox } from '@/utils/env';
import { useI18n } from '@/utils/i18n';

/**
 * 快捷键一览弹窗（只读）
 *
 * Chrome `commands` API 仅提供 `getAll()` / `onCommand`，扩展无法自行改键，
 * 因此本弹窗只展示四组命令的真实绑定状态，并把改键动作引导至浏览器内置管理页。
 * 与「密码历史设置」「自动锁定设置」等安全设置弹窗同构，由 HeaderBar 下拉菜单触发。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();
const { entries, loadShortcuts, openShortcutsPage } = useShortcuts();

/**
 * 命令标识到应用内 i18n key 的映射
 *
 * 措辞与 `public/_locales/*` 的 `commandXxx` 保持一致（用户在浏览器管理页看到同一句话），
 * 但取值走应用自身 i18n —— `chrome.i18n.getMessage()` 跟随浏览器 UI 语言，
 * 会与密码管理页右上角的语言切换器脱钩。
 */
const COMMAND_LABEL_KEYS = {
  open_options: 'options.shortcuts.label.openOptions',
  toggle_sidepanel: 'options.shortcuts.label.toggleSidepanel',
  quick_fill: 'options.shortcuts.label.quickFill',
  open_inline_dropdown: 'options.shortcuts.label.openInlineDropdown',
} as const satisfies Record<ShortcutEntry['id'], string>;

/**
 * 键帽的无障碍名：命令名 + 按键 + 生效状态
 *
 * 键帽本体只渲染 `Ctrl⇧F` 这类符号串，未生效态又刻意弱化了颜色，
 * 因此把完整语义放进 aria-label，保证状态不只靠颜色表达。
 */
const keycapLabel = (entry: ShortcutEntry): string =>
  [
    t(COMMAND_LABEL_KEYS[entry.id]),
    entry.shortcut,
    t(entry.assigned ? 'options.shortcuts.statusActive' : 'options.shortcuts.statusInactive'),
  ].join(' ');

// 每次打开都重新读取，用户在管理页改完键回来即可看到最新状态
watch(
  () => props.modelValue,
  visible => {
    if (visible) void loadShortcuts();
  },
);

const handleEdit = (): void => {
  void openShortcutsPage();
};
</script>

<style scoped>
.dialog-body-scroll {
  max-height: 60vh;
  padding-right: 4px;
  overflow-y: auto;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcut-intro {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--aph-text-secondary);
}

.shortcut-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.shortcut-item + .shortcut-item {
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--aph-border-light);
}

.shortcut-item__row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.shortcut-item__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--aph-text-primary);
}

.shortcut-item__status {
  flex-shrink: 0;
}

.shortcut-item__hint {
  padding: 0;
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--aph-text-muted);
}
</style>
