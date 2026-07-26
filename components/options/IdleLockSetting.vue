<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.idleLock')"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <!-- label-width auto：中英文标签宽度差异大（如 Lock on browser restart），按最长标签自适应 -->
      <el-form
        label-width="auto"
        size="large"
      >
        <el-form-item :label="t('options.idleLock.idleTime')">
          <el-select
            v-model="idleMinutes"
            style="width: 100%"
          >
            <el-option
              :label="t('options.idleLock.never')"
              :value="0"
            />
            <el-option
              :label="t('options.idleLock.min5')"
              :value="5"
            />
            <el-option
              :label="t('options.idleLock.min10')"
              :value="10"
            />
            <el-option
              :label="t('options.idleLock.min30')"
              :value="30"
            />
            <el-option
              :label="t('options.idleLock.min60')"
              :value="60"
            />
          </el-select>
          <div class="form-tip">{{ t('options.idleLock.idleTip') }}</div>
        </el-form-item>
        <el-form-item :label="t('options.idleLock.restartLock')">
          <el-switch v-model="relockOnBrowserRestart" />
          <div class="form-tip">
            {{ t('options.idleLock.restartTip') }}
          </div>
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

const idleMinutes = ref(0);
/** 关闭浏览器后是否需要重新输入主密码 */
const relockOnBrowserRestart = ref(false);
const saveLoading = ref(false);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    const config = await StorageUtils.getIdleLockConfig();
    idleMinutes.value = config.idleLockMinutes;
    relockOnBrowserRestart.value = config.relockOnBrowserRestart ?? false;
  } catch (error) {
    logger.error('IdleLockSetting: 加载配置失败:', error);
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
    await StorageUtils.saveIdleLockConfig({
      idleLockMinutes: idleMinutes.value,
      relockOnBrowserRestart: relockOnBrowserRestart.value,
    });
    ElMessage.success(t('options.idleLock.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('IdleLockSetting: 保存配置失败:', error);
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
