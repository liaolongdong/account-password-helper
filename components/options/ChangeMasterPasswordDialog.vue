<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.changeMasterPassword')"
    width="440px"
    align-center
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
        class="change-pwd-alert"
        style="margin-bottom: 16px"
      >
        <template #title>{{ t('options.changePwd.alertTitle') }}</template>
        <template #default>
          {{ t('options.changePwd.alertDesc') }}
          <span
            v-if="recoveryEnabled"
            class="change-pwd-alert__recovery"
          >
            {{ t('options.changePwd.alertDescRecovery') }}
          </span>
        </template>
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
      <!-- 恢复开启时它出现在套件步骤之后；恢复关闭时改密仍可能被坏记录挡住，所以必须放在两个分支之外。 -->
      <RecoverySkipConsent
        v-if="offerSkip"
        v-model="allowSkip"
        :disabled="loading"
        mode="change"
      />
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
import { ref, reactive, computed, shallowRef, useTemplateRef, onMounted } from 'vue';
import { ElMessage, type FormInstance, type FormRules, type FormItemRule } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import PasswordStrengthPopover from './PasswordStrengthPopover.vue';
import RecoveryKitSaveStep from './RecoveryKitSaveStep.vue';
import RecoverySkipConsent from './RecoverySkipConsent.vue';
import CapsLockHint from '@/components/CapsLockHint.vue';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useRecoveryOperation } from '@/composables/useRecoveryOperation';
import { clearRecoveryInputs, recoveryErrorCode, recoveryErrorMessage } from '@/utils/recoveryUi';
import { VAULT_ERROR_CODES } from '@/utils/recoveryTypes';
import { logger } from '@/utils/logger';
import type { RecoveryDraft, VaultRekeyResult } from '@/utils/storage/recoveryTypes';
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
/**
 * 第一屏要不要提前点名「旧套件作废」
 *
 * 判据与套件那一步是否出现完全同源（`prepareChangedPasswordRecovery` 也只认
 * `getRecoveryStatus().enabled`），所以这里只是把同一个事实往前搬一屏，不另立规则。
 * 本弹窗由父级 `v-if` 挂载，开一次读一次，无需 watch。刻意不走 `useRecoveryOperation.run`：
 * 那会把 `busy` 点亮，等于给「打开弹窗」新增一个禁用表单的瞬间，改变既有交互。
 * 读失败按未启用处理——真正的门禁在存储层（`RECOVERY_REPLACEMENT_REQUIRED`），
 * 少一句话不会让任何人绕过换发。
 */
const recoveryEnabled = ref(false);
onMounted(() => {
  void (async () => {
    try {
      const api = await import('@/utils/storage/recovery');
      recoveryEnabled.value = (await api.getRecoveryStatus()).enabled;
    } catch (error) {
      logger.warn('读取离线恢复启用态失败，第一屏按未启用呈现:', error);
    }
  })();
});
/** 改密确实被「有记录解不开」挡过一次后，才亮出知情携带的门 */
const offerSkip = shallowRef(false);
/** 用户已勾选知情携带；下一次提交会把 allowUndecryptable 传给存储层 */
const allowSkip = shallowRef(false);
const sensitiveRoot = useTemplateRef<HTMLElement>('sensitiveRoot');
const newPasswordFocused = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const newPasswordRef = computed(() => form.newPassword);
const { strength: passwordStrength, rules: passwordRules } = usePasswordStrength(newPasswordRef);

/**
 * 新密码强度校验器：必须四条规则全通过（≥8 位 + 字母 + 数字 + 符号）
 *
 * 原先判的是 `level === 'weak'`，而 `level` 在通过数 ≥2 时即升为 `medium`
 * （`utils/passwordStrengthCore.ts` 的等级映射），等于只要求四条里的两条——
 * 于是「创建主密码时不允许的强度，改密时能设进去」，把库降级到比首次设置更弱的密钥。
 * 同时存储层的 `normalizeNewMasterPassword` 判的就是 `allPassed`，同一串密码会在
 * 启用/未启用离线恢复时得到两种结果，弹窗放行、提交被拒。
 * 对齐到 `allPassed` 后三处（创建 / 改密 / 恢复换钥）共用同一道门槛。
 */
const strengthValidator: NonNullable<FormItemRule['validator']> = (_rule, _value, callback) => {
  if (form.newPassword && !passwordStrength.value.allPassed) {
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
  offerSkip.value = false;
  allowSkip.value = false;
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
 * 存储层用 `Object.assign(new Error(...), { code })` 携带稳定错误码，一律**按码**分流。
 * 这里曾有一条 `msg.includes('验证失败')` 兜底，靠匹配中文串认出「不带码的旧密码校验失败」；
 * 现在抛方（`sessionManager-storage.ts`）已补齐 `WRONG_PASSWORD` 码，文案一改就静默降级成
 * 通用错误的脆弱匹配随之删除。
 * 未登记的码回落到 `options.changePwd.failed` 兜底串，但不再插值原始 `message`：
 * 本仓在 `utils/backupExport.ts` 已确立「解析/解密链路上的原始异常可能携带解密片段，
 * 不得进入用户可见文案与日志」的口径，此处与之对齐，只报「未知错误」。
 */
const presentChangeError = (cause: unknown): void => {
  logger.error('修改主密码失败:', cause);
  const { code } = (cause ?? {}) as { code?: string };
  if (code === VAULT_ERROR_CODES.REKEY_CONCURRENT_WRITE) {
    // 重加密期间另一张管理页标签写过数据，快照复验主动取消了这次换钥（数据仍完整可读）
    ElMessage.error(t('options.changePwd.concurrentWrite'));
  } else if (code === VAULT_ERROR_CODES.WRONG_PASSWORD) {
    ElMessage.error(t('options.changePwd.wrongOldPassword'));
  } else if (code === VAULT_ERROR_CODES.EMPTY_PASSWORD) {
    // 纯空白新密码过得了 required/min 规则，归一化后在存储层被拒，这里给出本地化提示
    ElMessage.error(t('options.changePwd.newPasswordRequired'));
  } else {
    ElMessage.error(recoveryErrorMessage(cause, t('options.changePwd.failed', { msg: t('message.unknownError') })));
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
 * 收尾必须说实话，两件事各有一条文案：
 * - `relockRequired`：数据与新校验值已提交，只是会话材料没能发布（或本次本就处于锁定态）。
 *   照旧报「修改成功」会让用户以为解锁态延续，必须改口为「请用新主密码重新解锁」。
 * - `carriedUndecryptable`：原样携带过这次换钥的记录条数。它们留在库里但新主密码永远读不出，
 *   此前只在成功路径之外记一条日志，用户勾没勾「知情跳过」都看不到数字——为「旧密码疑似泄露」
 *   而改密的人尤其需要知道自己没拿到完整的密钥轮换，因此不再以勾选为前提，按条数点名。
 */
const finish = (result: VaultRekeyResult): void => {
  invalidate();
  if (result.relockRequired) {
    ElMessage.warning(t('recovery.relockRequired'));
  } else if (result.carriedUndecryptable > 0) {
    ElMessage.warning(t('recovery.partialChangeNote', { count: result.carriedUndecryptable }));
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
      offerSkip.value = false;
      allowSkip.value = false;
      draft.value = prepared;
      return;
    }
    try {
      const result = allowSkip.value
        ? await changeMasterPassword(form.oldPassword, form.newPassword, undefined, true)
        : await changeMasterPassword(form.oldPassword, form.newPassword);
      if (isCurrent()) finish(result);
    } catch (cause: unknown) {
      maybeOfferSkip(cause);
      throw cause;
    }
  });

/**
 * 默认仍是整笔中止；只有「密码/回收站里有记录解不开」这一种失败才亮知情门。
 * 结构损坏走 VAULT_DATA_CORRUPTED，不会伪造这扇门（见 assertDomainsIntact）。
 */
const maybeOfferSkip = (cause: unknown): void => {
  if (!allowSkip.value && recoveryErrorCode(cause) === VAULT_ERROR_CODES.UNDECRYPTABLE_RECORDS) {
    offerSkip.value = true;
  }
};

const confirmReplacement = (confirmation: string) =>
  run(async isCurrent => {
    const currentDraft = draft.value;
    if (!currentDraft) return;
    try {
      const replacement = { draft: currentDraft, confirmation };
      const result = allowSkip.value
        ? await changeMasterPassword(form.oldPassword, form.newPassword, replacement, true)
        : await changeMasterPassword(form.oldPassword, form.newPassword, replacement);
      if (isCurrent()) finish(result);
    } catch (cause: unknown) {
      maybeOfferSkip(cause);
      throw cause;
    }
  });
/** 退回编辑只作废未提交的套件草稿；表单里已输入的密码沿用，失败反馈一律走 toast（无内联态可清）。 */
const backToEdit = (): void => {
  if (loading.value) return;
  draft.value = null;
  offerSkip.value = false;
  allowSkip.value = false;
};
</script>

<style scoped>
/* 标题与描述的文字颜色由 `assets/theme/tokens.css` 的浅色告警覆写统一负责，这里不重复一份。
   补的那句用 span + display:block，不用 p：EP 会把默认插槽整个包进
   `<p class="el-alert__description">`，再放一个 p 就是非法嵌套——浏览器重新解析时
   会把它拆成兄弟节点，脱离那条颜色覆盖。 */
.change-pwd-alert__recovery {
  display: block;
  margin-top: 4px;
}
</style>
