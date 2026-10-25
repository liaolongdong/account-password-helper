<template>
  <section
    class="backup-check"
    :aria-labelledby="`${id}-title`"
  >
    <h5
      :id="`${id}-title`"
      class="backup-check__title"
    >
      {{ t('options.forgot.checkTitle') }}
    </h5>
    <p
      :id="`${id}-note`"
      class="backup-check__note"
    >
      {{ t('options.forgot.checkOnly') }}
    </p>
    <form
      class="backup-check__form"
      :aria-describedby="`${id}-note`"
      :aria-busy="checking"
      @submit.prevent="handleVerify"
    >
      <label :for="`${id}-file`">{{ t('options.forgot.checkFile') }}</label>
      <!--
        原生 input 只负责取文件，皮肤交给 el-button；`display:none` 而非移出 DOM——
        `files` 与 `change` 是这条链路唯一的取文件入口。选中的文件名由下面的
        `selectedFile` 自己回显，因为 `input.value` 会在取到文件后立即清空。
      -->
      <div class="backup-check__picker">
        <el-button @click="pickFile">{{ t('common.chooseFile') }}</el-button>
        <span
          v-if="selectedFile"
          class="backup-check__file-name"
          role="status"
        >
          {{ t('common.fileSelected', { name: selectedFile.name }) }}
        </span>
        <span
          v-else
          class="backup-check__file-name backup-check__file-name--empty"
        >
          {{ t('common.noFileSelected') }}
        </span>
      </div>
      <input
        :id="`${id}-file`"
        ref="fileInput"
        class="backup-check__file"
        type="file"
        accept=".aph,.aphid"
        @change="handleFileChange"
      />
      <label :for="`${id}-password`">{{ t('options.forgot.checkPassword') }}</label>
      <el-input
        :id="`${id}-password`"
        ref="passwordInput"
        v-model="password"
        type="password"
        show-password
        autocomplete="off"
      />
      <el-button
        class="backup-check__button"
        native-type="submit"
        type="primary"
        :loading="checking"
        :disabled="!canVerify"
      >
        {{ t('options.forgot.checkAction') }}
      </el-button>
    </form>
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        v-if="checking"
        class="backup-check__note"
      >
        {{ t('options.forgot.checkPending') }}
      </p>
      <el-alert
        v-else-if="result"
        class="backup-check__result"
        type="success"
        :closable="false"
        show-icon
        :title="successMessage"
        :description="t('options.forgot.checkOnly')"
      />
      <el-alert
        v-else-if="errorMessage"
        class="backup-check__result"
        type="error"
        :closable="false"
        show-icon
        :title="t('options.forgot.checkFailureTitle')"
        :description="errorMessage"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, useTemplateRef, watch } from 'vue';
import type { InputInstance } from 'element-plus';
import type { BackupVerificationResult } from '@/utils/backup/type';
import { verifyBackupFile } from '@/utils/backup/verifyBackupFile';
import { BackupImportUserError } from '@/utils/backupExport';
import { useI18n } from '@/utils/i18n';

/** 只读验证区：独占临时输入，不向父级传递密码、文件或解密数据；父级关闭时卸载。 */
const { t } = useI18n();
const id = useId();
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const passwordInput = useTemplateRef<InputInstance>('passwordInput');
const selectedFile = shallowRef<File | null>(null);
const password = shallowRef('');
const checking = shallowRef(false);
const result = shallowRef<BackupVerificationResult | null>(null);
const errorMessage = shallowRef('');
let generation = 0;
let disposed = false;

const canVerify = computed(() => !checking.value && selectedFile.value !== null && password.value.trim() !== '');
const successMessage = computed(() => {
  if (!result.value) return '';
  const kind =
    result.value.kind === 'passwords' ? t('options.forgot.checkPasswords') : t('options.forgot.checkIdentities');
  return t('options.forgot.checkSuccess', { kind, count: result.value.count });
});

/** 同步作废：即使改回原输入，也不接受前一轮结果。 */
watch(
  [selectedFile, password],
  () => {
    generation++;
    result.value = null;
    errorMessage.value = '';
  },
  { flush: 'sync' },
);

/** 转发到隐藏的 file input，避免为取一个文件再引入上传组件。 */
function pickFile(): void {
  fileInput.value?.click();
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
  // 立即清空 value：验证失败后重挑同一份文件是最常见的动作，
  // 不清空则 value 未变、`change` 不再触发，用户只能眼看按钮一直灰着。
  input.value = '';
}

/** Web Crypto 不支持取消；输入变化后仅丢弃结果，完成前仍禁重复提交。 */
async function handleVerify(): Promise<void> {
  if (!canVerify.value || !selectedFile.value || disposed) return;
  const requestGeneration = generation;
  checking.value = true;
  result.value = null;
  errorMessage.value = '';
  try {
    const summary = await verifyBackupFile(selectedFile.value, password.value);
    if (!disposed && requestGeneration === generation) result.value = summary;
  } catch (error: unknown) {
    if (!disposed && requestGeneration === generation) {
      errorMessage.value = error instanceof BackupImportUserError ? error.message : t('options.forgot.checkFailed');
    }
  } finally {
    if (!disposed) checking.value = false;
  }
}

onBeforeUnmount(() => {
  disposed = true;
  generation++;
  password.value = '';
  selectedFile.value = null;
  result.value = null;
  errorMessage.value = '';
  // 卸载不再调度渲染，显式擦除仍可能被关闭动画持有的 DOM 输入值。
  if (fileInput.value) fileInput.value.value = '';
  if (passwordInput.value?.input) passwordInput.value.input.value = '';
});
</script>

<style scoped>
.backup-check {
  padding: 12px;
  margin-top: 10px;
  background: var(--aph-surface-2);
  border: 1px solid var(--aph-primary-border);
  border-radius: 8px;
}

.backup-check__title {
  margin: 0;
  font-size: 13px;
  color: var(--aph-text-primary);
}

.backup-check__note {
  margin: 6px 0;
  color: var(--aph-text-secondary);
}

.backup-check__form {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.backup-check__file {
  display: none;
}

.backup-check__picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.backup-check__file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--aph-text-primary);
  white-space: nowrap;
}

.backup-check__file-name--empty {
  color: var(--aph-text-secondary);
}

.backup-check__button {
  justify-self: start;
  margin-top: 4px;
}

.backup-check__result {
  margin-top: 10px;
}
</style>
