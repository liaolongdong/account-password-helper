<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('recovery.resetTitle')"
    width="min(520px, calc(100vw - 24px))"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!busy && !draft"
    :show-close="!busy && !draft"
    destroy-on-close
    @update:model-value="requestClose"
  >
    <div
      v-if="modelValue"
      ref="root"
      class="dialog-body-scroll recovery-body"
      :aria-busy="busy"
    >
      <!--
        两条成功文案必须整体待在同一个 `v-if` 分支里：`<template v-else>` 认的是紧邻的
        上一个 `v-if`，中间多插一个独立 `v-if` 就会把 v-else 挂错对象，导致恢复成功后
        整个表单又渲染回来（敏感输入框重新出现在「已完成」界面上）。
      -->
      <template v-if="completed">
        <p role="status">{{ t('recovery.resetSuccess') }}</p>
        <!-- 走过知情跳过就不能只报「恢复完成」——那会把「有几条永远读不出来了」藏起来。 -->
        <p
          v-if="usedSkip"
          class="recovery-skip__note"
          role="status"
        >
          {{ t('recovery.resetPartialNote') }}
        </p>
      </template>
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
          <!--
            只有真的被零容忍挡过一次才亮这扇门：默认仍是整笔中止，勾选并重新确认才会
            把解不开的条目原样携带过去。放在这里而不是开头，因为「你的库里有一条坏记录」
            这件事只有试过才知道，预先摆出来只会让所有人先读一遍坏消息。
          -->
          <RecoverySkipConsent
            v-if="offerSkip"
            v-model="allowSkip"
            :disabled="busy"
            mode="recovery"
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
                show-password
                :placeholder="t('recovery.newPasswordPlaceholder')"
                :aria-label="t('recovery.newPassword')"
                :disabled="busy"
                @focus="passwordFocused = true"
                @blur="
                  passwordFocused = false;
                  resetPasswordCaps();
                "
                @keydown="handlePasswordCaps"
                @keyup="handlePasswordCaps"
              >
                <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏）。
                     与 RecoveryKeyInput 同一套图标；恢复换钥要连打两遍新密码，
                     盲打没有回显就只知道「不一致」，不知道哪一遍打错了。 -->
                <template #password-icon="{ visible }">
                  <el-icon>
                    <Hide v-if="visible" />
                    <View v-else />
                  </el-icon>
                </template>
              </el-input>
            </PasswordStrengthPopover>
            <CapsLockHint v-if="passwordCaps" />
          </el-form-item>
          <el-form-item :label="t('recovery.confirmPassword')">
            <el-input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              show-password
              :placeholder="t('recovery.confirmPasswordPlaceholder')"
              :aria-label="t('recovery.confirmPassword')"
              :disabled="busy"
              @blur="resetConfirmCaps"
              @keydown="handleConfirmCaps"
              @keyup="handleConfirmCaps"
            >
              <template #password-icon="{ visible }">
                <el-icon>
                  <Hide v-if="visible" />
                  <View v-else />
                </el-icon>
              </template>
            </el-input>
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
      <!-- 仓库既有的页脚约定：15 处弹窗用 .dialog-footer 收口相邻 12px 边距，不再各写各的 -->
      <div class="dialog-footer">
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
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue';
import { View, Hide } from '@element-plus/icons-vue';
import type { RecoveryDraft, RecoveryStatus } from '@/utils/storage/recoveryTypes';
import { RECOVERY_FORMAT, VAULT_ERROR_CODES } from '@/utils/recoveryTypes';
import { clearRecoveryInputs, recoveryErrorCode } from '@/utils/recoveryUi';
import { loadRecoveryStatus, useRecoveryOperation } from '@/composables/useRecoveryOperation';
import { evaluatePasswordStrengthAsync, usePasswordStrength } from '@/composables/usePasswordStrength';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useI18n } from '@/utils/i18n';
import CapsLockHint from '@/components/CapsLockHint.vue';
import PasswordStrengthPopover from './PasswordStrengthPopover.vue';
import RecoveryKeyInput from './RecoveryKeyInput.vue';
import RecoveryKitSaveStep from './RecoveryKitSaveStep.vue';
import RecoverySkipConsent from './RecoverySkipConsent.vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; recovered: [] }>();
const { t } = useI18n();
const recoveryInput = shallowRef('');
const password = shallowRef('');
const confirmPassword = shallowRef('');
const passwordFocused = shallowRef(false);
const completed = shallowRef(false);
/** 恢复因「本机有记录解不开」而中止过：亮出知情跳过这一扇门 */
const offerSkip = shallowRef(false);
/** 用户已勾选知情跳过；下一次 `recover` 会把解不开的条目原样携带 */
const allowSkip = shallowRef(false);
/** 本次恢复确实携带过不可解条目，成功文案要补一句，不能只报「恢复完成」 */
const usedSkip = shallowRef(false);
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
  offerSkip.value = false;
  allowSkip.value = false;
  usedSkip.value = false;
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
const loadStatus = (): Promise<void> => loadRecoveryStatus(run, status);
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
    try {
      await api.recoverMasterPassword(recoveryInput.value, password.value, draft.value, confirmation, allowSkip.value);
    } catch (cause: unknown) {
      // 零容忍把「库里已有一条坏记录」的用户逼回唯一出路 = 清空全部数据。
      // 这里不吞错、不改呈现口径（照旧交给 `run` 本地化），只在失败确实是这个原因时
      // 亮出一扇需要用户明确勾选才走得通的门：原样携带解不开的条目，换回其余数据可用。
      if (!allowSkip.value && recoveryErrorCode(cause) === VAULT_ERROR_CODES.RECOVERY_INCOMPLETE) {
        offerSkip.value = true;
      }
      throw cause;
    }
    if (!isCurrent()) return;
    const skipped = allowSkip.value;
    invalidate();
    completed.value = true;
    usedSkip.value = skipped;
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
  color: var(--aph-danger-strong);
}

.recovery-skip__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
