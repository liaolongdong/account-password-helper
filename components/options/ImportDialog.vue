<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('options.import.title')"
    width="920px"
    align-center
    class="import-dialog"
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
            <p>{{ t('options.import.noteLine1') }}</p>
            <p>{{ t('options.import.noteLine2') }}</p>
          </template>
        </el-alert>

        <!-- 格式选择 -->
        <div class="format-selector">
          <span class="format-label">{{ t('options.import.formatLabel') }}</span>
          <el-select
            v-model="importFormat"
            style="width: 200px"
            size="default"
          >
            <el-option
              :label="t('options.import.autoDetect')"
              value="auto"
            />
            <el-option
              :label="t('options.import.nativeTemplate')"
              value="native"
            />
            <el-option
              :label="t('options.import.chromePasswords')"
              value="chrome"
            />
            <el-option
              label="LastPass"
              value="lastpass"
            />
            <el-option
              label="Bitwarden"
              value="bitwarden"
            />
            <el-option
              label="1Password"
              value="1password"
            />
          </el-select>
        </div>

        <!-- 拖拽上传区域 -->
        <div class="upload-area">
          <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :show-file-list="false"
            :limit="1"
            accept=".csv,.json"
            @change="handleFileChange"
          >
            <div class="upload-dragger-content">
              <el-icon class="upload-icon"><Upload /></el-icon>
              <div class="upload-text">
                <span>{{ t('options.import.dragText') }}</span>
                <em>{{ t('options.import.clickText') }}</em>
              </div>
              <div class="upload-hint">{{ t('options.import.acceptHint') }}</div>
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
              <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
              <el-icon
                v-if="showPreviewPassword"
                style="margin-right: 4px"
              >
                <Hide />
              </el-icon>
              <el-icon
                v-else
                style="margin-right: 4px"
              >
                <View />
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
          :loading="loading"
          @click="handleImport"
        >
          {{
            loading ? t('options.import.importing') : t('options.import.confirmImport', { count: previewData.length })
          }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { Upload, Delete, Document, View, Hide } from '@element-plus/icons-vue';
import type { UploadFile } from 'element-plus';
import { ExcelUtils } from '@/utils/excel';
import type { ImportFormat } from '@/utils/excelFormatMap';
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
const loading = ref(false);
const previewData = ref<Omit<PasswordEntry, 'id' | 'order'>[]>([]);
const selectedFile = ref<File | undefined>(undefined);
const showPreviewPassword = ref(false);
const importFormat = ref<ImportFormat | 'native'>('auto');

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

// 处理文件选择
const handleFileChange = async (file: UploadFile) => {
  if (!file.raw) return;

  try {
    const fileName = file.raw.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isJSON = fileName.endsWith('.json');

    let data: Omit<PasswordEntry, 'id' | 'order'>[];
    if (isJSON) {
      // JSON 解析路径
      selectedFile.value = file.raw;
      const text = await file.raw.text();
      data = ExcelUtils.parseJSON(text);
    } else if (isCSV) {
      // CSV 解析路径
      selectedFile.value = file.raw;
      const buffer = await file.raw.arrayBuffer();
      data = ExcelUtils.parseCSV(buffer, importFormat.value as ImportFormat);
    } else {
      ElMessage.error(t('options.import.unsupportedFormat'));
      selectedFile.value = undefined;
      if (uploadRef.value) {
        uploadRef.value.clearFiles();
      }
      return;
    }
    previewData.value = data;

    if (data.length === 0) {
      ElMessage.warning(t('options.import.noValidData'));
    } else {
      ElMessage.success(t('options.import.parseSuccess', { count: data.length }));
      // 有有效数据时，等 DOM 和 el-table 完全渲染后自动滚动弹窗内容区到底部
      await nextTick();
      setTimeout(() => {
        const dialogBody = document.querySelector('.import-dialog .dialog-body-scroll');
        if (dialogBody) {
          dialogBody.scrollTo({ top: dialogBody.scrollHeight, behavior: 'smooth' });
        }
      }, 150);
    }
  } catch (error) {
    logger.error('解析文件失败:', error);
    ElMessage.error(t('options.import.parseFailed'));
    previewData.value = [];
  }
};

// 处理文件移除
const handleFileRemove = () => {
  previewData.value = [];
  selectedFile.value = undefined;
  if (uploadRef.value) {
    uploadRef.value.clearFiles();
  }
};

// 监听导入格式变化，自动重新解析已选文件
watch(importFormat, () => {
  if (selectedFile.value) {
    // 重新解析当前文件（使用新格式）
    const fakeUploadFile = { raw: selectedFile.value } as UploadFile;
    handleFileChange(fakeUploadFile);
  }
});

// 处理导入
const handleImport = async () => {
  if (previewData.value.length === 0 || !selectedFile.value) return;

  try {
    loading.value = true;

    // 批量保存密码（单次读写，避免逐条 savePassword 导致的 O(M×N) 数据搬运）
    await StorageUtils.batchSavePasswords(previewData.value);

    ElMessage.success(t('options.import.importSuccess', { count: previewData.value.length }));
    emit('imported');
    handleClose();
  } catch (error) {
    logger.error('导入失败:', error);
    ElMessage.error(t('options.import.importFailed'));
  } finally {
    loading.value = false;
  }
};

// 处理关闭
const handleClose = () => {
  dialogVisible.value = false;
  previewData.value = [];
  selectedFile.value = undefined;
  showPreviewPassword.value = false;
  importFormat.value = 'auto';
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

:deep(.el-alert ul) {
  padding-left: 16px;
  margin: 8px 0;
}

:deep(.el-alert li) {
  margin: 4px 0;
}

:deep(.el-alert__description) {
  line-height: 1;
}

/* 格式选择器 */
.format-selector {
  display: flex;
  gap: 8px;
  align-items: center;
}

.format-label {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  white-space: nowrap;
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
