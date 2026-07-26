<script setup lang="ts">
import { computed } from 'vue';
import { CopyDocument } from '@element-plus/icons-vue';
import { useTotp } from '@/composables/useTotp';
import { parseOtpAuth } from '@/utils/totp';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

/**
 * 两步验证码（TOTP）展示组件
 *
 * 签名元素：环形倒计时 + 等宽分组数字。动态码由 useTotp 在本地按 RFC 6238 计算，
 * 每秒刷新倒计时环，周期结束时自动生成新码；末 5 秒环变琥珀色提示即将刷新。
 * 可选内置复制按钮，尊重 prefers-reduced-motion。
 */
interface Props {
  /** TOTP 密钥（otpauth URI 或裸 Base32 密钥） */
  secret?: string;
  /** 是否显示内置复制按钮 */
  copyable?: boolean;
  /** 是否显示解析出的参数（算法/位数/周期），用于表单预览排查非默认参数 */
  diagnostic?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  secret: '',
  copyable: false,
  diagnostic: false,
});

const secretRef = computed(() => props.secret);
const { code, valid, remaining, progress } = useTotp(secretRef);

const { t } = useI18n();

/** 圆环周长（r=15.9155 时约等于 100，使 dashoffset 直接映射为百分比） */
const RING_CIRCUMFERENCE = 100;

/** 环形进度样式：随剩余时间收缩 */
const ringStyle = computed(() => ({
  strokeDasharray: `${RING_CIRCUMFERENCE}`,
  strokeDashoffset: `${RING_CIRCUMFERENCE * (1 - progress.value)}`,
}));

/** 解析出的 TOTP 参数文本（如 "SHA-1 · 6 位 · 30 秒"），仅 diagnostic 模式展示 */
const paramsText = computed(() => {
  const parsed = parseOtpAuth((props.secret || '').trim());
  if (!parsed) return '';
  return t('totp.params', { algorithm: parsed.algorithm, digits: parsed.digits, period: parsed.period });
});

/**
 * 复制当前动态码到剪贴板
 */
const handleCopy = async (): Promise<void> => {
  if (!valid.value || !code.value) return;
  try {
    await navigator.clipboard.writeText(code.value);
    ElMessage.success(t('totp.copied'));
  } catch (error) {
    logger.error('复制验证码失败:', error);
    ElMessage.error(t('message.copyFailed'));
  }
};
</script>

<template>
  <div
    class="totp-code"
    :class="{ 'is-invalid': !valid }"
  >
    <template v-if="valid">
      <div
        class="totp-code__ring"
        :class="{ 'is-expiring': remaining <= 5 }"
      >
        <svg
          class="totp-code__ring-svg"
          viewBox="0 0 36 36"
        >
          <circle
            class="totp-code__ring-track"
            cx="18"
            cy="18"
            r="15.9155"
          />
          <circle
            class="totp-code__ring-progress"
            cx="18"
            cy="18"
            r="15.9155"
            :style="ringStyle"
          />
        </svg>
        <span class="totp-code__ring-num">{{ remaining }}</span>
      </div>
      <span class="totp-code__digits">{{ code }}</span>
      <el-icon
        v-if="copyable"
        class="totp-code__copy"
        :title="t('sidepanel.item.copyTotp')"
        @click.stop="handleCopy"
      >
        <CopyDocument />
      </el-icon>
      <div
        v-if="diagnostic"
        class="totp-code__params"
      >
        {{ paramsText }}
      </div>
    </template>
    <span
      v-else
      class="totp-code__invalid"
      >{{ t('totp.invalidSecret') }}</span
    >
  </div>
</template>

<style scoped>
.totp-code {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  align-items: center;
}

.totp-code__ring {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}

.totp-code__ring-svg {
  width: 22px;
  height: 22px;
  transform: rotate(-90deg);
}

.totp-code__ring-track {
  fill: none;
  stroke: #e4e7ed;
  stroke-width: 3;
}

.totp-code__ring-progress {
  fill: none;
  stroke: var(--aph-primary);
  stroke-width: 3;
  stroke-linecap: round;
  transition:
    stroke-dashoffset 0.95s linear,
    stroke 0.3s ease;
}

.totp-code__ring-num {
  position: absolute;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: #909399;
}

.totp-code__ring.is-expiring .totp-code__ring-progress {
  stroke: #e6a23c;
}

.totp-code__ring.is-expiring .totp-code__ring-num {
  color: #e6a23c;
}

.totp-code__digits {
  font-family: SFMono-Regular, consolas, 'Liberation Mono', menlo, monospace;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #1f2937;
  letter-spacing: 1px;
}

.totp-code__params {
  flex-basis: 100%;
  font-size: 11px;
  color: #909399;
}

.totp-code__copy {
  font-size: 14px;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.2s ease;
}

.totp-code__copy:hover {
  color: var(--aph-primary);
}

.totp-code__invalid {
  font-size: 12px;
  font-style: italic;
  color: #c0c4cc;
}

@media (prefers-reduced-motion: reduce) {
  .totp-code__ring-progress {
    transition: none;
  }
}
</style>
