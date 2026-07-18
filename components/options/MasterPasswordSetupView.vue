<template>
  <div class="setup-page">
    <div class="setup-container">
      <div class="setup-header">
        <div class="logo-section">
          <BrandLogo class="logo" />
          <h1>账号密码管理助手</h1>
        </div>
        <p class="subtitle">欢迎使用账号密码管理助手，请先设置主密码</p>
      </div>

      <div class="setup-form">
        <el-card class="form-card">
          <el-form
            ref="localSetupFormRef"
            :model="formModel"
            :rules="setupRules"
            label-width="100px"
            label-position="top"
          >
            <el-alert
              title="设置主密码"
              description="主密码用于保护您的所有账号信息，请妥善保管，切勿遗忘。"
              type="info"
              :closable="false"
              show-icon
            />

            <el-form-item
              label="主密码"
              prop="password"
            >
              <PasswordStrengthPopover
                v-model:visible="passwordInputFocused"
                title="密码要求"
                hint="请输入密码查看要求"
                :password="formModel.password"
                :strength="passwordStrength"
                :rules="passwordRules"
              >
                <el-input
                  v-model="formModel.password"
                  type="password"
                  placeholder="请输入主密码（至少8个字符，包含字母、数字、特殊字符）"
                  show-password
                  size="large"
                  :disabled="setupLoading"
                  autocomplete="new-password"
                  @keyup.enter="handleSubmit"
                  @focus="passwordInputFocused = true"
                  @blur="passwordInputFocused = false"
                >
                  <!-- 状态语义：明文显示睁眼，密文显示闭眼 -->
                  <template #password-icon="{ visible }">
                    <el-icon>
                      <View v-if="visible" />
                      <Hide v-else />
                    </el-icon>
                  </template>
                </el-input>
              </PasswordStrengthPopover>
            </el-form-item>

            <el-form-item
              label="确认密码"
              prop="confirmPassword"
            >
              <el-input
                v-model="formModel.confirmPassword"
                type="password"
                placeholder="请再次输入主密码"
                show-password
                size="large"
                :disabled="setupLoading"
                autocomplete="new-password"
                @keyup.enter="handleSubmit"
              >
                <template #password-icon="{ visible }">
                  <el-icon>
                    <View v-if="visible" />
                    <Hide v-else />
                  </el-icon>
                </template>
              </el-input>
            </el-form-item>

            <el-form-item
              label="验证有效期"
              prop="validityHours"
            >
              <ValidityHoursSelect
                v-model="formModel.validityHours"
                placeholder="选择验证有效期"
                size="large"
                :disabled="setupLoading"
                style="width: 100%"
              />
              <div class="form-tip">验证有效期内无需重新输入主密码，超过有效期需重新验证</div>
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="setupLoading"
                style="width: 100%"
                @click="handleSubmit"
              >
                设置主密码并开始使用
              </el-button>
            </el-form-item>
          </el-form>
          <!-- 免责声明 -->
          <div class="disclaimer-compact">
            <DisclaimerInfo />
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import DisclaimerInfo from '@/components/options/DisclaimerInfo.vue';
import ValidityHoursSelect from '@/components/options/ValidityHoursSelect.vue';
import PasswordStrengthPopover from '@/components/options/PasswordStrengthPopover.vue';
import type { PasswordRuleItem, PasswordStrengthResult } from '@/composables/usePasswordStrength';

/**
 * 主密码设置视图组件
 *
 * 展示首次使用时的主密码设置表单，包含密码输入、确认密码、
 * 有效期选择以及密码强度实时检测等功能。
 */
const props = defineProps<{
  /** 设置表单数据 */
  setupForm: { password: string; confirmPassword: string; validityHours: number };
  /** 表单校验规则 */
  setupRules: FormRules;
  /** 提交加载状态 */
  setupLoading: boolean;
  /** 密码强度计算结果 */
  passwordStrength: PasswordStrengthResult;
  /** 密码规则逐条校验结果 */
  passwordRules: PasswordRuleItem[];
}>();

/** 表单提交事件 */
const emit = defineEmits<{
  submit: [];
  'update:setupForm': [value: { password: string; confirmPassword: string; validityHours: number }];
}>();

/** 提交前本地表单校验，通过后通知父组件 */
const handleSubmit = async () => {
  if (!localSetupFormRef.value) return;
  try {
    await localSetupFormRef.value.validate();
    emit('submit');
  } catch {
    // 校验未通过，el-form 已显示错误提示
  }
};

/** 本地表单模型，从 props 同步并通过事件回写 */
const formModel = reactive({
  password: props.setupForm.password,
  confirmPassword: props.setupForm.confirmPassword,
  validityHours: props.setupForm.validityHours,
});

/** props -> local 同步（父组件重置时生效） */
watch(
  () => props.setupForm,
  val => {
    formModel.password = val.password;
    formModel.confirmPassword = val.confirmPassword;
    formModel.validityHours = val.validityHours;
  },
);

/** local -> parent 同步 */
watch(formModel, val => {
  emit('update:setupForm', { ...val });
});

/** 本地表单引用 */
const localSetupFormRef = ref<FormInstance>();

/** 主密码输入框焦点状态 */
const passwordInputFocused = ref(false);

/** 暴露表单引用供父组件调用 validate */
defineExpose({ formRef: localSetupFormRef });
</script>

<style scoped>
/* 设置页面样式 */
.setup-page {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 16px;
  overflow: hidden;
}

.setup-container {
  width: 100%;
  max-width: 460px;
}

.setup-header {
  margin-bottom: 14px;
  text-align: center;
}

.logo-section {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.logo-section .logo {
  margin-right: 10px;
  font-size: 32px;
  color: var(--aph-primary);
}

.setup-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #2c3e50;
  text-shadow: none;
}

.subtitle {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  color: #6c757d;
}

.setup-form {
  margin-top: 14px;
}

.form-card {
  overflow: hidden;
  border: 1px solid var(--aph-surface-line);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 10%);
}

:deep(.form-card .el-card__body) {
  padding: 22px 24px;
  background: #fff;
}

/* 表单标签 */
:deep(.setup-form .el-form-item) {
  margin-bottom: 18px;
}

:deep(.setup-form .el-alert) {
  margin-bottom: 18px;
}

/* 表单提示 */
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

/* 紧凑免责声明 */
.disclaimer-compact {
  padding-top: 10px;
  margin-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.disclaimer-compact :deep(.el-alert) {
  padding: 8px 12px;
}

.disclaimer-compact :deep(.el-alert__title) {
  font-size: 12px;
}

.disclaimer-compact :deep(.el-alert__description) {
  font-size: 11px;
  line-height: 1.4;
}
</style>
