<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('recovery.resetTitle')"
    width="min(520px, calc(100vw - 24px))"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    destroy-on-close
    @update:model-value="requestClose"
  >
    <div
      v-if="modelValue"
      ref="root"
      class="dialog-body-scroll recovery-body"
      :aria-busy="busy"
    >
      <p
        v-if="completed"
        role="status"
      >
        {{ t('recovery.resetSuccess') }}
      </p>
      <template v-else>
        <p
          v-if="!status"
          role="status"
        >
          {{ t('recovery.loading') }}
        </p>
        <p
          v-else-if="status.corrupted"
          role="alert"
        >
          {{ t('recovery.corruptedLocked') }}
        </p>
        <p
          v-else-if="!status.enabled"
          role="status"
        >
          {{ t('recovery.notEnabled') }}
        </p>
        <template v-else-if="draft">
          <p>{{ t('recovery.rekeyWarning') }}</p>
          <RecoveryKitSaveStep
            :material="draft.material"
            :busy="busy"
            @confirm="recover"
          />
        </template>
        <!--
          `el-form label-position="top"` 而不是裸 `<form>`：下面两个 `el-form-item` 原先没有
          表单上下文，EP 退回默认的行内右对齐布局，「新主密码」被挤到输入框左边，
          与上方 RecoveryKeyInput 自己的堆叠标签在同一个弹窗里长成两种样子。
          ElForm 的 emits 只声明了 `validate`，`@submit.prevent` 仍会落到根 `<form>` 上。
        -->
        <el-form
          v-else
          label-position="top"
          @submit.prevent="prepare"
        >
          <p>{{ t('recovery.resetIntro') }}</p>
          <RecoveryKeyInput
            v-model="recoveryInput"
            :label="t('recovery.keyInput')"
            :disabled="busy"
          />
          <el-form-item
            :label="t('recovery.newPassword')"
            class="password-field"
          >
            <PasswordStrengthPopover
              v-model:visible="passwordFocused"
              :title="t('auth.passwordRequirements')"
              :hint="t('auth.passwordRequirementsHint')"
              :password="password.trim()"
              :strength="strength"
              :rules="rules"
            >
              <el-input
                v-model="password"
                type="password"
                autocomplete="new-password"
                :aria-label="t('recovery.newPassword')"
                :disabled="busy"
                @focus="passwordFocused = true"
                @blur="
                  passwordFocused = false;
                  resetPasswordCaps();
                "
                @keydown="handlePasswordCaps"
                @keyup="handlePasswordCaps"
              />
            </PasswordStrengthPopover>
            <CapsLockHint v-if="passwordCaps" />
          </el-form-item>
          <el-form-item :label="t('recovery.confirmPassword')">
            <el-input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              :aria-label="t('recovery.confirmPassword')"
              :disabled="busy"
              @blur="resetConfirmCaps"
              @keydown="handleConfirmCaps"
              @keyup="handleConfirmCaps"
            />
            <CapsLockHint v-if="confirmCaps" />
          </el-form-item>
          <el-button
            native-type="submit"
            type="primary"
            :loading="busy"
            :disabled="busy || !recoveryInput.trim()"
          >
            {{ t('recovery.prepareReset') }}
          </el-button>
        </el-form>
        <p
          v-if="error"
          class="recovery-error"
          role="alert"
        >
          {{ error }}
        </p>
        <el-button
          v-if="!status && !busy"
          @click="loadStatus"
          >{{ t('recovery.retry') }}</el-button
        >
      </template>
    </div>
    <template #footer>
      <el-button
        v-if="draft"
        :disabled="busy"
        @click="backToEdit"
        >{{ t('recovery.backToEdit') }}</el-button
      >
      <el-button
        :disabled="busy"
        @click="requestClose(false)"
      >
        {{ completed ? t('recovery.close') : t('common.cancel') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue';
import type { RecoveryDraft, RecoveryStatus } from '@/utils/storage/recoveryTypes';
import { RECOVERY_FORMAT } from '@/utils/recoveryTypes';
import { clearRecoveryInputs } from '@/utils/recoveryUi';
import { useRecoveryOperation } from '@/composables/useRecoveryOperation';
import { evaluatePasswordStrengthAsync, usePasswordStrength } from '@/composables/usePasswordStrength';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useI18n } from '@/utils/i18n';
import CapsLockHint from '@/components/CapsLockHint.vue';
import PasswordStrengthPopover from './PasswordStrengthPopover.vue';
import RecoveryKeyInput from './RecoveryKeyInput.vue';
import RecoveryKitSaveStep from './RecoveryKitSaveStep.vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; recovered: [] }>();
const { t } = useI18n();
const recoveryInput = shallowRef('');
const password = shallowRef('');
const confirmPassword = shallowRef('');
const passwordFocused = shallowRef(false);
const completed = shallowRef(false);
const status = shallowRef<RecoveryStatus | null>(null);
const draft = shallowRef<RecoveryDraft | null>(null);
const root = useTemplateRef<HTMLElement>('root');
const { strength, rules } = usePasswordStrength(computed(() => password.value.trim()));
const {
  capsLockOn: passwordCaps,
  handleCapsKeyEvent: handlePasswordCaps,
  resetCapsLockState: resetPasswordCaps,
} = useCapsLockDetection();
const {
  capsLockOn: confirmCaps,
  handleCapsKeyEvent: handleConfirmCaps,
  resetCapsLockState: resetConfirmCaps,
} = useCapsLockDetection();
const clear = (): void => {
  recoveryInput.value = '';
  password.value = '';
  confirmPassword.value = '';
  passwordFocused.value = false;
  draft.value = null;
  completed.value = false;
  resetPasswordCaps();
  resetConfirmCaps();
  clearRecoveryInputs(root.value);
};
const { busy, error, run, invalidate } = useRecoveryOperation(() => props.modelValue, clear);
const requestClose = (value: boolean): void => {
  if (busy.value || value) return;
  invalidate();
  emit('update:modelValue', false);
};
const loadStatus = () =>
  run(async isCurrent => {
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent()) return;
    const result = await api.getRecoveryStatus();
    if (isCurrent()) status.value = result;
  });
const prepare = () =>
  run(async isCurrent => {
    if (!status.value?.enabled || status.value.corrupted || draft.value) return;
    if (!recoveryInput.value.trim() || recoveryInput.value.length > RECOVERY_FORMAT.maxInputLength) {
      error.value = t('recovery.error.invalid');
      return;
    }
    password.value = password.value.trim();
    if (password.value !== confirmPassword.value.trim()) {
      error.value = t('recovery.passwordMismatch');
      return;
    }
    const result = await evaluatePasswordStrengthAsync(password.value);
    if (!isCurrent()) return;
    if (!result.allPassed) {
      error.value = t('recovery.passwordRequirements');
      return;
    }
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent()) return;
    const prepared = await api.preparePasswordRecovery(recoveryInput.value, password.value);
    if (isCurrent()) {
      clearRecoveryInputs(root.value);
      confirmPassword.value = '';
      passwordFocused.value = false;
      draft.value = prepared;
    }
  });
const recover = (confirmation: string) =>
  run(async isCurrent => {
    if (!draft.value) return;
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent() || !draft.value) return;
    await api.recoverMasterPassword(recoveryInput.value, password.value, draft.value, confirmation);
    if (!isCurrent()) return;
    invalidate();
    completed.value = true;
    emit('recovered');
  });
const backToEdit = (): void => {
  if (busy.value) return;
  invalidate();
};
watch(
  () => props.modelValue,
  open => {
    if (open) {
      status.value = null;
      void loadStatus();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.recovery-body {
  /* 同 RecoverySettingsDialog：高度与滚动走 .dialog-body-scroll 约定，这里只留换行规则。 */
  overflow-wrap: anywhere;
}
.password-field {
  margin-top: 16px;
}
.recovery-error {
  color: var(--el-color-danger);
}
</style>
