<template>
  <aside class="group-panel">
    <div class="group-panel__header">
      <el-input
        v-model="keyword"
        class="group-panel__search"
        :placeholder="t('options.group.searchPlaceholder')"
        :prefix-icon="Search"
        size="small"
        clearable
      />
      <el-tooltip
        :content="t('options.group.create')"
        placement="top"
        :show-after="400"
      >
        <el-button
          :icon="Plus"
          size="small"
          circle
          :aria-label="t('options.group.create')"
          @click="promptCreate(ROOT_GROUP_CODE)"
        />
      </el-tooltip>
    </div>

    <el-tree
      ref="treeRef"
      class="group-panel__tree"
      :data="treeData"
      :props="TREE_PROPS"
      node-key="code"
      :expand-on-click-node="false"
      default-expand-all
      highlight-current
      :current-node-key="selectedGroupCode"
      draggable
      :allow-drop="allowDrop"
      :allow-drag="allowDrag"
      :filter-node-method="filterNode"
      @node-click="handleNodeClick"
      @node-drop="handleNodeDrop"
    >
      <template #default="{ data }">
        <!--
          节点内容同时作为「表格行拖入归组」的放置目标：原生 dragover/drop
          挂在节点根元素上，与 el-tree 自身节点拖拽通过 MIME 类型区分。
        -->
        <span
          class="group-node"
          :class="{ 'is-drop-target': dropTargetCode === data.code }"
          @dragover="handleEntryDragOver($event, data.code)"
          @dragleave="handleEntryDragLeave(data.code)"
          @drop="handleEntryDrop($event, data.code)"
        >
          <span class="group-node__label">{{ nodeLabel(data) }}</span>
          <span class="group-node__count">({{ entryCounts.get(data.code) ?? 0 }})</span>
          <span
            v-if="!data.isVirtual"
            class="group-node__actions"
          >
            <el-button
              :icon="Plus"
              link
              size="small"
              :title="t('options.group.createSub')"
              :aria-label="t('options.group.createSub')"
              @click.stop="promptCreate(data.code)"
            />
            <el-button
              :icon="Edit"
              link
              size="small"
              :title="t('options.group.rename')"
              :aria-label="t('options.group.rename')"
              @click.stop="promptRename(data)"
            />
            <el-button
              :icon="Delete"
              link
              size="small"
              :title="t('options.group.delete')"
              :aria-label="t('options.group.delete')"
              @click.stop="$emit('requestDelete', data.code)"
            />
          </span>
        </span>
      </template>
    </el-tree>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Delete, Edit, Plus, Search } from '@element-plus/icons-vue';
import type { GroupTreeNode } from '@/utils/types';
import { ROOT_GROUP_CODE, UNGROUPED_CODE } from '@/utils/types';
import { ENTRY_DRAG_MIME, filterGroupsByKeyword, MAX_GROUP_NAME_LENGTH } from '@/utils/groupTree';
import { useI18n } from '@/utils/i18n';

/**
 * 左侧分组树面板
 *
 * 分组数据的读写由父级编排，本组件只负责渲染、树交互并向父级发事件。
 */
const props = defineProps<{
  /** 分组树渲染节点（含虚拟根与未分组叶子） */
  treeData: GroupTreeNode[];
  /** 各分组（含子孙聚合）条目数 */
  entryCounts: Map<string, number>;
  /** 当前选中分组 code */
  selectedGroupCode: string;
}>();

const emit = defineEmits<{
  /** 选中分组（驱动右侧列表过滤） */
  select: [code: string];
  /** 请求新建分组 */
  create: [name: string, parentCode: string];
  /** 请求重命名分组 */
  rename: [code: string, name: string];
  /** 请求删除分组（由父级弹确认对话框裁决条目处置） */
  requestDelete: [code: string];
  /** 树内拖拽移动分组 */
  move: [code: string, newParentCode: string];
  /** 树内同级拖拽排序 */
  reorder: [parentCode: string, orderedCodes: string[]];
  /** 表格行拖入归组 */
  dropEntries: [entryIds: string[], targetCode: string];
}>();

const { t } = useI18n();

/** el-tree 字段映射 */
const TREE_PROPS = { label: 'name', children: 'children' } as const;

/** el-tree 节点实例的最小结构（仅声明本组件用到的字段） */
interface TreeNodeInstance {
  data: GroupTreeNode;
  parent?: TreeNodeInstance;
  childNodes: TreeNodeInstance[];
}

const treeRef = ref<{ filter: (value: string) => void; store: { nodesMap: Record<string, TreeNodeInstance> } }>();
/** 分组名搜索关键词（组件内部状态，纯 UI 过滤） */
const keyword = ref('');
/** 当前作为条目放置目标高亮的节点 code */
const dropTargetCode = ref<string | null>(null);

/**
 * 把树节点摊平为 { code, name, parentCode } 供纯函数消费
 *
 * 复用 groupTree 的过滤逻辑，避免组件内重复维护树搜索语义。
 */
const flatNodes = computed(() => {
  const flat: Array<{ code: string; name: string; parentCode: string }> = [];
  const walk = (list: readonly GroupTreeNode[], parentCode: string) => {
    for (const node of list) {
      flat.push({ code: node.code, name: node.name, parentCode });
      walk(node.children, node.code);
    }
  };
  walk(props.treeData, ROOT_GROUP_CODE);
  return flat;
});

/** 树搜索：命中节点 + 祖先链保留，保证层级完整可展开 */
const visibleCodes = computed(() => filterGroupsByKeyword(flatNodes.value, keyword.value));

/** 虚拟节点显示 i18n 文案（buildTree 中 name 为空串，纯函数不依赖语言包） */
const nodeLabel = (data: GroupTreeNode): string => {
  if (data.code === ROOT_GROUP_CODE) return t('options.group.rootName');
  if (data.code === UNGROUPED_CODE) return t('options.group.ungrouped');
  return data.name;
};

/** el-tree 过滤回调：只保留命中集内的节点 */
const filterNode = (_value: string, data: Record<string, unknown>): boolean => {
  if (!keyword.value.trim()) return true;
  return visibleCodes.value.has(String(data.code));
};

/** 关键词变化时触发 el-tree 重新过滤 */
watch(keyword, value => {
  treeRef.value?.filter(value);
});

const handleNodeClick = (data: GroupTreeNode) => {
  emit('select', data.code);
};

/** 虚拟节点（根 / 未分组）不可拖动 */
const allowDrag = (node: TreeNodeInstance): boolean => !node.data.isVirtual;

/**
 * 拖拽落点约束
 *
 * - 不允许放进「未分组」（它不能有子节点）；
 * - 根节点只允许 `inner`（成为一级分组），不允许在根前后插入排序；
 * - 防环由 moveGroup 的存储层校验兜底，此处不重复计算子孙集。
 */
const allowDrop = (
  _draggingNode: TreeNodeInstance,
  dropNode: TreeNodeInstance,
  type: 'prev' | 'inner' | 'next',
): boolean => {
  if (dropNode.data.code === UNGROUPED_CODE) return false;
  if (dropNode.data.code === ROOT_GROUP_CODE) return type === 'inner';
  return true;
};

/**
 * 树内拖拽落定：区分「移动到新父级」与「同级重排」
 *
 * el-tree 已完成节点位置变更，这里只把新结构回写存储；
 * 落库后父级 reloadGroups 重建 treeData，以存储为唯一事实源。
 */
const handleNodeDrop = (
  draggingNode: TreeNodeInstance,
  dropNode: TreeNodeInstance,
  position: 'before' | 'after' | 'inner',
) => {
  const draggedCode = draggingNode.data.code;
  if (position === 'inner') {
    emit('move', draggedCode, dropNode.data.code);
    return;
  }
  const newParentCode = dropNode.parent?.data.code ?? ROOT_GROUP_CODE;
  if (newParentCode !== draggingNode.parent?.data.code) {
    emit('move', draggedCode, newParentCode);
  }
  const siblings = (treeRef.value?.store.nodesMap[newParentCode]?.childNodes ?? []).map(child => child.data.code);
  emit('reorder', newParentCode, siblings);
};

// ==================== 表格行拖入归组 ====================

/** 判定拖拽载荷是否来自密码表格（区分 el-tree 自身的节点拖拽） */
const hasEntryPayload = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes(ENTRY_DRAG_MIME);

const handleEntryDragOver = (event: DragEvent, code: string) => {
  if (!hasEntryPayload(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTargetCode.value = code;
};

const handleEntryDragLeave = (code: string) => {
  if (dropTargetCode.value === code) dropTargetCode.value = null;
};

const handleEntryDrop = (event: DragEvent, code: string) => {
  if (!hasEntryPayload(event)) return;
  event.preventDefault();
  dropTargetCode.value = null;
  const entryIds = (event.dataTransfer?.getData(ENTRY_DRAG_MIME) ?? '').split(',').filter(Boolean);
  if (entryIds.length === 0) return;
  // 拖到根节点视为移出分组（归入未分组）
  emit('dropEntries', entryIds, code === ROOT_GROUP_CODE ? UNGROUPED_CODE : code);
};

/**
 * 名称校验（供 ElMessageBox.prompt 的 inputValidator）
 *
 * 返回 true 表示通过，返回字符串即错误提示。同级重名判定需排除自身（重命名场景）。
 */
const validateName = (input: string, parentCode: string, selfCode?: string): true | string => {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return t('options.group.nameRequired');
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) return t('options.group.nameTooLong', { max: MAX_GROUP_NAME_LENGTH });
  if (trimmed.includes('/')) return t('options.group.nameInvalidChar');
  const duplicated = flatNodes.value.some(
    node => node.parentCode === parentCode && node.code !== selfCode && node.name === trimmed,
  );
  if (duplicated) return t('options.group.nameDuplicate');
  return true;
};

/** 新建分组：ElMessageBox.prompt + 名称校验 */
const promptCreate = async (parentCode: string) => {
  const parentName = flatNodes.value.find(node => node.code === parentCode)?.name ?? '';
  const message = parentCode === ROOT_GROUP_CODE ? '' : t('options.group.createSubTitle', { parent: parentName });
  try {
    const { value } = await ElMessageBox.prompt(message, t('options.group.createTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputPlaceholder: t('options.group.nameLabel'),
      inputValidator: (input: string) => validateName(input, parentCode),
    });
    emit('create', value.trim(), parentCode);
  } catch {
    // 用户取消或校验未通过，无需处理
  }
};

/** 重命名分组 */
const promptRename = async (data: GroupTreeNode) => {
  const parentCode = flatNodes.value.find(node => node.code === data.code)?.parentCode ?? ROOT_GROUP_CODE;
  try {
    const { value } = await ElMessageBox.prompt('', t('options.group.renameTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputValue: data.name,
      inputPlaceholder: t('options.group.nameLabel'),
      inputValidator: (input: string) => validateName(input, parentCode, data.code),
    });
    emit('rename', data.code, value.trim());
  } catch {
    // 用户取消或校验未通过，无需处理
  }
};
</script>

<style scoped>
/* 分组窗格：列表卡内左栏，与右侧筛选/表格同卡，右边框分隔 */
.group-panel {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: 240px;
  overflow: hidden;
  border-right: 1px solid var(--aph-surface-line);
}

.group-panel__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--aph-surface-line);
}

.group-panel__search {
  flex: 1;
  min-width: 0;
}

.group-panel__tree {
  flex: 1;
  padding: 8px 4px;
  overflow-y: auto;
}

.group-panel__tree::-webkit-scrollbar {
  width: 4px;
}

.group-panel__tree::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color);
  border-radius: 4px;
}

.group-node {
  display: flex;
  flex: 1;
  gap: 4px;
  align-items: center;
  min-width: 0;
  padding-right: 4px;
}

.group-node.is-drop-target {
  outline: 1px dashed var(--aph-primary);
  background: rgb(var(--aph-primary-rgb) / 12%);
  border-radius: 4px;
}

.group-node__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-node__count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 操作按钮默认隐藏，hover 节点时显现，避免树视觉噪声 */
.group-node__actions {
  display: none;
  flex-shrink: 0;
  margin-left: auto;
}

.group-node:hover .group-node__actions {
  display: inline-flex;
}

.group-node__actions .el-button {
  width: 20px;
  height: 20px;
  padding: 0;
  margin-left: 2px;
}

/* 窄屏：列表卡切为上下布局，分组窗格变为顶部块 */
@media (width <= 1024px) {
  .group-panel {
    width: auto;
    max-height: 240px;
    border-right: none;
    border-bottom: 1px solid var(--aph-surface-line);
  }
}
</style>
