<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.historySetting.title')"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="auto"
        size="large"
      >
        <el-form-item :label="t('options.historySetting.enabled')">
          <el-switch v-model="config.enabled" />
        </el-form-item>
        <el-form-item :label="t('options.historySetting.maxCount')">
          <el-input-number
            v-model="config.maxCount"
            :min="1"
            :max="10"
            :step="1"
            :disabled="!config.enabled"
            style="width: 100%"
          />
          <div class="form-tip">
            {{ t('options.historySetting.maxCountTip') }}
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
import { getPasswordHistoryConfig, savePasswordHistoryConfig } from '@/utils/storage/configManager';
import type { PasswordHistoryConfig } from '@/utils/types';
import { DEFAULT_PASSWORD_HISTORY_CONFIG } from '@/utils/storage/configManager';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const config = ref<PasswordHistoryConfig>({ ...DEFAULT_PASSWORD_HISTORY_CONFIG });
const saveLoading = ref(false);

/** 加载配置 */
const loadConfig = async () => {
  try {
    config.value = await getPasswordHistoryConfig();
  } catch (error) {
    logger.error('加载密码历史配置失败:', error);
    config.value = { ...DEFAULT_PASSWORD_HISTORY_CONFIG };
  }
};

/**
 * 保存配置
 *
 * 保存前验证主密码，验证通过后才允许修改设置。
 */
const handleSave = async (): Promise<void> => {
  // 保存前验证主密码
  const masterPassword = await promptAndVerifyMasterPassword(
    t('options.historySetting.verifyTitle'),
    t('options.historySetting.verifySavePrompt'),
  );
  if (!masterPassword) return;

  saveLoading.value = true;
  try {
    await savePasswordHistoryConfig({
      enabled: config.value.enabled,
      maxCount: config.value.maxCount,
    });
    ElMessage.success(t('options.historySetting.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('保存密码历史配置失败:', error);
    ElMessage.error(t('message.saveFailed'));
  } finally {
    saveLoading.value = false;
  }
};

/** 弹窗打开时加载配置 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      loadConfig();
    }
  },
);
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
