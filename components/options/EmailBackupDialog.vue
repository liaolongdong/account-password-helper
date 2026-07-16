<template>
  <el-dialog
    v-model="dialogVisible"
    title="备份到邮箱"
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
          title="备份说明"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 20px"
        >
          <template #default>
            将密码列表导出为数据文件并唤起邮件客户端，请将下载的文件作为附件发送。<br />
            开启「自动备份提醒」后，仅定时发送桌面提醒通知您手动备份，<strong>不会自动下载密码文件</strong>。
          </template>
        </el-alert>

        <el-form-item label="备份方式">
          <el-radio-group v-model="backupType">
            <el-radio value="unencrypted">不加密备份</el-radio>
            <el-radio value="encrypted">加密备份</el-radio>
          </el-radio-group>
          <el-alert
            v-if="backupType === 'encrypted'"
            type="warning"
            :closable="false"
            show-icon
            class="encrypted-backup-tip"
          >
            <template #default>
              加密备份的文件只能通过本插件的
              <strong>数据管理 -> 加密备份导入</strong> 功能才能正常看到明文账号密码数据。
            </template>
          </el-alert>
        </el-form-item>

        <el-form-item
          label="备份邮箱"
          prop="email"
        >
          <el-input
            v-model="form.email"
            placeholder="请输入备份目标邮箱地址"
            :disabled="backupLoading"
            clearable
          />
        </el-form-item>

        <el-form-item label="自动备份提醒">
          <div class="auto-backup-row">
            <el-switch
              v-model="form.autoBackup"
              active-text="开启"
              inactive-text="关闭"
            />
            <el-select
              v-if="form.autoBackup"
              v-model="form.autoBackupIntervalDays"
              style="width: 140px; margin-left: 12px"
              placeholder="备份提醒间隔"
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
            开启后将定时发送桌面通知提醒您手动备份，不会自动下载密码文件。
          </div>
          <div
            v-if="form.autoBackup && lastBackupTime"
            class="last-backup-info"
          >
            上次提醒：{{ lastBackupTime }}
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
          取消
        </el-button>
        <el-button
          :loading="saveLoading"
          :disabled="backupLoading"
          @click="handleSaveConfig"
        >
          保存配置
        </el-button>
        <el-button
          type="primary"
          :loading="backupLoading"
          @click="handleBackup"
        >
          立即备份
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

/** 自动备份间隔选项 */
const intervalOptions = [
  { label: '每天', value: 1 },
  { label: '每3天', value: 3 },
  { label: '每周', value: 7 },
  { label: '每两周', value: 14 },
  { label: '每月', value: 30 },
];

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

const rules: FormRules = {
  email: [
    { required: true, message: '请输入备份邮箱地址', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && !EmailBackupUtils.isValidEmail(value)) {
          callback(new Error('邮箱格式不正确'));
        } else {
          callback();
        }
      },
      trigger: 'blur',
    },
  ],
};

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
    ElMessage.success('备份配置已保存');
  } catch (error) {
    if (error !== false) {
      logger.error('保存邮箱备份配置失败:', error);
      ElMessage.error('保存配置失败');
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
      ElMessage.error('备份失败');
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
.dialog-body-scroll {
  max-height: 80vh;
  padding-right: 4px;
  overflow-y: auto;
}

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
