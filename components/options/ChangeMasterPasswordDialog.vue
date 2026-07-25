<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.changeMasterPassword')"
    width="440px"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      <template #title>{{ t('options.changePwd.alertTitle') }}</template>
      <template #default>{{ t('options.changePwd.alertDesc') }}</template>
    </el-alert>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      :disabled="loading"
    >
      <el-form-item
        :label="t('options.changePwd.oldPassword')"
        prop="oldPassword"
      >
        <el-input
          v-model="form.oldPassword"
          type="password"
          :placeholder="t('options.changePwd.oldPasswordPlaceholder')"
          show-password
          @keyup.enter="handleSubmit"
        />
      </el-form-item>

      <el-form-item
        :label="t('options.changePwd.newPassword')"
        prop="newPassword"
      >
        <PasswordStrengthPopover
          v-model:visible="newPasswordFocused"
          :title="t('auth.passwordRequirements')"
          :hint="t('auth.passwordRequirementsHint')"
          :password="form.newPassword"
          :strength="passwordStrength"
          :rules="passwordRules"
        >
          <el-input
            v-model="form.newPassword"
            type="password"
            :placeholder="t('options.changePwd.newPasswordPlaceholder')"
            show-password
            @focus="newPasswordFocused = true"
            @blur="newPasswordFocused = false"
            @keyup.enter="handleSubmit"
          />
        </PasswordStrengthPopover>
      </el-form-item>

      <el-form-item
        :label="t('options.changePwd.confirmPassword')"
        prop="confirmPassword"
      >
        <el-input
          v-model="form.confirmPassword"
          type="password"
          :placeholder="t('options.changePwd.confirmPasswordPlaceholder')"
          show-password
          @keyup.enter="handleSubmit"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button
        :disabled="loading"
        @click="$emit('update:modelValue', false)"
      >
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="loading"
        @click="handleSubmit"
      >
        {{ loading ? t('options.changePwd.reencrypting') : t('options.changePwd.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import PasswordStrengthPopover from '@/components/options/PasswordStrengthPopover.vue';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { changeMasterPassword } from '@/utils/storage/changeMasterPassword';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

/**
 * 修改主密码对话框
 *
 * 验证旧密码 → 输入新密码（含强度校验）→ 确认 → 全库 rekey 重加密 → 刷新会话。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 修改成功事件：父组件据此确定性重载密码列表（不依赖 storage watcher 时序） */
  success: [];
}>();

const { t } = useI18n();

const formRef = ref<FormInstance>();
const loading = ref(false);
const newPasswordFocused = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const newPasswordRef = computed(() => form.newPassword);
const { strength: passwordStrength, rules: passwordRules } = usePasswordStrength(newPasswordRef);

/** 密码强度校验器：必须至少为「中」 */
const strengthValidator = (_rule: any, _value: string, callback: any) => {
  if (form.newPassword && passwordStrength.value.level === 'weak') {
    callback(new Error(t('options.changePwd.weakPassword')));
  } else {
    callback();
  }
};

/** 确认密码校验器 */
const confirmValidator = (_rule: any, value: string, callback: any) => {
  if (value !== form.newPassword) {
    callback(new Error(t('options.changePwd.mismatch')));
  } else {
    callback();
  }
};

/** 表单校验规则（computed 保证语言切换后错误提示同步更新） */
const rules = computed<FormRules>(() => ({
  oldPassword: [{ required: true, message: t('options.changePwd.oldPasswordPlaceholder'), trigger: 'blur' }],
  newPassword: [
    { required: true, message: t('options.changePwd.newPasswordRequired'), trigger: 'blur' },
    { min: 8, message: t('options.changePwd.minLength'), trigger: 'blur' },
    { validator: strengthValidator, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: t('options.changePwd.confirmRequired'), trigger: 'blur' },
    { validator: confirmValidator, trigger: 'blur' },
  ],
}));

/** 提交修改主密码 */
const handleSubmit = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  loading.value = true;
  try {
    await changeMasterPassword(form.oldPassword, form.newPassword);
    ElMessage.success(t('options.changePwd.success'));
    emit('update:modelValue', false);
    emit('success');
  } catch (error: any) {
    logger.error('修改主密码失败:', error);
    const msg = error?.message || '';
    if (error?.code === 'WRONG_PASSWORD' || msg.includes('验证失败')) {
      ElMessage.error(t('options.changePwd.wrongOldPassword'));
    } else {
      ElMessage.error(t('options.changePwd.failed', { msg: msg || t('message.unknownError') }));
    }
  } finally {
    loading.value = false;
  }
};

/** 弹窗关闭时重置表单（安全考虑：清除内存中的明文密码） */
watch(
  () => props.modelValue,
  visible => {
    if (!visible) {
      form.oldPassword = '';
      form.newPassword = '';
      form.confirmPassword = '';
      formRef.value?.resetFields();
    }
  },
);
</script>
