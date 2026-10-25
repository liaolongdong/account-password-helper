<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.identityAccess.title')"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="auto"
        size="large"
      >
        <el-form-item :label="t('options.identityAccess.policy')">
          <el-select
            v-model="verifyPolicy"
            style="width: 100%"
          >
            <el-option
              :label="t('options.identityAccess.policyAlways')"
              value="always"
            />
            <el-option
              :label="t('options.identityAccess.policyPerSession')"
              value="perSession"
            />
            <el-option
              :label="t('options.identityAccess.policyFollowValidity')"
              value="followValidity"
            />
          </el-select>
          <div class="form-tip">{{ policyTip }}</div>
          <!-- 放宽到「跟随有效期」是一次明确的降级，用警告色把它从常规说明里拎出来，
               口径与 IdleLockSetting 的 restartTip / diskNote 同一层级 -->
          <div
            v-if="verifyPolicy === 'followValidity'"
            class="form-tip__caution"
          >
            {{ t('options.identityAccess.cautionFollowValidity') }}
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
import { computed, ref, watch } from 'vue';
import type { IdentityVaultVerifyPolicy } from '@/utils/types';
import { DEFAULT_IDENTITY_VERIFY_POLICY } from '@/utils/identityVaultAccess';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

const verifyPolicy = ref<IdentityVaultVerifyPolicy>(DEFAULT_IDENTITY_VERIFY_POLICY);
const saveLoading = ref(false);

/** 当前档位的说明文字，随选择切换，避免三段说明同时堆在弹窗里 */
const policyTip = computed(() => {
  switch (verifyPolicy.value) {
    case 'always':
      return t('options.identityAccess.tipAlways');
    case 'followValidity':
      return t('options.identityAccess.tipFollowValidity');
    default:
      return t('options.identityAccess.tipPerSession');
  }
});

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    const config = await StorageUtils.getIdentityVaultAccessConfig();
    verifyPolicy.value = config.verifyPolicy;
  } catch (error) {
    logger.error('IdentityVaultAccessSetting: 加载配置失败:', error);
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
 *
 * 保存前必须复验主密码，且三档一律要（不是只约束放宽方向）：本设置决定的是
 * 「打开身份库前问不问」，若改它不需要证明知道主密码，那么坐在已解锁机器前的旁人
 * 只要把档位拨到「跟随有效期」就当场绕过这道门槛——门槛自身成了免验通道。
 * 与 `useSessionTimer.handleValiditySave` 同一处理方式。
 */
const handleSave = async (): Promise<void> => {
  try {
    const masterPassword = await promptAndVerifyMasterPassword(
      t('options.identityAccess.verifyTitle'),
      t('options.identityAccess.verifyPrompt'),
    );
    if (!masterPassword) return;

    saveLoading.value = true;
    await StorageUtils.saveIdentityVaultAccessConfig({ verifyPolicy: verifyPolicy.value });
    ElMessage.success(t('options.identityAccess.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    // 用户点击取消时静默返回，不弹错误提示
    if (error === 'cancel' || error === 'close') {
      return;
    }
    logger.error('IdentityVaultAccessSetting: 保存配置失败:', error);
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
  color: var(--aph-text-muted);
}

.form-tip__caution {
  margin-top: 4px;
  color: var(--aph-warning-strong);
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
