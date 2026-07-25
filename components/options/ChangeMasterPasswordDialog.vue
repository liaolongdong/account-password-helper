<template>
  <el-dialog
    :model-value="modelValue"
    title="修改主密码"
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
      <template #title>修改主密码将重新加密所有数据，请确保新密码安全且牢记。</template>
      <template #default>已导出的加密备份（.aph 文件）不受影响，仍使用导出时的密码解密。</template>
    </el-alert>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      :disabled="loading"
    >
      <el-form-item
        label="当前密码"
        prop="oldPassword"
      >
        <el-input
          v-model="form.oldPassword"
          type="password"
          placeholder="请输入当前主密码"
          show-password
          @keyup.enter="handleSubmit"
        />
      </el-form-item>

      <el-form-item
        label="新密码"
        prop="newPassword"
      >
        <PasswordStrengthPopover
          v-model:visible="newPasswordFocused"
          title="密码要求"
          hint="请输入密码查看要求"
          :password="form.newPassword"
          :strength="passwordStrength"
          :rules="passwordRules"
        >
          <el-input
            v-model="form.newPassword"
            type="password"
            placeholder="请输入新主密码（至少8个字符，包含字母、数字、特殊字符）"
            show-password
            @focus="newPasswordFocused = true"
            @blur="newPasswordFocused = false"
            @keyup.enter="handleSubmit"
          />
        </PasswordStrengthPopover>
      </el-form-item>

      <el-form-item
        label="确认新密码"
        prop="confirmPassword"
      >
        <el-input
          v-model="form.confirmPassword"
          type="password"
          placeholder="请再次输入新主密码"
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
        取消
      </el-button>
      <el-button
        type="primary"
        :loading="loading"
        @click="handleSubmit"
      >
        {{ loading ? '正在重新加密...' : '确认修改' }}
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
}>();

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
    callback(new Error('密码强度不够，请包含字母、数字和特殊字符'));
  } else {
    callback();
  }
};

/** 确认密码校验器 */
const confirmValidator = (_rule: any, value: string, callback: any) => {
  if (value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'));
  } else {
    callback();
  }
};

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入当前主密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 个字符', trigger: 'blur' },
    { validator: strengthValidator, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    { validator: confirmValidator, trigger: 'blur' },
  ],
};

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
    ElMessage.success('主密码修改成功，所有数据已重新加密');
    emit('update:modelValue', false);
  } catch (error: any) {
    logger.error('修改主密码失败:', error);
    const msg = error?.message || '未知错误';
    if (msg.includes('验证失败')) {
      ElMessage.error('当前密码错误，请重新输入');
    } else {
      ElMessage.error('修改失败: ' + msg);
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
