<template>
  <el-dialog
    :model-value="modelValue"
    title="剪贴板设置"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="140px"
        size="large"
      >
        <el-form-item label="自动清除剪贴板">
          <el-switch
            v-model="autoClear"
            active-text="开启"
            inactive-text="关闭"
          />
          <div class="form-tip">复制密码后，将在指定时间后自动清除剪贴板内容，防止密码残留</div>
        </el-form-item>

        <el-form-item
          v-if="autoClear"
          label="清除延时"
        >
          <el-select
            v-model="clearAfterSeconds"
            style="width: 100%"
          >
            <el-option
              label="10 秒"
              :value="10"
            />
            <el-option
              label="15 秒"
              :value="15"
            />
            <el-option
              label="30 秒"
              :value="30"
            />
            <el-option
              label="60 秒"
              :value="60"
            />
            <el-option
              label="120 秒"
              :value="120"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saveLoading"
          @click="handleSave"
        >
          保存
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const autoClear = ref(true);
const clearAfterSeconds = ref(30);
const saveLoading = ref(false);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    const config = await StorageUtils.getClipboardConfig();
    autoClear.value = config.autoClear;
    clearAfterSeconds.value = config.clearAfterSeconds;
  } catch (error) {
    logger.error('ClipboardSettingDialog: 加载配置失败:', error);
    ElMessage.error('加载配置失败');
  }
};

// 监听弹窗打开时加载配置
watch(
  () => props.modelValue,
  visible => {
    if (visible) loadConfig();
  },
  { immediate: true },
);

/**
 * 保存配置
 */
const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    await StorageUtils.saveClipboardConfig({
      autoClear: autoClear.value,
      clearAfterSeconds: clearAfterSeconds.value,
    });
    ElMessage.success(autoClear.value ? `已设置复制后 ${clearAfterSeconds.value} 秒自动清除` : '已关闭剪贴板自动清除');
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('ClipboardSettingDialog: 保存配置失败:', error);
    ElMessage.error('保存失败');
  } finally {
    saveLoading.value = false;
  }
};
</script>

<style scoped>
.form-tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

.dialog-body-scroll {
  max-height: 60vh;
  padding-right: 4px;
  overflow-y: auto;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
