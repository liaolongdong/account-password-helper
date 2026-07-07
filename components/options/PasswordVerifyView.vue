<template>
  <div class="verify-page">
    <div class="verify-container">
      <div class="verify-header">
        <div class="logo-section">
          <BrandLogo class="logo" />
          <h1>账号密码管理助手</h1>
        </div>
        <p class="subtitle">请输入主密码以继续</p>
      </div>

      <div class="verify-form">
        <el-card class="form-card">
          <el-form
            ref="localVerifyFormRef"
            :model="formModel"
            :rules="verifyRules"
            label-width="80px"
            label-position="top"
          >
            <el-form-item
              label="主密码"
              prop="password"
            >
              <el-input
                v-model="formModel.password"
                type="password"
                placeholder="请输入主密码"
                show-password
                size="large"
                :disabled="verifyLoading"
                :class="{ shake: verifyShake }"
                :style="{ '--shake-duration': SHAKE_DURATION_MS + 'ms' }"
                autocomplete="current-password"
                @keyup.enter="handleSubmit"
                @input="$emit('clearError')"
              >
                <!-- 状态语义：明文显示睁眼，密文显示闭眼 -->
                <template #password-icon="{ visible }">
                  <el-icon>
                    <View v-if="visible" />
                    <Hide v-else />
                  </el-icon>
                </template>
              </el-input>
              <div
                v-if="verifyError"
                class="verify-error-inline"
              >
                {{ verifyError }}
              </div>
            </el-form-item>

            <el-form-item
              label="验证有效期"
              prop="validityHours"
            >
              <ValidityHoursSelect
                v-model="formModel.validityHours"
                placeholder="选择验证有效期"
                size="large"
                :disabled="verifyLoading"
                style="width: 100%"
              />
              <div class="form-tip">验证有效期内无需重新输入主密码，超过有效期需重新验证</div>
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="verifyLoading"
                style="width: 100%"
                @click="handleSubmit"
              >
                验证密码
              </el-button>

              <div class="verify-actions">
                <el-button
                  v-if="isDev"
                  size="small"
                  type="info"
                  link
                  @click="$emit('debug')"
                >
                  🔍 调试信息
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  link
                  @click="$emit('reset')"
                >
                  忘记密码？重置所有数据
                </el-button>
              </div>
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
import { SHAKE_DURATION_MS } from '@/composables/useAuthFlow';

/**
 * 主密码验证视图组件
 *
 * 展示主密码验证表单，包含密码输入、有效期选择、
 * 错误提示及抖动动画反馈等功能。
 */
const props = defineProps<{
  /** 验证表单数据 */
  verifyForm: { password: string; validityHours: number };
  /** 表单校验规则 */
  verifyRules: FormRules;
  /** 验证加载状态 */
  verifyLoading: boolean;
  /** 验证错误信息 */
  verifyError: string;
  /** 是否启用抖动动画 */
  verifyShake: boolean;
  /** 是否为开发环境 */
  isDev: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  debug: [];
  reset: [];
  clearError: [];
  'update:verifyForm': [value: { password: string; validityHours: number }];
}>();

/** 提交前本地表单校验，通过后通知父组件 */
const handleSubmit = async () => {
  if (!localVerifyFormRef.value) return;
  try {
    await localVerifyFormRef.value.validate();
    emit('submit');
  } catch {
    // 校验未通过
  }
};

/** 本地表单模型 */
const formModel = reactive({
  password: props.verifyForm.password,
  validityHours: props.verifyForm.validityHours,
});

watch(
  () => props.verifyForm,
  val => {
    formModel.password = val.password;
    formModel.validityHours = val.validityHours;
  },
  { deep: true },
);

watch(formModel, val => {
  emit('update:verifyForm', { ...val });
});

/** 本地表单引用 */
const localVerifyFormRef = ref<FormInstance>();

/** 暴露表单引用供父组件调用 validate */
defineExpose({ formRef: localVerifyFormRef });
</script>

<style scoped>
/* 验证页面样式 */
.verify-page {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  overflow: hidden;
}

.verify-container {
  width: 100%;
  max-width: 400px;
}

.verify-header {
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
  color: #409eff;
}

.verify-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #2c3e50;
}

.subtitle {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  color: #6c757d;
}

.verify-form {
  margin-top: 14px;
}

.form-card {
  overflow: hidden;
  border: 1px solid #e3f2fd;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgb(64 158 255 / 10%);
}

:deep(.form-card .el-card__body) {
  padding: 22px 24px;
  background: #fff;
}

.verify-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
}

/* 验证错误内联提示 */
.verify-error-inline {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #f56c6c;
}

/* 密码输入框抖动动画 */
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }

  10%,
  30%,
  50%,
  70%,
  90% {
    transform: translateX(-4px);
  }

  20%,
  40%,
  60%,
  80% {
    transform: translateX(4px);
  }
}

.shake {
  animation: shake var(--shake-duration, 400ms) ease-in-out;
}

/* 表单标签 */
:deep(.verify-form .el-form-item) {
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
