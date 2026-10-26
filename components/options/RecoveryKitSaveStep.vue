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
      <el-checkbox
        v-model="acknowledged"
        :disabled="busy"
        class="plaintext-ack"
      >
        {{ t('recovery.plaintextAck') }}
      </el-checkbox>
      <div class="actions">
        <el-button
          :disabled="busy || !acknowledged"
          @click="downloadKit"
          >{{ t('recovery.downloadKit') }}</el-button
        >
        <el-button
          type="primary"
          :disabled="busy || !acknowledged"
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
/**
 * 下载与「我已保存，隐藏原码」都必须先显式确认明文风险。
 *
 * 两道门拦的是两种不同的损失：下载会**多**一份副本（泄露风险），而隐藏原码会
 * `textContent = ''` 掉屏幕上**唯一**一份（丢失风险，且不可逆——只能换发新套件）。
 * 门只装在下载上时，恰好放过了后果更重的那一下；而知情同意的对象本来就该是
 * 「密钥材料」而不是「套件文件」，手抄路径同样适用。
 */
const acknowledged = shallowRef(false);
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
/** Blob URL 仅为不含密钥的浏览器随机句柄；文件名带上公开套件 id 前缀，多次换发才分得清哪份有效。 */
const downloadKit = (): void => {
  if (props.busy || hidden.value) return;
  revokeDownload();
  error.value = '';
  try {
    const blob = new Blob([serializeRecoveryKit(props.material)], { type: 'application/json' });
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `offline-recovery-${props.material.config.id.slice(0, 8)}.aphrecovery`;
    // JSON 下载必须先把锚点挂进文档再点：游离 `<a>` 在部分浏览器（含本扩展的 Firefox 产物）里
    // 是空操作，而这里点完就「隐藏原码」——静默失败等于让用户丢掉唯一一份密钥。
    document.body.appendChild(link);
    link.click();
    link.remove();
    link.removeAttribute('href');
    revokeTimer = setTimeout(revokeDownload, 0);
  } catch (cause: unknown) {
    revokeDownload();
    error.value = recoveryErrorMessage(cause);
  }
};
const hideCode = async (): Promise<void> => {
  if (props.busy || !acknowledged.value) return;
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
  acknowledged.value = false;
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
.plaintext-ack {
  height: auto;
  white-space: normal;
}
.plaintext-ack :deep(.el-checkbox__label) {
  line-height: 1.5;
  white-space: normal;
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
  color: var(--aph-danger-strong);
}
</style>
