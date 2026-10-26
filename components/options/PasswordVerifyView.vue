<template>
  <div class="verify-page">
    <div class="verify-container">
      <div class="verify-header">
        <div class="logo-section">
          <BrandLogo class="logo" />
          <h1>{{ t('appName') }}</h1>
        </div>
        <p class="subtitle">{{ t('auth.verifySubtitle') }}</p>
      </div>

      <div class="verify-form">
        <el-card class="form-card">
          <el-form
            ref="localVerifyFormRef"
            :model="formModel"
            :rules="verifyRules"
            label-width="80px"
            label-position="top"
          >
            <el-form-item
              :label="t('auth.masterPassword')"
              prop="password"
            >
              <el-input
                v-model="formModel.password"
                type="password"
                :placeholder="t('auth.verifyPasswordPlaceholder')"
                show-password
                size="large"
                :disabled="verifyLoading"
                :class="{ shake: verifyShake }"
                :style="{ '--shake-duration': SHAKE_DURATION_MS + 'ms' }"
                :aria-invalid="Boolean(verifyError)"
                :aria-describedby="verifyError ? 'verify-error-inline' : undefined"
                autocomplete="current-password"
                @keyup.enter="handleSubmit"
                @keydown="handleCapsKeyEvent"
                @keyup="handleCapsKeyEvent"
                @blur="resetCapsLockState"
                @input="$emit('clearError')"
              >
                <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
                <template #password-icon="{ visible }">
                  <el-icon>
                    <Hide v-if="visible" />
                    <View v-else />
                  </el-icon>
                </template>
              </el-input>
              <CapsLockHint v-if="capsLockOn" />
              <!--
                `width:100%` 不是装饰：父级 `.el-form-item__content` 被 EP 定成
                `display:flex; flex-wrap:wrap`，两块 div 谁都不占满行宽时会被并排塞进同一行。
                中文态「密码错误，请重新输入」+「提示语： …」合计 268px < 350px 可用宽，
                于是两句拼成一句读（真机复现）；英文态合计 369px 反而自动折成两行。
                缺陷跟语言包走，所以两块都必须显式独占一行。
              -->
              <div
                v-if="verifyError"
                id="verify-error-inline"
                class="verify-error-inline"
                role="alert"
                aria-live="assertive"
              >
                <el-icon
                  class="verify-error-inline__icon"
                  aria-hidden="true"
                >
                  <WarningFilled />
                </el-icon>
                <span>{{ verifyError }}</span>
              </div>
              <!--
                提示语刻意等连续输错到达阈值才亮：第一次输错就甩出提示，
                等于把「回想」这条最低成本的路径跳过，也放大了本机旁观者读到提示的机会。
                亮出来之后给一条「收起」：提示语是明文躺在本机的，旁人窥屏时用户应当能立刻收掉它。
              -->
              <div
                v-if="hint && failCount >= MAX_FAIL_BEFORE_HINT"
                class="verify-hint-inline"
                aria-live="polite"
              >
                <span class="verify-hint-inline__label">{{ t('auth.hintShown') }}</span>
                <span
                  v-if="!hintCollapsed"
                  class="verify-hint-inline__text"
                  >{{ hint }}</span
                >
                <el-button
                  class="verify-hint-inline__toggle"
                  size="small"
                  type="info"
                  link
                  @click="hintCollapsed = !hintCollapsed"
                >
                  {{ hintCollapsed ? t('auth.hintExpand') : t('auth.hintCollapse') }}
                </el-button>
              </div>
            </el-form-item>

            <el-form-item
              :label="t('auth.validityLabel')"
              prop="validityHours"
            >
              <ValidityHoursSelect
                v-model="formModel.validityHours"
                :placeholder="t('auth.validityPlaceholder')"
                size="large"
                :disabled="verifyLoading"
                style="width: 100%"
              />
              <div class="form-tip">{{ t('auth.validityTip') }}</div>
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="verifyLoading"
                style="width: 100%"
                @click="handleSubmit"
              >
                {{ t('auth.verifySubmit') }}
              </el-button>

              <div class="verify-actions">
                <el-button
                  v-if="recoveryAvailable"
                  class="verify-actions__start"
                  size="small"
                  type="primary"
                  link
                  :disabled="verifyLoading"
                  @click="openRecovery"
                >
                  {{ t('recovery.useKey') }}
                </el-button>
                <el-button
                  v-if="isDev"
                  size="small"
                  type="info"
                  link
                  @click="$emit('debug')"
                >
                  🔍 {{ t('auth.debugInfo') }}
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  link
                  @click="showForgotDialog = true"
                >
                  {{ t('auth.forgotPassword') }}
                </el-button>
              </div>
            </el-form-item>
          </el-form>
          <!--
            找回向导：把「先想退路、再谈清空」的顺序固化下来。
            挂在锁定页内部而不是 App 顶层，是因为它只在 `showPasswordVerify` 为真时可达，
            且向导的终点直接复用父级既有的 `reset` 事件（清空与二次确认逻辑一律不改）。
          -->
          <ForgotPasswordDialog
            v-model="showForgotDialog"
            :has-hint="Boolean(hint)"
            :recovery-available="recoveryAvailable"
            @use-recovery="handleWizardUseRecovery"
            @closed="handleWizardClosed"
            @reset="handleConfirmReset"
          />
          <!--
            chunk 没取到时 `defineAsyncComponent` 默认什么都不渲染，用户看到的表现就是
            「点『使用离线恢复密钥』没反应」——dev 构建的模块来自 dev server，服务没起来
            必然 reject。这里把静默失败换成一句读得懂的提示，并留一条可关的出口：
            恢复弹窗自己不会挂载，没人能把 `showRecoveryDialog` 落回 false。
          -->
          <el-alert
            v-if="showRecoveryDialog && recoveryChunkFailed"
            class="verify-recovery-failed"
            type="error"
            closable
            show-icon
            :title="t('recovery.loadFailed')"
            @close="showRecoveryDialog = false"
          />
          <RecoveryResetDialog
            v-if="showRecoveryDialog && !recoveryChunkFailed"
            v-model="showRecoveryDialog"
            @recovered="handleRecovered"
          />
          <!-- 免责声明 -->
          <div class="disclaimer-compact">
            <DisclaimerInfo />
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, shallowRef, onMounted, defineAsyncComponent } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { View, Hide, WarningFilled } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import DisclaimerInfo from '@/components/options/DisclaimerInfo.vue';
import ValidityHoursSelect from '@/components/options/ValidityHoursSelect.vue';
import ForgotPasswordDialog from './ForgotPasswordDialog.vue';
import CapsLockHint from '@/components/CapsLockHint.vue';
import { SHAKE_DURATION_MS, MAX_FAIL_BEFORE_HINT } from '@/composables/useAuthFlow';
import { useCapsLockDetection } from '@/composables/useCapsLockDetection';
import { useI18n } from '@/utils/i18n';
import { logger } from '@/utils/logger';

/** 恢复弹窗的 chunk 是否取不到，供模板把「点了没反应」换成可读提示 */
const recoveryChunkFailed = ref(false);

const RecoveryResetDialog = defineAsyncComponent({
  loader: () =>
    import('./RecoveryResetDialog.vue').catch((error: unknown) => {
      recoveryChunkFailed.value = true;
      logger.error('恢复弹窗组件加载失败:', error);
      throw error;
    }),
});

/**
 * 主密码验证视图组件
 *
 * 展示主密码验证表单，包含密码输入、有效期选择、
 * 错误提示及抖动动画反馈等功能。
 */
const props = defineProps<{
  /** 验证表单数据 */
  verifyForm: { password: string; validityHours: number };
  /** 表单校验规则 */
  verifyRules: FormRules;
  /** 验证加载状态 */
  verifyLoading: boolean;
  /** 验证错误信息 */
  verifyError: string;
  /** 是否启用抖动动画 */
  verifyShake: boolean;
  /** 是否为开发环境 */
  isDev: boolean;
  /** 主密码提示语（空串表示用户未设置） */
  hint: string;
  /** 本次解锁已连续输错的次数 */
  failCount: number;
}>();

const emit = defineEmits<{
  submit: [];
  debug: [];
  reset: [];
  recovered: [];
  clearError: [];
  'update:verifyForm': [value: { password: string; validityHours: number }];
}>();

const { t } = useI18n();

/** 找回向导可见性 */
const showForgotDialog = ref(false);
const showRecoveryDialog = shallowRef(false);
/** 提示语条是否被用户当场收起（只作用于本次锁定，组件卸载即复位，不落盘） */
const hintCollapsed = ref(false);
/** 向导里点了「用恢复密钥取回」，但要等向导淡出结束才开恢复弹窗 */
const pendingRecovery = ref(false);

/**
 * 恢复入口只在「本机确实配过可用密钥」时出现。
 *
 * 锁定页在改造前只有「忘记密码」一个出口；无条件多挂一颗主色链接，会替从未启用恢复的
 * 用户改掉既有动作行的排布，并把他们带进一条只能读到「未启用」的死路。状态在挂载后
 * 异步读一次，不进首帧渲染链；读不到就维持改造前的样子。
 */
const recoveryAvailable = shallowRef(false);

onMounted(() => {
  // 只为一个布尔位：读恢复配置的「存在性」，别把 changeMasterPassword 的整条换钥依赖图
  // （~20 KB chunk + 一次额外盘读）拉进锁定态的首帧窗口（评审报告 P2-17）。
  void import('@/utils/storage/recoveryState')
    .then(api => api.isRecoveryEnrolled())
    .then(enrolled => {
      recoveryAvailable.value = enrolled;
    })
    .catch(() => {
      recoveryAvailable.value = false;
    });
});

const openRecovery = (): void => {
  if (props.verifyLoading) return;
  formModel.password = '';
  resetCapsLockState();
  showRecoveryDialog.value = true;
};

/**
 * 向导内的「用恢复密钥取回」：只记下意图，真正的开启动作等向导淡出结束。
 *
 * 两个都是居中模态。原先在同一 tick 里「关一个 + 开一个」，遮罩残留确实没了，
 * 但 EP 的淡出有 300ms：恢复弹窗在向导还没走完 leave 过渡时就淡入，两份文字在屏幕上
 * 叠成一屏读不出来的糊字（真机截图为证）。挂到 `closed` 上，序列才真正是「先收后开」。
 */
const handleWizardUseRecovery = (): void => {
  pendingRecovery.value = true;
  showForgotDialog.value = false;
};

/** 向导淡出结束：有待办的恢复意图就接着开恢复弹窗 */
const handleWizardClosed = (): void => {
  if (!pendingRecovery.value) return;
  pendingRecovery.value = false;
  openRecovery();
};

/** 仅刷新认证配置/提示语；不建立会话，也不向解锁框自动填入新密码。 */
const handleRecovered = (): void => {
  hintCollapsed.value = false;
  formModel.password = '';
  emit('update:verifyForm', { ...formModel });
  emit('clearError');
  emit('recovered');
};

/**
 * 向导终点「仍然重置全部数据」：先收起向导，再把清空动作交回父级的 `reset` 事件。
 * 父级 `useAuthFlow.resetMasterPassword` 内已带 lockSession → clearAllData 与二次确认，此处不复制。
 */
const handleConfirmReset = () => {
  showForgotDialog.value = false;
  emit('reset');
};

/** 主密码输入框大写锁定检测（误开大写锁定时即时提示） */
const { capsLockOn, handleCapsKeyEvent, resetCapsLockState } = useCapsLockDetection();

/** 提交前本地表单校验，通过后通知父组件 */
const handleSubmit = async () => {
  if (!localVerifyFormRef.value || props.verifyLoading || showRecoveryDialog.value) return;
  try {
    await localVerifyFormRef.value.validate();
    emit('submit');
  } catch {
    // 校验未通过
  }
};

/** 本地表单模型 */
const formModel = reactive({
  password: props.verifyForm.password,
  validityHours: props.verifyForm.validityHours,
});

watch(
  () => props.verifyForm,
  val => {
    formModel.password = val.password;
    formModel.validityHours = val.validityHours;
  },
  { deep: true },
);

watch(formModel, val => {
  emit('update:verifyForm', { ...val });
});

/** 本地表单引用 */
const localVerifyFormRef = ref<FormInstance>();

/** 暴露表单引用供父组件调用 validate */
defineExpose({ formRef: localVerifyFormRef });
</script>

<style scoped>
/* 验证页面样式 */
.verify-page {
  /* 与 MasterPasswordSetupView 同一处教训：`height:100vh + align-items:center + overflow:hidden`
     会在内容超出时把居中盒子的上下两端各推出约一半，而 hidden 让两端都不可达。
     解锁页原本连那 16px 安全边距都没有，错误行 + 提示语条 + 大写锁定提示同时出现时长约 60px，
     小屏就会被裁且滚不到。改用 flex 子项 `margin:auto` 安全居中。
     `box-sizing` 必须一起写：默认 content-box 下 `min-height:100vh` 加上上下 16px 内边距
     会把盒子撑成 100vh + 32px，于是**任何视口都恒定多出一条 32px 的幽灵滚动条**
     （真机读数 628 视口 docScroll = 660、700 视口 = 732，而内容本身只有 582px）。 */
  box-sizing: border-box;
  display: flex;
  min-height: 100vh;
  padding: 16px;
}

.verify-container {
  width: 100%;
  max-width: 400px;
  margin: auto;
}

.verify-header {
  margin-bottom: 14px;
  text-align: center;
}

.logo-section {
  /* 图标（32px）+ 间距（10px）留在居中流里，整组居中会把标题文字推到中心右侧半个图标位
     （21px），而副标题是整行居中——两行中心差 21px，肉眼读出来就是「标题没居中」。
     在**右侧**补一段等宽内边距，把内容盒的中心往左挪 21px，文字正好落回真中心，
     图标仍紧贴标题左侧。写成 padding-left 会偏到 +42（真机试过，方向反了）。 */
  display: flex;
  align-items: center;
  justify-content: center;
  padding-right: 42px;
  margin-bottom: 8px;
}

.logo-section .logo {
  margin-right: 10px;
  font-size: 32px;
  color: var(--aph-primary);
}

.verify-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #2c3e50;
}

.subtitle {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  color: var(--aph-text-muted);
}

.verify-form {
  margin-top: 14px;
}

.form-card {
  overflow: hidden;
  border: 1px solid var(--aph-surface-line);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 10%);
}

:deep(.form-card .el-card__body) {
  padding: 22px 24px;
  background: #fff;
}

.verify-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  justify-content: flex-end;

  /* 必须是满宽，否则下面的 `margin-right: auto` 是空转。
     本 div 的直接父级是 `.el-form-item__content`，EP 给它 `display: flex; flex-wrap: wrap`，
     于是它自己是个 flex item——默认 `flex: 0 1 auto` 按内容定宽，容器和内容一样宽时
     auto 外边距没有可分配的空间，链接照样贴在左边。
     （上一轮就是栽在这：探针页把它放在普通块级容器里，容器满宽、auto 边距生效，假绿。） */
  width: 100%;
  margin-top: 12px;
}

/* 逃生出口一律钉在行尾，恢复入口钉在行首。
   原先用 `justify-content: space-between`：恢复入口按 `recoveryAvailable` 显隐，
   没启用过离线恢复的用户这一行只剩一颗链接，space-between 会把它推到最左边——
   同一个逃生出口，换一台机器就换了位置。改成「整行右对齐 + 恢复入口 `margin-right:auto`」
   之后，恢复入口在就顶住左端、其余靠右；不在时那颗按钮根本不存在，剩下的照样贴右，
   位置不随邻居显隐而漂。
   调试入口（仅 dev）留在这一行内：中文三枚合计 302px < 350px 可用宽，一行放得下。
   上一版把它拆成独立一行，两行各占 32 / 28px 命中高、中间还夹 14px 行距，
   真机量出来按钮下方就是两大块空白。 */
.verify-actions__start {
  margin-right: auto;
}

/* 链接按钮默认只有 `size="small"` 的 ~24px 命中高度；刚输错过主密码的用户手在抖，
   把可点面积垫回 32px（WCAG 2.5.8 AA 的最小目标尺寸），视觉字号与文案一律不动。 */
.verify-actions :deep(.el-button.is-link) {
  min-height: 32px;
  padding: 4px 8px;
}

/* 两端的文字压回卡片内容边：按钮盒子本来就与「验证密码」主按钮共用同一条左右边缘
   （真机量到 465 / 815 完全相同），但 8px 内边距把文字往里推，用户读到的就是
   「没左对齐 / 没靠右」。首枚归零左、末枚归零右，夹在中间那枚（dev 的调试入口）不动。 */
.verify-actions > :deep(.el-button.is-link.verify-actions__start) {
  padding-left: 0;
}

.verify-actions > :deep(.el-button.is-link:last-child) {
  padding-right: 0;
}

/* 恢复弹窗的 chunk 没取到时的兜底：把「点了没反应」变成一句读得懂的提示 */
.verify-recovery-failed {
  margin-top: 12px;
}

/* 验证错误内联提示 */
.verify-error-inline {
  display: flex;
  gap: 5px;
  align-items: center;
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--aph-danger-strong);
}

.verify-error-inline__icon {
  flex: none;
  font-size: 13px;
}

/* 主密码提示语（连续输错达阈值后出现）：从「一行小字」升格成独立信息条，
   与错误在颜色、形状、缩进三个维度都区分开，不再靠字重硬撑 */
.verify-hint-inline {
  display: flex;
  gap: 7px;
  align-items: center;
  width: 100%;
  padding: 6px 9px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--aph-text-primary);
  background: var(--aph-primary-bg);
  border-left: 3px solid var(--aph-primary);
  border-radius: 0 6px 6px 0;
  animation: hint-in 0.12s ease-out both;
}

@keyframes hint-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

.verify-hint-inline__label {
  flex: none;
  font-weight: 600;
  color: var(--aph-text-secondary);
}

.verify-hint-inline__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.verify-hint-inline__toggle {
  flex: none;
  margin-left: auto;
}

/* 走信息条自己的口径，不吃 `.verify-actions` 那套 32px 命中区（本条不在那一行里）。
   选择器必须带上父级，否则压不过 EP `.el-button.is-link` 的两类特异性。
   命中区仍按 WCAG 2.5.8 垫到 28px，只是从满高信息条里收一点，不撑破条子。 */
.verify-hint-inline :deep(.el-button.is-link) {
  min-height: 28px;
  padding: 4px 6px;
  font-size: 11.5px;
  color: var(--aph-text-secondary);
}

/* 密码输入框抖动动画 */
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }

  10%,
  30%,
  50%,
  70%,
  90% {
    transform: translateX(-4px);
  }

  20%,
  40%,
  60%,
  80% {
    transform: translateX(4px);
  }
}

.shake {
  animation: shake var(--shake-duration, 400ms) ease-in-out;
}

/* 减弱动效：取消抖动。校验失败的判据由红边、错误文案与 `aria-invalid` 表达，
   摇晃只是冗余的注意力提示，去掉不丢任何信息（JS 侧仍按时清除 `shake` 类，状态机不变） */
@media (prefers-reduced-motion: reduce) {
  .shake {
    animation: none;
  }

  /* 提示语条的入场位移同理：信息本身不受影响，去掉动画不丢任何内容 */
  .verify-hint-inline {
    animation: none;
  }
}

/* 表单标签 */
:deep(.verify-form .el-form-item) {
  margin-bottom: 14px;
}

/* 表单提示 */
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--aph-text-muted);
}

/* 紧凑免责声明 */
.disclaimer-compact {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.disclaimer-compact :deep(.el-alert) {
  padding: 8px 12px;
}

.disclaimer-compact :deep(.el-alert__title) {
  font-size: 12px;
}

.disclaimer-compact :deep(.el-alert__description) {
  font-size: 11px;
  line-height: 1.4;
}
</style>
