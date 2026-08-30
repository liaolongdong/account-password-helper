<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogState.title"
    width="420px"
    :close-on-click-modal="false"
    :close-on-press-escape="!verifying"
    :destroy-on-close="false"
    @closed="handleClosed"
  >
    <p class="verify-description">
      {{ dialogState.description }}
    </p>

    <el-input
      ref="inputRef"
      v-model="password"
      type="password"
      :placeholder="t('auth.verifyPasswordPlaceholder')"
      show-password
      :disabled="verifying"
      :class="{ shake: shaking }"
      :style="{ '--shake-duration': shakeDurationMs + 'ms' }"
      autocomplete="current-password"
      @keyup.enter="handleConfirm"
      @keydown="handleCapsKeyEvent"
      @keyup="handleCapsKeyEvent"
      @blur="resetCapsLockState"
      @input="clearError"
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
      v-if="errorMsg"
      class="verify-error-inline"
    >
      {{ errorMsg }}
    </div>

    <div
      v-if="failCount >= MAX_FAIL_BEFORE_HINT"
      class="verify-hint-inline"
    >
      {{ t('verify.forgotHint') }}
    </div>

    <template #footer>
      <el-button
        :disabled="verifying"
        @click="handleCancel"
      >
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="verifying"
        @click="handleConfirm"
      >
        {{ t('common.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { View, Hide } from '@element-plus/icons-vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import {
  _getVerifyDialogState,
  _resolveVerifyDialog,
  _rejectVerifyDialog,
} from '@/utils/masterPasswordVerifyController';
import { SHAKE_DURATION_MS } from '@/composables/useAuthFlow';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import CapsLockHint from '@/components/CapsLockHint.vue';

/** 连续错误次数达到此值后显示重置提示 */
const MAX_FAIL_BEFORE_HINT = 3;

const { t } = useI18n();

/** 大写锁定检测（弹窗每次打开时重置，避免残留） */
const { capsLockOn, handleCapsKeyEvent, resetCapsLockState } = useCapsLockDetection();

const dialogState = _getVerifyDialogState();

/** 双向绑定弹窗可见性 */
const dialogVisible = ref(false);

/** 密码输入 */
const password = ref('');

/** 验证中加载状态 */
const verifying = ref(false);

/** 内联错误信息 */
const errorMsg = ref('');

/** 抖动动画触发 */
const shaking = ref(false);

/** 连续验证失败次数 */
const failCount = ref(0);

/** 输入框引用（用于聚焦） */
const inputRef = ref();

/** 抖动动画持续时间，与 useAuthFlow 保持一致 */
const shakeDurationMs = SHAKE_DURATION_MS;

/** 监听控制器状态，同步弹窗可见性 */
watch(
  () => dialogState.visible,
  visible => {
    dialogVisible.value = visible;
    if (visible) {
      password.value = '';
      errorMsg.value = '';
      failCount.value = 0;
      shaking.value = false;
      resetCapsLockState();

      nextTick(() => {
        const input = inputRef.value?.$el?.querySelector?.('.el-input__inner') as HTMLInputElement | undefined;
        input?.focus();
      });
    }
  },
);

/** 确认按钮：校验密码 */
const handleConfirm = async () => {
  const trimmed = password.value.trim();
  if (!trimmed) {
    errorMsg.value = t('verify.passwordEmpty');
    triggerShake();
    return;
  }

  verifying.value = true;
  errorMsg.value = '';

  try {
    const isValid = await StorageUtils.verifyMasterPassword(trimmed);
    if (isValid) {
      _resolveVerifyDialog(trimmed);
    } else {
      failCount.value++;
      errorMsg.value = t('verify.wrongPassword');
      password.value = '';
      triggerShake();
    }
  } catch (error) {
    logger.error('主密码验证弹窗校验异常:', error);
    errorMsg.value = t('verify.wrongPassword');
    failCount.value++;
    password.value = '';
    triggerShake();
  } finally {
    verifying.value = false;
  }
};

/** 取消按钮：关闭弹窗 */
const handleCancel = () => {
  _rejectVerifyDialog();
};

/** 弹窗关闭后的清理回调（仅处理用户通过 X 按钮等非标路径关闭的情况） */
const handleClosed = () => {
  // 控制器已通过 resolve/reject 处理时 _resolve 为 null，此处为安全兜底
  _rejectVerifyDialog();
  password.value = '';
  errorMsg.value = '';
  failCount.value = 0;
};

/** 触发输入框抖动动画 */
const triggerShake = () => {
  shaking.value = true;
  setTimeout(() => {
    shaking.value = false;
  }, shakeDurationMs);

  nextTick(() => {
    const input = inputRef.value?.$el?.querySelector?.('.el-input__inner') as HTMLInputElement | undefined;
    input?.focus();
  });
};

/** 输入时清除错误 */
const clearError = () => {
  errorMsg.value = '';
};
</script>

<style scoped>
.verify-description {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--el-text-color-regular);
}

/* 密码输入框抖动动画（与 PasswordVerifyView 保持一致） */
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

/* 验证错误内联提示 */
.verify-error-inline {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-color-error);
}

/* 忘记密码提示 */
.verify-hint-inline {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}
</style>
