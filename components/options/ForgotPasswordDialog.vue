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

        <li
          v-if="recoveryAvailable"
          class="forgot-path"
        >
          <h4 class="forgot-path__title">{{ t('options.forgot.recoveryTitle') }}</h4>
          <p class="forgot-path__body">{{ t('options.forgot.recoveryBody') }}</p>
          <el-button
            size="small"
            type="primary"
            link
            @click="emit('use-recovery')"
          >
            {{ t('options.forgot.recoveryAction') }}
          </el-button>
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
          <BackupCheckPanel v-if="modelValue" />
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
import BackupCheckPanel from './BackupCheckPanel.vue';
import { useI18n } from '@/utils/i18n';

/**
 * 忘记密码找回向导
 *
 * 把「先回想、验证备份并隔离核对、最后才考虑清空」固化在 UI 里。
 * 验证区独占临时输入，关闭即卸载；向导自身不持有密码、文件或解密数据。
 * 终点 `reset` 事件交回 `useAuthFlow.resetMasterPassword`，
 * 其 `lockSession → clearAllData` 序列与二次确认一律复用，不在本组件复制。
 *
 * 「用离线恢复密钥取回」是第二条路径：它是本机数据唯一「不必事先有备份也能取回」的出口，
 * 入口原先只挂在解锁页的按钮行里，用户读完其余路径就直面红色的「仍然重置全部数据」——
 * 最该出现退路的地方反倒没有退路，因此在这里显式接回同一套恢复流程（不复制其实现）。
 */
defineProps<{
  /** 显式声明开关，关闭时同步移除验证区，避免仅隐藏后保留敏感输入。 */
  modelValue: boolean;
  /** 用户是否设置过主密码提示语（决定「先回想」这一步是否出现） */
  hasHint: boolean;
  /** 本机是否登记过离线恢复密钥（决定「用恢复密钥取回」这一步是否出现） */
  recoveryAvailable: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 交回解锁页既有的恢复流程：先收掉向导，再由父级打开同一个恢复弹窗（不在本组件复制实现） */
  'use-recovery': [];
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
  color: var(--aph-warning-strong);
}

.forgot-path--last {
  margin-bottom: 0;
}
</style>
