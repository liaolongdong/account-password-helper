<template>
  <el-popover
    :visible="visible"
    placement="right"
    :width="220"
    :show-arrow="true"
    popper-class="password-rules-popover"
  >
    <template #reference>
      <slot />
    </template>
    <!-- 弹窗内容：密码规则与强度校验清单 -->
    <div class="password-rules-popover-content">
      <div class="rules-title-row">
        <span class="rules-title">{{ title }}</span>
        <span
          v-if="password && strength.label"
          class="strength-label"
          :style="{ color: strength.color }"
        >
          {{ strength.label }}
        </span>
      </div>
      <el-progress
        v-if="password"
        :percentage="strength.percentage"
        :color="strength.color"
        :stroke-width="6"
        :show-text="false"
      />
      <p
        v-else
        class="rules-hint"
      >
        {{ hint }}
      </p>
      <ul class="password-rules-list">
        <li
          v-for="rule in rules"
          :key="rule.label"
          :class="{ passed: rule.passed }"
        >
          <el-icon
            :color="rule.passed ? '#67c23a' : '#c0c4cc'"
            :size="14"
          >
            <CircleCheckFilled v-if="rule.passed" />
            <CircleCloseFilled v-else />
          </el-icon>
          <span>{{ rule.label }}</span>
        </li>
      </ul>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue';
import type { PasswordRuleItem, PasswordStrengthResult } from '@/composables/usePasswordStrength';

/**
 * 密码强度气泡弹窗组件
 *
 * 封装 el-popover + 进度条 + 规则清单 + 强度文案，
 * 通过 props 接收数据，通过默认插槽放置触发元素（如 el-input）。
 */
defineProps<{
  /** 弹窗标题，如"密码要求"或"密码强度" */
  title: string;
  /** 密码为空时的提示文案 */
  hint: string;
  /** 当前密码值，用于控制进度条与强度文案的显隐 */
  password: string;
  /** 密码强度计算结果 */
  strength: PasswordStrengthResult;
  /** 密码规则逐条校验结果 */
  rules: PasswordRuleItem[];
  /** 弹窗显隐状态（v-model:visible） */
  visible: boolean;
}>();

defineEmits<{
  /** 弹窗显隐状态变更 */
  'update:visible': [value: boolean];
}>();
</script>

<style scoped>
:global(.password-rules-popover) {
  padding: 12px 14px;
}

:global(.password-rules-popover .rules-title-row) {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

:global(.password-rules-popover .rules-title) {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

:global(.password-rules-popover .strength-label) {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  transition: color 0.2s ease;
}

:global(.password-rules-popover .rules-hint) {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
}

:global(.password-rules-popover .password-rules-list) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  margin: 8px 0 0;
  list-style: none;
}

:global(.password-rules-popover .password-rules-list li) {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
  transition: color 0.25s ease;
}

:global(.password-rules-popover .password-rules-list li.passed) {
  color: #67c23a;
}
</style>
