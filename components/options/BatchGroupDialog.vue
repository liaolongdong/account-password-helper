<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.group.batchMoveTitle')"
    width="440px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    :show-close="!loading"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="targetCode = UNGROUPED_CODE"
  >
    <p class="batch-group__tip">{{ t('options.group.batchMoveTip', { count }) }}</p>
    <el-tree-select
      v-model="targetCode"
      class="batch-group__select"
      :data="selectData"
      :props="TREE_PROPS"
      node-key="code"
      check-strictly
      :render-after-expand="false"
      default-expand-all
      :disabled="loading"
      :placeholder="t('options.group.selectPlaceholder')"
    />
    <template #footer>
      <div class="dialog-footer">
        <el-button
          :disabled="loading"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          :disabled="!targetCode || loading"
          :loading="loading"
          @click="$emit('confirm', targetCode)"
        >
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GroupTreeNode } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { useI18n } from '@/utils/i18n';

/**
 * 批量「移动到分组」对话框
 *
 * 根节点语义是「全库」而非真实分组，故从选项中剔除，只保留真实分组与「未分组」。
 */
const props = defineProps<{
  modelValue: boolean;
  /** 分组树渲染节点 */
  treeData: GroupTreeNode[];
  /** 选中条目数 */
  count: number;
  /** 提交进行中 */
  loading?: boolean;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
  /** 确认移动，携带目标分组 code（UNGROUPED_CODE 表示移出分组） */
  confirm: [targetCode: string];
}>();

const { t } = useI18n();

const TREE_PROPS = { label: 'label', children: 'children' } as const;

/** 目标分组 code，默认「未分组」（最安全的非破坏性选择） */
const targetCode = ref<string>(UNGROUPED_CODE);

/** el-tree-select 数据：虚拟节点补 i18n 文案，剔除根节点 */
const selectData = computed(() => {
  const mapNode = (node: GroupTreeNode): { code: string; label: string; children: unknown[] } => ({
    code: node.code,
    label: node.code === UNGROUPED_CODE ? t('options.group.ungrouped') : node.name,
    children: node.children.map(mapNode),
  });
  const root = props.treeData.find(node => node.code === ROOT_GROUP_CODE);
  return (root?.children ?? []).map(mapNode);
});
</script>

<style scoped>
.batch-group__tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.batch-group__select {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
