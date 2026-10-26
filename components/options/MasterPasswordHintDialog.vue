<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.hint.title')"
    width="500px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-alert
        :title="t('options.hint.alertTitle')"
        :description="t('options.hint.alertDesc')"
        type="info"
        :closable="false"
        show-icon
      />

      <el-form
        class="hint-form"
        :model="form"
        label-position="top"
        size="large"
        @submit.prevent
      >
        <el-form-item :label="t('options.hint.label')">
          <el-input
            v-model="form.hint"
            type="textarea"
            :rows="3"
            :maxlength="MAX_MASTER_PASSWORD_HINT_LENGTH"
            show-word-limit
            :placeholder="t('options.hint.placeholder')"
            :disabled="saving"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          :disabled="saving"
          @click="emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          v-if="currentHint"
          type="danger"
          size="large"
          :loading="clearing"
          @click="handleClear"
        >
          {{ t('options.hint.clear') }}
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saving"
          @click="handleSave"
        >
          {{ t('common.saveSettings') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { MAX_MASTER_PASSWORD_HINT_LENGTH } from '@/utils/storage/masterPassword';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

/**
 * 主密码提示语编辑弹窗
 *
 * 提示语此前只有「首次设置主密码」那一次能写，之后既不能改也不能清：
 * 用恢复码换回本机库的人会被留一条指向已作废口令的明文提示，而唯一消除办法是清空整库。
 * 本组件补上这个入口，走 `updateMasterPasswordHint`——它只改 `hint` 字段，
 * 保留 `salt` / `hashedPassword` / `kdf`，因此不会影响离线恢复套件对校验配置的绑定。
 *
 * 空串按「未设置」落盘（省略字段），与存储层既有口径一致；长度上限取自存储层常量，
 * 不在界面另写一个数字，避免两处阈值分叉。
 */
const props = defineProps<{
  /** 显式声明开关：关闭时不保留任何输入内容以外的状态 */
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

const form = reactive({ hint: '' });
const currentHint = ref('');
const saving = ref(false);
const clearing = ref(false);

/** 打开时重新取一次盘上的提示语，避免上一轮的编辑残留 */
watch(
  () => props.modelValue,
  visible => {
    if (!visible) return;
    void StorageUtils.getMasterPasswordHint()
      .then(hint => {
        currentHint.value = hint;
        form.hint = hint;
      })
      .catch(error => {
        logger.error('读取主密码提示语失败:', error);
        currentHint.value = '';
        form.hint = '';
      });
  },
);

/** 落盘一次提示语并回到与界面一致的文案 */
const persist = async (value: string, successKey: string): Promise<void> => {
  try {
    await StorageUtils.updateMasterPasswordHint(value);
    currentHint.value = value.trim();
    form.hint = value.trim();
    ElMessage.success(t(successKey));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('保存主密码提示语失败:', error);
    ElMessage.error(t('options.hint.failed'));
  }
};

const handleSave = async (): Promise<void> => {
  saving.value = true;
  try {
    await persist(form.hint, 'options.hint.saved');
  } finally {
    saving.value = false;
  }
};

const handleClear = async (): Promise<void> => {
  clearing.value = true;
  try {
    await persist('', 'options.hint.cleared');
  } finally {
    clearing.value = false;
  }
};
</script>

<style scoped>
.hint-form {
  margin-top: 16px;
}
</style>
