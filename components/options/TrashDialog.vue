<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.trash.title')"
    width="860px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="trash-content">
      <!-- 空态 -->
      <div
        v-if="!loading && trashList.length === 0"
        class="trash-empty"
      >
        <el-empty :description="t('options.trash.empty')" />
      </div>

      <!-- 列表 -->
      <div
        v-if="trashList.length > 0"
        class="trash-stats"
      >
        {{ t('options.trash.total', { count: trashList.length }) }}
      </div>
      <el-table
        v-if="trashList.length > 0 || loading"
        v-loading="loading"
        :data="trashList"
        stripe
        size="small"
        max-height="400"
        class="trash-table"
      >
        <el-table-column
          :label="t('common.username')"
          prop="username"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          :label="t('common.url')"
          prop="url"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          :label="t('common.tag')"
          prop="tag"
          width="100"
          show-overflow-tooltip
        />
        <el-table-column
          :label="t('options.trash.deletedAt')"
          width="95"
          align="center"
        >
          <template #default="{ row }">
            <span class="trash-date">{{ formatDate(row.deletedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          :label="t('options.trash.remainingDays')"
          width="70"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="getRemainingDays(row.deletedAt) <= 7 ? 'danger' : 'info'"
              size="small"
              effect="plain"
            >
              {{ getRemainingDays(row.deletedAt) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          :label="t('common.actions')"
          width="130"
          fixed="right"
          align="center"
        >
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              @click="handleRestore(row.id)"
            >
              {{ t('options.form.restore') }}
            </el-button>
            <el-button
              type="danger"
              size="small"
              @click="handlePermanentDelete(row.id)"
            >
              {{ t('common.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div class="trash-footer">
        <el-button
          v-if="trashList.length > 0"
          type="danger"
          plain
          :disabled="loading"
          @click="handleEmptyTrash"
        >
          {{ t('options.trash.emptyTrash') }}
        </el-button>
        <el-button @click="$emit('update:modelValue', false)">{{ t('common.close') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { getTrashEntries, restoreFromTrash, permanentDeleteFromTrash, emptyTrash } from '@/utils/storage/trashManager';
import { getSessionDataKey } from '@/utils/storage/facades';
import { formatDateCompact } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import { lazyImport } from '@/utils/lazyImport';
import { useI18n } from '@/utils/i18n';

const _getEncryption = lazyImport(() => import('@/utils/encryption'));

const { t } = useI18n();

/**
 * 回收站对话框
 *
 * 展示已删除的密码条目，支持恢复、彻底删除和清空回收站。
 * 条目在回收站中保留 30 天后自动清理。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 条目恢复后通知父组件重新加载密码列表 */
  restored: [];
}>();

/** 解密后的回收站条目（用于 UI 展示） */
interface TrashDisplayEntry {
  id: string;
  username: string;
  url: string;
  tag: string;
  deletedAt: number;
}

const loading = ref(false);
const trashList = ref<TrashDisplayEntry[]>([]);

/** 回收站保留天数 */
const RETENTION_DAYS = 30;

/**
 * 加载回收站条目（解密敏感字段用于展示）
 *
 * 使用会话数据密钥解密 username/url/tag，会话无效时显示占位符。
 */
const loadTrash = async () => {
  loading.value = true;
  try {
    const entries = await getTrashEntries();
    const key = await getSessionDataKey();

    if (!key) {
      // 会话无效，无法解密，展示占位符
      trashList.value = entries.map(e => ({
        id: e.id,
        username: t('options.trash.lockedPlaceholder'),
        url: '•••',
        tag: e.tag || '',
        deletedAt: e.deletedAt,
      }));
      return;
    }

    const enc = await _getEncryption();
    const decrypted: TrashDisplayEntry[] = [];
    for (const entry of entries) {
      try {
        const username = entry.username ? await enc.decryptData(entry.username, key) : '';
        const url = entry.url ? await enc.decryptData(entry.url, key) : '';
        const tag = entry.tag ? await enc.decryptData(entry.tag, key).catch(() => entry.tag) : '';
        decrypted.push({
          id: entry.id,
          username,
          url,
          tag,
          deletedAt: entry.deletedAt,
        });
      } catch {
        // 单条解密失败时降级展示
        decrypted.push({
          id: entry.id,
          username: t('message.decryptFailed'),
          url: '',
          tag: '',
          deletedAt: entry.deletedAt,
        });
      }
    }
    trashList.value = decrypted;
  } catch (error) {
    logger.error('加载回收站失败:', error);
    ElMessage.error(t('options.trash.loadFailed'));
  } finally {
    loading.value = false;
  }
};

/** 格式化日期 */
const formatDate = (timestamp: number): string => {
  return formatDateCompact(timestamp);
};

/** 计算剩余天数 */
const getRemainingDays = (deletedAt: number): number => {
  const elapsed = Date.now() - deletedAt;
  const remaining = RETENTION_DAYS - Math.floor(elapsed / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
};

/** 恢复条目 */
const handleRestore = async (id: string) => {
  try {
    await restoreFromTrash([id]);
    ElMessage.success(t('options.trash.restored'));
    await loadTrash();
    emit('restored');
  } catch (error) {
    logger.error('恢复条目失败:', error);
    ElMessage.error(t('options.trash.restoreFailed'));
  }
};

/** 彻底删除条目 */
const handlePermanentDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm(t('options.trash.deleteConfirm'), t('options.trash.deleteConfirmTitle'), {
      confirmButtonText: t('options.trash.deleteForever'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    });
    await permanentDeleteFromTrash([id]);
    ElMessage.success(t('options.trash.deleted'));
    await loadTrash();
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('彻底删除失败:', error);
      ElMessage.error(t('message.deleteFailed'));
    }
  }
};

/** 清空回收站 */
const handleEmptyTrash = async () => {
  try {
    await ElMessageBox.confirm(t('options.trash.emptyConfirm'), t('options.trash.emptyConfirmTitle'), {
      confirmButtonText: t('options.trash.emptyAction'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    });
    await emptyTrash();
    ElMessage.success(t('options.trash.emptied'));
    trashList.value = [];
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('清空回收站失败:', error);
      ElMessage.error(t('options.trash.emptyFailed'));
    }
  }
};

/** 弹窗打开时加载数据 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      loadTrash();
    }
  },
);
</script>

<style scoped>
.trash-content {
  min-height: 200px;
}

.trash-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.trash-footer {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

.trash-stats {
  margin-bottom: 8px;
  font-size: 12px;
  color: #909399;
}

.trash-date {
  font-size: 12px;
  color: #606266;
}

/* 表格操作列按钮紧凑 */
.trash-table :deep(.el-button + .el-button) {
  margin-left: 6px;
}
</style>
