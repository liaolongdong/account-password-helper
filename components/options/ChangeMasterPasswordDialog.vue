<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.changeMasterPassword')"
    width="440px"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    @update:model-value="requestClose"
  >
    <div
      v-if="modelValue"
      ref="sensitiveRoot"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      >
        <template #title>{{ t('options.changePwd.alertTitle') }}</template>
        <template #default>{{ t('options.changePwd.alertDesc') }}</template>
      </el-alert>

      <template v-if="draft">
        <!-- 内滚走 App.vue 的 .dialog-body-scroll 全局约定，且只加在「换发套件」这一步
             （恢复启用后才会出现的新状态）；改密表单本身的呈现与改造前逐字一致。 -->
        <div class="dialog-body-scroll">
          <p>{{ t('recovery.rekeyWarning') }}</p>
          <RecoveryKitSaveStep
            :material="draft.material"
            :busy="loading"
            @confirm="confirmReplacement"
          />
        </div>
      </template>
      <el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        :disabled="loading"
      >
        <el-form-item
          :label="t('options.changePwd.oldPassword')"
          prop="oldPassword"
        >
          <el-input
            v-model="form.oldPassword"
            type="password"
            :placeholder="t('options.changePwd.oldPasswordPlaceholder')"
            show-password
            @keyup.enter="handleSubmit"
            @keydown="handleOldCapsKeyEvent"
            @keyup="handleOldCapsKeyEvent"
            @blur="resetOldCapsLockState"
          >
            <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
            <template #password-icon="{ visible }">
              <el-icon>
                <Hide v-if="visible" />
                <View v-else />
              </el-icon>
            </template>
          </el-input>
          <CapsLockHint v-if="oldCapsLockOn" />
        </el-form-item>

        <el-form-item
          :label="t('options.changePwd.newPassword')"
          prop="newPassword"
        >
          <PasswordStrengthPopover
            v-model:visible="newPasswordFocused"
            :title="t('auth.passwordRequirements')"
            :hint="t('auth.passwordRequirementsHint')"
            :password="form.newPassword"
            :strength="passwordStrength"
            :rules="passwordRules"
          >
            <el-input
              v-model="form.newPassword"
              type="password"
              :placeholder="t('options.changePwd.newPasswordPlaceholder')"
              show-password
              @focus="newPasswordFocused = true"
              @blur="handleNewPasswordBlur"
              @keydown="handleNewCapsKeyEvent"
              @keyup="handleNewCapsKeyEvent"
              @keyup.enter="handleSubmit"
            >
              <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
              <template #password-icon="{ visible }">
                <el-icon>
                  <Hide v-if="visible" />
                  <View v-else />
                </el-icon>
              </template>
            </el-input>
          </PasswordStrengthPopover>
          <CapsLockHint v-if="newCapsLockOn" />
        </el-form-item>

        <el-form-item
          :label="t('options.changePwd.confirmPassword')"
          prop="confirmPassword"
        >
          <el-input
            v-model="form.confirmPassword"
            type="password"
            :placeholder="t('options.changePwd.confirmPasswordPlaceholder')"
            show-password
            @keyup.enter="handleSubmit"
            @keydown="handleConfirmCapsKeyEvent"
            @keyup="handleConfirmCapsKeyEvent"
            @blur="resetConfirmCapsLockState"
          >
            <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
            <template #password-icon="{ visible }">
              <el-icon>
                <Hide v-if="visible" />
                <View v-else />
              </el-icon>
            </template>
          </el-input>
          <CapsLockHint v-if="confirmCapsLockOn" />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button
        v-if="draft"
        :disabled="loading"
        @click="backToEdit"
        >{{ t('recovery.backToEdit') }}</el-button
      >
      <el-button
        :disabled="loading"
        @click="requestClose(false)"
      >
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        v-if="!draft"
        type="primary"
        :loading="loading"
        @click="handleSubmit"
      >
        {{ loading ? t('options.changePwd.reencrypting') : t('options.changePwd.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, shallowRef, useTemplateRef } from 'vue';
import { ElMessage, type FormInstance, type FormRules, type FormItemRule } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import PasswordStrengthPopover from './PasswordStrengthPopover.vue';
import RecoveryKitSaveStep from './RecoveryKitSaveStep.vue';
import CapsLockHint from '@/components/CapsLockHint.vue';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useRecoveryOperation } from '@/composables/useRecoveryOperation';
import { clearRecoveryInputs, recoveryErrorMessage } from '@/utils/recoveryUi';
import { logger } from '@/utils/logger';
import type { RecoveryDraft } from '@/utils/storage/recoveryTypes';
import { changeMasterPassword } from '@/utils/storage/changeMasterPassword';
import { useI18n } from '@/utils/i18n';

/**
 * 修改主密码对话框
 *
 * 验证旧密码 → 输入新密码（含强度校验）→ 确认 → 全库 rekey 重加密 → 刷新会话。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 修改成功事件：父组件据此确定性重载密码列表（不依赖 storage watcher 时序） */
  success: [];
}>();

const { t } = useI18n();

/** 旧/新/确认密码分别独立检测大写锁定（仅当前输入字段展示提示） */
const {
  capsLockOn: oldCapsLockOn,
  handleCapsKeyEvent: handleOldCapsKeyEvent,
  resetCapsLockState: resetOldCapsLockState,
} = useCapsLockDetection();
const {
  capsLockOn: newCapsLockOn,
  handleCapsKeyEvent: handleNewCapsKeyEvent,
  resetCapsLockState: resetNewCapsLockState,
} = useCapsLockDetection();
const {
  capsLockOn: confirmCapsLockOn,
  handleCapsKeyEvent: handleConfirmCapsKeyEvent,
  resetCapsLockState: resetConfirmCapsLockState,
} = useCapsLockDetection();

/** 新密码失焦：收起强度气泡并清除大写锁定提示 */
const handleNewPasswordBlur = (): void => {
  newPasswordFocused.value = false;
  resetNewCapsLockState();
};

const formRef = ref<FormInstance>();
const draft = shallowRef<RecoveryDraft | null>(null);
const sensitiveRoot = useTemplateRef<HTMLElement>('sensitiveRoot');
const newPasswordFocused = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const newPasswordRef = computed(() => form.newPassword);
const { strength: passwordStrength, rules: passwordRules } = usePasswordStrength(newPasswordRef);

/** 密码强度校验器：必须至少为「中」 */
const strengthValidator: NonNullable<FormItemRule['validator']> = (_rule, _value, callback) => {
  if (form.newPassword && passwordStrength.value.level === 'weak') {
    callback(new Error(t('options.changePwd.weakPassword')));
  } else {
    callback();
  }
};

/** 确认密码校验器 */
const confirmValidator: NonNullable<FormItemRule['validator']> = (_rule, value, callback) => {
  if (value !== form.newPassword) {
    callback(new Error(t('common.pwdMismatch')));
  } else {
    callback();
  }
};

/** 表单校验规则（computed 保证语言切换后错误提示同步更新） */
const rules = computed<FormRules>(() => ({
  oldPassword: [{ required: true, message: t('options.changePwd.oldPasswordPlaceholder'), trigger: 'blur' }],
  newPassword: [
    { required: true, message: t('options.changePwd.newPasswordRequired'), trigger: 'blur' },
    { min: 8, message: t('options.changePwd.minLength'), trigger: 'blur' },
    { validator: strengthValidator, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: t('options.changePwd.confirmRequired'), trigger: 'blur' },
    { validator: confirmValidator, trigger: 'blur' },
  ],
}));

/** 关闭、锁定卸载与页面离开均清除主密码和未激活草稿。 */
const clearSecrets = (): void => {
  form.oldPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  draft.value = null;
  newPasswordFocused.value = false;
  formRef.value?.clearValidate();
  resetOldCapsLockState();
  resetNewCapsLockState();
  resetConfirmCapsLockState();
  clearRecoveryInputs(sensitiveRoot.value);
};
/**
 * 失败呈现沿用改造前的口径：既有三个码各自的本机文案 toast，其余落到通用兜底。
 *
 * 存储层用 `Object.assign(new Error(...), { code })` 携带稳定错误码，直出的 `error.message`
 * 是存储层中文串，塞进本地化模板会让英文界面夹进中文，所以按码分流；未登记的码才回退到
 * 改造前的 `options.changePwd.failed` 兜底串，不让既有反馈渠道被内联告警换掉。
 */
const presentChangeError = (cause: unknown): void => {
  logger.error('修改主密码失败:', cause);
  const { message: msg = '', code } = (cause ?? {}) as { message?: string; code?: string };
  if (code === 'REKEY_CONCURRENT_WRITE') {
    // 重加密期间另一张管理页标签写过数据，快照复验主动取消了这次换钥（数据仍完整可读）
    ElMessage.error(t('options.changePwd.concurrentWrite'));
  } else if (code === 'WRONG_PASSWORD' || msg.includes('验证失败')) {
    ElMessage.error(t('options.changePwd.wrongOldPassword'));
  } else if (code === 'EMPTY_PASSWORD') {
    // 纯空白新密码过得了 required/min 规则，归一化后在存储层被拒，这里给出本地化提示
    ElMessage.error(t('options.changePwd.newPasswordRequired'));
  } else {
    ElMessage.error(
      recoveryErrorMessage(cause, t('options.changePwd.failed', { msg: msg || t('message.unknownError') })),
    );
  }
};
const {
  busy: loading,
  run,
  invalidate,
} = useRecoveryOperation(() => props.modelValue, clearSecrets, presentChangeError);
const requestClose = (value: boolean): void => {
  if (loading.value || value) return;
  invalidate();
  emit('update:modelValue', false);
};
/**
 * 收尾：`relock-required` 表示数据与新校验值已经提交，只是会话材料没能发布。
 * 此时仍报「修改成功」会误导用户以为解锁态延续，必须改口为「请用新主密码重新解锁」。
 */
const finish = (outcome?: 'relock-required'): void => {
  invalidate();
  if (outcome === 'relock-required') {
    ElMessage.warning(t('recovery.relockRequired'));
  } else {
    ElMessage.success(t('options.changePwd.success'));
  }
  emit('update:modelValue', false);
  emit('success');
};

/** 未启用恢复时沿用两参数改密；启用时先保存新套件，不要求旧恢复码。 */
const handleSubmit = () =>
  run(async isCurrent => {
    if (!formRef.value || draft.value) return;
    try {
      await formRef.value.validate();
    } catch {
      return;
    }
    if (!isCurrent()) return;
    const { prepareChangedPasswordRecovery } = await import('@/utils/storage/recovery');
    if (!isCurrent()) return;
    const prepared = await prepareChangedPasswordRecovery(form.oldPassword, form.newPassword);
    if (!isCurrent()) return;
    if (prepared) {
      clearRecoveryInputs(sensitiveRoot.value);
      newPasswordFocused.value = false;
      draft.value = prepared;
      return;
    }
    const outcome = await changeMasterPassword(form.oldPassword, form.newPassword);
    if (isCurrent()) finish(outcome);
  });

const confirmReplacement = (confirmation: string) =>
  run(async isCurrent => {
    if (!draft.value) return;
    const outcome = await changeMasterPassword(form.oldPassword, form.newPassword, {
      draft: draft.value,
      confirmation,
    });
    if (isCurrent()) finish(outcome);
  });
/** 退回编辑只作废未提交的套件草稿；表单里已输入的密码沿用，失败反馈一律走 toast（无内联态可清）。 */
const backToEdit = (): void => {
  if (loading.value) return;
  draft.value = null;
};
</script>
