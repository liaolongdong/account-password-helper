<script setup lang="ts">
import { useI18n } from '@/utils/i18n';
import type { EnvChipOption } from '@/utils/envFamily';

/**
 * 本地开发页的环境选择条
 *
 * 为什么不挂在头部芯片下面（做成浮层）：头部卡片 `overflow: hidden`，浮层会被裁掉，
 * 而为了一个面板去放开裁切会牵动整行布局。改成在卡片下方展开一条横向选项带，
 * 展开态即「本页正在按哪个环境显示账号」，收回即恢复只看本机端点。
 *
 * 只做展示与事件上报：绑定状态由父级写回后台（`SET_ENV_BINDING`），确认后再生效，
 * 本组件不持有任何跨组件状态，也不注册全局监听（收起由父级判定，见下）。
 */
interface Props {
  /** 可选环境（由 `collectEnvFamilies` 派生） */
  options: EnvChipOption[];
  /** 当前生效的绑定主机；空串表示未绑定 */
  activeHost: string;
  /**
   * 待确认的线上/无法识别环境主机；空串表示没有待确认项
   *
   * 这个值由后台的拒绝（`needsAck`）产生，而不是前端自己判「是不是 prod」：
   * 门禁留在后台，界面漏判一次也不会放行。
   */
  pendingConfirmHost: string;
}

interface Emits {
  /** 选定环境（空串 = 清除绑定） */
  pick: [host: string];
  /** 确认把该环境的账号带到本地页 */
  confirm: [];
  /** 收回确认 */
  cancelConfirm: [];
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useI18n();

// 本组件刻意不注册任何全局监听：「点外面收起」与 Esc 由父级统一接管（它同时看得见头部芯片，
// 而芯片在选择条之外）。选择条自己监听就会在同一次点击里先关后开，面板收不起来。
</script>

<template>
  <div
    class="env-bar"
    role="group"
    :aria-label="t('sidepanel.env.pickerAria')"
  >
    <span class="env-bar__title">{{ t('sidepanel.env.pickerTitle') }}</span>
    <button
      v-for="option in options"
      :key="option.host"
      type="button"
      class="env-bar__opt"
      :class="{
        'env-bar__opt--active': option.host === activeHost,
        'env-bar__opt--danger': option.production,
      }"
      :title="option.siblingCount > 0 ? t('sidepanel.env.siblingsHint', { count: option.siblingCount }) : option.host"
      @click="emit('pick', option.host)"
    >
      {{ option.label }}
      <span class="env-bar__count">{{ option.count }}</span>
    </button>
    <button
      v-if="activeHost"
      type="button"
      class="env-bar__opt env-bar__opt--clear"
      @click="emit('pick', '')"
    >
      {{ t('sidepanel.env.clear') }}
    </button>
    <!-- 线上确认：确认条出现在点完之后、生效之前，说清「接下来会把哪套账号带到这一页」 -->
    <div
      v-if="pendingConfirmHost"
      class="env-confirm"
      role="alertdialog"
      :aria-label="t('sidepanel.env.confirmTitle')"
    >
      <span class="env-confirm__text">
        {{ t('sidepanel.env.confirmText', { host: pendingConfirmHost }) }}
      </span>
      <button
        type="button"
        class="env-confirm__btn env-confirm__btn--yes"
        @click="emit('confirm')"
      >
        {{ t('sidepanel.env.confirmYes') }}
      </button>
      <button
        type="button"
        class="env-confirm__btn"
        @click="emit('cancelConfirm')"
      >
        {{ t('sidepanel.env.confirmNo') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 选择条：贴着头部卡片的一条横向带，随主题令牌换肤，不引入新的色值 */
.env-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 6px 16px;
  background: var(--aph-surface-2);
  border-bottom: 1px solid var(--aph-surface-line);
}

.env-bar__title {
  margin-right: 2px;
  font-size: 12px;
  color: var(--aph-text-muted);
}

.env-bar__opt {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 2px 8px;
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--aph-text-secondary);
  cursor: pointer;
  background: var(--aph-surface);
  border: 1px solid var(--aph-surface-line);
  border-radius: 999px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.env-bar__opt:hover {
  background: var(--aph-surface-hover);
}

.env-bar__opt:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

.env-bar__opt--active {
  font-weight: 600;
  color: var(--aph-primary);
  background: var(--aph-primary-bg);
  border-color: var(--aph-primary-border);
}

.env-bar__opt--danger {
  color: var(--aph-danger-strong);
  border-color: var(--el-color-danger-light-7);
}

.env-bar__count {
  padding: 0 4px;
  font-size: 11px;
  color: var(--aph-text-muted);
  background: var(--aph-surface-2);
  border-radius: 6px;
}

.env-bar__opt--clear {
  color: var(--aph-text-muted);
}

/* 确认条：整行换到警示底，与普通选项在视觉上分开——它要用户做一个决定，不是再点一下 */
.env-confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--aph-danger-strong);
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 8px;
}

.env-confirm__text {
  flex: 1;
  min-width: 160px;
}

.env-confirm__btn {
  padding: 2px 10px;
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--aph-danger-strong);
  cursor: pointer;
  background: var(--aph-surface);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 999px;
}

.env-confirm__btn:hover {
  background: var(--aph-surface-hover);
}

.env-confirm__btn:focus-visible {
  outline: 2px solid var(--el-color-danger-light-3);
  outline-offset: 1px;
}

/* 主操作用实心危险色：确认按钮必须比「取消」更重，避免误点把线上凭证带进本地页 */
.env-confirm__btn--yes {
  color: #fff;
  background: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.env-confirm__btn--yes:hover {
  background: var(--el-color-danger-dark-2);
}
</style>
