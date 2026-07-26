<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('options.header.backupImport')"
    width="920px"
    align-center
    class="backup-import-dialog"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="dialog-body-scroll">
      <div class="import-content">
        <!-- 导入说明 -->
        <el-alert
          :title="t('options.import.noteTitle')"
          type="info"
          :closable="false"
          show-icon
        >
          <template #default>
            <p>{{ t('options.backupImport.noteLine1') }}</p>
            <p>{{ t('options.backupImport.noteLine2') }}</p>
          </template>
        </el-alert>

        <!-- 拖拽上传区域 -->
        <div class="upload-area">
          <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :show-file-list="false"
            :limit="1"
            accept=".aph"
            @change="handleFileChange"
          >
            <div class="upload-dragger-content">
              <el-icon class="upload-icon"><Upload /></el-icon>
              <div class="upload-text">
                <span>{{ t('options.import.dragText') }}</span>
                <em>{{ t('options.import.clickText') }}</em>
              </div>
              <div class="upload-hint">{{ t('options.backupImport.acceptHint') }}</div>
            </div>
          </el-upload>

          <!-- 文件信息展示 -->
          <div
            v-if="selectedFile"
            class="file-info"
          >
            <el-icon class="file-info-icon"><Document /></el-icon>
            <div class="file-info-detail">
              <span class="file-info-name">{{ selectedFile.name }}</span>
              <span class="file-info-size">{{ formatFileSize(selectedFile.size) }}</span>
            </div>
            <el-button
              type="danger"
              :icon="Delete"
              circle
              size="small"
              @click="handleFileRemove"
            />
          </div>
        </div>

        <!-- 主密码输入区（文件选择后才显示） -->
        <div
          v-if="selectedFile && previewData.length === 0"
          class="password-section"
        >
          <div class="password-label">{{ t('auth.masterPassword') }}</div>
          <el-input
            v-model="masterPassword"
            type="password"
            :placeholder="t('options.backupImport.passwordPlaceholder')"
            show-password
            :disabled="decrypting"
            @keyup.enter="handleDecrypt"
          >
            <!-- 状态语义：明文显示睁眼，密文显示闭眼 -->
            <template #password-icon="{ visible }">
              <el-icon>
                <View v-if="visible" />
                <Hide v-else />
              </el-icon>
            </template>
          </el-input>
          <el-button
            type="primary"
            :loading="decrypting"
            :disabled="!masterPassword.trim()"
            style="margin-top: 10px"
            @click="handleDecrypt"
          >
            {{ t('options.backupImport.decryptPreview') }}
          </el-button>
        </div>

        <!-- 预览数据 -->
        <div
          v-if="previewData.length > 0"
          class="preview-section"
        >
          <div class="preview-header">
            <h4>{{ t('options.import.previewTitle') }}</h4>
            <span class="preview-total">{{ t('options.import.previewTotal', { count: previewData.length }) }}</span>
          </div>
          <el-table
            :data="previewData.slice(0, 5)"
            style="width: 100%"
            stripe
            size="small"
          >
            <el-table-column
              prop="username"
              :label="t('common.username')"
              show-overflow-tooltip
              min-width="120"
            />
            <el-table-column
              prop="password"
              :label="t('common.password')"
              min-width="100"
            >
              <template #default="{ row }">
                <span>{{ showPreviewPassword ? row.password : '*'.repeat(8) }}</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="url"
              :label="t('common.url')"
              show-overflow-tooltip
              min-width="160"
            />
            <el-table-column
              prop="tag"
              :label="t('common.tag')"
              show-overflow-tooltip
              min-width="100"
            />
            <el-table-column
              prop="remark"
              :label="t('common.remark')"
              show-overflow-tooltip
              min-width="120"
            />
            <el-table-column
              prop="createTime"
              :label="t('sidepanel.createTime')"
              min-width="100"
            >
              <template #default="{ row }">
                {{ formatDate(row.createTime) }}
              </template>
            </el-table-column>
            <el-table-column
              prop="updateTime"
              :label="t('options.table.updateTime')"
              min-width="100"
            >
              <template #default="{ row }">
                {{ formatDate(row.updateTime) }}
              </template>
            </el-table-column>
          </el-table>
          <div class="preview-footer">
            <el-button
              type="primary"
              @click="showPreviewPassword = !showPreviewPassword"
            >
              <!-- 状态语义：明文显示睁眼，密文显示闭眼 -->
              <el-icon
                v-if="showPreviewPassword"
                style="margin-right: 4px"
              >
                <View />
              </el-icon>
              <el-icon
                v-else
                style="margin-right: 4px"
              >
                <Hide />
              </el-icon>
              {{ showPreviewPassword ? t('options.import.hidePassword') : t('options.import.showPassword') }}
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">{{ t('common.cancel') }}</el-button>
        <el-button
          type="success"
          :disabled="previewData.length === 0"
          :loading="importing"
          @click="handleImport"
        >
          {{
            importing ? t('options.import.importing') : t('options.import.confirmImport', { count: previewData.length })
          }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Upload, Delete, Document, View, Hide } from '@element-plus/icons-vue';
import type { UploadFile } from 'element-plus';
import { importEncryptedBackup } from '@/utils/backupExport';
import { StorageUtils } from '@/utils/storage';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import type { PasswordEntry } from '@/utils/types';
import { useI18n } from '@/utils/i18n';

interface Props {
  modelValue: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'imported'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useI18n();

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
});

const uploadRef = ref();
const decrypting = ref(false);
const importing = ref(false);
const previewData = ref<Omit<PasswordEntry, 'id' | 'order'>[]>([]);
const selectedFile = ref<File | undefined>(undefined);
const masterPassword = ref('');
const showPreviewPassword = ref(false);

/**
 * 格式化文件大小为可读字符串
 * @param bytes 文件字节数
 * @returns 格式化后的文件大小字符串
 */
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

/** 处理文件选择 */
const handleFileChange = async (file: UploadFile) => {
  if (!file.raw) return;
  const fileName = file.raw.name.toLowerCase();
  if (!fileName.endsWith('.aph')) {
    ElMessage.error(t('options.backupImport.unsupportedFormat'));
    if (uploadRef.value) {
      uploadRef.value.clearFiles();
    }
    return;
  }
  selectedFile.value = file.raw;
  previewData.value = [];
  masterPassword.value = '';
  // 文件选择后，密码输入区出现，等 DOM 渲染完毕后滚动弹窗内容区到底部
  await nextTick();
  setTimeout(() => {
    const dialogBody = document.querySelector('.backup-import-dialog .dialog-body-scroll');
    if (dialogBody) {
      dialogBody.scrollTo({ top: dialogBody.scrollHeight, behavior: 'smooth' });
    }
  }, 150);
};

/** 处理文件移除 */
const handleFileRemove = () => {
  previewData.value = [];
  selectedFile.value = undefined;
  masterPassword.value = '';
  if (uploadRef.value) {
    uploadRef.value.clearFiles();
  }
};

/** 解密并预览 */
const handleDecrypt = async () => {
  if (!selectedFile.value || !masterPassword.value.trim()) return;

  try {
    decrypting.value = true;
    const entries = await importEncryptedBackup(selectedFile.value, masterPassword.value.trim());

    if (entries.length === 0) {
      ElMessage.warning(t('options.backupImport.noValidData'));
      return;
    }

    previewData.value = entries;
    ElMessage.success(t('options.backupImport.decryptSuccess', { count: entries.length }));
    await nextTick();
    setTimeout(() => {
      const dialogBody = document.querySelector('.backup-import-dialog .dialog-body-scroll');
      if (dialogBody) {
        dialogBody.scrollTo({ top: dialogBody.scrollHeight, behavior: 'smooth' });
      }
    }, 150);
  } catch (error) {
    logger.error('解密备份文件失败:', error);
    const message = error instanceof Error ? error.message : t('options.backupImport.decryptFailed');
    ElMessage.error(message);
    previewData.value = [];
  } finally {
    decrypting.value = false;
  }
};

/** 确认导入 */
const handleImport = async () => {
  if (previewData.value.length === 0) return;

  try {
    importing.value = true;
    await StorageUtils.batchSavePasswords(previewData.value);
    ElMessage.success(t('options.import.importSuccess', { count: previewData.value.length }));
    emit('imported');
    handleClose();
  } catch (error) {
    logger.error('导入失败:', error);
    ElMessage.error(t('options.import.importFailed'));
  } finally {
    importing.value = false;
  }
};

/** 处理关闭 */
const handleClose = () => {
  dialogVisible.value = false;
  previewData.value = [];
  selectedFile.value = undefined;
  masterPassword.value = '';
  showPreviewPassword.value = false;
  if (uploadRef.value) {
    uploadRef.value.clearFiles();
  }
};
</script>

<style>
/* 非 scoped 样式块保留供其他全局覆盖使用，滚动样式已迁移至全局 styles.css */
</style>

<style scoped>
.import-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 导入说明 */
:deep(.el-alert__content) {
  font-size: 13px;
}

:deep(.el-alert__description) {
  line-height: 1;
}

/* 拖拽上传区域 */
.upload-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

:deep(.el-upload) {
  width: 100%;
}

:deep(.el-upload-dragger) {
  padding: 24px 0;
  border: 2px dashed var(--aph-primary-border);
  border-radius: 10px;
  transition: border-color 0.25s ease;
}

:deep(.el-upload-dragger:hover) {
  border-color: var(--aph-primary);
}

.upload-dragger-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.upload-icon {
  font-size: 40px;
  color: var(--aph-primary);
}

.upload-text {
  font-size: 14px;
  color: #606266;
}

.upload-text em {
  font-style: normal;
  font-weight: 500;
  color: var(--aph-primary);
}

.upload-hint {
  font-size: 12px;
  color: #909399;
}

/* 文件信息展示 */
.file-info {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  background: var(--aph-surface-hover);
  border: 1px solid var(--aph-primary-border);
  border-radius: 8px;
}

.file-info-icon {
  font-size: 20px;
  color: var(--aph-primary);
}

.file-info-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-info-name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  white-space: nowrap;
}

.file-info-size {
  font-size: 12px;
  color: #909399;
}

/* 主密码输入区 */
.password-section {
  display: flex;
  flex-direction: column;
}

.password-label {
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

/* 预览区域 */
.preview-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 10px;
}

.preview-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.preview-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.preview-total {
  font-size: 12px;
  color: #67c23a;
}

.preview-footer {
  display: flex;
  justify-content: flex-end;
}

/* 底部按钮 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
