<template>
  <section
    ref="root"
    class="save-step"
    :aria-label="t('recovery.saveTitle')"
    :aria-busy="busy"
  >
    <h3>{{ t('recovery.saveTitle') }}</h3>
    <p>{{ t('recovery.saveWarning') }}</p>
    <template v-if="!hidden">
      <code
        ref="code"
        class="recovery-key"
        data-recovery-key
        >{{ material.recoveryKey }}</code
      >
      <div class="actions">
        <el-button
          :disabled="busy"
          @click="downloadKit"
          >{{ t('recovery.downloadKit') }}</el-button
        >
        <el-button
          type="primary"
          :disabled="busy"
          @click="hideCode"
          >{{ t('recovery.savedContinue') }}</el-button
        >
      </div>
    </template>
    <form
      v-else
      class="confirmation"
      @submit.prevent="confirm"
    >
      <p role="status">{{ t('recovery.reenterHint') }}</p>
      <RecoveryKeyInput
        v-model="confirmation"
        :label="t('recovery.confirmKey')"
        :disabled="busy"
      />
      <el-button
        native-type="submit"
        type="primary"
        :loading="busy"
        :disabled="busy || !confirmation.trim()"
      >
        {{ t('recovery.confirmSaved') }}
      </el-button>
    </form>
    <p
      v-if="error"
      class="save-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue';
import type { RecoveryMaterial } from '@/utils/recoveryTypes';
import { serializeRecoveryKit } from '@/utils/recoveryCrypto';
import { clearRecoveryInputs, recoveryErrorMessage } from '@/utils/recoveryUi';
import { useI18n } from '@/utils/i18n';
import RecoveryKeyInput from './RecoveryKeyInput.vue';

const props = defineProps<{ material: RecoveryMaterial; busy?: boolean }>();
const emit = defineEmits<{ confirm: [confirmation: string] }>();
const { t } = useI18n();
const root = useTemplateRef<HTMLElement>('root');
const code = useTemplateRef<HTMLElement>('code');
const hidden = shallowRef(false);
const confirmation = shallowRef('');
const error = shallowRef('');
let downloadUrl: string | undefined;
let revokeTimer: ReturnType<typeof setTimeout> | undefined;
let epoch = 0;

const revokeDownload = (): void => {
  if (revokeTimer) clearTimeout(revokeTimer);
  revokeTimer = undefined;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
};
/** Blob URL 仅为不含密钥的浏览器随机句柄；文件名固定，密钥只在文件内容中。 */
const downloadKit = (): void => {
  if (props.busy || hidden.value) return;
  revokeDownload();
  error.value = '';
  try {
    const blob = new Blob([serializeRecoveryKit(props.material)], { type: 'application/json' });
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'offline-recovery.aphrecovery';
    link.click();
    link.removeAttribute('href');
    revokeTimer = setTimeout(revokeDownload, 0);
  } catch (cause: unknown) {
    revokeDownload();
    error.value = recoveryErrorMessage(cause);
  }
};
const hideCode = async (): Promise<void> => {
  if (props.busy) return;
  const token = epoch;
  if (code.value) code.value.textContent = '';
  hidden.value = true;
  confirmation.value = '';
  revokeDownload();
  await nextTick();
  if (token === epoch) root.value?.querySelector<HTMLInputElement>('input')?.focus();
};
const confirm = (): void => {
  if (props.busy || !hidden.value || !confirmation.value.trim()) return;
  emit('confirm', confirmation.value);
  confirmation.value = '';
  clearRecoveryInputs(root.value);
};
const clear = (): void => {
  epoch++;
  confirmation.value = '';
  error.value = '';
  hidden.value = true;
  if (code.value) code.value.textContent = '';
  clearRecoveryInputs(root.value);
  revokeDownload();
};
watch(
  () => props.material,
  () => {
    clear();
    hidden.value = false;
  },
  { flush: 'sync' },
);
window.addEventListener('pagehide', clear);
onBeforeUnmount(() => {
  clear();
  window.removeEventListener('pagehide', clear);
});
</script>

<style scoped>
.save-step,
.confirmation {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.save-step h3,
.save-step p {
  margin: 0;
}
.recovery-key {
  padding: 12px;
  overflow-wrap: anywhere;
  user-select: all;
  background: var(--aph-surface-hover);
  border: 1px solid var(--aph-surface-line);
  border-radius: 6px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions :deep(.el-button) {
  max-width: 100%;
  height: auto;
  min-height: 32px;
  margin: 0;
  white-space: normal;
}
.save-error {
  color: var(--el-color-danger);
}
</style>
