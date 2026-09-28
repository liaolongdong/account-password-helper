<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.group.deleteTitle', { name: groupName })"
    width="480px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    :show-close="!loading"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="group-delete__message">
      {{
        isEmpty
          ? t('options.group.deleteEmptyMessage')
          : t('options.group.deleteMessage', { entries: entryCount, subGroups: subGroupCount })
      }}
    </p>

    <!-- 空分组无需二选一：只有一种语义，直接确认 -->
    <div
      v-if="!isEmpty"
      class="group-delete__choices"
    >
      <label class="group-delete__choice">
        <el-radio
          v-model="mode"
          value="toUngrouped"
        >
          <span class="group-delete__choice-title">{{ t('options.group.deleteGroupOnly') }}</span>
        </el-radio>
        <span class="group-delete__choice-tip">{{ t('options.group.deleteGroupOnlyTip') }}</span>
      </label>
      <label class="group-delete__choice">
        <el-radio
          v-model="mode"
          value="toTrash"
        >
          <span class="group-delete__choice-title group-delete__choice-title--danger">
            {{ t('options.group.deleteGroupAndData') }}
          </span>
        </el-radio>
        <span class="group-delete__choice-tip">
          {{ t('options.group.deleteGroupAndDataTip', { entries: entryCount }) }}
        </span>
      </label>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          :disabled="loading"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          :type="mode === 'toTrash' && !isEmpty ? 'danger' : 'primary'"
          :disabled="loading"
          :loading="loading"
          @click="handleConfirm"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '@/utils/i18n';

/**
 * 删除分组确认对话框
 *
 * 三个动作（仅删分组 / 删分组和数据 / 取消）超出 ElMessageBox 的双按钮能力，故自定义。
 * 默认选中「仅删除分组」；破坏性动作需用户显式改选。
 */
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 用户确认删除，携带条目处置方式 */
  confirm: [mode: 'toUngrouped' | 'toTrash'];
}>();

const { t } = useI18n();
const props = defineProps<{
  modelValue: boolean;
  /** 待删除分组名（标题展示） */
  groupName: string;
  /** 该分组（含子孙）下的条目数 */
  entryCount: number;
  /** 该分组下的子分组数（含子孙） */
  subGroupCount: number;
  /** 删除进行中 */
  loading?: boolean;
}>();

/** 条目处置方式；空分组时该值无意义，父级直接删 */
const mode = ref<'toUngrouped' | 'toTrash'>('toUngrouped');

/** 空分组（无条目、无子分组）：不展示二选一 */
const isEmpty = computed(() => props.entryCount === 0 && props.subGroupCount === 0);

/** 每次打开都重置为安全默认值，避免上次选择残留 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) mode.value = 'toUngrouped';
  },
);

const handleConfirm = () => {
  emit('confirm', isEmpty.value ? 'toUngrouped' : mode.value);
};
</script>

<style scoped>
.group-delete__message {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.group-delete__choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-delete__choice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  cursor: pointer;
  border: 1px solid var(--aph-surface-line);
  border-radius: 6px;
  transition: border-color 0.2s ease;
}

.group-delete__choice:hover {
  border-color: var(--aph-primary);
}

.group-delete__choice-title {
  font-size: 14px;
  font-weight: 500;
}

.group-delete__choice-title--danger {
  color: var(--el-color-danger);
}

.group-delete__choice-tip {
  padding-left: 24px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
