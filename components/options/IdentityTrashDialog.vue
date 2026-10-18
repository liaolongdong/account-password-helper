<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('identity.trash.title')"
    width="680px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="identity-trash-content">
      <!-- 空态 -->
      <div
        v-if="!loading && rows.length === 0"
        class="identity-trash-empty"
      >
        <el-empty :description="t('identity.trash.empty')" />
      </div>

      <template v-else>
        <!-- 计数读数（回收站条目不参与主列表上限，仅做展示） -->
        <div
          v-if="rows.length > 0"
          class="identity-trash-stats"
        >
          {{ t('identity.trash.total', { count: rows.length }) }}
        </div>
        <el-table
          v-if="rows.length > 0 || loading"
          v-loading="loading"
          :data="rows"
          stripe
          size="small"
          max-height="400"
          row-key="id"
          :empty-text="t('common.noData')"
          :tooltip-options="TABLE_OVERFLOW_TOOLTIP_OPTIONS"
          class="identity-trash-table"
        >
          <el-table-column
            :label="t('identity.trash.column.title')"
            min-width="140"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span :class="{ 'is-muted': row.title === null }">{{ row.titleText }}</span>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('identity.trash.column.category')"
            width="100"
            align="center"
          >
            <template #default="{ row }">
              <el-tag
                v-if="row.category"
                size="small"
                effect="plain"
              >
                {{ t(`identity.category.${row.category}`) }}
              </el-tag>
              <span
                v-else
                class="is-muted"
                >—</span
              >
            </template>
          </el-table-column>
          <el-table-column
            :label="t('identity.trash.deletedAt')"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <span class="identity-trash-date">{{ row.deletedDate }}</span>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('identity.trash.remainingDays')"
            width="90"
            align="center"
          >
            <template #default="{ row }">
              <el-tag
                :type="row.remainingDays <= 7 ? 'danger' : 'info'"
                size="small"
                effect="plain"
              >
                {{ row.remainingDays }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('common.actions')"
            width="160"
            fixed="right"
            align="center"
          >
            <template #default="{ row }">
              <el-button
                type="primary"
                size="small"
                @click="handleRestore(row.id)"
              >
                {{ t('identity.trash.restore') }}
              </el-button>
              <el-button
                type="danger"
                size="small"
                @click="handlePermanentDelete(row.id)"
              >
                {{ t('identity.trash.deleteForever') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>

    <template #footer>
      <div class="identity-trash-footer">
        <el-button
          v-if="rows.length > 0"
          type="danger"
          plain
          :disabled="loading"
          @click="handleEmptyTrash"
        >
          {{ t('identity.trash.emptyTrash') }}
        </el-button>
        <el-button @click="$emit('update:modelValue', false)">{{ t('common.close') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  getIdentityTrashEntries,
  restoreIdentitiesFromTrash,
  permanentDeleteIdentitiesFromTrash,
  emptyIdentityTrash,
  decryptIdentityTrashTitles,
  IdentityTrashCapacityError,
} from '@/utils/storage/identityTrashManager';
import { getTrashRemainingDays } from '@/utils/storage/trashRetention';
import { MAX_IDENTITIES } from '@/utils/identity/constants';
import { getSessionDataKey } from '@/utils/storage/facades';
import { identityDisplayTitle } from '@/utils/identity/fields';
import { formatDate } from '@/utils/dateFormat';
import { TABLE_OVERFLOW_TOOLTIP_OPTIONS } from '@/utils/tableOverflowTooltip';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

/**
 * 身份信息库回收站弹窗
 *
 * 展示已删除（软删除）的身份条目，支持恢复、彻底删除和清空回收站。
 * 条目保留 30 天后由后台闹钟自动清理（保留期与密码库回收站共用
 * `trashRetention` 的 `TRASH_RETENTION_DAYS`，倒计时同源不会出现两种读数）。
 *
 * 展示面刻意收窄为「标题 + 类别 + 删除日期」：解密只提取标题回退链与类别两个
 * 展示字段（见 `decryptIdentityTrashTitles`），其余 PII 不进入本组件内存。
 * 上限 30 条的主列表决定了回收站体量远小于密码库（千级），因此不做检索与分页。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 回收站内容发生变化（恢复/彻底删除/清空）后通知父组件刷新列表与计数 */
  changed: [];
}>();

const { t } = useI18n();

/**
 * 回收站展示行
 *
 * `title` 为解密结果（null 表示会话无效或单条解密失败），`titleText` 是随行预计算的
 * 展示文本——占位/降级文案在加载时一次算好，模板不做逐行判断。
 */
interface TrashDisplayRow {
  id: string;
  title: string | null;
  titleText: string;
  category: string;
  deletedDate: string;
  remainingDays: number;
}

const loading = ref(false);
const rows = ref<TrashDisplayRow[]>([]);

/** 加载回收站条目（解密标题与类别用于展示，会话无效时显示占位符） */
const loadTrash = async (): Promise<void> => {
  loading.value = true;
  try {
    const entries = await getIdentityTrashEntries();
    // 一次取样：同一屏的倒计时必须相对同一时刻，避免「同一批数据两种剩余天数」
    const now = Date.now();
    const key = await getSessionDataKey();
    const decrypted = key
      ? await decryptIdentityTrashTitles(entries, key, payload => identityDisplayTitle(payload, t))
      : entries.map(entry => ({ id: entry.id, title: null, category: '' }));

    rows.value = decrypted.map((item, index) => ({
      ...item,
      titleText: item.title ?? (key ? t('message.decryptFailed') : t('identity.trash.lockedPlaceholder')),
      deletedDate: formatDate(entries[index].deletedAt),
      remainingDays: getTrashRemainingDays(entries[index].deletedAt, now),
    }));
  } catch (error) {
    logger.error('加载身份信息回收站失败:', error);
    ElMessage.error(t('identity.trash.loadFailed'));
  } finally {
    loading.value = false;
  }
};

/**
 * 恢复条目到身份库（回收站与主列表的变化统一经 changed 通知父组件）
 *
 * 与密码库回收站同口径：提示按 `restoreIdentitiesFromTrash` 返回的计数分三档，
 * 零恢复时不许弹「已恢复」——`restoreMissing` 那一档是唯一该让用户知道「找不回来了」的情形。
 */
const handleRestore = async (id: string): Promise<void> => {
  try {
    const { restored, skippedExisting } = await restoreIdentitiesFromTrash([id]);
    if (restored > 0) {
      ElMessage.success(t('identity.trash.restored'));
    } else if (skippedExisting > 0) {
      ElMessage.info(t('identity.trash.restoreAlreadyInList'));
    } else {
      ElMessage.warning(t('identity.trash.restoreMissing'));
    }
    await loadTrash();
    emit('changed');
  } catch (error) {
    logger.error('恢复身份信息失败:', error);
    ElMessage.error(
      error instanceof IdentityTrashCapacityError
        ? t('identity.trash.restoreLimitReached', { max: MAX_IDENTITIES })
        : t('identity.trash.restoreFailed'),
    );
  }
};

/** 彻底删除条目（不可恢复，二次确认） */
const handlePermanentDelete = async (id: string): Promise<void> => {
  try {
    await ElMessageBox.confirm(t('identity.trash.deleteConfirm'), t('identity.trash.deleteConfirmTitle'), {
      confirmButtonText: t('identity.trash.deleteForever'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    });
    await permanentDeleteIdentitiesFromTrash([id]);
    ElMessage.success(t('identity.trash.deleted'));
    await loadTrash();
    emit('changed');
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('彻底删除身份信息失败:', error);
      ElMessage.error(t('message.deleteFailed'));
    }
  }
};

/** 清空回收站（不可恢复，二次确认并播报条数） */
const handleEmptyTrash = async (): Promise<void> => {
  try {
    await ElMessageBox.confirm(
      t('identity.trash.emptyConfirm', { count: rows.value.length }),
      t('identity.trash.emptyConfirmTitle'),
      {
        confirmButtonText: t('identity.trash.emptyTrash'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    );
    await emptyIdentityTrash();
    ElMessage.success(t('identity.trash.emptied'));
    rows.value = [];
    emit('changed');
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('清空身份信息回收站失败:', error);
      ElMessage.error(t('identity.trash.emptyFailed'));
    }
  }
};

/** 弹窗打开时清空上一次的展示数据并加载 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      rows.value = [];
      loadTrash();
    }
  },
);
</script>

<style scoped>
.identity-trash-content {
  min-height: 200px;
}

.identity-trash-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.identity-trash-footer {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

.identity-trash-stats {
  margin-bottom: 8px;
  font-size: 12px;
  color: #909399;
}

.identity-trash-date {
  font-size: 12px;
  color: #606266;
}

.is-muted {
  color: #909399;
}

/* 表格操作列按钮紧凑 */
.identity-trash-table :deep(.el-button + .el-button) {
  margin-left: 6px;
}
</style>
