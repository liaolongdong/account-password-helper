<template>
  <div class="verify-page">
    <div class="verify-container">
      <div class="verify-header">
        <div class="logo-section">
          <BrandLogo class="logo" />
          <h1>{{ t('appName') }}</h1>
        </div>
        <p class="subtitle">{{ t('auth.verifySubtitle') }}</p>
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
              :label="t('auth.masterPassword')"
              prop="password"
            >
              <el-input
                v-model="formModel.password"
                type="password"
                :placeholder="t('auth.verifyPasswordPlaceholder')"
                show-password
                size="large"
                :disabled="verifyLoading"
                :class="{ shake: verifyShake }"
                :style="{ '--shake-duration': SHAKE_DURATION_MS + 'ms' }"
                :aria-invalid="Boolean(verifyError)"
                :aria-describedby="verifyError ? 'verify-error-inline' : undefined"
                autocomplete="current-password"
                @keyup.enter="handleSubmit"
                @keydown="handleCapsKeyEvent"
                @keyup="handleCapsKeyEvent"
                @blur="resetCapsLockState"
                @input="$emit('clearError')"
              >
                <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
                <template #password-icon="{ visible }">
                  <el-icon>
                    <Hide v-if="visible" />
                    <View v-else />
                  </el-icon>
                </template>
              </el-input>
              <CapsLockHint v-if="capsLockOn" />
              <div
                v-if="verifyError"
                id="verify-error-inline"
                class="verify-error-inline"
                role="alert"
                aria-live="assertive"
              >
                {{ verifyError }}
              </div>
              <!--
                提示语刻意等连续输错到达阈值才亮：第一次输错就甩出提示，
                等于把「回想」这条最低成本的路径跳过，也放大了本机旁观者读到提示的机会。
              -->
              <div
                v-if="hint && failCount >= MAX_FAIL_BEFORE_HINT"
                class="verify-hint-inline"
              >
                <span class="verify-hint-inline__label">{{ t('auth.hintShown') }}</span>
                {{ hint }}
              </div>
            </el-form-item>

            <el-form-item
              :label="t('auth.validityLabel')"
              prop="validityHours"
            >
              <ValidityHoursSelect
                v-model="formModel.validityHours"
                :placeholder="t('auth.validityPlaceholder')"
                size="large"
                :disabled="verifyLoading"
                style="width: 100%"
              />
              <div class="form-tip">{{ t('auth.validityTip') }}</div>
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="verifyLoading"
                style="width: 100%"
                @click="handleSubmit"
              >
                {{ t('auth.verifySubmit') }}
              </el-button>

              <div class="verify-actions">
                <el-button
                  v-if="recoveryAvailable"
                  size="small"
                  type="primary"
                  link
                  :disabled="verifyLoading"
                  @click="openRecovery"
                >
                  {{ t('recovery.useKey') }}
                </el-button>
                <el-button
                  v-if="isDev"
                  size="small"
                  type="info"
                  link
                  @click="$emit('debug')"
                >
                  🔍 {{ t('auth.debugInfo') }}
                </el-button>
                <el-button
                  class="verify-actions__end"
                  size="small"
                  type="danger"
                  link
                  @click="showForgotDialog = true"
                >
                  {{ t('auth.forgotPassword') }}
                </el-button>
              </div>
            </el-form-item>
          </el-form>
          <!--
            找回向导：把「先想退路、再谈清空」的顺序固化下来。
            挂在锁定页内部而不是 App 顶层，是因为它只在 `showPasswordVerify` 为真时可达，
            且向导的终点直接复用父级既有的 `reset` 事件（清空与二次确认逻辑一律不改）。
          -->
          <ForgotPasswordDialog
            v-model="showForgotDialog"
            :has-hint="Boolean(hint)"
            @reset="handleConfirmReset"
          />
          <RecoveryResetDialog
            v-if="showRecoveryDialog"
            v-model="showRecoveryDialog"
            @recovered="handleRecovered"
          />
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
import { ref, reactive, watch, shallowRef, onMounted, defineAsyncComponent } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import DisclaimerInfo from '@/components/options/DisclaimerInfo.vue';
import ValidityHoursSelect from '@/components/options/ValidityHoursSelect.vue';
import ForgotPasswordDialog from './ForgotPasswordDialog.vue';
import CapsLockHint from '@/components/CapsLockHint.vue';
import { SHAKE_DURATION_MS, MAX_FAIL_BEFORE_HINT } from '@/composables/useAuthFlow';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useI18n } from '@/utils/i18n';

const RecoveryResetDialog = defineAsyncComponent(() => import('./RecoveryResetDialog.vue'));

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
  /** 主密码提示语（空串表示用户未设置） */
  hint: string;
  /** 本次解锁已连续输错的次数 */
  failCount: number;
}>();

const emit = defineEmits<{
  submit: [];
  debug: [];
  reset: [];
  recovered: [];
  clearError: [];
  'update:verifyForm': [value: { password: string; validityHours: number }];
}>();

const { t } = useI18n();

/** 找回向导可见性 */
const showForgotDialog = ref(false);
const showRecoveryDialog = shallowRef(false);

/**
 * 恢复入口只在「本机确实配过可用密钥」时出现。
 *
 * 锁定页在改造前只有「忘记密码」一个出口；无条件多挂一颗主色链接，会替从未启用恢复的
 * 用户改掉既有动作行的排布，并把他们带进一条只能读到「未启用」的死路。状态在挂载后
 * 异步读一次，不进首帧渲染链；读不到就维持改造前的样子。
 */
const recoveryAvailable = shallowRef(false);

onMounted(() => {
  void import('@/utils/storage/recovery')
    .then(api => api.getRecoveryStatus())
    .then(status => {
      recoveryAvailable.value = status.enabled;
    })
    .catch(() => {
      recoveryAvailable.value = false;
    });
});

const openRecovery = (): void => {
  if (props.verifyLoading) return;
  formModel.password = '';
  resetCapsLockState();
  showRecoveryDialog.value = true;
};

/** 仅刷新认证配置/提示语；不建立会话，也不向解锁框自动填入新密码。 */
const handleRecovered = (): void => {
  formModel.password = '';
  emit('update:verifyForm', { ...formModel });
  emit('clearError');
  emit('recovered');
};

/**
 * 向导终点「仍然重置全部数据」：先收起向导，再把清空动作交回父级的 `reset` 事件。
 * 父级 `useAuthFlow.resetMasterPassword` 内已带 lockSession → clearAllData 与二次确认，此处不复制。
 */
const handleConfirmReset = () => {
  showForgotDialog.value = false;
  emit('reset');
};

/** 主密码输入框大写锁定检测（误开大写锁定时即时提示） */
const { capsLockOn, handleCapsKeyEvent, resetCapsLockState } = useCapsLockDetection();

/** 提交前本地表单校验，通过后通知父组件 */
const handleSubmit = async () => {
  if (!localVerifyFormRef.value || props.verifyLoading || showRecoveryDialog.value) return;
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
  color: var(--aph-primary);
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
  border: 1px solid var(--aph-surface-line);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 10%);
}

:deep(.form-card .el-card__body) {
  padding: 22px 24px;
  background: #fff;
}

.verify-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;

  /* 必须是满宽，否则下面的 `margin-left: auto` 是空转。
     本 div 的直接父级是 `.el-form-item__content`，EP 给它 `display: flex; flex-wrap: wrap`，
     于是它自己是个 flex item——默认 `flex: 0 1 auto` 按内容定宽，容器和内容一样宽时
     auto 外边距没有可分配的空间，链接照样贴在左边。
     （上一轮就是栽在这：探针页把它放在普通块级容器里，容器满宽、auto 边距生效，假绿。） */
  width: 100%;
  margin-top: 12px;
}

/* 找回入口钉死行尾，恢复入口留在行首。
   原先用 `justify-content: space-between`：恢复入口按 `recoveryAvailable` 显隐，
   没启用过离线恢复的用户这一行只剩一颗链接，space-between 会把它推到最左边——
   同一个逃生出口，换一台机器就换了位置。`margin-left: auto` 让「忘记密码」
   无论邻居在不在都落在右端，左位缺位时留白即可。 */
.verify-actions__end {
  margin-left: auto;
}

/* 链接按钮默认只有 `size="small"` 的 ~24px 命中高度；刚输错过主密码的用户手在抖，
   把可点面积垫回 32px（WCAG 2.5.8 最小目标尺寸），视觉字号与文案一律不动。 */
.verify-actions :deep(.el-button.is-link) {
  min-height: 32px;
  padding: 4px 8px;
}

/* 验证错误内联提示 */
.verify-error-inline {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #f56c6c;
}

/* 主密码提示语（连续输错达阈值后出现，与复验弹窗的忘记密码提示同一口径） */
.verify-hint-inline {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.verify-hint-inline__label {
  font-weight: 600;
  color: var(--el-text-color-regular);
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

/* 减弱动效：取消抖动。校验失败的判据由红边、错误文案与 `aria-invalid` 表达，
   摇晃只是冗余的注意力提示，去掉不丢任何信息（JS 侧仍按时清除 `shake` 类，状态机不变） */
@media (prefers-reduced-motion: reduce) {
  .shake {
    animation: none;
  }
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
