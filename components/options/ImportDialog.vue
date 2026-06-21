<template>
  <el-dialog
    v-model="dialogVisible"
    title="导入密码数据"
    width="920px"
    top="10vh"
    class="import-dialog"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="import-content">
      <!-- 导入说明 -->
      <el-alert
        title="导入说明"
        type="info"
        :closable="false"
        show-icon
      >
        <template #default>
          <p>支持 CSV 和 JSON 文件格式导入</p>
          <p>CSV 支持 Chrome、LastPass、Bitwarden、1Password 导出格式，也可自动检测</p>
        </template>
      </el-alert>

      <!-- 格式选择 -->
      <div class="format-selector">
        <span class="format-label">导入格式：</span>
        <el-select
          v-model="importFormat"
          style="width: 200px"
          size="default"
        >
          <el-option
            label="自动检测"
            value="auto"
          />
          <el-option
            label="自有模板"
            value="native"
          />
          <el-option
            label="Chrome 密码"
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
              <span>将文件拖拽到此处，或</span>
              <em>点击选择文件</em>
            </div>
            <div class="upload-hint">支持 .csv、.json 格式</div>
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
          <h4>预览数据（前5条）</h4>
          <span class="preview-total">共 {{ previewData.length }} 条有效数据</span>
        </div>
        <el-table
          :data="previewData.slice(0, 5)"
          style="width: 100%"
          stripe
          size="small"
        >
          <el-table-column
            prop="username"
            label="用户名"
            show-overflow-tooltip
            min-width="120"
          />
          <el-table-column
            prop="password"
            label="密码"
            min-width="100"
          >
            <template #default="{ row }">
              <span>{{ showPreviewPassword ? row.password : '*'.repeat(8) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="url"
            label="网址"
            show-overflow-tooltip
            min-width="160"
          />
          <el-table-column
            prop="tag"
            label="标签"
            show-overflow-tooltip
            min-width="100"
          />
          <el-table-column
            prop="remark"
            label="备注"
            show-overflow-tooltip
            min-width="120"
          />
          <el-table-column
            prop="createTime"
            label="创建时间"
            min-width="100"
          >
            <template #default="{ row }">
              {{ formatDate(row.createTime) }}
            </template>
          </el-table-column>
          <el-table-column
            prop="updateTime"
            label="更新时间"
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
            {{ showPreviewPassword ? '隐藏密码' : '显示密码' }}
          </el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="success"
          :disabled="previewData.length === 0"
          :loading="loading"
          @click="handleImport"
        >
          {{ loading ? '导入中...' : `确认导入（${previewData.length} 条）` }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Upload, Delete, Document, View, Hide } from '@element-plus/icons-vue';
import type { UploadFile } from 'element-plus';
import { ExcelUtils, type ImportFormat } from '@/utils/excel';
import { StorageUtils } from '@/utils/storage';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import type { PasswordEntry } from '@/utils/types';

interface Props {
  modelValue: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'imported'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

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
    selectedFile.value = file.raw;
    const fileName = file.raw.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isJSON = fileName.endsWith('.json');

    let data: Omit<PasswordEntry, 'id' | 'order'>[];
    if (isJSON) {
      // JSON 解析路径
      const text = await file.raw.text();
      data = ExcelUtils.parseJSON(text);
    } else if (isCSV) {
      // CSV 解析路径
      const text = await file.raw.text();
      data = ExcelUtils.parseCSV(text, importFormat.value as ImportFormat);
    } else {
      ElMessage.error('不支持的文件格式，请使用 CSV 或 JSON 文件');
      return;
    }
    previewData.value = data;

    if (data.length === 0) {
      ElMessage.warning('文件中没有找到有效的密码数据');
    } else {
      ElMessage.success(`解析成功，共找到 ${data.length} 条有效数据`);
      // 有有效数据时，等 DOM 和 el-table 完全渲染后自动滚动弹窗内容区到底部
      await nextTick();
      setTimeout(() => {
        const dialogBody = document.querySelector('.import-dialog .el-dialog__body');
        if (dialogBody) {
          dialogBody.scrollTo({ top: dialogBody.scrollHeight, behavior: 'smooth' });
        }
      }, 150);
    }
  } catch (error) {
    logger.error('解析文件失败:', error);
    ElMessage.error('文件解析失败，请检查文件格式');
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

// 处理导入
const handleImport = async () => {
  if (previewData.value.length === 0 || !selectedFile.value) return;

  try {
    loading.value = true;

    // 批量保存密码
    for (const passwordData of previewData.value) {
      await StorageUtils.savePassword(passwordData);
    }

    ElMessage.success(`成功导入 ${previewData.value.length} 条密码`);
    emit('imported');
    handleClose();
  } catch (error) {
    logger.error('导入失败:', error);
    ElMessage.error('导入失败，请重试');
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
/* 非 scoped 样式：el-dialog__body 是组件内部元素，scoped 选择器无法穿透 */
.import-dialog .el-dialog__body {
  max-height: 60vh;
  padding: 16px 20px;
  overflow-y: auto;
}
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
  border: 2px dashed #d9ecff;
  border-radius: 10px;
  transition: border-color 0.25s ease;
}

:deep(.el-upload-dragger:hover) {
  border-color: #409eff;
}

.upload-dragger-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.upload-icon {
  font-size: 40px;
  color: #409eff;
}

.upload-text {
  font-size: 14px;
  color: #606266;
}

.upload-text em {
  font-style: normal;
  font-weight: 500;
  color: #409eff;
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
  background: #f0f9ff;
  border: 1px solid #d9ecff;
  border-radius: 8px;
}

.file-info-icon {
  font-size: 20px;
  color: #409eff;
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
