<template>
  <div class="recovery-skip">
    <el-checkbox
      v-model="model"
      :disabled="disabled"
      class="recovery-skip__check"
    >
      {{ t(mode === 'change' ? 'recovery.skipChangeConfirm' : 'recovery.skipConfirm') }}
    </el-checkbox>
    <p class="recovery-skip__note">
      {{ t(mode === 'change' ? 'recovery.skipChangeNote' : 'recovery.skipNote') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '@/utils/i18n';

/**
 * 「知情携带坏记录」的共用确认块。
 *
 * 恢复与改密是两条链路，但语义完全相同：默认整笔中止，只有用户明确知道某些记录
 * 将永久读不出来之后，才允许把其余数据换钥并原样保留坏记录。文案按 mode 分流，
 * 避免改密时出现「恢复已中止」这种错位表述。
 */
defineProps<{
  disabled?: boolean;
  mode: 'recovery' | 'change';
}>();
const model = defineModel<boolean>({ required: true });
const { t } = useI18n();
</script>

<style scoped>
.recovery-skip {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  margin-top: 4px;
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 8px;
}
.recovery-skip__check {
  height: auto;
  white-space: normal;
}
.recovery-skip__check :deep(.el-checkbox__label) {
  line-height: 1.5;
  white-space: normal;
}
.recovery-skip__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}
</style>
