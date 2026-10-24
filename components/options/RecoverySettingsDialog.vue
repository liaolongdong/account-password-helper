<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('recovery.settingsTitle')"
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
      <p>{{ t('recovery.settingsIntro') }}</p>
      <p
        v-if="!status"
        role="status"
      >
        {{ t('recovery.loading') }}
      </p>
      <template v-else>
        <p role="status">{{ status.enabled ? t('recovery.enabled') : t('recovery.disabled') }}</p>
        <p
          v-if="status.corrupted"
          role="alert"
        >
          {{ t('recovery.corrupted') }}
        </p>
        <dl
          v-if="status.config"
          class="metadata"
        >
          <dt>{{ t('recovery.createdAt') }}</dt>
          <dd>{{ new Date(status.config.createdAt).toLocaleString(currentLocale) }}</dd>
          <dt>{{ t('recovery.kitId') }}</dt>
          <dd>{{ status.config.id }}</dd>
        </dl>
        <template v-if="draft">
          <!-- 首次创建没有「旧套件」可谈，这句话只在已启用（即换发）时成立 -->
          <p v-if="status.enabled">{{ t('recovery.replaceWarning') }}</p>
          <RecoveryKitSaveStep
            :material="draft.material"
            :busy="busy"
            @confirm="activate"
          />
        </template>
        <form
          v-else
          @submit.prevent="prepare"
        >
          <el-form-item :label="t('recovery.currentPassword')">
            <el-input
              v-model="password"
              type="password"
              autocomplete="current-password"
              :aria-label="t('recovery.currentPassword')"
              :disabled="busy"
              @keydown="handleCapsKeyEvent"
              @keyup="handleCapsKeyEvent"
              @blur="resetCapsLockState"
            />
            <CapsLockHint v-if="capsLockOn" />
          </el-form-item>
          <el-button
            native-type="submit"
            type="primary"
            :loading="busy"
            :disabled="busy || !password.trim()"
          >
            {{ status.enabled || status.corrupted ? t('recovery.replace') : t('recovery.create') }}
          </el-button>
          <div
            v-if="status.enabled || status.corrupted"
            class="disable-section"
          >
            <p>{{ t('recovery.disableWarning') }}</p>
            <el-checkbox
              v-model="disableConfirmed"
              :disabled="busy"
              class="disable-check"
            >
              {{ t('recovery.disableConfirm') }}
            </el-checkbox>
            <el-button
              type="danger"
              :disabled="busy || !password.trim() || !disableConfirmed"
              @click="disable"
            >
              {{ t('recovery.disable') }}
            </el-button>
          </div>
        </form>
      </template>
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
        >{{ t('common.cancel') }}</el-button
      >
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { shallowRef, useTemplateRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { RecoveryDraft, RecoveryStatus } from '@/utils/storage/recoveryTypes';
import { clearRecoveryInputs } from '@/utils/recoveryUi';
import { useRecoveryOperation } from '@/composables/useRecoveryOperation';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useI18n } from '@/utils/i18n';
import CapsLockHint from '@/components/CapsLockHint.vue';
import RecoveryKitSaveStep from './RecoveryKitSaveStep.vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const { t, currentLocale } = useI18n();
const password = shallowRef('');
const draft = shallowRef<RecoveryDraft | null>(null);
const status = shallowRef<RecoveryStatus | null>(null);
const disableConfirmed = shallowRef(false);
const root = useTemplateRef<HTMLElement>('root');
const { capsLockOn, handleCapsKeyEvent, resetCapsLockState } = useCapsLockDetection();
const clear = (): void => {
  password.value = '';
  draft.value = null;
  status.value = null;
  disableConfirmed.value = false;
  resetCapsLockState();
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
    if (!password.value.trim() || !status.value || draft.value) return;
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent()) return;
    password.value = password.value.trim();
    const result = await api.prepareRecoveryEnrollment(password.value);
    if (isCurrent()) {
      clearRecoveryInputs(root.value);
      draft.value = result;
    }
  });
const activate = (confirmation: string) =>
  run(async isCurrent => {
    if (!draft.value) return;
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent() || !draft.value) return;
    await api.activateRecovery(password.value, draft.value, confirmation);
    if (!isCurrent()) return;
    invalidate();
    ElMessage.success(t('recovery.activated'));
    emit('update:modelValue', false);
  });
const disable = () =>
  run(async isCurrent => {
    if (!disableConfirmed.value || !password.value.trim()) return;
    const api = await import('@/utils/storage/recovery');
    if (!isCurrent()) return;
    await api.disableRecovery(password.value.trim());
    if (!isCurrent()) return;
    invalidate();
    ElMessage.success(t('recovery.disabledSuccess'));
    emit('update:modelValue', false);
  });
const backToEdit = (): void => {
  if (busy.value) return;
  draft.value = null;
  password.value = '';
  error.value = '';
};
watch(
  () => props.modelValue,
  open => {
    if (open) void loadStatus();
  },
  { immediate: true },
);
</script>

<style scoped>
.recovery-body {
  /* 高度与滚动一律走 App.vue 的 .dialog-body-scroll 约定（70vh + 细滚动条），
     这里只留本组件特有的换行规则，避免再造一套弹窗滚动机制。 */
  overflow-wrap: anywhere;
}
.metadata {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
}
.metadata dd {
  margin: 0;
}
.disable-section {
  display: grid;
  gap: 12px;
  margin-top: 20px;
}
.disable-check {
  height: auto;
  white-space: normal;
}
.disable-check :deep(.el-checkbox__label) {
  white-space: normal;
}
.recovery-error {
  color: var(--el-color-danger);
}
</style>
