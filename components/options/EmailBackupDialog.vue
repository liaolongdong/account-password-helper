<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('options.header.emailBackup')"
    width="520px"
    align-center
    :close-on-click-modal="false"
    @open="handleOpen"
    @close="handleClose"
  >
    <div class="dialog-body-scroll">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        label-position="top"
        size="large"
      >
        <el-alert
          :title="t('options.emailBackup.noteTitle')"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 20px"
        >
          <template #default>
            {{ t('options.emailBackup.noteLine1') }}<br />
            {{ t('options.emailBackup.noteLine2Prefix') }}<strong>{{ t('options.emailBackup.noteLine2Strong') }}</strong
            >{{ t('options.emailBackup.noteLine2Suffix') }}
          </template>
        </el-alert>

        <el-form-item :label="t('options.emailBackup.backupType')">
          <el-radio-group v-model="backupType">
            <el-radio value="unencrypted">{{ t('options.emailBackup.unencrypted') }}</el-radio>
            <el-radio value="encrypted">{{ t('options.emailBackup.encrypted') }}</el-radio>
          </el-radio-group>
          <el-alert
            v-if="backupType === 'encrypted'"
            type="warning"
            :closable="false"
            show-icon
            class="encrypted-backup-tip"
          >
            <template #default>
              {{ t('options.emailBackup.encryptedTipPrefix') }}
              <strong>{{ t('options.emailBackup.encryptedTipStrong') }}</strong>
              <strong>{{ t('options.emailBackup.encryptedTipRemember') }}</strong>
            </template>
          </el-alert>
        </el-form-item>

        <el-form-item
          :label="t('options.emailBackup.emailLabel')"
          prop="email"
        >
          <el-input
            v-model="form.email"
            :placeholder="t('options.emailBackup.emailPlaceholder')"
            :disabled="backupLoading"
            clearable
          />
        </el-form-item>

        <el-form-item :label="t('options.emailBackup.autoRemind')">
          <div class="auto-backup-row">
            <el-switch
              v-model="form.autoBackup"
              :active-text="t('common.on')"
              :inactive-text="t('common.off')"
            />
            <el-select
              v-if="form.autoBackup"
              v-model="form.autoBackupIntervalDays"
              style="width: 140px; margin-left: 12px"
              :placeholder="t('options.emailBackup.intervalPlaceholder')"
            >
              <el-option
                v-for="opt in intervalOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div
            v-if="form.autoBackup"
            class="auto-backup-tip"
          >
            {{ t('options.emailBackup.autoRemindTip') }}
          </div>
          <div
            v-if="form.autoBackup && lastBackupTime"
            class="last-backup-info"
          >
            {{ t('options.emailBackup.lastRemind', { time: lastBackupTime }) }}
          </div>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          :disabled="backupLoading"
          @click="handleClose"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          :loading="saveLoading"
          :disabled="backupLoading"
          @click="handleSaveConfig"
        >
          {{ t('options.emailBackup.saveConfig') }}
        </el-button>
        <el-button
          type="primary"
          :loading="backupLoading"
          @click="handleBackup"
        >
          {{ t('options.emailBackup.backupNow') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import type { EmailBackupConfig } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { EmailBackupUtils } from '@/utils/emailBackup';
import { formatDateTime } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

const { t } = useI18n();

/** 自动备份间隔选项（label 随语言实时切换） */
const intervalOptions = computed(() => [
  { label: t('options.emailBackup.everyDay'), value: 1 },
  { label: t('options.emailBackup.every3Days'), value: 3 },
  { label: t('options.emailBackup.everyWeek'), value: 7 },
  { label: t('options.emailBackup.every2Weeks'), value: 14 },
  { label: t('options.emailBackup.everyMonth'), value: 30 },
]);

/** 备份方式：不加密 / 加密 */
type BackupType = 'unencrypted' | 'encrypted';

interface Props {
  modelValue: boolean;
  /** 父组件提供的备份执行函数，支持加密/不加密两种模式 */
  backupFn?: (email: string, encrypted: boolean) => Promise<void>;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const backupLoading = ref(false);
const saveLoading = ref(false);
const lastBackupTime = ref('');
const backupType = ref<BackupType>('unencrypted');

const form = ref<EmailBackupConfig>({
  email: '',
  autoBackup: false,
  autoBackupIntervalDays: 7,
});

/** 表单校验规则（computed 保证语言切换后错误提示同步更新） */
const rules = computed<FormRules>(() => ({
  email: [
    { required: true, message: t('options.emailBackup.emailRequired'), trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && !EmailBackupUtils.isValidEmail(value)) {
          callback(new Error(t('options.emailBackup.emailInvalid')));
        } else {
          callback();
        }
      },
      trigger: 'blur',
    },
  ],
}));

/**
 * 弹窗打开时加载最新配置
 */
const handleOpen = async () => {
  try {
    const config = await StorageUtils.getEmailBackupConfig();
    form.value = { ...config };

    const lastTime = await StorageUtils.getLastAutoBackupTime();
    lastBackupTime.value = lastTime ? formatDateTime(lastTime) : '';
  } catch (error) {
    logger.error('加载邮箱备份配置失败:', error);
  }
};

/**
 * 保存邮箱备份配置
 */
const handleSaveConfig = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
    saveLoading.value = true;
    await StorageUtils.saveEmailBackupConfig(form.value);
    ElMessage.success(t('options.emailBackup.configSaved'));
  } catch (error) {
    if (error !== false) {
      logger.error('保存邮箱备份配置失败:', error);
      ElMessage.error(t('message.saveConfigFailed'));
    }
  } finally {
    saveLoading.value = false;
  }
};

/**
 * 执行立即备份
 */
const handleBackup = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
    backupLoading.value = true;

    // 先保存配置
    await StorageUtils.saveEmailBackupConfig(form.value);

    // 调用父组件提供的备份函数（包含主密码验证等异步操作）
    if (props.backupFn) {
      await props.backupFn(form.value.email, backupType.value === 'encrypted');
      // 备份成功后关闭弹窗
      dialogVisible.value = false;
    }
  } catch (error) {
    if (error !== false && error !== 'cancel') {
      logger.error('备份操作失败:', error);
      ElMessage.error(t('options.emailBackup.backupFailed'));
    }
  } finally {
    backupLoading.value = false;
  }
};

/**
 * 弹窗关闭
 */
const handleClose = () => {
  dialogVisible.value = false;
};
</script>

<style scoped>
.auto-backup-row {
  display: flex;
  align-items: center;
}

.auto-backup-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}

.encrypted-backup-tip {
  margin-top: 10px;
}

:deep(.encrypted-backup-tip .el-alert__content) {
  font-size: 13px;
  line-height: 1.5;
}

.last-backup-info {
  font-size: 12px;
  color: #909399;
}

.dialog-footer {
  margin-top: -20px;
  text-align: right;
}

:deep(.el-alert__content) {
  font-size: 13px;
}
</style>
