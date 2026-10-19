<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('identity.trash.title')"
    width="min(680px, 94vw)"
    align-center
    :close-on-click-modal="false"
    @closed="handleClosed"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="identity-trash-content">
      <!-- 读取失败：与「确实为空」分开，给重试出口 -->
      <div
        v-if="!loading && loadFailed"
        class="identity-trash-empty"
      >
        <el-empty :description="t('identity.trash.loadFailed')">
          <el-button
            type="primary"
            @click="loadTrash"
          >
            {{ t('common.retry') }}
          </el-button>
        </el-empty>
      </div>

      <!-- 空态 -->
      <div
        v-else-if="!loading && rows.length === 0"
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
          v-loading="loading || mutating"
          :data="pagedRows"
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
            width="200"
            fixed="right"
            align="center"
          >
            <template #default="{ row }">
              <el-button
                type="primary"
                size="small"
                :disabled="loading || mutating"
                @click="handleRestore(row.id)"
              >
                {{ t('identity.trash.restore') }}
              </el-button>
              <el-button
                type="danger"
                size="small"
                :disabled="loading || mutating"
                @click="handlePermanentDelete(row.id)"
              >
                {{ t('identity.trash.deleteForever') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-if="rows.length > PAGE_SIZE"
          v-model:current-page="currentPage"
          class="identity-trash-pagination"
          :page-size="PAGE_SIZE"
          :total="rows.length"
          layout="prev, pager, next"
          small
          background
        />
      </template>
    </div>

    <template #footer>
      <div class="identity-trash-footer">
        <el-button
          v-if="rows.length > 0"
          type="danger"
          plain
          :disabled="loading || mutating"
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
import { computed, ref, watch } from 'vue';
import {
  getIdentityTrashEntriesStrict,
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
 * 主列表上限 30 条，但反复新增/删除可在 30 天保留期内积累更多回收站条目，因此
 * 表格按页渲染；关闭（含父弹窗关闭 / 会话锁定）即清空解密标题与分页状态。
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

/** 每页条数：与密码回收站/管理页的 100 行口径区分，回收站弹窗内容高度有限 */
const PAGE_SIZE = 50;

const loading = ref(false);
const mutating = ref(false);
const loadFailed = ref(false);
const currentPage = ref(1);
const rows = ref<TrashDisplayRow[]>([]);
/** 加载代际：关闭/重开时递增，迟到的解密结果不得写回已关闭弹窗 */
let loadEpoch = 0;

/** 当前页切片；行数变化后由 watch 把越界页码收回 */
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return rows.value.slice(start, start + PAGE_SIZE);
});

watch(
  () => rows.value.length,
  total => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage.value > pageCount) currentPage.value = pageCount;
  },
);

/** 清空解密数据与视图状态（关闭 / 父弹窗关闭 / 会话锁定） */
const clearState = (): void => {
  loadEpoch += 1;
  rows.value = [];
  currentPage.value = 1;
  loadFailed.value = false;
  mutating.value = false;
};

/** 加载回收站条目（解密标题与类别用于展示，会话无效时显示占位符） */
const loadTrash = async (): Promise<void> => {
  if (!props.modelValue) return;
  const epoch = ++loadEpoch;
  loading.value = true;
  loadFailed.value = false;
  try {
    const entries = await getIdentityTrashEntriesStrict();
    // 一次取样：同一屏的倒计时必须相对同一时刻，避免「同一批数据两种剩余天数」
    const now = Date.now();
    const key = await getSessionDataKey();
    const decrypted = key
      ? await decryptIdentityTrashTitles(entries, key, payload => identityDisplayTitle(payload, t))
      : entries.map(entry => ({ id: entry.id, title: null, category: '' }));

    if (epoch !== loadEpoch) return;
    rows.value = decrypted.map((item, index) => ({
      ...item,
      titleText: item.title ?? (key ? t('message.decryptFailed') : t('identity.trash.lockedPlaceholder')),
      deletedDate: formatDate(entries[index].deletedAt),
      remainingDays: getTrashRemainingDays(entries[index].deletedAt, now),
    }));
  } catch (error) {
    if (epoch !== loadEpoch) return;
    logger.error('加载身份信息回收站失败:', error);
    rows.value = [];
    loadFailed.value = true;
  } finally {
    if (epoch === loadEpoch) loading.value = false;
  }
};

/**
 * 恢复条目到身份库（回收站与主列表的变化统一经 changed 通知父组件）
 *
 * 与密码库回收站同口径：提示按 `restoreIdentitiesFromTrash` 返回的计数分三档，
 * 零恢复时不许弹「已恢复」——`restoreMissing` 那一档是唯一该让用户知道「找不回来了」的情形。
 */
const handleRestore = async (id: string): Promise<void> => {
  if (mutating.value) return;
  mutating.value = true;
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
  } finally {
    mutating.value = false;
  }
};

/** 彻底删除条目（不可恢复，二次确认） */
const handlePermanentDelete = async (id: string): Promise<void> => {
  if (mutating.value) return;
  mutating.value = true;
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
  } finally {
    mutating.value = false;
  }
};

/** 清空回收站（不可恢复，二次确认并播报条数） */
const handleEmptyTrash = async (): Promise<void> => {
  if (mutating.value) return;
  mutating.value = true;
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
  } finally {
    mutating.value = false;
  }
};

/** 关闭动画结束后释放解密标题与分页/错误状态 */
const handleClosed = (): void => {
  clearState();
};

/** 打开时重置并加载；关闭时立即清空，避免隐藏 DOM/组件状态继续驻留 PII */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      clearState();
      void loadTrash();
    } else {
      clearState();
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
  color: var(--aph-text-secondary, var(--el-text-color-secondary));
}

.identity-trash-date {
  font-size: 12px;
  color: var(--aph-text-primary, var(--el-text-color-primary));
}

.is-muted {
  color: var(--aph-text-secondary, var(--el-text-color-secondary));
}

.identity-trash-pagination {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

/* 表格操作列按钮紧凑 */
.identity-trash-table :deep(.el-button + .el-button) {
  margin-left: 6px;
}
</style>
