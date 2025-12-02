<template>
  <el-dialog
    v-model="dialogVisible"
    title="导入Excel"
    width="100vw"
    :fullscreen="true"
    class="import-dialog full-width-dialog"
    @close="handleClose"
  >
    <div class="import-content">
      <el-alert
        title="导入说明"
        type="info"
        :closable="false"
        show-icon
      >
        <template #default>
          <p>支持的Excel列名：</p>
          <ul>
            <li>用户名/username/Username/账号</li>
            <li>密码/password/Password</li>
            <li>URL/url/网址/链接</li>
            <li>标签/tag/Tag/分类</li>
            <li>备注/remark/Remark/说明</li>
          </ul>
          <p>其中用户名为必填项，其它字段均为选填项</p>
        </template>
      </el-alert>

      <div class="upload-area">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :show-file-list="true"
          :limit="1"
          accept=".xlsx,.xls"
          @change="handleFileChange"
        >
          <el-button :icon="Upload">选择Excel文件</el-button>
        </el-upload>
      </div>

      <div
        v-if="previewData.length > 0"
        class="preview-section"
      >
        <h4>预览数据 (前5条)</h4>
        <el-table
          :data="previewData.slice(0, 5)"
          style="width: 100%"
        >
          <el-table-column
            prop="username"
            label="用户名"
            show-overflow-tooltip
          />
          <el-table-column
            prop="password"
            label="密码"
            show-overflow-tooltip
          />
          <el-table-column
            prop="url"
            label="URL"
            show-overflow-tooltip
          />
          <el-table-column
            prop="tag"
            label="标签"
          />
          <el-table-column
            prop="remark"
            label="备注"
            show-overflow-tooltip
          />
          <el-table-column
            prop="createTime"
            label="创建时间"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ new Date(row.createTime).toLocaleDateString() }}
            </template>
          </el-table-column>
          <el-table-column
            prop="updateTime"
            label="更新时间"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ new Date(row.createTime).toLocaleDateString() }}
            </template>
          </el-table-column>
        </el-table>
        <p class="preview-info">共 {{ previewData.length }} 条有效数据</p>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          :disabled="previewData.length === 0"
          :loading="loading"
          @click="handleImport"
        >
          导入 ({{ previewData.length }})
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { Upload } from '@element-plus/icons-vue';
import type { UploadFile } from 'element-plus';
import { ExcelUtils } from '../utils/excel';
import { StorageUtils } from '../utils/storage';
import type { PasswordEntry } from '../utils/types';

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

// 处理文件选择
const handleFileChange = async (file: UploadFile) => {
  if (!file.raw) return;

  try {
    selectedFile.value = file.raw;
    const data = await ExcelUtils.importFromExcel(file.raw);
    console.log('🚀 ~ handleFileChange ~ data:', data);
    previewData.value = data;

    if (data.length === 0) {
      ElMessage.warning('Excel文件中没有找到有效的密码数据');
    } else {
      ElMessage.success(`解析成功，共找到 ${data.length} 条有效数据`);
    }
  } catch (error) {
    console.error('解析Excel失败:', error);
    ElMessage.error('Excel文件解析失败，请检查文件格式');
    previewData.value = [];
  }
};

// 处理文件删除（但不使用参数）
const handleFileRemove = () => {
  previewData.value = [];
  selectedFile.value = undefined;
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
    console.error('导入失败:', error);
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
  if (uploadRef.value) {
    uploadRef.value.clearFiles();
  }
};
</script>

<style scoped>
.upload-area {
  margin: 20px 0;
  text-align: center;
}

.preview-section {
  margin-top: 24px;
}

.preview-section h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #303133;
  text-align: center;
}

.preview-info {
  margin: 12px 0 0;
  font-size: 12px;
  color: #909399;
  text-align: center;
}

.dialog-footer {
  text-align: center;
}

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

/* 全屏宽度浅蓝色弹窗样式 */
:deep(.full-width-dialog) {
  --el-dialog-margin-top: 0;
}

:deep(.full-width-dialog .el-dialog) {
  width: 100vw !important;
  max-width: none;
  height: 100vh !important;
  margin: 0 !important;
  border: none;
  border-radius: 0;
  box-shadow: none;
  transform: none !important;
  transition: none !important;
  animation: none !important;
}

:deep(.full-width-dialog .el-overlay) {
  background-color: #f8fbff;
  transition: none !important;
  animation: none !important;
}

/* 弹窗内容区域优化 - 确保水平居中 */
:deep(.full-width-dialog .el-dialog__body) {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: calc(100vh - 160px);
  padding: 5vh 10vw;
  background: #f8fbff;
}

/* 弹窗头部优化 - 标题居中 */
:deep(.full-width-dialog .el-dialog__header) {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 24px 10vw;
  color: white;
  background: #409eff;
  border-bottom: none;
  border-radius: 0;
  text-align: center; /* 标题居中 */
}

:deep(.full-width-dialog .el-dialog__title) {
  font-size: 20px;
  font-weight: 500;
}

/* 弹窗底部优化 - 按钮居中 */
:deep(.full-width-dialog .el-dialog__footer) {
  position: sticky;
  bottom: 0;
  z-index: 100;
  padding: 24px 10vw;
  background: #fff;
  border-top: 1px solid #e3f2fd;
  text-align: center; /* 按钮居中 */
}

/* 内容容器优化 - 更好的水平居中效果 */
.import-content {
  width: 100%;
  max-width: 800px;
  margin: 0 auto; /* 确保容器自身居中 */
  padding: 40px;
  background: white;
  border: 1px solid #e3f2fd;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgb(64 158 255 / 10%);
}

/* 响应式设计 */
@media (width <= 768px) {
  :deep(.full-width-dialog .el-dialog__body) {
    padding: 5vh 5vw;
  }

  :deep(.full-width-dialog .el-dialog__header) {
    padding: 20px 5vw;
  }

  :deep(.full-width-dialog .el-dialog__footer) {
    padding: 20px 5vw;
  }

  .import-content {
    padding: 24px;
  }
}
</style>
