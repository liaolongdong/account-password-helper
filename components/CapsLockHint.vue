<script setup lang="ts">
import { WarningFilled } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';

/**
 * Caps Lock 大写锁定提示
 *
 * 在主密码等敏感输入框下方展示警示行，配合 useCapsLockDetection 使用；
 * role="status" 使屏幕阅读器以非打断方式播报状态变化。
 */
const { t } = useI18n();
</script>

<template>
  <div
    class="caps-lock-hint"
    role="status"
  >
    <el-icon class="caps-lock-hint__icon"><WarningFilled /></el-icon>
    <span>{{ t('auth.capsLockWarning') }}</span>
  </div>
</template>

<style scoped>
.caps-lock-hint {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #e6a23c;
}

.caps-lock-hint__icon {
  font-size: 12px;
}
</style>
