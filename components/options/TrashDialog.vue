<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.trash.title')"
    width="920px"
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
        {{ t('options.trash.total', { count: totalCount }) }}
      </div>
      <el-table
        v-if="trashList.length > 0 || loading"
        v-loading="loading"
        :data="pagedEntries"
        stripe
        size="small"
        max-height="400"
        row-key="id"
        :empty-text="t('common.noData')"
        class="trash-table"
      >
        <el-table-column
          :label="t('common.username')"
          prop="username"
          min-width="100"
          show-overflow-tooltip
        />
        <el-table-column
          :label="t('common.url')"
          prop="url"
          min-width="120"
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
          width="110"
          align="center"
        >
          <template #default="{ row }">
            <span class="trash-date">{{ row.deletedDate }}</span>
          </template>
        </el-table-column>
        <el-table-column
          :label="t('options.trash.remainingDays')"
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
      <!--
        分页条与密码表共用 `VaultPagination`：回收站没有跨页选中概念，
        `selected-count` / `off-page-selected-count` 走组件默认值 0。
      -->
      <VaultPagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-count="pageCount"
        :total-count="totalCount"
      />
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
import { computed, ref, watch } from 'vue';
import {
  getTrashEntries,
  restoreFromTrash,
  permanentDeleteFromTrash,
  emptyTrash,
  getTrashRemainingDays,
} from '@/utils/storage/trashManager';
import { getSessionDataKey } from '@/utils/storage/facades';
import { formatDate as formatDateYmd } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import { lazyImport } from '@/utils/lazyImport';
import { useI18n } from '@/utils/i18n';
import { isVaultCapacityError, MAX_PASSWORD_ENTRIES } from '@/utils/storage/vaultCapacity';
import { useVaultListPagination } from '@/composables/useVaultListPagination';
import { useVaultPageSize } from '@/composables/useVaultPageSize';
import VaultPagination from '@/components/options/VaultPagination.vue';

const _getEncryption = lazyImport(() => import('@/utils/encryption'));

const { t } = useI18n();

/**
 * 回收站对话框
 *
 * 展示已删除的密码条目，支持恢复、彻底删除和清空回收站。
 * 条目在回收站中保留 30 天后自动清理（保留期与倒计时同读
 * `trashManager` 的 `TRASH_RETENTION_DAYS`，避免两处各写一份 30）。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 条目恢复后通知父组件重新加载密码列表 */
  restored: [];
}>();

/**
 * 解密后的回收站条目（用于 UI 展示）
 *
 * `deletedDate` 与 `remainingDays` 在加载时一次算好随行携带：表格每行都要读这两个值，
 * 放在模板里就是「每次重渲染 × 每行 × 一次 `Date.now()` + 字符串拼接」，
 * 而回收站列表在勾选/翻页/提示刷新时会被反复重渲染。
 */
interface TrashDisplayEntry {
  id: string;
  username: string;
  url: string;
  tag: string;
  /** 删除日期（YYYY-MM-DD） */
  deletedDate: string;
  /** 剩余保留天数（以本次加载时刻为准） */
  remainingDays: number;
}

const loading = ref(false);
const trashList = ref<TrashDisplayEntry[]>([]);

/**
 * 分页（与管理页密码表同一套口径：默认每页 100，可切 50/100/200）
 *
 * 复位信号取「弹窗打开」而不是列表长度：恢复/彻底删除后仍要重新 `loadTrash()`，
 * 那属于就地编辑级别的口径，刻意不把用户送回第 1 页；越界由 `pageCount` 钳位兜住。
 *
 * 档位与密码表是**同一个用户偏好**（同一个存储键），但分页状态是本弹窗自己的实例，
 * 所以每次打开先按落盘值对齐一次；这里换档位也会写回同一个键，关闭弹窗时由 `App.vue`
 * 让主表跟上，避免「刚在回收站选了 200，回到列表还是 100」。
 */
const { currentPage, pageSize, totalCount, pageCount, pagedEntries } = useVaultListPagination(
  trashList,
  computed(() => props.modelValue),
);

const { restorePageSize } = useVaultPageSize(pageSize);

/**
 * 加载回收站条目（解密敏感字段用于展示）
 *
 * 使用会话数据密钥解密 username/url/tag，会话无效时显示占位符。
 * 主密码验证由调用方（App.vue 菜单命令处理）在弹窗打开前完成。
 */
const loadTrash = async () => {
  loading.value = true;
  try {
    const entries = await getTrashEntries();
    // 一次取样：同一屏的倒计时必须相对同一时刻，否则行间会出现「同一批数据两种剩余天数」
    const now = Date.now();
    const key = await getSessionDataKey();

    /** 随行携带的展示派生值（日期与剩余天数只与 `deletedAt` 和取样时刻有关） */
    const displayOf = (entry: { id: string; deletedAt: number; tag?: string }) => ({
      id: entry.id,
      deletedDate: formatDateYmd(entry.deletedAt),
      remainingDays: getTrashRemainingDays(entry.deletedAt, now),
    });

    if (!key) {
      // 会话无效，无法解密，展示占位符
      trashList.value = entries.map(entry => ({
        ...displayOf(entry),
        username: t('options.trash.lockedPlaceholder'),
        url: '•••',
        tag: entry.tag || '',
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
        decrypted.push({ ...displayOf(entry), username, url, tag });
      } catch {
        // 单条解密失败时降级展示
        decrypted.push({ ...displayOf(entry), username: t('message.decryptFailed'), url: '', tag: '' });
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

/** 恢复条目 */
const handleRestore = async (id: string) => {
  try {
    await restoreFromTrash([id]);
    ElMessage.success(t('options.trash.restored'));
    await loadTrash();
    emit('restored');
  } catch (error) {
    logger.error('恢复条目失败:', error);
    ElMessage.error(
      isVaultCapacityError(error)
        ? t('options.capacity.restoreBlocked', { max: MAX_PASSWORD_ENTRIES })
        : t('options.trash.restoreFailed'),
    );
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

/** 弹窗打开时按落盘档位对齐，并加载数据 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      // 与 `loadTrash()` 同一个 watcher：档位决定这次渲染多少行，必须在数据落地前对齐，
      // 且不给本组件新增第二个监听器。
      void restorePageSize();
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
