<template>
  <div
    ref="root"
    class="recovery-input"
  >
    <label :for="inputId">{{ label }}</label>
    <el-input
      :id="inputId"
      :model-value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      :maxlength="RECOVERY_FORMAT.maxInputLength"
      type="password"
      autocomplete="off"
      show-password
      @update:model-value="updateInput"
    >
      <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏）。
           恢复码是 18 组十六进制，盲打回填看不到自己抄错了什么，没有显隐切换就只能整串重来。 -->
      <template #password-icon="{ visible }">
        <el-icon>
          <Hide v-if="visible" />
          <View v-else />
        </el-icon>
      </template>
    </el-input>
    <label :for="fileId">{{ t('recovery.uploadKit') }}</label>
    <input
      :id="fileId"
      ref="fileInput"
      type="file"
      accept=".aphrecovery,.json,application/json"
      :disabled="disabled || reading"
      :aria-label="t('recovery.uploadKit')"
      @change="readFile"
    />
    <p
      v-if="error"
      class="input-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, shallowRef, useId, useTemplateRef, watch } from 'vue';
import { View, Hide } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';
import { RECOVERY_FORMAT } from '@/utils/recoveryTypes';
import { clearRecoveryInputs, readRecoveryInputFile, recoveryErrorMessage } from '@/utils/recoveryUi';

const props = defineProps<{ modelValue: string; label: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const { t } = useI18n();
const inputId = useId();
const fileId = useId();
const root = useTemplateRef<HTMLElement>('root');
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const error = shallowRef('');
const reading = shallowRef(false);
let epoch = 0;

const updateInput = (value: string): void => {
  epoch++;
  error.value = '';
  if (fileInput.value) fileInput.value.value = '';
  emit('update:modelValue', value);
};

/** 文件仅在本地读取；格式/校验和/套件 id 的认证由存储和 crypto 边界执行。 */
const readFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || props.disabled || reading.value) return;
  const token = ++epoch;
  emit('update:modelValue', '');
  error.value = '';
  reading.value = true;
  try {
    const text = await readRecoveryInputFile(file);
    if (token === epoch && !props.disabled) emit('update:modelValue', text);
  } catch (cause: unknown) {
    if (token === epoch) error.value = recoveryErrorMessage(cause);
  } finally {
    reading.value = false;
  }
};
const clear = (): void => {
  epoch++;
  error.value = '';
  clearRecoveryInputs(root.value);
};
watch(
  () => props.disabled,
  disabled => {
    if (disabled) epoch++;
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
.recovery-input {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.recovery-input input {
  max-width: 100%;
}
.input-error {
  margin: 0;
  color: var(--el-color-danger);
}
</style>
