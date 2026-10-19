<template>
  <section
    class="activation"
    aria-labelledby="activation-title"
  >
    <div class="activation__head">
      <div>
        <h3
          id="activation-title"
          class="activation__title"
        >
          {{ t('options.activation.title') }}
        </h3>
        <p class="activation__desc">
          {{ t('options.activation.desc', { done: doneCount, total: totalSteps }) }}
        </p>
      </div>
      <el-button
        link
        size="small"
        class="activation__dismiss"
        @click="$emit('dismiss')"
      >
        {{ t('options.activation.dismiss') }}
      </el-button>
    </div>

    <div
      class="activation__progress"
      role="progressbar"
      :aria-label="t('options.activation.desc', { done: doneCount, total: totalSteps })"
      :aria-valuenow="doneCount"
      aria-valuemin="0"
      :aria-valuemax="totalSteps"
    >
      <span
        class="activation__progress-fill"
        :style="{ width: `${(doneCount / totalSteps) * 100}%` }"
      ></span>
    </div>

    <ol class="activation__steps">
      <li
        v-for="step in steps"
        :key="step.key"
        class="activation__step"
        :class="{ 'is-done': step.done }"
      >
        <el-icon
          class="activation__check"
          aria-hidden="true"
        >
          <CircleCheckFilled v-if="step.done" />
          <CircleCheck v-else />
        </el-icon>
        <span class="activation__label">{{ step.label }}</span>
        <span
          v-if="step.done"
          class="activation__done"
        >
          {{ t('options.activation.done') }}
        </span>
        <div
          v-else
          class="activation__actions"
        >
          <el-button
            v-for="action in step.actions"
            :key="action.key"
            size="small"
            :type="action.primary ? 'primary' : 'default'"
            @click="runAction(action.key)"
          >
            {{ action.label }}
          </el-button>
        </div>
      </li>
    </ol>

    <p class="activation__hint">{{ t('options.activation.hint') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CircleCheck, CircleCheckFilled } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';

/**
 * 安全起步清单
 *
 * 空库时由 EmptyGuide 承担添加/导入入口；本清单在已有至少一条密码后出现，
 * 把「备份」与「体检」这两个最容易被忽略的安全动作变成可勾选的剩余步骤。
 * 完成状态全部由页面派生（密码数量 / 最近验证备份 / 体检趋势），
 * 组件自身不读存储，也不包含任何账号数据。
 */
const props = defineProps<{
  hasPassword: boolean;
  hasBackup: boolean;
  hasHealthCheck: boolean;
}>();

type ActivationAction = 'add' | 'importData' | 'backup' | 'health';

const emit = defineEmits<{
  add: [];
  'import-data': [];
  backup: [];
  health: [];
  dismiss: [];
}>();

const { t } = useI18n();

const totalSteps = 3;

const doneCount = computed(() => [props.hasPassword, props.hasBackup, props.hasHealthCheck].filter(Boolean).length);

const steps = computed(() => [
  {
    key: 'password',
    label: t('options.activation.stepPassword'),
    done: props.hasPassword,
    actions: [
      { key: 'add' as const, label: t('options.activation.add'), primary: true },
      { key: 'importData' as const, label: t('options.activation.importData'), primary: false },
    ],
  },
  {
    key: 'backup',
    label: t('options.activation.stepBackup'),
    done: props.hasBackup,
    actions: [{ key: 'backup' as const, label: t('options.activation.backup'), primary: true }],
  },
  {
    key: 'health',
    label: t('options.activation.stepHealth'),
    done: props.hasHealthCheck,
    actions: [{ key: 'health' as const, label: t('options.activation.health'), primary: true }],
  },
]);

const runAction = (action: ActivationAction): void => {
  switch (action) {
    case 'add':
      emit('add');
      break;
    case 'importData':
      emit('import-data');
      break;
    case 'backup':
      emit('backup');
      break;
    case 'health':
      emit('health');
      break;
  }
};
</script>

<style scoped>
.activation {
  padding: 16px 18px;
  margin: 0 32px 16px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 12px;
  box-shadow: 0 2px 10px rgb(15 23 42 / 4%);
}

.activation__head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.activation__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--el-text-color-primary, #303133);
}

.activation__desc {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary, #909399);
}

.activation__dismiss {
  flex-shrink: 0;
}

.activation__progress {
  height: 4px;
  margin: 12px 0 6px;
  overflow: hidden;
  background: var(--el-fill-color, #f0f2f5);
  border-radius: 2px;
}

.activation__progress-fill {
  display: block;
  height: 100%;
  background: var(--el-color-primary, #409eff);
  border-radius: inherit;
  transition: width 0.25s ease;
}

.activation__steps {
  padding: 0;
  margin: 0;
  list-style: none;
}

.activation__step {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-height: 34px;
  padding: 5px 0;
}

.activation__check {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

.activation__step.is-done .activation__check {
  color: var(--el-color-success, #67c23a);
}

.activation__label {
  flex: 1;
  min-width: 160px;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
}

.activation__step.is-done .activation__label {
  color: var(--el-text-color-secondary, #909399);
  text-decoration: line-through;
}

.activation__done {
  font-size: 12px;
  color: var(--el-color-success, #67c23a);
}

.activation__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.activation__hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-placeholder, #a8abb2);
}

@media (prefers-reduced-motion: reduce) {
  .activation__progress-fill {
    transition: none;
  }
}
</style>
