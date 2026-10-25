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
      :placeholder="t('recovery.keyPlaceholder')"
      :disabled="disabled"
      :maxlength="RECOVERY_FORMAT.maxInputLength"
      type="password"
      autocomplete="off"
      show-password
      @update:model-value="updateInput"
    >
      <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏）。
           恢复码是 9 组 8 位十六进制（32B 密钥 + 4B 校验和 = 72 字符），盲打回填看不到
           自己抄错了什么，没有显隐切换就只能整串重来。 -->
      <template #password-icon="{ visible }">
        <el-icon>
          <Hide v-if="visible" />
          <View v-else />
        </el-icon>
      </template>
    </el-input>
    <p class="recovery-input__format">
      {{ t('recovery.keyFormatHint') }}
    </p>
    <label :for="fileId">{{ t('recovery.uploadKit') }}</label>
    <div class="recovery-input__picker">
      <el-button
        :disabled="disabled || reading"
        :loading="reading"
        @click="pickFile"
      >
        {{ t('common.chooseFile') }}
      </el-button>
      <span
        v-if="fileName"
        class="recovery-input__file-name"
        role="status"
      >
        {{ t('common.fileSelected', { name: fileName }) }}
      </span>
      <span
        v-else
        class="recovery-input__file-name recovery-input__file-name--empty"
      >
        {{ t('common.noFileSelected') }}
      </span>
    </div>
    <!--
      原生 input 只负责取文件，皮肤交给 el-button；`display:none` 而非移出 DOM——
      `files` 与 `change` 是这条链路的唯一入口，卸载它等于砍掉文件回填。
      读成功后 `input.value` 会被立即清空（重选同一份文件才能再次触发 change），
      所以「选到了哪份文件」必须由下面的 fileName 自己说，不能指望原生控件回显。
    -->
    <input
      :id="fileId"
      ref="fileInput"
      class="recovery-input__file"
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
const fileName = shallowRef('');
let epoch = 0;

const updateInput = (value: string): void => {
  epoch++;
  error.value = '';
  fileName.value = '';
  if (fileInput.value) fileInput.value.value = '';
  emit('update:modelValue', value);
};

const pickFile = (): void => {
  if (props.disabled || reading.value) return;
  fileInput.value?.click();
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
  fileName.value = '';
  reading.value = true;
  try {
    const text = await readRecoveryInputFile(file);
    if (token !== epoch || props.disabled) return;
    // 名字只在读成功后亮：超限或异常时留空，避免「已选择 X」和紧随的报错互相打脸
    fileName.value = file.name;
    emit('update:modelValue', text);
  } catch (cause: unknown) {
    if (token === epoch) error.value = recoveryErrorMessage(cause);
  } finally {
    // 不受代际影响：`reading` 只表达「这次 IO 还在飞」，epoch 前进（用户改手打、弹窗被禁用）
    // 也必须落回 false，否则按钮永久停在 loading 且 `pickFile` 被自己挡住。
    reading.value = false;
  }
};
const clear = (): void => {
  epoch++;
  error.value = '';
  fileName.value = '';
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
.recovery-input__file {
  display: none;
}
.recovery-input__format {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.recovery-input__picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.recovery-input__file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.recovery-input__file-name--empty {
  color: var(--el-text-color-secondary);
}
.input-error {
  margin: 0;
  color: var(--el-color-danger);
}
</style>
