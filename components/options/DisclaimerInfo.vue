<template>
  <!-- 免责声明 -->
  <div class="disclaimer-section">
    <el-alert
      :title="t('options.disclaimer.title')"
      :description="t('options.disclaimer.desc')"
      type="warning"
      :closable="false"
      show-icon
      size="small"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '@/utils/i18n';

const { t } = useI18n();
</script>

<style scoped></style>
