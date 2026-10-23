<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.forgot.title')"
    width="620px"
    align-center
    :close-on-click-modal="false"
    class="forgot-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll forgot-body">
      <el-alert
        :title="t('options.forgot.lead')"
        :closable="false"
        show-icon
        type="warning"
      />

      <ol class="forgot-paths">
        <!-- 回想：设过提示语时才出现，排在所有恢复路径之前，成本最低 -->
        <li
          v-if="hasHint"
          class="forgot-path"
        >
          <h4 class="forgot-path__title">{{ t('options.forgot.recallTitle') }}</h4>
          <p class="forgot-path__body">{{ t('options.forgot.recallBody') }}</p>
        </li>

        <li class="forgot-path">
          <h4 class="forgot-path__title">{{ t('options.forgot.backupTitle') }}</h4>
          <p class="forgot-path__body">{{ t('options.forgot.backupBody') }}</p>
          <ul class="forgot-path__list">
            <li>{{ t('options.forgot.backupStep1') }}</li>
            <li>{{ t('options.forgot.backupStep2') }}</li>
            <li>{{ t('options.forgot.backupStep3') }}</li>
          </ul>
          <p class="forgot-path__warn">{{ t('options.forgot.backupWarn') }}</p>
        </li>

        <li class="forgot-path">
          <h4 class="forgot-path__title">{{ t('options.forgot.csvTitle') }}</h4>
          <p class="forgot-path__body">{{ t('options.forgot.csvBody') }}</p>
        </li>

        <li class="forgot-path forgot-path--last">
          <h4 class="forgot-path__title">{{ t('options.forgot.resetTitle') }}</h4>
          <p class="forgot-path__body">{{ t('options.forgot.resetBody') }}</p>
        </li>
      </ol>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="danger"
        @click="emit('reset')"
      >
        {{ t('options.forgot.resetBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useI18n } from '@/utils/i18n';

/**
 * 忘记密码找回向导
 *
 * 把「先回想、再用备份、最后才清空」的顺序固化在 UI 里：清空整库是既有且唯一
 * 不可撤销的路径，但它不该是解锁页上的第一个动作按钮。
 *
 * 只读展示，不触碰任何密钥材料；终点 `reset` 事件交回 `useAuthFlow.resetMasterPassword`，
 * 其 `lockSession → clearAllData` 序列与二次确认一律复用，不在本组件复制。
 */
defineProps<{
  /** 用户是否设置过主密码提示语（决定「先回想」这一步是否出现） */
  hasHint: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  reset: [];
}>();

const { t } = useI18n();
</script>

<style scoped>
.forgot-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.forgot-paths {
  padding: 0 0 0 18px;
  margin: 14px 0 0;
}

.forgot-path {
  margin-bottom: 14px;
}

.forgot-path__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.forgot-path__body {
  margin: 0;
}

.forgot-path__list {
  padding: 0 0 0 18px;
  margin: 6px 0 0;
}

.forgot-path__warn {
  margin: 6px 0 0;
  color: var(--el-color-warning);
}

.forgot-path--last {
  margin-bottom: 0;
}
</style>
