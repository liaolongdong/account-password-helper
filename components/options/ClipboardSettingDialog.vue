<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.clipboard')"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <!-- label-width auto：中英文标签宽度差异大（如 Auto-clear clipboard），按最长标签自适应 -->
      <el-form
        label-width="auto"
        size="large"
      >
        <el-form-item :label="t('options.clipboard.autoClear')">
          <el-switch
            v-model="autoClear"
            :active-text="t('common.on')"
            :inactive-text="t('common.off')"
          />
          <div class="form-tip">{{ t('options.clipboard.autoClearTip') }}</div>
        </el-form-item>

        <el-form-item
          v-if="autoClear"
          :label="t('options.clipboard.clearDelay')"
        >
          <el-select
            v-model="clearAfterSeconds"
            style="width: 100%"
          >
            <el-option
              :label="t('options.clipboard.sec', { n: 10 })"
              :value="10"
            />
            <el-option
              :label="t('options.clipboard.sec', { n: 15 })"
              :value="15"
            />
            <el-option
              :label="t('options.clipboard.sec', { n: 30 })"
              :value="30"
            />
            <el-option
              :label="t('options.clipboard.sec', { n: 60 })"
              :value="60"
            />
            <el-option
              :label="t('options.clipboard.sec', { n: 120 })"
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
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saveLoading"
          @click="handleSave"
        >
          {{ t('common.save') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

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
    ElMessage.error(t('message.loadConfigFailed'));
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
    ElMessage.success(
      autoClear.value
        ? t('options.clipboard.savedOn', { n: clearAfterSeconds.value })
        : t('options.clipboard.savedOff'),
    );
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('ClipboardSettingDialog: 保存配置失败:', error);
    ElMessage.error(t('message.saveFailed'));
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
