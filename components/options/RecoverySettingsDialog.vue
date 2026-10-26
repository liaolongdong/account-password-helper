<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('recovery.settingsTitle')"
    width="min(520px, calc(100vw - 24px))"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!busy && !draft"
    :show-close="!busy && !draft"
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
        <p
          role="status"
          class="state-line"
        >
          <span
            class="state-line__dot"
            :class="status.enabled ? 'state-line__dot--on' : 'state-line__dot--off'"
            aria-hidden="true"
          ></span>
          {{ status.enabled ? t('recovery.enabled') : t('recovery.disabled') }}
        </p>
        <!-- 损坏是「现在就有事」的状态，原先用普通 `<p role="alert">` 渲染：读屏会念，
             但眼睛看不出它和上一行平安状态有什么区别。换成 warning 型 alert，让颜色与图标
             跟上已经存在的语义角色（文字仍是同一句，不新增只用颜色表达的信息）。 -->
        <el-alert
          v-if="status.corrupted"
          class="state-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="t('recovery.corrupted')"
        />
        <dl
          v-if="status.config"
          class="metadata"
        >
          <dt>{{ t('recovery.createdAt') }}</dt>
          <dd>{{ formatCreatedAt(status.config.createdAt) }}</dd>
          <dt>{{ t('recovery.kitId') }}</dt>
          <!--
            套件编号是用户拿去比对「我保存的那份文件到底是哪一套」的唯一把手，因此走等宽 +
            单击全选，但刻意不加分组连字符：这个 id 会出现在套件文件名里，也是配置校验比对的
            原值，显示形态一旦和存储形态不一致，复制出去就对不上。
          -->
          <dd class="metadata__mono">{{ status.config.id }}</dd>
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
        <!-- 同 RecoveryResetDialog：`el-form-item` 必须有表单上下文才会走堆叠标签 -->
        <el-form
          v-else
          label-position="top"
          @submit.prevent="prepare"
        >
          <el-form-item :label="t('recovery.currentPassword')">
            <el-input
              v-model="password"
              type="password"
              autocomplete="current-password"
              show-password
              :placeholder="t('recovery.currentPasswordPlaceholder')"
              :aria-label="t('recovery.currentPassword')"
              :disabled="busy"
              @keydown="handleCapsKeyEvent"
              @keyup="handleCapsKeyEvent"
              @blur="resetCapsLockState"
            >
              <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏）。
                   这把密码同时还要驱动换发与停用两个动作，打错要能立刻看出来。 -->
              <template #password-icon="{ visible }">
                <el-icon>
                  <Hide v-if="visible" />
                  <View v-else />
                </el-icon>
              </template>
            </el-input>
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
              class="disable-section__action"
              type="danger"
              :disabled="busy || !password.trim() || !disableConfirmed"
              @click="disable"
            >
              {{ t('recovery.disable') }}
            </el-button>
          </div>
        </el-form>
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
      <!-- 仓库既有的页脚约定：15 处弹窗用 .dialog-footer 收口相邻 12px 边距，不再各写各的 -->
      <div class="dialog-footer">
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
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { shallowRef, useTemplateRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import type { RecoveryDraft, RecoveryStatus } from '@/utils/storage/recoveryTypes';
import { clearRecoveryInputs } from '@/utils/recoveryUi';
import { loadRecoveryStatus, useRecoveryOperation } from '@/composables/useRecoveryOperation';
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
/**
 * 套件创建时间只精确到分钟。
 *
 * 这一行的用途是「认出眼前这套是哪一次换发出来的」，秒级精度对这个判断没有贡献，
 * 只会让 `2026-10-25 00:31:20` 比 `2026-10-25 00:31` 多占一位并更难扫读。
 * 仍走 `toLocaleString(currentLocale)`，不改成仓库里那个固定格式的 `formatDateTime`，
 * 以免英文态突然换成一套与页面其余位置不同的日期写法。
 */
const formatCreatedAt = (ts: number): string =>
  new Date(ts).toLocaleString(currentLocale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
const loadStatus = (): Promise<void> => loadRecoveryStatus(run, status);
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
.metadata dt {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}
.metadata dd {
  margin: 0;
}

/* 套件编号是十六进制长串，等宽字体让相邻两套的差别看得出来；
   `user-select: all` 让单击即整串选中。仍沿用容器的 `overflow-wrap: anywhere`，
   窄窗口下宁可折行也不要横向溢出。 */
.metadata__mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-ligatures: none;
  user-select: all;
}
.state-line {
  display: flex;
  gap: 8px;
  align-items: center;
}
.state-line__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.state-line__dot--on {
  /* 与 `--aph-*` 令牌同族的既有 EP 语义色，非新造调色板 */
  background: var(--el-color-success);
}
.state-line__dot--off {
  background: var(--el-text-color-placeholder);
}
.state-alert {
  margin: 0 0 14px;
}

/* 停用是全弹窗唯一的不可逆动作，原先只靠 20px 外边距与上文分离——警告语、勾选框、
   红色按钮三段裸排在一片空白里，读起来像没人认领的孤儿控件。给它一层危险色容器，
   边界本身就是「这一段会丢数据」的语义；颜色沿用仓库既有的 danger-light-9/7 档位。 */
.disable-section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  margin-top: 20px;
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 8px;
}

.disable-section p {
  margin: 0;
}

/* `.disable-section` 是 grid，按钮默认被拉成整行宽——低频破坏性动作反而成了
   全屏最响的一块。收回内容宽度，与上方那颗主操作按钮同一档。 */
.disable-section__action {
  justify-self: start;
}
.disable-check {
  height: auto;
  white-space: normal;
}
.disable-check :deep(.el-checkbox__label) {
  white-space: normal;
}
.recovery-error {
  color: var(--aph-danger-strong);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
