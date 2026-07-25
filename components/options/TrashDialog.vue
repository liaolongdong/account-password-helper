<template>
  <el-dialog
    :model-value="modelValue"
    title="回收站"
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
        <el-empty description="回收站为空" />
      </div>

      <!-- 列表 -->
      <div
        v-if="trashList.length > 0"
        class="trash-stats"
      >
        共 {{ trashList.length }} 条记录
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
          label="用户名"
          prop="username"
          min-width="140"
          show-overflow-tooltip
        />
        <el-table-column
          label="网址"
          prop="url"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column
          label="标签"
          prop="tag"
          width="100"
          show-overflow-tooltip
        />
        <el-table-column
          label="删除时间"
          width="95"
          align="center"
        >
          <template #default="{ row }">
            <span class="trash-date">{{ formatDate(row.deletedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="剩余(天)"
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
          label="操作"
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
              恢复
            </el-button>
            <el-button
              type="danger"
              size="small"
              @click="handlePermanentDelete(row.id)"
            >
              删除
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
          清空回收站
        </el-button>
        <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TrashedPasswordEntry } from '@/utils/types';
import { getTrashEntries, restoreFromTrash, permanentDeleteFromTrash, emptyTrash } from '@/utils/storage/trashManager';
import { getSessionDataKey } from '@/utils/storage/facades';
import { formatDateCompact } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import { lazyImport } from '@/utils/lazyImport';

const _getEncryption = lazyImport(() => import('@/utils/encryption'));

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
        username: '•••（需验证主密码）',
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
          username: '解密失败',
          url: '',
          tag: '',
          deletedAt: entry.deletedAt,
        });
      }
    }
    trashList.value = decrypted;
  } catch (error) {
    logger.error('加载回收站失败:', error);
    ElMessage.error('加载回收站失败');
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
    ElMessage.success('已恢复到密码列表');
    await loadTrash();
    emit('restored');
  } catch (error) {
    logger.error('恢复条目失败:', error);
    ElMessage.error('恢复失败');
  }
};

/** 彻底删除条目 */
const handlePermanentDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('彻底删除后将无法恢复，确定吗？', '确认彻底删除', {
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await permanentDeleteFromTrash([id]);
    ElMessage.success('已彻底删除');
    await loadTrash();
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('彻底删除失败:', error);
      ElMessage.error('删除失败');
    }
  }
};

/** 清空回收站 */
const handleEmptyTrash = async () => {
  try {
    await ElMessageBox.confirm('清空后所有条目将无法恢复，确定清空回收站吗？', '确认清空', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await emptyTrash();
    ElMessage.success('回收站已清空');
    trashList.value = [];
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('清空回收站失败:', error);
      ElMessage.error('清空失败');
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
