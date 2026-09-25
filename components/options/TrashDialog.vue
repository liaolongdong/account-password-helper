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

      <!-- 工具行：关键词检索 + 计数读数（回收站为空时整行不出现，保持原有空态） -->
      <div
        v-if="trashList.length > 0"
        class="trash-toolbar"
      >
        <el-input
          v-if="isSearchable"
          v-model="searchKeyword"
          class="trash-search"
          :placeholder="t('options.trash.searchPlaceholder')"
          :prefix-icon="Search"
          clearable
        />
        <span class="trash-stats">
          {{
            hasKeyword
              ? t('options.trash.matchedCount', { matched: totalCount, total: trashList.length })
              : t('options.trash.total', { count: totalCount })
          }}
        </span>
      </div>
      <el-table
        v-if="trashList.length > 0 || loading"
        v-loading="loading"
        :data="pagedEntries"
        stripe
        size="small"
        max-height="400"
        row-key="id"
        :empty-text="hasKeyword ? t('options.trash.searchNoMatch') : t('common.noData')"
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
import { computed, onScopeDispose, ref, watch } from 'vue';
import { Search } from '@element-plus/icons-vue';
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
import { filterByKeyword, KEYWORD_DEBOUNCE_MS } from '@/utils/keywordMatch';
import { matchesKeyword } from '@/utils/searchMatch';
import { mapWithConcurrency } from '@/utils/concurrency';
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
 * 这一屏的行是否带明文可搜字段
 *
 * 会话无效时 `loadTrash()` 走占位符分支：username 是本地化占位文案、url 是「•••」、
 * tag 是原始密文。让这些值参与检索，用户输入 `•` 就命中全部行、输入一段 base64 又命中
 * 若干条密文标签——读起来像「检索坏了」。因此可搜性随这一屏一起决定，而不是另加一层
 * 「占位符排除」规则；`displayEntries` 同样以它为门，防止会话在弹窗存续期间失效后，
 * 残留关键词继续在占位符上做过滤。
 */
const isSearchable = ref(false);

/** 检索关键词（输入框即时值）与其防抖副本，防抖理由见下方 `searchKeyword` 的 watcher */
const searchKeyword = ref('');
const debouncedKeyword = ref('');

/** 生效关键词：锁定那一屏没有明文可搜，检索与它的读数一起悬空 */
const activeKeyword = computed(() => (isSearchable.value ? debouncedKeyword.value : ''));

/** 是否存在生效中的关键词：驱动空态文案与计数读数 */
const hasKeyword = computed(() => !!activeKeyword.value.trim());

/**
 * 关键词防抖：与密码表共用 `KEYWORD_DEBOUNCE_MS`
 *
 * 输入框保持即时回显（`v-model` 挂在 `searchKeyword` 上），只有驱动过滤的副本延后落地。
 * 回收站同样受「整表按引用换 data 会重排当前已渲染行」的成本约束（见
 * `composables/useVaultListPagination` 的存在理由），连续击键时不防抖就是每击一次键
 * 重排一页；时长取共享常量，避免两处对「手感是否跟手」给出两种答案。
 */
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchKeyword, value => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    debouncedKeyword.value = value;
  }, KEYWORD_DEBOUNCE_MS);
});

// 作用域销毁时清理未触发的防抖定时器，避免向已停用作用域赋值
onScopeDispose(() => clearTimeout(searchDebounceTimer));

/**
 * 关键词过滤后的展示列表
 *
 * 字段清单与判定口径由 `utils/keywordMatch.filterByKeyword` 单点持有，匹配器注入的是
 * 密码表那一份 `matchesKeyword`（含拼音），因此「密码表里搜得到」与「回收站里搜得到」
 * 不会各说一套。刻意只在已解密的三个字段里找：回收站弹窗不展示备注，也就没有为检索
 * 多解一类字段的理由——placeholder 因此把可搜范围写在台面上。
 */
const displayEntries = computed(() => filterByKeyword(trashList.value, activeKeyword.value, matchesKeyword));

/**
 * 分页（与管理页密码表同一套口径：默认每页 100，可切 50/100/200）
 *
 * 复位信号取「弹窗打开 + 生效关键词」：换关键词是一次口径变化，继续停在第 7 页只会读到
 * 空白；而恢复/彻底删除后仍要重新 `loadTrash()`，那属于就地编辑级别的口径，刻意不把用户
 * 送回第 1 页；越界由 `pageCount` 钳位兜住。
 *
 * 档位与密码表是**同一个用户偏好**（同一个存储键），但分页状态是本弹窗自己的实例，
 * 所以每次打开先按落盘值对齐一次；这里换档位也会写回同一个键，关闭弹窗时由 `App.vue`
 * 让主表跟上，避免「刚在回收站选了 200，回到列表还是 100」。
 */
const { currentPage, pageSize, totalCount, pageCount, pagedEntries } = useVaultListPagination(
  displayEntries,
  computed(() => `${props.modelValue ? 1 : 0}\u0000${activeKeyword.value}`),
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
      isSearchable.value = false;
      trashList.value = entries.map(entry => ({
        ...displayOf(entry),
        username: t('options.trash.lockedPlaceholder'),
        url: '•••',
        tag: entry.tag || '',
      }));
      return;
    }

    const enc = await _getEncryption();
    isSearchable.value = true;
    /**
     * 整库解密走受限并发：每条三个字段各一次 `crypto.subtle`，串行 `for … await` 的耗时
     * 因此随条目数线性累加（同口径实测：5N 串行在 2000 条时 705.0 ms、条目级并行 396.3 ms，
     * 见 `docs/PERF_ISSUE89_DATA_LAYER_EVALUATION.md` 3.3；本路径是 3N，量级按比例缩小），
     * 而这份列表是**关键词检索的前提**——没解密的字段搜不到，所以不能退化成「只解当前页」。
     * `mapWithConcurrency` 保证输出与入参同序，降级分支在 mapper 内部消化，语义与原串行一致。
     */
    trashList.value = await mapWithConcurrency(entries, async entry => {
      try {
        const username = entry.username ? await enc.decryptData(entry.username, key) : '';
        const url = entry.url ? await enc.decryptData(entry.url, key) : '';
        const tag = entry.tag ? await enc.decryptData(entry.tag, key).catch(() => entry.tag) : '';
        return { ...displayOf(entry), username, url, tag };
      } catch {
        // 单条解密失败时降级展示
        return { ...displayOf(entry), username: t('message.decryptFailed'), url: '', tag: '' };
      }
    });
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

/** 弹窗打开时按落盘档位对齐、清空上一次的检索词，并加载数据 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      // 三个动作共用这一个 watcher：档位决定这次渲染多少行，必须在数据落地前对齐；
      // 检索词与它一起归零，否则残留的关键词会让这次打开「什么都没删」似的只显示一小撮。
      // 两个副本同时赋值（而非只清输入框）是为了不等防抖落地，不把「过滤后的旧关键词结果」
      // 闪进这一帧。
      void restorePageSize();
      clearTimeout(searchDebounceTimer);
      searchKeyword.value = '';
      debouncedKeyword.value = '';
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

.trash-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.trash-search {
  width: 260px;
}

.trash-stats {
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
