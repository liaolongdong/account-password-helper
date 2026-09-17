<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('identity.title')"
    width="760px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="handleClosed"
  >
    <div class="identity-content">
      <!-- 顶部工具栏：类别过滤 + 搜索 + 添加 -->
      <div class="identity-toolbar">
        <el-radio-group
          v-model="categoryFilter"
          size="small"
          class="identity-toolbar__filter"
        >
          <el-radio-button value="all">{{ t('identity.filter.all') }}</el-radio-button>
          <el-radio-button value="person">{{ t('identity.category.person') }}</el-radio-button>
          <el-radio-button value="id_card">{{ t('identity.category.id_card') }}</el-radio-button>
          <el-radio-button value="bank_card">{{ t('identity.category.bank_card') }}</el-radio-button>
          <el-radio-button value="address">{{ t('identity.category.address') }}</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          clearable
          :placeholder="t('identity.searchPlaceholder')"
          class="identity-toolbar__search"
        />
        <el-button
          type="primary"
          :icon="Plus"
          @click="$emit('add')"
        >
          {{ t('identity.add') }}
        </el-button>
      </div>

      <!-- 备份提醒条：仅在有条目时显示，缓解「身份信息无自动备份」的真实损害 -->
      <el-alert
        v-if="rows.length > 0"
        type="info"
        :closable="false"
        :title="t('identity.backupReminder')"
        class="identity-reminder"
      />

      <!-- 状态栏：搜索命中计数（左，仅过滤时） + 条数上限指示（右） -->
      <div
        v-if="rows.length > 0"
        class="identity-meta"
      >
        <span v-if="filterActive">
          {{ t('identity.matchCount', { count: filteredRows.length }) }}
        </span>
        <span :class="['identity-meta__count', { 'is-limit': atLimit }]">
          {{
            atLimit
              ? t('identity.countAtLimit', { max: MAX_IDENTITIES })
              : t('identity.countIndicator', { count: rows.length, max: MAX_IDENTITIES })
          }}
        </span>
      </div>

      <!-- 选择栏：全选 + 已选/总数摘要（驱动导出作用域） + 展开/收起全部机密 -->
      <div
        v-if="rows.length > 0"
        class="identity-selectbar"
      >
        <el-checkbox
          :model-value="allVisibleSelected"
          :indeterminate="selectionIndeterminate"
          @change="selectAllVisible"
        >
          {{ t('identity.selectAll') }}
        </el-checkbox>
        <span class="identity-selectbar__summary">
          {{ t('identity.selection.summary', { selected: selectedCount, total: rows.length }) }}
        </span>
        <el-button
          v-if="canRevealAll"
          link
          size="small"
          class="identity-selectbar__reveal"
          @click="toggleRevealAll"
        >
          {{ allVisibleRevealed ? t('identity.hideAll') : t('identity.revealAll') }}
        </el-button>
      </div>

      <!-- 空态：未保存任何条目 -->
      <div
        v-if="!loading && rows.length === 0"
        class="identity-empty"
      >
        <el-empty :description="t('identity.empty')" />
      </div>

      <!-- 无匹配（有数据但被过滤） -->
      <div
        v-else-if="!loading && filteredRows.length === 0"
        class="identity-empty"
      >
        <el-empty :description="t('identity.noMatch')">
          <el-button
            v-if="filterActive"
            @click="clearFilters"
          >
            {{ t('identity.clearFilters') }}
          </el-button>
        </el-empty>
      </div>

      <!-- 条目卡片列表 -->
      <div
        v-else
        v-loading="loading"
        class="identity-list"
      >
        <div
          v-for="entry in filteredRows"
          :key="entry.id"
          class="identity-card"
        >
          <div class="identity-card__header">
            <el-checkbox
              class="identity-card__check"
              :aria-label="t('identity.selectOne')"
              :model-value="isSelected(entry.id)"
              @change="toggleSelect(entry.id)"
            />
            <div class="identity-card__title">
              <SearchHighlight
                :text="displayTitle(entry)"
                :keyword="keyword"
              />
              <el-tag
                size="small"
                effect="plain"
                class="identity-card__category"
              >
                {{ t(`identity.category.${entry.payload.category}`) }}
              </el-tag>
            </div>
            <div class="identity-card__actions">
              <el-button
                v-if="cardHasSecret(entry)"
                :icon="isRevealed(entry.id) ? Hide : View"
                :aria-label="isRevealed(entry.id) ? t('identity.hide') : t('identity.show')"
                link
                @click="toggleReveal(entry.id)"
              />
              <el-button
                :icon="DocumentCopy"
                :aria-label="t('identity.copyCard')"
                link
                @click="handleCopyCard(entry)"
              />
              <el-button
                :icon="Edit"
                :aria-label="t('common.edit')"
                link
                @click="$emit('edit', entry)"
              />
              <el-button
                :icon="Delete"
                :aria-label="t('common.delete')"
                link
                @click="handleDelete(entry)"
              />
            </div>
          </div>

          <el-descriptions
            :column="1"
            border
            class="identity-card__fields"
          >
            <el-descriptions-item
              v-for="field in buildFieldRows(entry)"
              :key="field.key"
              :label="field.label"
            >
              <div class="identity-field">
                <span
                  v-if="field.secret"
                  class="identity-field__text"
                >
                  {{ isRevealed(entry.id) ? field.value : MASK }}
                </span>
                <SearchHighlight
                  v-else
                  :text="field.value"
                  :keyword="keyword"
                />
                <el-button
                  :icon="CopyDocument"
                  :aria-label="t('common.copy')"
                  link
                  @click="copyField(field.value, field.secret)"
                />
              </div>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>

      <!-- 隐藏的文件输入：导入加密 .aphid 备份或明文 .json 导出（代码内二次校验扩展名） -->
      <input
        ref="fileInputRef"
        type="file"
        accept=".aphid,.json"
        class="identity-file-input"
        @change="handleFileChange"
      />
    </div>

    <template #footer>
      <div class="identity-footer">
        <div class="identity-footer__left">
          <el-button
            :icon="Download"
            :disabled="rows.length === 0"
            @click="handleExport"
          >
            {{ t('identity.export.action') }}
          </el-button>
          <el-button
            type="warning"
            plain
            :icon="WarnTriangleFilled"
            :disabled="rows.length === 0"
            @click="handleExportPlaintext"
          >
            {{ t('identity.export.plainAction') }}
          </el-button>
          <el-button
            :icon="Upload"
            @click="handleImport"
          >
            {{ t('identity.import.action') }}
          </el-button>
        </div>
        <el-button @click="$emit('update:modelValue', false)">{{ t('common.close') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CopyDocument,
  Delete,
  DocumentCopy,
  Download,
  Edit,
  Hide,
  Plus,
  Search,
  Upload,
  View,
  WarnTriangleFilled,
} from '@element-plus/icons-vue';
import type { IdentityEntry } from '@/utils/identity/types';
import { MAX_IDENTITIES } from '@/utils/identity/constants';
import { buildIdentityFieldRows, formatIdentityCardText, hasSecretFields } from '@/utils/identity/fields';
import {
  exportIdentityBackup,
  exportIdentityPlaintext,
  getIdentityBackupErrorCode,
  importIdentityBackup,
  mergeIdentityRecords,
  parseIdentityPlaintextJson,
  resolveExportEntries,
} from '@/utils/identity/backup';
import type { IdentityBackupData } from '@/utils/identity/backup';
import { replaceAllIdentity } from '@/utils/storage/identityCrud';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import SearchHighlight from '@/components/SearchHighlight.vue';
import type { IdentityVault } from '@/composables/useIdentityVault';

/**
 * 身份信息库列表弹窗
 *
 * 展示解密后的身份条目（类别过滤 + 搜索 + 卡级机密显隐 / 批量展开收起 + 整卡/逐字段复制 +
 * 勾选 + 删除；顶部状态栏显示搜索命中数与「已用 n/30」条数上限，无匹配时空态提供「清除筛选」）。
 * 眼睛按「卡片」为粒度切换该卡全部机密字段（设计如此，非 bug）；每卡复选框 + 工具栏
 * 全选驱动导出作用域——未勾选=导出全部，勾选=仅导出所选子集。footer 常驻备份导入/导出：
 * 加密 `.aphid` 走主密码解密；「导出明文（不推荐）」与导入均接受明文 `.json`，明文读写都设
 * 主密码复验 + 风险确认双重门槛。明文 `.json` 复用 `.aphid` 数据结构，导入按 id 合并回导。
 * 状态由 App.vue 的 useIdentityVault 单一实例注入
 * （props.vault），本组件不自行实例化，保证会话失效时 App.vue 侧 teardown() 与弹窗
 * 共享同一份内存明文并同步清空（R2）。
 */
const props = defineProps<{
  /** 弹窗显隐 */
  modelValue: boolean;
  /** 身份库共享实例（App.vue 创建） */
  vault: IdentityVault;
}>();

// 事件仅经模板 $emit 触发，无需脚本侧引用 emit 实例
defineEmits<{
  'update:modelValue': [value: boolean];
  /** 新增：请求打开表单弹窗（App.vue 处理） */
  add: [];
  /** 编辑：请求打开表单弹窗并带入条目 */
  edit: [entry: IdentityEntry];
}>();

const { t } = useI18n();

// 解构共享实例的 ref（模板中自动解包，脚本中经 .value 访问）
const {
  rows,
  loading,
  keyword,
  categoryFilter,
  filteredRows,
  selectedIds,
  selectedCount,
  allVisibleSelected,
  selectionIndeterminate,
  allVisibleRevealed,
} = props.vault;
const {
  displayTitle,
  isRevealed,
  toggleReveal,
  toggleRevealAll,
  isSelected,
  toggleSelect,
  selectAllVisible,
  clearSelection,
  clearFilters,
  copyField,
  copyCard,
  remove,
  resetViewState,
  load,
} = props.vault;

/** 统一掩码（'*' × 8，对标 PasswordTable / PasswordDetailDrawer） */
const MASK = '*'.repeat(8);

/** 字段行：复用 utils/identity/fields 展示模型，传入本组件 t 取标签（单一事实来源） */
const buildFieldRows = (entry: IdentityEntry) => buildIdentityFieldRows(entry, t);

/** 该卡片是否含机密字段（决定卡级显/隐眼睛是否出现；与批量展开/收起作用范围同源） */
const cardHasSecret = (entry: IdentityEntry) => hasSecretFields(entry.payload);

/** 是否已达条目上限（驱动条数指示切换为告警文案） */
const atLimit = computed(() => rows.value.length >= MAX_IDENTITIES);

/** 是否有过滤条件生效（搜索词或非「全部」类别，驱动命中计数与「清除筛选」） */
const filterActive = computed(() => keyword.value.trim() !== '' || categoryFilter.value !== 'all');

/** 可见卡片中是否存在含机密字段的卡（决定「展开 / 收起全部机密」是否出现） */
const canRevealAll = computed(() => filteredRows.value.some(cardHasSecret));

/**
 * 复制整条身份信息：拼成「标签: 值」多行文本一次性写入剪贴板
 *
 * 与逐字段复制一致——复制的是明文值本身，掩码仅为展示态，故未显隐的机密字段照样复制。
 * 整卡恒含 PII，一律走限时自动清除通道（见 copyCard）。
 */
const handleCopyCard = (entry: IdentityEntry): Promise<void> =>
  copyCard(formatIdentityCardText(buildIdentityFieldRows(entry, t)));

/** 当前导出作用域：未勾选→全部；已勾选→所选子集 */
const exportTargets = computed(() => resolveExportEntries(rows.value, selectedIds.value));

/** 弹窗打开时加载数据（对标 TrashDialog 的 watch modelValue） */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      void load();
    }
  },
);

/** 弹窗关闭动画结束后复位显隐/搜索/过滤（不含 rows，下次打开会重新 load） */
const handleClosed = (): void => {
  resetViewState();
};

/** 删除条目（二次确认 + 明说不可恢复） */
const handleDelete = async (entry: IdentityEntry): Promise<void> => {
  try {
    await ElMessageBox.confirm(t('identity.deleteConfirm'), t('identity.deleteConfirmTitle'), {
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    });
    await remove(entry.id);
    ElMessage.success(t('identity.deleteSuccess'));
  } catch (error) {
    if (error !== 'cancel') {
      logger.error('删除身份信息失败:', error);
      ElMessage.error(t('message.deleteFailed'));
    }
  }
};

/** 导出备份（加密 .aphid）：按当前导出作用域（未勾选=全部），主密码复验门槛 */
const handleExport = async (): Promise<void> => {
  const targets = exportTargets.value;
  if (targets.length === 0) {
    ElMessage.warning(t('message.noDataToBackup'));
    return;
  }
  const masterPassword = await promptAndVerifyMasterPassword(t('identity.export.title'), t('identity.export.prompt'));
  if (!masterPassword) return;
  try {
    await exportIdentityBackup(targets, masterPassword);
    clearSelection();
    ElMessage.success(t('identity.export.success'));
  } catch (error) {
    logger.error('导出身份信息备份失败:', error);
    ElMessage.error(t('identity.export.failed'));
  }
};

/**
 * 导出明文（不推荐）：非加密 JSON 落盘，属隐私边界例外通道。
 * 先弹风险提示（误点可在输入主密码前取消）→ 主密码复验 → 导出。
 */
const handleExportPlaintext = async (): Promise<void> => {
  const targets = exportTargets.value;
  if (targets.length === 0) {
    ElMessage.warning(t('message.noDataToBackup'));
    return;
  }
  try {
    await ElMessageBox.confirm(
      t('identity.export.plainWarning', { count: targets.length }),
      t('identity.export.plainWarningTitle'),
      {
        confirmButtonText: t('identity.export.plainConfirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  const masterPassword = await promptAndVerifyMasterPassword(
    t('identity.export.plainTitle'),
    t('identity.export.plainPrompt'),
  );
  if (!masterPassword) return;
  try {
    exportIdentityPlaintext(targets);
    clearSelection();
    ElMessage.success(t('identity.export.plainSuccess', { count: targets.length }));
  } catch (error) {
    logger.error('导出身份信息明文失败:', error);
    ElMessage.error(t('identity.export.plainFailed'));
  }
};

/** 隐藏文件输入引用（导入用） */
const fileInputRef = ref<HTMLInputElement | null>(null);

/** 触发文件选择 */
const handleImport = (): void => {
  fileInputRef.value?.click();
};

/**
 * 导入备份数据的共享写回流程：预览计数 → 风险确认 → 以磁盘当前态为基重合并 → 写回
 *
 * @param data 已解析（解密后的 .aphid，或明文 .json）的备份数据
 * @param plaintext 是否来自明文 .json：true 时确认弹窗额外提示「未加密明文 + 请确认来源可信」
 * @throws 用户在确认弹窗取消时抛出 'cancel'，由调用方 catch 静默处理
 */
const applyImportedData = async (data: IdentityBackupData, plaintext: boolean): Promise<void> => {
  // 预览计数基于当前内存快照（advisory，仅用于确认弹窗展示）
  const preview = mergeIdentityRecords(rows.value, data.records);
  if (preview.records.length > MAX_IDENTITIES) {
    ElMessage.error(t('identity.import.limitReached'));
    return;
  }

  const countArgs = {
    added: preview.added,
    updated: preview.updated,
    skipped: preview.skipped,
    total: preview.records.length,
  };
  await ElMessageBox.confirm(
    plaintext ? t('identity.import.plainPreviewDesc', countArgs) : t('identity.import.previewDesc', countArgs),
    plaintext ? t('identity.import.plainPreviewTitle') : t('identity.import.previewTitle'),
    {
      confirmButtonText: t('identity.import.confirmImport'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    },
  );

  // 确认到写回之间可能有其他 Options 标签页改动：写回前重新读取磁盘当前态作为 merge 基，
  // 避免用陈旧内存快照整体覆盖并发编辑（否则 replaceAll 会丢掉期间新增/修改的条目）
  await load();
  const merged = mergeIdentityRecords(rows.value, data.records);
  if (merged.records.length > MAX_IDENTITIES) {
    ElMessage.error(t('identity.import.limitReached'));
    return;
  }

  await replaceAllIdentity(merged.records);
  await load();
  ElMessage.success(t('identity.import.importSuccess', { count: merged.added + merged.updated }));
};

/** 导入：按扩展名分支——.aphid 走主密码解密导入，.json 走明文双门槛回导，共用同一写回流程 */
const handleFileChange = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const name = file.name.toLowerCase();

  try {
    if (name.endsWith('.aphid')) {
      const { value: password } = await ElMessageBox.prompt(
        t('identity.import.passwordPrompt'),
        t('identity.import.title'),
        {
          confirmButtonText: t('common.confirm'),
          cancelButtonText: t('common.cancel'),
          inputType: 'password',
          inputValidator: value => (value ? true : t('identity.import.passwordPrompt')),
        },
      );
      const data = await importIdentityBackup(file, password);
      await applyImportedData(data, false);
      return;
    }

    if (name.endsWith('.json')) {
      // 门槛一：主密码复验（纯身份门，丢弃返回的密码；取消或验证失败返回 null）
      const verified = await promptAndVerifyMasterPassword(
        t('identity.import.plainVerifyTitle'),
        t('identity.import.plainVerifyPrompt'),
      );
      if (!verified) return;
      // 解析不可信明文（不解密）；门槛二：applyImportedData 内的明文风险确认
      const data = parseIdentityPlaintextJson(await file.text());
      await applyImportedData(data, true);
      return;
    }

    ElMessage.error(t('identity.import.unsupportedFormat'));
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    const code = getIdentityBackupErrorCode(error);
    if (code) {
      const keyByCode: Record<string, string> = {
        WRONG_PASSWORD: 'identity.import.wrongPassword',
        NOT_APHID: 'identity.import.notAphid',
        INVALID_FILE: 'identity.import.invalidFile',
        INVALID_STRUCTURE: 'identity.import.invalidStructure',
        EXPORT_FAILED: 'identity.import.importFailed',
      };
      ElMessage.error(t(keyByCode[code] ?? 'identity.import.importFailed'));
    } else {
      logger.error('导入身份信息失败:', error);
      ElMessage.error(t('identity.import.importFailed'));
    }
  }
};
</script>

<style scoped>
.identity-content {
  min-height: 320px;
}

.identity-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.identity-toolbar__search {
  flex: 1;
  min-width: 0;
}

.identity-reminder {
  margin-bottom: 12px;
}

.identity-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.identity-meta__count {
  margin-left: auto;
}

.identity-meta__count.is-limit {
  color: var(--el-color-warning);
}

.identity-selectbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.identity-selectbar__summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.identity-selectbar__reveal {
  margin-left: auto;
}

.identity-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
}

.identity-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 55vh;
  padding-right: 4px;
  overflow-y: auto;
}

/* 条目卡片：对齐 PasswordTable 卡片观感（白底 + 主题描边 + 轻阴影 + hover 上浮） */
.identity-card {
  padding: 12px 16px;
  background: white;
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
  transition: transform 0.2s ease;
}

.identity-card:hover {
  transform: translateY(-2px);
}

.identity-card__header {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.identity-card__check {
  flex-shrink: 0;
  margin-right: 0;
}

.identity-card__title {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.identity-card__category {
  flex-shrink: 0;
}

.identity-card__actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

/* 字段行：文本 + 行内操作按钮（对标 PasswordDetailDrawer 的 .detail-value） */
.identity-field {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.identity-field__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-footer {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

.identity-footer__left {
  display: flex;
  gap: 8px;
}

.identity-file-input {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .identity-card {
    transition: none;
  }
}
</style>
